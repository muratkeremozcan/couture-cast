// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-00i (TD-01): the harness half of the text layout probe. How an answer is asked for and read
// back on each platform, the wire contract check, and how records pair with hierarchy nodes
// (TEA change 5 and the rulings of 2026-11-14). The judging rules live in
// live-font-scale-proof.test.mjs beside the rest of the oracle.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import { probeRecord } from './fixtures/live-font-text-probe-records.mjs'
import {
  assembleLogcatAnswer,
  boundedCall,
  coveredWindows,
  createTextProbe,
  matchTextProbe,
  TEXT_PROBE_ACTION,
  TEXT_PROBE_NOTIFICATION,
  validateTextProbeAnswer,
} from './live-font-text-probe.mjs'

const WINDOW = { id: 1, rect: [0, 0, 1080, 2400], z: 0, focused: true }
const answerFor = (
  token,
  records,
  { platform = 'android', windows = [WINDOW] } = {}
) => ({
  version: 1,
  token,
  platform,
  windows,
  records,
})
const record = (text, rect, overrides) => probeRecord('android', text, rect, overrides)
const iosRecord = (text, rect, overrides) => probeRecord('ios', text, rect, overrides)

/** The logcat lines the app writes for one answer, `size` base64 characters per chunk. */
function logcatLines(token, json, { size = 40, cut = 'string', hash } = {}) {
  const bytes = Buffer.from(json, 'utf8')
  const digest = hash ?? createHash('sha256').update(bytes).digest('hex')
  let chunks
  if (cut === 'string') {
    const text = bytes.toString('base64')
    chunks = []
    for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size))
  } else {
    // Each piece of bytes encoded on its own, padding and all.
    chunks = []
    for (let at = 0; at < bytes.length; at += size)
      chunks.push(bytes.subarray(at, at + size).toString('base64'))
  }
  const line = (message) => `11-14 10:00:00.000  4321  4321 I TextLayoutProbe: ${message}`
  return [
    line(`begin ${token} ${chunks.length} ${digest}`),
    ...chunks.map((chunk, index) => line(`chunk ${token} ${index} ${chunk}`)),
    line(`done ${token}`),
  ]
}

const SAMPLE = answerFor('t1', [
  record('68°F', [97, 1080, 170, 1127]),
  record('Hourly Forecast · ünïcode ✓', [42, 814, 308, 865]),
])

describe('assembleLogcatAnswer', () => {
  test('reassembles chunks by index, whichever way the base64 is cut, among other tokens', () => {
    const json = JSON.stringify(SAMPLE)
    for (const cut of ['string', 'bytes']) {
      const lines = logcatLines('t1', json, { size: 30, cut })
      const [begin, ...rest] = lines
      const done = rest.pop()
      // Chunks out of order, a line of another ask in between, and noise from the app.
      const shuffled = [
        begin,
        ...logcatLines('t0', '{"other":1}').slice(1),
        ...rest.reverse(),
        '11-14 10:00:00.001  4321  4321 I ReactNativeJS: hello',
        done,
      ]
      const outcome = assembleLogcatAnswer(shuffled.join('\n'), 't1')
      assert.equal(outcome.status, 'complete', cut)
      assert.equal(outcome.json, json)
      assert.ok(rest.length > 2, 'the sample spans several chunks')
    }
  })

  test('a hash that does not match the chunks is a hash mismatch, never an answer', () => {
    const json = JSON.stringify(SAMPLE)
    const lines = logcatLines('t1', json, { hash: 'a'.repeat(64) })
    assert.equal(assembleLogcatAnswer(lines.join('\n'), 't1').status, 'hash_mismatch')
    // One chunk changed in flight.
    const tampered = logcatLines('t1', json).map((line, index) =>
      index === 1
        ? line.replace(
            / (\S)(\S*)$/,
            (_, first, rest) => ` ${first === 'A' ? 'B' : 'A'}${rest}`
          )
        : line
    )
    assert.equal(assembleLogcatAnswer(tampered.join('\n'), 't1').status, 'hash_mismatch')
  })

  test('nothing, a missing chunk, a missing done line or a conflicting chunk is no answer', () => {
    const lines = logcatLines('t1', JSON.stringify(SAMPLE), { size: 30 })
    assert.equal(assembleLogcatAnswer('', 't1').status, 'absent')
    assert.equal(assembleLogcatAnswer(lines.join('\n'), 't2').status, 'absent')
    assert.equal(
      assembleLogcatAnswer(lines.filter((_, index) => index !== 2).join('\n'), 't1')
        .status,
      'incomplete'
    )
    assert.equal(
      assembleLogcatAnswer(lines.slice(0, -1).join('\n'), 't1').status,
      'incomplete'
    )
    assert.equal(
      assembleLogcatAnswer(lines.slice(1).join('\n'), 't1').status,
      'incomplete'
    )
    const conflicting = [...lines, lines[1].replace(/ \S+$/, ' QUFB')]
    assert.equal(assembleLogcatAnswer(conflicting.join('\n'), 't1').status, 'conflict')
  })
})

