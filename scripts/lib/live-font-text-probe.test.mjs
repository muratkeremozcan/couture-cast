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
  assertTextProbeLinked,
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
  { platform = 'android', windows = [WINDOW], elements = [] } = {}
) => ({
  version: 1,
  token,
  platform,
  windows,
  records,
  elements,
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

// Nightly run 43707223465: a Release build prebuilt without COUTURE_TEXT_LAYOUT_PROBE=1 carried
// no probe, and the run spent its whole proof on live_font_text_probe_missing. The driver now
// checks the installed build once, before its first capture.
describe('assertTextProbeLinked', () => {
  const DEVICE = '1B2C3D4E-0000-1111-2222-333344445555'
  const APP = 'com.couturecast.story68'
  const MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe])
  const machO = (...parts) => Buffer.concat([MACH_O, Buffer.from(parts.join('\0'))])

  function fakeBundle(t, files) {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'text-probe-link-'))
    t.after(() => fs.rmSync(container, { recursive: true, force: true }))
    const bundle = path.join(container, 'CoutureCastStory68.app')
    for (const [name, bytes] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(bundle, name)), { recursive: true })
      fs.writeFileSync(path.join(bundle, name), bytes)
    }
    const calls = []
    const exec = (binary, args, options) => {
      calls.push({ binary, args, options })
      return `${bundle}\n`
    }
    return { exec, calls }
  }
  const check = (exec, platform = 'ios') =>
    assertTextProbeLinked({ platform, device: DEVICE, appId: APP, exec, callMs: 5000 })

  test('passes an iOS build whose executable carries the probe notification', (t) => {
    const { exec, calls } = fakeBundle(t, {
      CoutureCastStory68: machO('RCTAppDelegate', TEXT_PROBE_NOTIFICATION),
      'main.jsbundle': 'var a=1',
    })
    assert.doesNotThrow(() => check(exec))
    assert.deepEqual(calls, [
      {
        binary: 'xcrun',
        args: ['simctl', 'get_app_container', DEVICE, APP, 'app'],
        options: { timeout: 5000 },
      },
    ])
  })

  test('passes an iOS build that links the probe as a framework', (t) => {
    const { exec } = fakeBundle(t, {
      CoutureCastStory68: machO('RCTAppDelegate'),
      'Frameworks/TextLayoutProbe.framework/TextLayoutProbe': machO(
        TEXT_PROBE_NOTIFICATION
      ),
    })
    assert.doesNotThrow(() => check(exec))
  })

  test('fails an iOS build without the probe as live_font_probe_not_linked', (t) => {
    const { exec } = fakeBundle(t, {
      CoutureCastStory68: machO('RCTAppDelegate', 'ExpoModulesProvider'),
      'Frameworks/hermes.framework/hermes': machO('hermes'),
      'main.jsbundle': 'var a=1',
    })
    assert.throws(() => check(exec), {
      code: 'live_font_probe_not_linked',
      message:
        /no binary in CoutureCastStory68\.app carries com\.couturecast\.textlayoutprobe\.dump; prebuild with COUTURE_TEXT_LAYOUT_PROBE=1/,
    })
  })

  test('the notification name outside any binary does not count as linked', (t) => {
    const { exec } = fakeBundle(t, {
      CoutureCastStory68: machO('RCTAppDelegate'),
      'main.jsbundle': `var n="${TEXT_PROBE_NOTIFICATION}"`,
      'Info.plist': TEXT_PROBE_NOTIFICATION,
    })
    assert.throws(() => check(exec), { code: 'live_font_probe_not_linked' })
  })

  test('on Android, only a registered receiver filter for the probe action counts', () => {
    const registered = [
      'ACTIVITY MANAGER BROADCAST STATE (dumpsys activity broadcasts)',
      '  Registered Receivers:',
      `  * ReceiverList{1 4321 ${APP}/10123/u0 remote:2}`,
      '    Filter #0: BroadcastFilter{3 10123/u0 ReceiverList{1}}',
      `      Action: "${TEXT_PROBE_ACTION}"`,
    ].join('\n')
    // An earlier run's broadcast stays in the history after the app is replaced.
    const historyOnly = [
      '  Registered Receivers:',
      `  * ReceiverList{1 4321 ${APP}/10123/u0 remote:2}`,
      '      Action: "android.intent.action.SCREEN_ON"',
      '  Historical broadcasts [foreground]:',
      `  #0: BroadcastRecord{5 u0 ${TEXT_PROBE_ACTION}}`,
      `    Intent { act=${TEXT_PROBE_ACTION} flg=0x400010 pkg=${APP} (has extras) }`,
    ].join('\n')
    const calls = []
    const exec = (output) => (binary, args) => {
      calls.push({ binary, args })
      return output
    }
    assert.doesNotThrow(() => check(exec(registered), 'android'))
    assert.deepEqual(calls[0], {
      binary: 'adb',
      args: ['-s', DEVICE, 'shell', 'dumpsys', 'activity', 'broadcasts'],
    })
    assert.throws(() => check(exec(historyOnly), 'android'), {
      code: 'live_font_probe_not_linked',
      message: /registered no com\.couturecast\.textlayoutprobe\.DUMP receiver/,
    })
  })

  test('the driver checks once, after its first launch and before any capture', () => {
    const driver = fs.readFileSync(
      new URL('../run-live-font-proof.mjs', import.meta.url),
      'utf8'
    )
    const loop = driver.indexOf('for (const name of screens) {')
    const checkAt = driver.indexOf(
      'assertTextProbeLinked({ platform, device, appId, adbBinary })'
    )
    assert.ok(loop > 0 && checkAt > loop, 'inside the screen loop')
    assert.equal(driver.split('assertTextProbeLinked(').length, 2, 'one call')
    assert.ok(checkAt > driver.indexOf('launch()', loop), 'after the first launch')
    for (const capture of ['await runScreenJourney(', 'await proveConfigChange(name'])
      assert.ok(checkAt < driver.indexOf(capture, loop), `before ${capture}`)
    // Not inside a try: a missing probe ends the run instead of failing one screen.
    const block = driver.slice(driver.lastIndexOf('\n    }\n', checkAt), checkAt)
    assert.match(block, /if \(!probeLinked\) \{\n\s*$/)
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

  // TEA ruling r45: ReactSwitch is a known Android kind; an unknown kind fails whatever its text.
  test('ReactSwitch is known on Android only; an unknown kind with empty text still fails', () => {
    const answer = ok()
    answer.records[0].kind = 'ReactSwitch'
    assert.doesNotThrow(() => validateTextProbeAnswer(answer, asked))
    const ios = answerFor(
      't1',
      [iosRecord('On', [16, 400, 80, 440], { kind: 'ReactSwitch' })],
      {
        platform: 'ios',
      }
    )
    assert.throws(() => validateTextProbeAnswer(ios, { platform: 'ios', token: 't1' }), {
      code: 'live_font_text_probe_invalid',
    })
    const unknownEmpty = ok()
    Object.assign(unknownEmpty.records[0], {
      kind: 'unknown:com.facebook.react.views.switchview.ReactSwitch',
      text: '',
    })
    assert.throws(() => validateTextProbeAnswer(unknownEmpty, asked), {
      code: 'live_font_text_probe_unknown_view',
    })
  })

  // Wire contract r44 4: every iOS record carries accessibilityAncestor, null or an identifier
  // with a rect; Android records omit it.
  // TEA ruling r46: the accessibility elements beside the records, required on both platforms.
  test('every element carries an identifier or null, a label, a rect, hasText and a window', () => {
    const element = (overrides = {}) => ({
      identifier: 'community-card-image-seed-spotlight-1',
      label: 'Spotlight look 1 styled for the season',
      rect: [17, 721, 325, 1029],
      hasText: false,
      window: 1,
      ...overrides,
    })
    for (const each of [element(), element({ identifier: null, hasText: true })]) {
      const answer = ok()
      answer.elements = [each]
      assert.doesNotThrow(
        () => validateTextProbeAnswer(answer, asked),
        JSON.stringify(each)
      )
    }
    for (const [name, each] of Object.entries({
      'empty identifier': element({ identifier: '' }),
      'identifier not text': element({ identifier: 3 }),
      'missing identifier': (() => {
        const each = element()
        delete each.identifier
        return each
      })(),
      'empty label': element({ label: '' }),
      'label not text': element({ label: null }),
      'inverted rect': element({ rect: [325, 721, 17, 1029] }),
      'hasText not a boolean': element({ hasText: 'false' }),
      'unknown window': element({ window: 9 }),
      'extra field': element({ kind: 'image' }),
      'not an object': 'Spotlight look 1',
    })) {
      const answer = ok()
      answer.elements = [element(), each]
      assert.throws(
        () => validateTextProbeAnswer(answer, asked),
        (error) =>
          error.code === 'live_font_text_probe_invalid' &&
          /^\S+: element 1 /.test(error.message),
        name
      )
    }
  })

  // TEA ruling r46: behindModal, required on iOS (null or the modal view's frame), absent on Android.
  test('behindModal is required on iOS, null or a frame, and absent on Android', () => {
    const iosAsked = { platform: 'ios', token: 't1' }
    const iosAnswer = (modal) => {
      const answer = answerFor('t1', [iosRecord('Community', [121, 63, 281, 99])], {
        platform: 'ios',
      })
      if (modal === undefined) delete answer.records[0].behindModal
      else answer.records[0].behindModal = modal
      return answer
    }
    for (const modal of [
      null,
      { rect: [0, 300, 402, 874], opaque: true },
      { rect: [0, 0, 402, 874], opaque: false },
    ])
      assert.doesNotThrow(() => validateTextProbeAnswer(iosAnswer(modal), iosAsked))
    for (const [name, modal] of Object.entries({
      missing: undefined,
      'inverted rect': { rect: [402, 300, 0, 874] },
      'no rect': { opaque: true },
      'no opaque (the r46 shape)': { rect: [0, 300, 402, 874] },
      'opaque not a boolean': { rect: [0, 300, 402, 874], opaque: 1 },
      'extra field': { rect: [0, 300, 402, 874], opaque: true, id: 'sheet' },
      'a boolean': true,
    }))
      assert.throws(
        () => validateTextProbeAnswer(iosAnswer(modal), iosAsked),
        (error) =>
          error.code === 'live_font_text_probe_invalid' &&
          /record 0 (behindModal|fields)/.test(error.message),
        name
      )
    for (const modal of [null, { rect: [0, 300, 402, 874], opaque: true }]) {
      const answer = ok()
      answer.records[0].behindModal = modal
      assert.throws(
        () => validateTextProbeAnswer(answer, asked),
        (error) =>
          error.code === 'live_font_text_probe_invalid' &&
          /record 0 fields/.test(error.message),
        `android ${JSON.stringify(modal)}`
      )
    }
  })

  test('accessibilityAncestor is required on iOS, null or an identifier with a rect, and absent on Android', () => {
    const iosAsked = { platform: 'ios', token: 't1' }
    const iosAnswer = (ancestor) => {
      const answer = answerFor('t1', [iosRecord('57°F', [16, 173, 115, 235])], {
        platform: 'ios',
      })
      if (ancestor === undefined) delete answer.records[0].accessibilityAncestor
      else answer.records[0].accessibilityAncestor = ancestor
      return answer
    }
    for (const ancestor of [
      null,
      { identifier: 'current-temperature', rect: [16, 173, 115.667, 235.333] },
    ])
      assert.doesNotThrow(
        () => validateTextProbeAnswer(iosAnswer(ancestor), iosAsked),
        JSON.stringify(ancestor)
      )
    for (const [name, ancestor] of Object.entries({
      missing: undefined,
      'empty identifier': { identifier: '', rect: [0, 0, 1, 1] },
      'identifier not text': { identifier: 7, rect: [0, 0, 1, 1] },
      'inverted rect': { identifier: 'a', rect: [5, 0, 1, 1] },
      'short rect': { identifier: 'a', rect: [0, 0, 1] },
      'no rect': { identifier: 'a' },
      'extra field': { identifier: 'a', rect: [0, 0, 1, 1], label: 'x' },
      'a string': 'tab-home',
      'a list': ['tab-home', [0, 0, 1, 1]],
    }))
      assert.throws(
        () => validateTextProbeAnswer(iosAnswer(ancestor), iosAsked),
        (error) =>
          error.code === 'live_font_text_probe_invalid' &&
          /record 0 (accessibilityAncestor|fields)/.test(error.message),
        name
      )
    for (const ancestor of [null, { identifier: 'a', rect: [0, 0, 1, 1] }]) {
      const answer = ok()
      answer.records[0].accessibilityAncestor = ancestor
      assert.throws(
        () => validateTextProbeAnswer(answer, asked),
        (error) =>
          error.code === 'live_font_text_probe_invalid' &&
          /record 0 fields/.test(error.message),
        `android ${JSON.stringify(ancestor)}`
      )
    }
  })

  // Wire contract r44 3: a ReactSwitch with showText false, as Android writes it.
  test('a ReactSwitch record as the native probe writes it passes', () => {
    const answer = ok()
    answer.records[0] = record('', [880, 700, 1000, 760], {
      kind: 'ReactSwitch',
      lineCount: 0,
      maxLines: null,
      unlimitedLineCount: null,
    })
    assert.equal(answer.records[0].contentRect, answer.records[0].viewRect)
    assert.doesNotThrow(() => validateTextProbeAnswer(answer, asked))
  })

  // Wire contract r44 P1-1: text a layout alone pushes off the window is no offWindow record.
  test('a record with nothing shown, no clipRect, not scrolled away and not offWindow passes', () => {
    const answer = ok()
    Object.assign(answer.records[0], {
      viewRect: [97, 2500, 170, 2547],
      contentRect: [97, 2500, 170, 2547],
      visibleRect: null,
      clipRect: null,
      scrolledAway: false,
      offWindow: false,
    })
    assert.doesNotThrow(() => validateTextProbeAnswer(answer, asked))
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
      'no elements': (a) => delete a.elements,
      'elements not a list': (a) => (a.elements = {}),
      'another platform kind': (a) => (a.records[0].kind = 'RCTParagraphComponentView'),
      'extra record field': (a) => (a.records[0].extra = 1),
      'missing record field': (a) => delete a.records[0].clipRect,
      // TEA ruling r49: required on new answers, a boolean.
      'no accessibilityHidden': (a) => delete a.records[0].accessibilityHidden,
      'accessibilityHidden as text': (a) => (a.records[0].accessibilityHidden = 'false'),
      'accessibilityHidden null': (a) => (a.records[0].accessibilityHidden = null),
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
      'no scrollViewport': (a) => delete a.records[0].scrollViewport,
      'scrollViewport not a rect': (a) => (a.records[0].scrollViewport = [0, 0, 10]),
      'scrollViewport upside down': (a) => (a.records[0].scrollViewport = [0, 10, 10, 0]),
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

  // TEA r44 P3-1: an opacity the judging cannot trust is refused, never coerced.
  test('an opacity that is no finite number from 0 to 1 fails with its own code', () => {
    const cases = {
      NaN: Number.NaN,
      infinite: Number.POSITIVE_INFINITY,
      'above 1': 1.5,
      negative: -0.1,
      'as text': '1',
      'NaN as text': 'NaN',
      null: null,
      missing: undefined,
    }
    for (const [name, opacity] of Object.entries(cases)) {
      const answer = ok()
      if (opacity === undefined) delete answer.records[1].opacity
      else answer.records[1].opacity = opacity
      assert.throws(
        () => validateTextProbeAnswer(answer, asked),
        (error) =>
          error.code === 'live_font_text_probe_opacity_invalid' &&
          /^live_font_text_probe_opacity_invalid: record 1 opacity /.test(error.message),
        name
      )
    }
    for (const opacity of [0, 0.0001, 1]) {
      const answer = ok()
      answer.records[1].opacity = opacity
      assert.doesNotThrow(() => validateTextProbeAnswer(answer, asked), String(opacity))
    }
  })

  // Wire contract r44 P3-1: the refusal answer, as both platforms write it.
  test('the native refusal for an opacity fails with that code; any other is invalid', () => {
    const refusal = (error, overrides = {}) => ({
      version: 1,
      token: 't1',
      platform: 'android',
      error,
      ...overrides,
    })
    const opacity = {
      code: 'text_probe_opacity_invalid',
      record: 3,
      kind: 'ReactTextView',
    }
    assert.throws(
      () => validateTextProbeAnswer(refusal(opacity), asked),
      (error) =>
        error.code === 'live_font_text_probe_opacity_invalid' &&
        error.message.includes('record 3 ReactTextView')
    )
    // iOS writes it with sorted keys; key order does not matter.
    const ios = JSON.parse(
      '{"error":{"code":"text_probe_opacity_invalid","kind":"RCTParagraphComponentView","record":0},"platform":"ios","token":"t1","version":1}'
    )
    assert.throws(() => validateTextProbeAnswer(ios, { platform: 'ios', token: 't1' }), {
      code: 'live_font_text_probe_opacity_invalid',
    })
    for (const [name, answer] of Object.entries({
      'another native code': refusal({ ...opacity, code: 'text_probe_layout_missing' }),
      'the old short code': refusal({ ...opacity, code: 'opacity_invalid' }),
      'an inherited name': refusal({ ...opacity, code: 'toString' }),
      'another token': refusal(opacity, { token: 't9' }),
      'another platform': refusal(opacity, { platform: 'ios' }),
      'another version': refusal(opacity, { version: 2 }),
      'no record index': refusal({ code: opacity.code, kind: opacity.kind }),
      'a negative record index': refusal({ ...opacity, record: -1 }),
      'a fractional record index': refusal({ ...opacity, record: 1.5 }),
      'no kind': refusal({ code: opacity.code, record: 3 }),
      'an extra error field': refusal({ ...opacity, detail: 'x' }),
      'error beside records': { ...refusal(opacity), records: [] },
      'error beside windows and records': {
        ...refusal(opacity),
        records: [],
        windows: [],
      },
    }))
      assert.throws(
        () => validateTextProbeAnswer(answer, asked),
        { code: 'live_font_text_probe_invalid' },
        name
      )
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

// TEA ruling r46: label elements pair the nodes no text record takes; never judged, never text.
describe('matchTextProbe, accessibility elements (TEA ruling r46)', () => {
  const iosMatch = (nodes, records, elements) =>
    matchTextProbe({
      platform: 'ios',
      nodes,
      answer: answerFor('t', records, {
        platform: 'ios',
        windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }],
        elements,
      }),
      window: [0, 0, 402, 874],
      tolerance: 1,
    })
  const element = (label, rect, overrides = {}) => ({
    identifier: null,
    label,
    rect,
    hasText: false,
    window: 1,
    ...overrides,
  })
  const IMAGE = 'Spotlight look 1 styled for the season'
  const imageNode = node(
    IMAGE,
    [17, 721, 325, 1029],
    'community-card-image-seed-spotlight-1'
  )

  test('an element-only node pairs by identity, else by frame; neither fails unmatched', () => {
    const byId = iosMatch(
      [imageNode],
      [],
      // A frame off by more than the tolerance: only the identity can pair it.
      [element(IMAGE, [17, 715, 325, 1040], { identifier: imageNode.id })]
    )
    assert.deepEqual(
      [byId.pass, byId.elements],
      [true, [{ node: 0, element: 0, label: IMAGE }]]
    )
    assert.deepEqual(byId.pairs, [], 'an element pairs no record and is never judged')
    const byFrame = iosMatch([imageNode], [], [element(IMAGE, [17, 721.5, 325, 1029])])
    assert.equal(byFrame.pass, true)
    // Same label, other frame, no identity: no pair.
    const elsewhere = iosMatch([imageNode], [], [element(IMAGE, [17, 400, 325, 700])])
    assert.deepEqual(
      [elsewhere.code, elsewhere.unmatchedNodes],
      ['live_font_text_probe_unmatched', [0]]
    )
    // TEA ruling r48 (r46 PROBE_F3A): another testID never stands in, whatever its frame.
    const save = node('Save', [20, 700, 180, 750], 'btn-save')
    const cancel = element('Save', save.box, { identifier: 'btn-cancel' })
    const mismatch = iosMatch([save], [], [cancel])
    assert.deepEqual(
      [mismatch.code, mismatch.elements],
      ['live_font_text_probe_unmatched', []]
    )
    // Nor for a node with no testID; an element with none still pairs by frame.
    const bare = node('Save', save.box, '')
    assert.equal(iosMatch([bare], [], [cancel]).code, 'live_font_text_probe_unmatched')
    assert.equal(iosMatch([bare], [], [element('Save', save.box)]).pass, true)
    // Another label: no pair.
    const other = iosMatch(
      [imageNode],
      [],
      [element('A photo', imageNode.box, { identifier: imageNode.id })]
    )
    assert.equal(other.code, 'live_font_text_probe_unmatched')
    // No text record and no element: unmatched, as before.
    assert.equal(iosMatch([imageNode], [], []).code, 'live_font_text_probe_unmatched')
    // Two elements of one label and frame for one node: ambiguous.
    const twice = iosMatch(
      [imageNode],
      [],
      [element(IMAGE, imageNode.box), element(IMAGE, imageNode.box)]
    )
    assert.equal(twice.code, 'live_font_text_probe_ambiguous')
    // One element pairs one node.
    const twin = node(IMAGE, [17, 721, 325, 1029], '')
    assert.equal(
      iosMatch([imageNode, twin], [], [element(IMAGE, imageNode.box)]).code,
      'live_font_text_probe_unmatched'
    )
  })

  test('a button echoing its child label pairs with its element; the child text pairs with its node', () => {
    const button = node('New post', [251, 116, 386, 168], 'community-new-post-button')
    const label = node('New post', [267, 128, 370, 156], 'community-new-post-label')
    const records = [iosRecord('New post', [267.667, 128.667, 370, 156.667])]
    const elements = [
      element('New post', [251, 116, 386, 168], { identifier: button.id, hasText: true }),
    ]
    const result = iosMatch([button, label], records, elements)
    assert.equal(result.pass, true, JSON.stringify(result.unmatchedNodes))
    assert.deepEqual(
      result.pairs.map((pair) => [pair.node, pair.via]),
      [[1, 'text']]
    )
    assert.deepEqual(result.elements, [{ node: 0, element: 0, label: 'New post' }])
  })

  // The probe-reports-nothing mutant: the text record is gone, its own element (a text view
  // inside) is still listed. Nothing lies inside the element, so it cannot stand in.
  test('an element with a text view inside stands in only when a text record lies inside it', () => {
    const heading = node(
      'Spotlight in US',
      [17, 300, 385, 330],
      'community-spotlight-heading'
    )
    const own = element('Spotlight in US', [17, 300, 385, 330], {
      identifier: heading.id,
      hasText: true,
    })
    const result = iosMatch([heading], [], [own])
    assert.deepEqual(
      [result.code, result.unmatchedNodes],
      ['live_font_text_probe_unmatched', [0]]
    )
    // With its record it pairs by text and the element is not needed.
    const healthy = iosMatch(
      [heading],
      [iosRecord('Spotlight in US', [17, 300, 385, 330])],
      [own]
    )
    assert.deepEqual([healthy.pass, healthy.elements], [true, []])
  })

  test('an input node with the joined label pairs its element and its placeholder attaches there', () => {
    const input = node(
      'Image description Describe the garments, layers and colours',
      [22, 431, 380, 507],
      'community-alt-text-input'
    )
    const placeholder = iosRecord(
      'Describe the garments, layers and colours',
      [21, 430.667, 381, 508.333],
      {
        kind: 'RCTTextInputComponentView',
      }
    )
    const elements = [
      element(input.text, [21, 430.667, 381, 508.333], {
        identifier: input.id,
        hasText: true,
      }),
    ]
    const result = iosMatch([input], [placeholder], elements)
    assert.equal(
      result.pass,
      true,
      JSON.stringify([result.unmatchedRecords, result.unmatchedNodes])
    )
    assert.deepEqual(result.attached, [{ node: 0, records: [0] }])
    assert.deepEqual(
      result.pairs.map((pair) => [pair.node, pair.record, pair.via]),
      [[0, 0, 'attached']]
    )
  })

  // TEA ruling r46: behind an accessibility-modal view, like a partial or a whole cover.
  test('records behind a modal view leave matching; one an opaque modal frame holds is left out', () => {
    const sheet = { rect: [0, 300, 402, 874], opaque: true }
    const outside = iosRecord('Community', [121, 63, 281, 99], { behindModal: sheet })
    const inside = iosRecord('Shoes', [16, 600, 386, 640], { behindModal: sheet })
    const result = iosMatch([], [outside, inside], [])
    assert.equal(result.pass, true)
    assert.deepEqual([result.behind, result.modalCovered], [[0], [1]])
  })

  // TEA ruling r48 (r46 PROBE_F3D): a transparent backdrop (React Native's transparent Modal)
  // covers nothing; opacity 0 and off-window come first.
  test('a transparent or unflagged modal frame leaves its records behind; invisible and offWindow come first', () => {
    const shoes = (behindModal, extra = {}) =>
      iosRecord('Shoes', [16, 600, 386, 640], { behindModal, ...extra })
    const result = iosMatch([], [shoes({ rect: [0, 0, 402, 874], opaque: false })], [])
    assert.deepEqual([result.behind, result.modalCovered], [[0], []])
    // An answer stored before `opaque` reads as not opaque.
    const older = iosMatch([], [shoes({ rect: [0, 0, 402, 874] })], [])
    assert.deepEqual([older.behind, older.modalCovered], [[0], []])
    const sheet = { rect: [0, 0, 402, 874], opaque: true }
    const ordered = iosMatch(
      [],
      [
        shoes(sheet, { opacity: 0 }),
        iosRecord('Parked', [16, 700, 386, 740], {
          behindModal: sheet,
          offWindow: true,
          visibleRect: null,
          clipRect: null,
        }),
      ],
      []
    )
    assert.deepEqual(
      [
        ordered.invisible.map((each) => each.record),
        ordered.offWindow.map((each) => each.record),
        ordered.modalCovered,
      ],
      [[0], [1], []]
    )
  })
})

// TEA ruling r49: the iOS 6c85bbb4 Home spotlight teaser on scroll page 2. The "Partnered" pill and
// the in-app browser caption are hidden from accessibility; their words live only in the link's
// and the shop button's labels, so no node carries their text and no element frame holds them.
describe('matchTextProbe, accessibility-hidden records (TEA ruling r49)', () => {
  const LINK_LABEL =
    'Standout look in US by Style Explorer 9BC8AA75, 6 reactions. Opens the City Spotlight. ' +
    'Partnered with Sample Partner'
  const SHOP_LABEL = 'Shop this look at Sample Partner. Opens in an in-app browser'
  const LINK = { id: 'home-spotlight-teaser-link', rect: [17, 536.667, 385, 635.667] }
  const SHOP = { id: 'home-spotlight-teaser-shop', rect: [29, 665, 373, 709] }
  const nodes = () => [
    node(LINK_LABEL, [17, 536, 385, 635], LINK.id),
    node('Standout look in US', [113, 548, 373, 566], 'home-spotlight-teaser-heading'),
    node('Style Explorer 9BC8AA75', [113, 568, 373, 584], 'home-spotlight-teaser-author'),
    node('6 reactions', [113, 586, 373, 602], 'home-spotlight-teaser-reactions'),
    node(SHOP_LABEL, [29, 665, 373, 709], SHOP.id),
  ]
  const PILL = 4
  const CAPTION = 6
  /** The page's records; `flag` lists the texts native flags accessibility hidden. */
  const records = ({
    flag = ['Partnered', 'Opens in an in-app browser'],
    pill = 'Partnered',
  } = {}) => {
    const hidden = (text) => ({ accessibilityHidden: flag.includes(text) })
    const under = (ancestor) => ({ identifier: ancestor.id, rect: ancestor.rect })
    return [
      iosRecord('Standout look in US', [113, 548.667, 373, 566.667], {
        accessibilityAncestor: under(LINK),
      }),
      iosRecord('Style Explorer 9BC8AA75', [113, 568.667, 373, 584.333], {
        accessibilityAncestor: under(LINK),
      }),
      iosRecord('6 reactions', [113, 586.333, 373, 602], {
        accessibilityAncestor: under(LINK),
        ...hidden('6 reactions'),
      }),
      iosRecord('See it in the City Spotlight', [113, 608, 373, 623.667], {
        accessibilityAncestor: under(LINK),
      }),
      iosRecord(pill, [37, 639.667, 92.667, 653], hidden(pill)),
      iosRecord('Shop this look at Sample Partner', [88.333, 678.333, 313.333, 695.333], {
        accessibilityAncestor: under(SHOP),
      }),
      iosRecord('Opens in an in-app browser', [29, 715, 373, 731], {
        contentRect: [29, 715, 185.152, 731],
        ...hidden('Opens in an in-app browser'),
      }),
    ]
  }
  const elements = () => [
    { hasText: true, identifier: LINK.id, label: LINK_LABEL, rect: LINK.rect, window: 1 },
    { hasText: true, identifier: SHOP.id, label: SHOP_LABEL, rect: SHOP.rect, window: 1 },
  ]
  const teaser = (list = records(), elementList = elements()) =>
    matchTextProbe({
      platform: 'ios',
      nodes: nodes(),
      answer: answerFor('t', list, {
        platform: 'ios',
        windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }],
        elements: elementList,
      }),
      window: [0, 0, 402, 874],
      tolerance: 1,
    })
  const viaOf = (result, index) => result.pairs.find((pair) => pair.record === index)

  test('the teaser pill and caption join the nearest identified element whose label holds them', () => {
    const result = teaser()
    assert.equal(result.pass, true, result.code)
    assert.deepEqual(result.hiddenAttached, [
      { record: PILL, element: 0, node: 0 },
      { record: CAPTION, element: 1, node: 4 },
    ])
    assert.deepEqual(
      [viaOf(result, PILL), viaOf(result, CAPTION)],
      [
        { node: 0, record: PILL, via: 'accessibilityHidden' },
        { node: 4, record: CAPTION, via: 'accessibilityHidden' },
      ]
    )
    // Each node keeps one member list: the link's and the shop's groups take them.
    assert.deepEqual(
      result.groups.map((group) => [group.node, group.records]),
      [
        [0, [3, PILL]],
        [4, [5, CAPTION]],
      ]
    )
    assert.deepEqual(result.attached, [])
    // The path runs last: a flagged record a node of its text takes pairs by text.
    assert.equal(
      viaOf(
        teaser(
          records({ flag: ['6 reactions', 'Partnered', 'Opens in an in-app browser'] })
        ),
        2
      ).via,
      'text'
    )
    // The record text and the label match with whitespace normalized: a caption wrapped in two.
    const wrapped = records()
    wrapped[CAPTION].text = 'Opens in an\nin-app  browser'
    assert.deepEqual(teaser(wrapped).hiddenAttached[1], {
      record: CAPTION,
      element: 1,
      node: 4,
    })
  })

  test('an unflagged leftover of the same text, or a flagged one no label holds, stays unmatched', () => {
    const unflagged = teaser(records({ flag: [] }))
    assert.deepEqual(
      [unflagged.code, unflagged.unmatchedRecords, unflagged.hiddenAttached],
      ['live_font_text_probe_unmatched', [PILL, CAPTION], []]
    )
    // An answer from before the field reads as false in the matcher.
    const old = records()
    for (const each of old) delete each.accessibilityHidden
    assert.deepEqual(teaser(old).unmatchedRecords, [PILL, CAPTION])
    const sponsored = teaser(
      records({ flag: ['Sponsored', 'Opens in an in-app browser'], pill: 'Sponsored' })
    )
    assert.deepEqual(
      [sponsored.code, sponsored.unmatchedRecords],
      ['live_font_text_probe_unmatched', [PILL]]
    )
    // An element with no identifier never takes one.
    const anonymous = elements()
    anonymous[0].identifier = null
    assert.deepEqual(teaser(records(), anonymous).unmatchedRecords, [PILL])
    // Nor does one nearer than the identified element: the pill still joins the link.
    const nearer = [
      ...elements(),
      {
        hasText: false,
        identifier: null,
        label: 'Partnered',
        rect: [33, 637, 97, 655],
        window: 1,
      },
    ]
    assert.deepEqual(teaser(records(), nearer).hiddenAttached[0], {
      record: PILL,
      element: 0,
      node: 0,
    })
    // An element no node stands for leaves it free.
    const renamed = elements()
    renamed[0].identifier = 'home-spotlight-teaser-card'
    assert.deepEqual(teaser(records(), renamed).unmatchedRecords, [PILL])
  })

  test('two identified elements at one gap from a flagged record are ambiguous', () => {
    const twins = [
      ...elements(),
      { ...elements()[0], identifier: 'home-spotlight-teaser-copy' },
    ]
    const result = teaser(records(), twins)
    assert.deepEqual(
      [result.code, result.hiddenAmbiguous],
      ['live_font_text_probe_ambiguous', [{ record: PILL, elements: [0, 2] }]]
    )
    // A nearer one decides.
    const nearer = [
      ...elements(),
      {
        ...elements()[0],
        identifier: 'home-spotlight-teaser-copy',
        rect: [17, 400, 385, 500],
      },
    ]
    assert.equal(teaser(records(), nearer).pass, true)
  })

  // r48 P2-2 (probe F3): a flagged "cast" far down the screen joined "Forecast details" 460 px
  // above it, by substring.
  test('a flagged record joins only an element that holds or borders it, by whole words', () => {
    const forecast = {
      hasText: true,
      identifier: 'home-forecast-details',
      label: 'Forecast details',
      rect: [16, 100, 386, 150],
      window: 1,
    }
    const castNode = node('Forecast details', [16, 100, 386, 150], forecast.identifier)
    const probe = (rect, elementList) =>
      matchTextProbe({
        platform: 'ios',
        nodes: [castNode],
        answer: answerFor('t', [iosRecord('cast', rect, { accessibilityHidden: true })], {
          platform: 'ios',
          windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }],
          elements: elementList,
        }),
        window: [0, 0, 402, 874],
        tolerance: 1,
      })
    const far = probe([16, 610, 120, 640], [forecast])
    assert.deepEqual(
      [far.code, far.hiddenAttached],
      ['live_font_text_probe_unmatched', []]
    )
    // Right under the element, "cast" is only part of the word "Forecast".
    const inside = probe([16, 152, 120, 166], [forecast])
    assert.deepEqual(
      [inside.code, inside.hiddenAttached],
      ['live_font_text_probe_unmatched', []]
    )
    // A label that holds "cast" as a word takes it beside its frame, never 460 px away.
    const cast = { ...forecast, label: 'Forecast details, cast list' }
    const castLabelNode = node(cast.label, [16, 100, 386, 150], cast.identifier)
    const withLabel = (rect) =>
      matchTextProbe({
        platform: 'ios',
        nodes: [castLabelNode],
        answer: answerFor('t', [iosRecord('cast', rect, { accessibilityHidden: true })], {
          platform: 'ios',
          windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }],
          elements: [cast],
        }),
        window: [0, 0, 402, 874],
        tolerance: 1,
      })
    assert.deepEqual(withLabel([16, 152, 120, 166]).hiddenAttached, [
      { record: 0, element: 0, node: 0 },
    ])
    assert.deepEqual(withLabel([16, 610, 120, 640]).hiddenAttached, [])
  })
})