/**
 * A fake Android device: the app answers each broadcast as `answers[ask]` says ('ok', 'hash',
 * 'none', 'partial'), appending to the logcat it keeps; `now` moves on with each logcat read.
 */
function fakeAndroid(answers, build = (token) => answerFor(token, SAMPLE.records)) {
  const calls = []
  let logcat = []
  let clock = 0
  let asks = 0
  const exec = (binary, args, options) => {
    calls.push({ binary, args, options })
    if (args.includes('broadcast')) {
      const token = args[args.indexOf('token') + 1]
      const mode = answers[asks] ?? 'none'
      asks += 1
      const json = JSON.stringify(build(token))
      if (mode === 'ok') logcat.push(...logcatLines(token, json))
      if (mode === 'hash')
        logcat.push(...logcatLines(token, json, { hash: '0'.repeat(64) }))
      if (mode === 'partial') logcat.push(...logcatLines(token, json).slice(0, -1))
      return 'Broadcast completed: result=0'
    }
    if (args.includes('logcat')) {
      clock += 1000
      return logcat.join('\n')
    }
    throw new Error(`unexpected call ${args.join(' ')}`)
  }
  let next = 0
  const probe = createTextProbe({
    platform: 'android',
    device: 'emulator-5554',
    appId: 'com.couturecast.story68',
    adbBinary: '/sdk/adb',
    exec,
    sleep: () => undefined,
    now: () => clock,
    makeToken: () => `tok${(next += 1)}`,
    answerMs: 3000,
  })
  return { probe, calls, reset: () => (logcat = []) }
}

describe('createTextProbe on Android', () => {
  test('broadcasts to the package with a token and reads the answer back from logcat', () => {
    const { probe, calls } = fakeAndroid(['ok'])
    const answer = probe.read()
    assert.equal(answer.token, 'tok1')
    assert.deepEqual(answer.records, SAMPLE.records)
    assert.deepEqual(answer.asks, [{ token: 'tok1', status: 'complete' }])
    assert.deepEqual(calls[0].args, [
      '-s',
      'emulator-5554',
      'shell',
      'am',
      'broadcast',
      '-a',
      TEXT_PROBE_ACTION,
      '--es',
      'token',
      'tok1',
      '-p',
      'com.couturecast.story68',
    ])
    assert.deepEqual(calls[1].args, [
      '-s',
      'emulator-5554',
      'logcat',
      '-d',
      '-s',
      'TextLayoutProbe',
    ])
    // Every external call carries a bound.
    assert.ok(calls.every((call) => call.options.timeout > 0))
  })

  test('a hash mismatch or a partial answer asks again with a new token', () => {
    const { probe } = fakeAndroid(['hash', 'partial', 'ok'])
    const answer = probe.read()
    assert.equal(answer.token, 'tok3')
    assert.deepEqual(
      answer.asks.map((ask) => ask.status),
      ['hash_mismatch', 'incomplete', 'complete']
    )
  })

  test('no whole answer after three asks fails as live_font_text_probe_missing', () => {
    for (const answers of [[], ['hash', 'hash', 'hash'], ['none', 'partial', 'hash']]) {
      const { probe, calls } = fakeAndroid(answers)
      assert.throws(
        () => probe.read(),
        (error) =>
          error.code === 'live_font_text_probe_missing' &&
          /tok1 .*tok2 .*tok3 /.test(error.message)
      )
      assert.equal(calls.filter((call) => call.args.includes('broadcast')).length, 3)
    }
    // The fourth ask never happens: an answer only to it is missing too.
    const { probe } = fakeAndroid(['none', 'none', 'none', 'ok'])
    assert.throws(() => probe.read(), { code: 'live_font_text_probe_missing' })
  })

  test('an answer that breaks the contract fails at once, without asking again', () => {
    const { probe, calls } = fakeAndroid(['ok'], (token) =>
      answerFor(token, [
        { ...SAMPLE.records[0], kind: 'unknown:com.facebook.NewTextView' },
      ])
    )
    assert.throws(() => probe.read(), { code: 'live_font_text_probe_unknown_view' })
    assert.equal(calls.filter((call) => call.args.includes('broadcast')).length, 1)
  })

  test('a device, package or token that is not shell-safe is refused before any call', () => {
    const base = {
      platform: 'android',
      device: 'emulator-5554',
      appId: 'com.a.b',
      exec: () => '',
    }
    for (const bad of [
      { device: 'emu;rm -rf /' },
      { appId: 'com.a b' },
      { device: undefined },
    ])
      assert.throws(() => createTextProbe({ ...base, ...bad }), {
        code: 'live_font_text_probe_invalid',
      })
    const probe = createTextProbe({ ...base, makeToken: () => '$(reboot)' })
    assert.throws(() => probe.read(), { code: 'live_font_text_probe_invalid' })
  })
})