// TEA ruling r49 P2-1 (probe 2a): the card above, 14 px away, whose label mentions "Archived",
// took the badge that sits wholly inside the card below.
// TEA ruling r49 P2-1 (probe 2a): the card above, 14 px away, whose label mentions "Archived",
// took the badge that sits wholly inside the card below, an element no hierarchy node stands
// for.
describe('matchTextProbe, accessibility-hidden records held by an element (TEA ruling r49)', () => {
  const element = (identifier, label, rect) => ({
    hasText: true,
    identifier,
    label,
    rect,
    window: 1,
  })
  /** `withNodes` lists the elements a hierarchy node stands for. */
  const probe = (
    elements,
    { rect = [20, 194, 120, 212], withNodes = elements, extraNodes = [] } = {}
  ) =>
    matchTextProbe({
      platform: 'ios',
      nodes: [
        ...withNodes.map((each) => node(each.label, each.rect, each.identifier)),
        ...extraNodes,
      ],
      answer: answerFor(
        't',
        [iosRecord('Archived', rect, { accessibilityHidden: true })],
        {
          platform: 'ios',
          windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }],
          elements,
        }
      ),
      window: [0, 0, 402, 874],
      tolerance: 1,
      // The element paths alone: with the iOS group rule a node box that holds the badge takes
      // it first.
      groupRule: false,
    })
  const ownerOf = (result) => {
    const pair = result.pairs.find((each) => each.record === 0)
    return pair ? [pair.node, pair.via] : null
  }
  const above = element('card-1', 'Saved item, Archived', [16, 100, 386, 180])
  const below = element('card-2', 'Winter coat', [16, 192, 386, 272])
  const list = element('list', 'Saved items, Archived', [0, 90, 402, 800])

  test('an identified element whose frame holds the record decides it', () => {
    // The card below holds the badge; its label lacks the word: unmatched, never stolen.
    const stolen = probe([above, below], { withNodes: [above] })
    assert.deepEqual(
      [stolen.code, stolen.unmatchedRecords, ownerOf(stolen)],
      ['live_font_text_probe_unmatched', [0], null]
    )
    const labelled = element('card-2', 'Winter coat, Archived', [16, 192, 386, 272])
    const hidden = element('card-2', 'Winter coat, Archived', [16, 192, 386, 272])
    hidden.hasText = false
    assert.deepEqual(ownerOf(probe([list, hidden], { withNodes: [list, hidden] })), [
      1,
      'attached',
    ])
    assert.deepEqual(ownerOf(probe([above, labelled])), [1, 'attached'])
    // Held by no identified element, it may still join one that borders it.
    assert.deepEqual(ownerOf(probe([above], { rect: [20, 182, 120, 198] })), [
      0,
      'accessibilityHidden',
    ])
  })

  // TEA ruling r52 P2-4 a (probe 4a): the card below holds the badge but carries no identifier,
  // or is a hierarchy node only; the card above still took the badge across the gap.
  test('a record joins a bordering element only when nothing else holds it apart from it', () => {
    const anonymous = { ...below, identifier: null }
    const blocked = probe([above, anonymous], { withNodes: [above] })
    assert.deepEqual([blocked.unmatchedRecords, ownerOf(blocked)], [[0], null])
    const viaNode = probe([above], {
      extraNodes: [node('Winter coat', [16, 192, 386, 272], 'card-2')],
    })
    assert.deepEqual([viaNode.unmatchedRecords, ownerOf(viaNode)], [[0], null])
    // A container that also holds the bordering element blocks nothing.
    const list = { ...anonymous, rect: [0, 90, 402, 800], label: 'Saved items' }
    assert.deepEqual(ownerOf(probe([above, list], { withNodes: [above] })), [
      0,
      'accessibilityHidden',
    ])
  })

  // TEA ruling r52 P2-4 b (probe 4b, mutant M2): of the smallest holders, those whose label
  // holds the words own the record; one owns, several are ambiguous, none leaves it unmatched.
  // The cards' own text records pair their nodes first, as a card's title does on device.
  test('among tied smallest holders the ones whose label holds the words decide', () => {
    const frame = [16, 192, 386, 272]
    const tied = (labels) => {
      const elements = labels.map((label, index) =>
        element(`card-${index}`, label, frame)
      )
      return matchTextProbe({
        platform: 'ios',
        nodes: elements.map((each) => node(each.label, frame, each.identifier)),
        answer: answerFor(
          't',
          [
            iosRecord('Archived', [20, 194, 120, 212], { accessibilityHidden: true }),
            ...labels.map((label) => iosRecord(label, frame)),
          ],
          {
            platform: 'ios',
            windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }],
            elements,
          }
        ),
        window: [0, 0, 402, 874],
        tolerance: 1,
        groupRule: false,
      })
    }
    assert.deepEqual(tied(['Winter coat', 'Winter coat, Archived']).hiddenAttached, [
      { record: 0, element: 1, node: 1 },
    ])
    assert.deepEqual(tied(['Coat, Archived', 'Winter coat, Archived']).hiddenAmbiguous, [
      { record: 0, elements: [0, 1] },
    ])
    const none = tied(['Winter coat', 'Summer coat'])
    assert.deepEqual([none.unmatchedRecords, none.hiddenAttached], [[0], []])
  })
})

describe('matchTextProbe, records out of matching (TEA rulings 2026-11-14)', () => {
  // r48 P3-1 (probe F6_overflowRegionOf_left_col) and TEA ruling r49 P2-2 (probe 2b): a record
  // scrolled away sideways joins the region that holds the viewport it scrolls in; window
  // geometry missed a padded carousel and a straddling chip and gave a sibling's record away.
  test('a scrolled-away record joins a region sideways through its scroll viewport', () => {
    const kindOf = (rect, scrollViewport, regions, window = [0, 0, 1080, 2400]) =>
      match(
        [],
        [record('Chip', rect, { visibleRect: null, scrolledAway: true, scrollViewport })],
        { volatileRegions: regions, window }
      ).kinds[0]
    // The 6c85bbb4 chip row, its viewport the row.
    assert.equal(
      kindOf([1315, 545, 1615, 616], [0, 475, 1080, 645], [[0, 475, 1080, 645]]),
      'volatile'
    )
    // A padded carousel: region and viewport inset 16 from each window edge.
    const padded = [16, 120, 384, 160]
    assert.equal(
      kindOf([420, 125, 520, 155], padded, [padded], [0, 0, 400, 800]),
      'volatile'
    )
    // A chip that starts just inside the window edge.
    const row = [0, 120, 400, 160]
    assert.equal(kindOf([390, 125, 470, 155], row, [row], [0, 0, 400, 800]), 'volatile')
    // A sibling carousel at the edge: the record scrolls in its own viewport, outside the region.
    assert.equal(
      kindOf(
        [420, 125, 520, 155],
        [0, 120, 240, 160],
        [[250, 120, 400, 160]],
        [0, 0, 400, 800]
      ),
      'scrolled'
    )
    // Another column: its viewport on the right, the region on the left.
    assert.equal(
      kindOf([500, 120, 620, 160], [400, 100, 1080, 180], [[0, 100, 200, 180]]),
      'scrolled'
    )
    // r52 P2-1: a carousel its outer scroll view cuts at 2200; the hierarchy cuts the region
    // there too, and the viewport native now gives, cut the same way, lies in it.
    assert.equal(
      kindOf([1315, 2150, 1615, 2190], [0, 2100, 1080, 2200], [[0, 2100, 1080, 2200]]),
      'volatile'
    )
    // CodeRabbit on PR 230: a scrolled-away record whose own centre falls in a sibling region
    // belongs to the region of the viewport it scrolls in, here none.
    assert.equal(
      kindOf(
        [420, 125, 520, 155],
        [0, 120, 240, 160],
        [[400, 120, 650, 160]],
        [0, 0, 1080, 800]
      ),
      'scrolled'
    )
    // No viewport known: no region this way.
    assert.equal(kindOf([1315, 545, 1615, 616], null, [[0, 475, 1080, 645]]), 'scrolled')
    assert.equal(
      kindOf([1315, 545, 1615, 616], undefined, [[0, 475, 1080, 645]]),
      'scrolled'
    )
  })

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

  // Android Release 0027bf63, Community: the spotlight section's testID drops its subtree from
  // the hierarchy, but the subtitle under its heading is a sibling the region's bounds overlap,
  // so the hierarchy keeps it; its record must pair and be judged like any other.
  test('a region leaves out on the record side only what the hierarchy left out', () => {
    const region = [0, 883, 1080, 2190]
    const subtitle = 'Standout looks near you from the past week.'
    const result = match(
      [node(subtitle, [0, 969, 1080, 1017])],
      [
        record('Spotlight in US', [0, 883, 1080, 948]),
        record(subtitle, [0, 969, 1080, 1017]),
        record('#1', [79, 1051, 120, 1098]),
      ],
      { volatileRegions: [region] }
    )
    assert.equal(result.pass, true, JSON.stringify(result.unmatchedNodes))
    assert.deepEqual(
      result.pairs.map((pair) => [pair.node, pair.record, pair.via]),
      [[0, 1, 'text']]
    )
    assert.deepEqual(result.volatile, [
      { record: 0, region: 0 },
      { record: 2, region: 0 },
    ])
    // A region record whose text no node shows is never owed one.
    const alone = match([], [record('#1', [79, 1051, 120, 1098])], {
      volatileRegions: [region],
    })
    assert.deepEqual([alone.pass, alone.volatile], [true, [{ record: 0, region: 0 }]])
  })

  test('a record in a volatile region never joins an iOS group', () => {
    const result = matchTextProbe({
      platform: 'ios',
      nodes: [node('Card, Partnered', [0, 100, 400, 300], 'card')],
      answer: answerFor(
        't',
        [
          iosRecord('Card', [10, 110, 100, 130]),
          iosRecord('Partnered', [10, 250, 100, 270]),
        ],
        { platform: 'ios', windows: [{ ...WINDOW, rect: [0, 0, 402, 874] }] }
      ),
      window: [0, 0, 402, 874],
      volatileRegions: [[0, 240, 400, 300]],
      tolerance: 1,
    })
    assert.equal(result.pass, true)
    assert.deepEqual(result.groups, [{ node: 0, records: [0] }])
    assert.deepEqual(result.volatile, [{ record: 1, region: 0 }])
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

  test('a ReactSwitch with no text stays empty; one with text pairs like a text view', () => {
    const empty = match([], [record('', [900, 700, 1000, 760], { kind: 'ReactSwitch' })])
    assert.deepEqual([empty.pass, empty.empty, empty.pairs], [true, [0], []])
    const labelled = match(
      [node('On', [900, 700, 1000, 760])],
      [record('On', [900, 700, 1000, 760], { kind: 'ReactSwitch' })]
    )
    assert.deepEqual(
      [labelled.pass, labelled.pairs.map((pair) => pair.via)],
      [true, ['text']]
    )
    assert.equal(
      match([], [record('On', [900, 700, 1000, 760], { kind: 'ReactSwitch' })]).pass,
      false
    )
  })

  // TEA ruling r45, iOS 791123d1: a tab button's label pairs with its text record, so its icon
  // glyph had nowhere to go. It attaches to a node exact text took, identity first.
  const TAB = node('Home', [0, 784, 100, 840], 'tab-home')
  const TILE = node('Bottom', [16, 784, 386, 844], 'garment-tile-default-bottom')
  const ICON = '\uf015'
  const tabRecords = (ancestor) => [
    iosRecord('Home', [20, 822, 80, 838]),
    iosRecord('Bottom', [40, 786, 120, 800]),
    iosRecord(
      ICON,
      [37, 801, 63, 819],
      ancestor === undefined ? {} : { accessibilityAncestor: ancestor }
    ),
  ]
  const attachedOf = (result) =>
    result.attached.map((entry) => [entry.node, entry.records])

  test('without an ancestor a leftover record attaches to the smallest node that holds it', () => {
    for (const ancestor of [undefined, null]) {
      const result = ios([TAB, TILE], tabRecords(ancestor))
      assert.equal(result.pass, true, JSON.stringify(result.unmatchedRecords))
      assert.deepEqual(attachedOf(result), [[0, [2]]])
      assert.deepEqual(
        result.pairs.filter((pair) => pair.via === 'attached').map((pair) => pair.record),
        [2]
      )
    }
    // Two smallest holders of one size are ambiguous.
    const twin = node('Home', [0, 784, 100, 840], 'tab-home-copy')
    const tied = ios(
      [TAB, twin],
      [
        ...tabRecords().filter((r) => r.text !== 'Bottom'),
        iosRecord('Home', [21, 822, 81, 838]),
      ]
    )
    assert.equal(tied.code, 'live_font_text_probe_ambiguous')
    // A record no node holds is still unmatched.
    const outside = ios(
      [TAB],
      [iosRecord('Home', [20, 822, 80, 838]), iosRecord(ICON, [200, 100, 230, 130])]
    )
    assert.deepEqual(
      [outside.code, outside.unmatchedRecords],
      ['live_font_text_probe_unmatched', [1]]
    )
  })

  // iOS 9adc0d1a, Community: the spotlight card image runs under the tab bar, so its two
  // identical label nodes (open: no text view carries alt text) held each tab icon too, and the
  // open-first pass tied between them. The smallest holder of any kind is the tab.
  test('a leftover record goes to the smallest holder of any kind, before a larger open node', () => {
    const image = node('Spotlight look 1 styled for the season', [17, 721, 325, 1029], '')
    const copy = node(
      'Spotlight look 1 styled for the season',
      [17, 721, 325, 1029],
      'community-card-image-seed-spotlight-1'
    )
    const records = [
      iosRecord('Home', [20, 822, 80, 838]),
      iosRecord(ICON, [37, 791, 63, 819]),
    ]
    const result = ios([TAB, image, copy], records)
    assert.deepEqual(result.ambiguous, [])
    assert.deepEqual(attachedOf(result), [[0, [1]]])
    assert.deepEqual(result.unmatchedNodes, [1, 2], 'alt text no text view carries')
    // Smallest of all is still a group when it is open.
    const open = ios(
      [image, node('Hourly', [30, 790, 70, 830], 'hourly-item')],
      [records[1]]
    )
    assert.deepEqual([open.groups, open.attached], [[{ node: 1, records: [0] }], []])
  })

  // TEA ruling r47 (r45 P2-6): identity first with containment; an ancestor with no node
  // falls back to geometry among the nodes that hold both the record and the ancestor.
  test('an ancestor identifier decides before geometry, and the named node must hold the record', () => {
    // The ancestor names the tile, though the tab is the smaller holder.
    const named = ios([TAB, TILE], tabRecords({ identifier: TILE.id, rect: TILE.box }))
    assert.equal(named.pass, true)
    assert.deepEqual(attachedOf(named), [[1, [2]]])
    // Nodes carry the identifier, but none holds the record: unmatched, never geometry.
    const outside = ios(
      [TAB, TILE, node('Settings', [301, 784, 402, 840], 'tab-settings')],
      [
        ...tabRecords({ identifier: 'tab-settings', rect: [30, 786, 70, 824] }),
        iosRecord('Settings', [320, 822, 390, 838]),
      ]
    )
    assert.deepEqual(
      [outside.code, outside.unmatchedRecords],
      ['live_font_text_probe_unmatched', [2]]
    )
  })

  test('R4D: one testID twice resolves by containment, then the smallest', () => {
    const pills = [
      node('A', [10, 100, 110, 140], 'pill'),
      node('B', [15, 100, 115, 140], 'pill'),
    ]
    const records = (rect, ancestor = [16, 100, 116, 140]) => [
      iosRecord('A', [40, 120, 80, 138]),
      iosRecord('B', [60, 120, 100, 138]),
      iosRecord('•', rect, {
        accessibilityAncestor: { identifier: 'pill', rect: ancestor },
      }),
    ]
    // Only pill A holds the dot at 12..24, whatever rect the ancestor reports.
    assert.deepEqual(attachedOf(ios(pills, records([12, 102, 24, 114]))), [[0, [2]]])
    // Both hold it: the smaller one.
    const nested = [
      node('A', [10, 100, 110, 140], 'pill'),
      node('B', [15, 101, 100, 139], 'pill'),
    ]
    assert.deepEqual(attachedOf(ios(nested, records([20, 102, 30, 114]))), [[1, [2]]])
    // Two holders of one size: ambiguous.
    const twins = [
      node('A', [10, 100, 110, 140], 'pill'),
      node('B', [10, 100, 110, 140], 'pill'),
    ]
    assert.equal(
      ios(twins, records([20, 102, 30, 114])).code,
      'live_font_text_probe_ambiguous'
    )
  })

  test('R4E: an ancestor XCUITest flattened away falls back to the nodes holding it and the record', () => {
    // icon-box has no node; the tab holds the icon and the box, the card under the bar only
    // the icon's rect partly, so the tab takes it.
    const flattened = ios(
      [TAB, TILE],
      tabRecords({ identifier: 'icon-box', rect: [30, 786, 70, 824] })
    )
    assert.equal(flattened.pass, true, JSON.stringify(flattened.unmatchedRecords))
    assert.deepEqual(attachedOf(flattened), [[0, [2]]])
    // No node holds both: unmatched.
    const nowhere = ios(
      [TAB, TILE],
      tabRecords({ identifier: 'icon-box', rect: [30, 600, 70, 824] })
    )
    assert.deepEqual(
      [nowhere.code, nowhere.unmatchedRecords],
      ['live_font_text_probe_unmatched', [2]]
    )
  })

  test('R4C: a reported ancestor beats a smaller sibling that also holds the record; none, the smallest', () => {
    const card = node('Card, Partnered, Shop', [16, 400, 386, 600], 'card')
    const button = node('Shop', [200, 540, 380, 590], 'card-shop')
    const records = (ancestor) => [
      iosRecord('Shop', [210, 550, 370, 580]),
      iosRecord('Partnered', [220, 545, 330, 560], { accessibilityAncestor: ancestor }),
    ]
    const named = ios([card, button], records({ identifier: 'card', rect: card.box }))
    assert.deepEqual(
      [named.pass, named.groups, named.attached],
      [true, [{ node: 0, records: [1] }], []]
    )
    // With no ancestor only geometry decides: the smallest holder, the button.
    const unnamed = ios([card, button], records(null))
    assert.deepEqual(attachedOf(unnamed), [[1, [1]]])
    assert.deepEqual(unnamed.unmatchedNodes, [0], 'the card then holds no record')
  })

  test('an ancestor naming an open node makes it a group', () => {
    const result = ios(
      [hourly],
      hourlyRecords.map((each) => ({
        ...each,
        accessibilityAncestor: { identifier: 'hourly-item', rect: hourly.box },
      }))
    )
    assert.equal(result.pass, true)
    assert.deepEqual(result.groups, [{ node: 0, records: [0, 1, 2] }])
    assert.deepEqual(result.attached, [])
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