describe('createTextProbe on iOS', () => {
  function fakeIos(t, answers) {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'text-probe-'))
    t.after(() => fs.rmSync(container, { recursive: true, force: true }))
    const dir = path.join(container, 'Library/Caches/text-layout-probe')
    const calls = []
    let asks = 0
    let clock = 0
    const exec = (binary, args, options) => {
      calls.push({ binary, args, options })
      if (args[1] === 'get_app_container') return `${container}\n`
      if (args.includes('notifyutil')) {
        // The app reads the request and writes its answer beside it.
        const token = fs.readFileSync(path.join(dir, 'request'), 'utf8')
        const mode = answers[asks] ?? 'none'
        asks += 1
        const json = JSON.stringify(
          answerFor(token, [iosRecord('57°F', [16, 173, 115, 235])], {
            platform: 'ios',
            windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }],
          })
        )
        if (mode === 'ok') fs.writeFileSync(path.join(dir, `${token}.json`), json)
        if (mode === 'torn')
          fs.writeFileSync(path.join(dir, `${token}.json`), json.slice(0, 20))
        return ''
      }
      throw new Error(`unexpected call ${args.join(' ')}`)
    }
    let next = 0
    const probe = createTextProbe({
      platform: 'ios',
      device: '1B2C3D4E-0000-1111-2222-333344445555',
      appId: 'com.couturecast.story68',
      exec,
      sleep: () => {
        clock += 250
      },
      now: () => clock,
      makeToken: () => `tok${(next += 1)}`,
      answerMs: 1000,
    })
    return { probe, calls, dir }
  }

  test('writes the token to the request file, posts the notification and reads <token>.json', (t) => {
    const { probe, calls, dir } = fakeIos(t, ['ok'])
    const answer = probe.read()
    assert.equal(answer.token, 'tok1')
    assert.equal(answer.records[0].text, '57°F')
    assert.deepEqual(calls[0].args, [
      'simctl',
      'get_app_container',
      '1B2C3D4E-0000-1111-2222-333344445555',
      'com.couturecast.story68',
      'data',
    ])
    assert.deepEqual(calls[1].args, [
      'simctl',
      'spawn',
      '1B2C3D4E-0000-1111-2222-333344445555',
      'notifyutil',
      '-p',
      TEXT_PROBE_NOTIFICATION,
    ])
    assert.equal(fs.readFileSync(path.join(dir, 'request'), 'utf8'), 'tok1')
    // The answer read is removed, so the next ask cannot read it again.
    assert.equal(fs.existsSync(path.join(dir, 'tok1.json')), false)
  })

  test('a torn or absent answer file asks again; three without one fail as missing', (t) => {
    const { probe } = fakeIos(t, ['torn', 'none', 'ok'])
    assert.deepEqual(
      probe.read().asks.map((ask) => ask.status),
      ['incomplete', 'absent', 'complete']
    )
    const { probe: silent, calls } = fakeIos(t, [])
    assert.throws(() => silent.read(), { code: 'live_font_text_probe_missing' })
    assert.equal(calls.filter((call) => call.args.includes('notifyutil')).length, 3)
  })
})

describe('boundedCall', () => {
  test('a call past its bound, a nonzero exit or a bad bound fails coded', () => {
    assert.equal(boundedCall('sh', ['-c', 'printf ok']), 'ok')
    assert.throws(
      () => boundedCall('sleep', ['5'], { timeout: 100 }),
      (error) =>
        error.code === 'live_font_text_probe_command_failed' &&
        /ETIMEDOUT/.test(error.message)
    )
    assert.throws(
      () => boundedCall('sh', ['-c', 'exit 3']),
      (error) =>
        error.code === 'live_font_text_probe_command_failed' &&
        /exit 3/.test(error.message)
    )
    for (const timeout of [0, -1, 'abc', 1.5])
      assert.throws(() => boundedCall('true', [], { timeout }), {
        code: 'live_font_text_probe_timeout_invalid',
      })
  })
})

describe('validateTextProbeAnswer', () => {
  const ok = () => structuredClone(SAMPLE)
  const asked = { platform: 'android', token: 't1' }

  test('text inputs are known kinds, each on its own platform', () => {
    const android = ok()
    android.records[0].kind = 'ReactEditText'
    assert.doesNotThrow(() => validateTextProbeAnswer(android, asked))
    android.records[0].kind = 'RCTTextInputComponentView'
    assert.throws(() => validateTextProbeAnswer(android, asked), {
      code: 'live_font_text_probe_invalid',
    })
    const ios = answerFor(
      't1',
      [iosRecord('Caption', [16, 400, 386, 440], { kind: 'RCTTextInputComponentView' })],
      { platform: 'ios' }
    )
    assert.doesNotThrow(() =>
      validateTextProbeAnswer(ios, { platform: 'ios', token: 't1' })
    )
  })

  test('a well-formed answer passes as it is', () => {
    assert.deepEqual(validateTextProbeAnswer(ok(), asked), SAMPLE)
    const ios = answerFor('t1', [iosRecord('57°F', [16, 173, 115, 235])], {
      platform: 'ios',
    })
    assert.doesNotThrow(() =>
      validateTextProbeAnswer(ios, { platform: 'ios', token: 't1' })
    )
  })

  test('a text view of an unknown class fails as live_font_text_probe_unknown_view', () => {
    const answer = ok()
    answer.records[1].kind = 'unknown:com.facebook.react.views.text.FancyTextView'
    assert.throws(
      () => validateTextProbeAnswer(answer, asked),
      (error) =>
        error.code === 'live_font_text_probe_unknown_view' &&
        /record 1 unknown:/.test(error.message)
    )
  })

  test('every breach of the contract fails as live_font_text_probe_invalid', () => {
    const cases = {
      version: (a) => (a.version = 2),
      token: (a) => (a.token = 't9'),
      platform: (a) => (a.platform = 'ios'),
      'extra top-level field': (a) => (a.debug = true),
      'records not a list': (a) => (a.records = {}),
      'another platform kind': (a) => (a.records[0].kind = 'RCTParagraphComponentView'),
      'extra record field': (a) => (a.records[0].extra = 1),
      'missing record field': (a) => delete a.records[0].clipRect,
      'inverted rect': (a) => (a.records[0].viewRect = [10, 10, 5, 20]),
      'short rect': (a) => (a.records[0].contentRect = [1, 2, 3]),
      'NaN in a rect': (a) => (a.records[0].visibleRect = [0, 0, Number.NaN, 1]),
      'text not a string': (a) => (a.records[0].text = 5),
      'negative ellipsized': (a) => (a.records[0].ellipsized = -1),
      'fractional lineCount': (a) => (a.records[0].lineCount = 1.5),
      'zero maxLines': (a) => (a.records[0].maxLines = 0),
      'unknown window': (a) => (a.records[0].window = 7),
      'duplicate window id': (a) => a.windows.push({ ...WINDOW, focused: false }),
      'two focused windows': (a) => a.windows.push({ ...WINDOW, id: 2 }),
      'scrolled away yet visible': (a) => (a.records[0].scrolledAway = true),
      'visible without a clipRect': (a) => (a.records[0].clipRect = null),
      'hidden with a clipRect': (a) => (a.records[0].visibleRect = null),
      'missing opacity': (a) => delete a.records[0].opacity,
      'opacity above 1': (a) => (a.records[0].opacity = 1.5),
      'negative opacity': (a) => (a.records[0].opacity = -0.1),
      'opacity as text': (a) => (a.records[0].opacity = '1'),
      'offWindow as text': (a) => (a.records[0].offWindow = 'true'),
      'offWindow yet visible': (a) => (a.records[0].offWindow = true),
      'offWindow and scrolled away': (a) =>
        Object.assign(a.records[0], {
          offWindow: true,
          visibleRect: null,
          clipRect: null,
          scrolledAway: true,
        }),
    }
    for (const [name, mutate] of Object.entries(cases)) {
      const answer = ok()
      mutate(answer)
      assert.throws(
        () => validateTextProbeAnswer(answer, asked),
        { code: 'live_font_text_probe_invalid' },
        name
      )
    }
    assert.throws(() => validateTextProbeAnswer(null, asked), {
      code: 'live_font_text_probe_invalid',
    })
  })
})

/** Hierarchy text nodes as the oracle hands them over: text, id and box. */
const node = (text, box, id = '') => ({ text, id, box })
const match = (nodes, records, options = {}) =>
  matchTextProbe({
    platform: 'android',
    nodes,
    answer: answerFor('t', records, options),
    window: [0, 0, 1080, 2400],
    tolerance: 2,
    ...options,
  })

describe('matchTextProbe, exact text one to one', () => {
  // Five "68°F" labels of the hourly ribbon: one text, five places.
  const xs = [97, 302, 507, 711, 916]
  const ribbonNodes = xs.map((x) => node('68°F', [x, 1080, x + 73, 1127]))
  const ribbonRecords = xs.map((x) => record('68°F', [x, 1080, x + 73, 1127]))

  /** Each pair as [node left edge, record left edge], left to right. */
  const pairsOf = (result, nodes, records) =>
    result.pairs
      .map((pair) => [nodes[pair.node].box[0], records[pair.record].viewRect[0]])
      .sort((a, b) => a[0] - b[0])
  const orders = (nodes, records) => [
    [nodes, records],
    [nodes, [...records].reverse()],
    [[...nodes].reverse(), records],
    [[nodes[2], nodes[0], nodes[4], nodes[1], nodes[3]], [...records].reverse()],
  ]

  test('repeated text pairs by position, whatever order either side lists it in', () => {
    for (const [nodes, records] of orders(ribbonNodes, ribbonRecords)) {
      const result = match(nodes, records)
      assert.equal(result.pass, true)
      assert.deepEqual(
        pairsOf(result, nodes, records),
        xs.map((x) => [x, x])
      )
    }
  })

  test('repeats whose boxes touch their neighbours still pair each with its own', () => {
    // Five labels edge to edge: each record touches three nodes, so only overlap decides.
    const edges = [0, 73, 146, 219, 292]
    const nodes = edges.map((x) => node('68°F', [x, 1080, x + 73, 1127]))
    const records = edges.map((x) => record('68°F', [x, 1080, x + 73, 1127]))
    for (const [n, r] of orders(nodes, records)) {
      const result = match(n, r)
      assert.equal(result.pass, true)
      assert.deepEqual(
        pairsOf(result, n, r),
        edges.map((x) => [x, x])
      )
    }
  })

  test('of two same-text pairs that touch, the better overlap wins over screen order', () => {
    // A tall Save row whose own text sits low, beside a short Save button whose text sits high:
    // screen order alone would give the tall row the button's text.
    const nodes = [node('Save', [0, 0, 100, 100]), node('Save', [90, 5, 200, 40])]
    const records = [record('Save', [100, 10, 190, 30]), record('Save', [10, 50, 80, 90])]
    const result = match(nodes, records)
    assert.equal(result.pass, true)
    assert.deepEqual(result.pairs.map((pair) => [pair.node, pair.record]).sort(), [
      [0, 1],
      [1, 0],
    ])
  })

  test('a hierarchy rect cut to what shows pairs with the visibleRect of its record', () => {
    // The scroll view cuts "Bottom" to its last 6 px; the record's view is whole.
    const result = match(
      [node('Bottom', [81, 2184, 920, 2190])],
      [record('Bottom', [81, 2184, 920, 2238], { visibleRect: [81, 2184, 920, 2190] })]
    )
    assert.equal(result.pass, true)
    assert.equal(result.pairs.length, 1)
  })

  test('the probe reporting nothing for one node fails as unmatched (the mutant)', () => {
    const result = match(ribbonNodes, ribbonRecords.slice(0, 4))
    assert.equal(result.pass, false)
    assert.equal(result.code, 'live_font_text_probe_unmatched')
    assert.deepEqual(result.unmatchedNodes, [4])
    assert.deepEqual(result.unmatchedRecords, [])
  })

  test('a visible record no node shows fails as unmatched', () => {
    const result = match(ribbonNodes.slice(1), ribbonRecords)
    assert.equal(result.code, 'live_font_text_probe_unmatched')
    assert.deepEqual(result.unmatchedRecords, [0])
  })

  // TEA ruling 2026-11-14, from the b0bd7215 Android Release Home cold probe (records 53 and
  // 54): the bottom tab bar stacks an active and an inactive icon, byte-identical but for
  // opacity, and the hierarchy shows one.
  const tabIcon = (opacity) =>
    record('\uf015', [100, 2207, 169, 2282], {
      unlimitedLineCount: 1,
      window: 1,
      opacity,
    })
  // TEA ruling 2026-11-14: offWindow, optional so older captures read as false.
  test('a record with or without offWindow passes the contract', () => {
    const without = structuredClone(SAMPLE)
    assert.doesNotThrow(() =>
      validateTextProbeAnswer(without, { platform: 'android', token: 't1' })
    )
    const parked = structuredClone(SAMPLE)
    Object.assign(parked.records[0], {
      offWindow: true,
      visibleRect: null,
      clipRect: null,
    })
    parked.records[1].offWindow = false
    assert.doesNotThrow(() =>
      validateTextProbeAnswer(parked, { platform: 'android', token: 't1' })
    )
  })

  test('a parked sheet below the screen is listed offWindow and owes no node', () => {
    const sheet = record('Share your look', [42, 2500, 600, 2560], {
      offWindow: true,
      visibleRect: null,
      clipRect: null,
    })
    const result = match([], [sheet])
    assert.equal(result.pass, true, result.code)
    assert.deepEqual(result.offWindow, [{ record: 0, node: null, comparable: true }])
    assert.deepEqual(result.hiddenRecords, [])
  })

  test('a stacked icon pair passes, its opacity 0 copy listed invisible', () => {
    const result = match(
      [node('\uf015', [100, 2207, 169, 2282])],
      [tabIcon(1), tabIcon(0)]
    )
    assert.equal(result.pass, true, result.code)
    assert.deepEqual(
      result.pairs.map((pair) => [pair.node, pair.record]),
      [[0, 0]]
    )
    assert.deepEqual(result.invisible, [{ record: 1, node: 0, comparable: true }])
    // Listed in either order, the visible copy pairs.
    assert.equal(
      match([node('\uf015', [100, 2207, 169, 2282])], [tabIcon(0), tabIcon(1)]).pass,
      true
    )
  })

  test('a visible duplicate, however faint, still fails as unmatched', () => {
    for (const faint of [1, 0.4, 0.01]) {
      const result = match(
        [node('\uf015', [100, 2207, 169, 2282])],
        [tabIcon(1), tabIcon(faint)]
      )
      assert.equal(result.code, 'live_font_text_probe_unmatched', String(faint))
      assert.deepEqual(result.invisible, [])
    }
  })

  test('the same text far from the node is no pair, so a missing record cannot hide', () => {
    const result = match(
      [node('68°F', [97, 1080, 170, 1127])],
      [record('68°F', [97, 300, 170, 347])]
    )
    assert.equal(result.code, 'live_font_text_probe_unmatched')
    assert.deepEqual([result.unmatchedNodes, result.unmatchedRecords], [[0], [0]])
  })

  test('Android has no groups: a node whose text no record carries is unmatched', () => {
    const result = match(
      [node('New post', [0, 100, 300, 140])],
      [record('New', [0, 100, 140, 140]), record('post', [150, 100, 300, 140])]
    )
    assert.equal(result.code, 'live_font_text_probe_unmatched')
    assert.deepEqual(result.groups, [])
  })
})

describe('matchTextProbe, records out of matching (TEA rulings 2026-11-14)', () => {
  test('a scrolled-away record is listed offscreen and passes; a visible one would not', () => {
    const scrolled = record('Shoes', [16, 2600, 386, 2660], {
      visibleRect: null,
      scrolledAway: true,
    })
    const result = match([], [scrolled])
    assert.equal(result.pass, true)
    assert.deepEqual(result.offscreen, [0])
    assert.equal(match([], [record('Shoes', [16, 2600, 386, 2660])]).pass, false)
  })

  test('a hidden record (nothing shows, not scrolled away) is listed for the clip judgement', () => {
    const collapsed = record('Details', [16, 600, 386, 660], {
      visibleRect: null,
      clipRect: null,
    })
    const result = match([], [collapsed])
    assert.equal(result.pass, true, 'no hierarchy node is owed')
    assert.deepEqual(result.hiddenRecords, [0])
  })

  test('volatile records stay out of matching and are listed by region', () => {
    const result = matchTextProbe({
      platform: 'android',
      nodes: [],
      answer: answerFor('t', [record('Everyday Layering Tee', [81, 1862, 999, 1915])]),
      window: [0, 0, 1080, 2400],
      volatileRegions: [
        [0, 0, 10, 10],
        [81, 1862, 999, 1915],
      ],
      tolerance: 2,
    })
    assert.equal(result.pass, true)
    assert.deepEqual(result.volatile, [{ record: 0, region: 1 }])
  })

  test('records under a focused covering window are left out and counted', () => {
    const windows = [
      { id: 1, rect: [0, 0, 1080, 2400], z: 0, focused: false },
      { id: 2, rect: [0, 0, 1080, 2400], z: 1, focused: true },
    ]
    const records = [
      record('Home', [42, 176, 184, 247], { window: 1 }),
      record('Share card', [42, 300, 400, 360], { window: 2 }),
    ]
    const result = match([node('Share card', [42, 300, 400, 360])], records, { windows })
    assert.equal(result.pass, true)
    assert.deepEqual(result.covered, [{ window: 1, by: 2, whole: true, records: 1 }])
    assert.deepEqual(result.behind, [])
  })

  test('a window that is not focused, or not above, covers nothing', () => {
    const under = { id: 1, rect: [0, 0, 1080, 2400], z: 0, focused: false }
    for (const cover of [
      { id: 2, rect: [0, 0, 1080, 2400], z: 1, focused: false },
      { id: 2, rect: [0, 0, 1080, 2400], z: -1, focused: true },
    ]) {
      const records = [
        record('Home', [42, 176, 184, 247], { window: 1 }),
        record('Share card', [42, 500, 400, 560], { window: 2 }),
      ]
      const result = match([node('Share card', [42, 500, 400, 560])], records, {
        windows: [under, cover],
      })
      assert.equal(result.code, 'live_font_text_probe_unmatched', JSON.stringify(cover))
      assert.deepEqual(coveredWindows([under, cover], 2).size, 0)
    }
  })

  // Antigravity r41 P2-3, TEA ruling: a centred dialog does not cover the Activity whole. The
  // hierarchy shows only the dialog, so the Activity's records leave matching, but they still
  // show around it and are judged for clipping (live-font-scale-proof.test.mjs).
  test('the r41 dialog probe: records behind a focused dialog leave matching', () => {
    const windows = [
      { id: 0, rect: [0, 0, 1080, 2400], z: 0, focused: false },
      { id: 1, rect: [100, 300, 300, 500], z: 1, focused: true },
    ]
    const records = [
      record('Home', [42, 176, 184, 247], { window: 0 }),
      record('OK', [150, 420, 250, 470], { window: 1 }),
    ]
    const result = match([node('OK', [150, 420, 250, 470])], records, { windows })
    assert.equal(result.pass, true, result.code)
    assert.deepEqual(result.covered, [{ window: 0, by: 1, whole: false, records: 1 }])
    assert.deepEqual(result.behind, [0])
    assert.deepEqual(result.unmatchedRecords, [])
    // The dialog must still answer for itself.
    const silent = match([node('OK', [150, 420, 250, 470])], records.slice(0, 1), {
      windows,
    })
    assert.equal(silent.code, 'live_font_text_probe_missing')
  })

  test('a covering window none of whose records matches is a missing answer', () => {
    const windows = [
      { id: 1, rect: [0, 0, 1080, 2400], z: 0, focused: false },
      { id: 2, rect: [0, 0, 1080, 2400], z: 1, focused: true },
    ]
    const result = match([], [record('Home', [42, 176, 184, 247], { window: 1 })], {
      windows,
    })
    assert.equal(result.code, 'live_font_text_probe_missing')
  })
})

describe('matchTextProbe, iOS accessibility groups (TEA rulings 2026-11-14)', () => {
  const ios = (nodes, records, options = {}) =>
    matchTextProbe({
      platform: 'ios',
      nodes,
      answer: answerFor('t', records, {
        platform: 'ios',
        windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }],
      }),
      window: [0, 0, 402, 874],
      tolerance: 1,
      ...options,
    })
  const hourly = node(
    'Cloudy, 68 degrees Fahrenheit, and 1 AM',
    [16, 332, 86, 417],
    'hourly-item'
  )
  const hourlyRecords = [
    iosRecord('1 AM', [30, 340, 72, 360]),
    iosRecord('☁️', [30, 362, 72, 390]),
    iosRecord('68°F', [30, 392, 72, 412]),
  ]

  test('a grouped label takes the records inside it; exact text still pairs one to one', () => {
    const result = ios(
      [hourly, node('57°F', [16, 173, 115, 235], 'current-temperature')],
      [...hourlyRecords, iosRecord('57°F', [16, 173, 115, 235])]
    )
    assert.equal(result.pass, true)
    assert.deepEqual(result.groups, [{ node: 0, records: [0, 1, 2] }])
    assert.deepEqual(
      result.pairs.map((pair) => [pair.node, pair.record, pair.via]),
      [
        [1, 3, 'text'],
        [0, 0, 'group'],
        [0, 1, 'group'],
        [0, 2, 'group'],
      ]
    )
  })

  test('without the group rule every iOS group is unmatched both ways', () => {
    const result = ios([hourly], hourlyRecords, { groupRule: false })
    assert.equal(result.code, 'live_font_text_probe_unmatched')
    assert.deepEqual([result.unmatchedNodes, result.unmatchedRecords], [[0], [0, 1, 2]])
  })

  test('a group that holds no leftover record fails as unmatched', () => {
    const result = ios(
      [hourly, node('expanded', [319, 280, 386, 324], 'ribbon-expand-toggle')],
      hourlyRecords
    )
    assert.equal(result.code, 'live_font_text_probe_unmatched')
    assert.deepEqual(result.unmatchedNodes, [1])
  })

  test('a leftover record outside every group fails as unmatched', () => {
    const result = ios(
      [hourly],
      [...hourlyRecords, iosRecord('Precip 10%', [94, 392, 160, 412])]
    )
    assert.equal(result.code, 'live_font_text_probe_unmatched')
    assert.deepEqual(result.unmatchedRecords, [3])
  })

  test('a whole-window node (the app element) is out of matching and takes nothing', () => {
    const app = node('CoutureCast Story68', [0, 0, 402, 874])
    const result = ios([app], [iosRecord('Stray', [10, 10, 60, 30])])
    assert.equal(result.code, 'live_font_text_probe_unmatched')
    assert.deepEqual(result.windowNodes, [0])
    assert.deepEqual(result.unmatchedRecords, [0])
    assert.deepEqual(result.unmatchedNodes, [], 'the app element owes no record')
    assert.equal(ios([app], []).pass, true)
  })

  test('nested groups resolve to the smallest that holds the record', () => {
    const card = node('Outfit card, Top, Bottom', [0, 500, 402, 900], 'outfit-card')
    const tile = node('Top, wool coat', [16, 700, 386, 760], 'garment-tile-default-top')
    const result = ios(
      [card, tile],
      [iosRecord('Top', [30, 710, 120, 740]), iosRecord('Outfit', [30, 520, 120, 560])]
    )
    assert.equal(result.pass, true)
    assert.deepEqual(
      result.groups.sort((a, b) => a.node - b.node),
      [
        { node: 0, records: [1] },
        { node: 1, records: [0] },
      ]
    )
  })

  test('two smallest groups of one size holding a record are ambiguous', () => {
    const twins = [
      node('Show Personal', [16, 108, 112, 152], 'a'),
      node('Personal chip', [16, 108, 112, 152], 'b'),
    ]
    const result = ios(twins, [iosRecord('PERSONAL', [30, 120, 100, 140])])
    assert.equal(result.code, 'live_font_text_probe_ambiguous')
    assert.deepEqual(result.ambiguous, [{ record: 0, nodes: [0, 1] }])
  })
})
