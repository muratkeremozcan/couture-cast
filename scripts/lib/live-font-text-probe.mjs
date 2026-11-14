// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-00i (TD-01): the harness half of the text layout probe. The app's probe module
// (apps/mobile/modules/text-layout-probe, probe builds only) answers with one record per rendered
// text view in every window; this file asks for that answer, reads it back, checks it against
// the wire contract, and pairs each record with the hierarchy text node it renders. The oracle
// (live-font-scale-proof.mjs) judges the pairs. Design and TEA rulings:
// _bmad-output/implementation-artifacts/story-6-15/f-00i-text-layout-probe-design.md.
//
// Wire contract, version 1:
//   { version: 1, token, platform: 'android'|'ios',
//     windows: [{ id, rect, z, focused }],
//     records: [{ kind, text, window, viewRect, visibleRect|null, clipRect|null, contentRect,
//                 scrolledAway, lineCount, maxLines|null, ellipsized, unlimitedLineCount|null,
//                 opacity, offWindow? }] }
// Rects are [left, top, right, bottom]: screen pixels on Android (as uiautomator bounds), window
// points on iOS (as Maestro iOS bounds). `visibleRect` is the view cut by every clipping ancestor
// and the window; `clipRect` is the view cut by every clipping ancestor except scroll views and
// the window, so a scroll viewport edge never reads as a clip; `scrolledAway` is true when the
// view lies outside its nearest scroll view's clip or outside the window; `opacity` is the
// view's effective opacity, 0 to 1; `offWindow` (optional, false when absent) is true when the
// view lies wholly outside its window and no scroll view can bring it in.
//
// Android: `am broadcast -a com.couturecast.textlayoutprobe.DUMP --es token <t> -p <package>`,
// then `logcat -d -s TextLayoutProbe` lines `begin <t> <chunks> <sha256>`, `chunk <t> <i>
// <base64>` and `done <t>`. iOS: the token in <data container>/Library/Caches/text-layout-probe/
// request, `simctl spawn <udid> notifyutil -p com.couturecast.textlayoutprobe.dump`, then
// <same dir>/<token>.json. Every external call is bounded; three asks without a whole answer
// fail as live_font_text_probe_missing.
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import nodeFs from 'node:fs'
import path from 'node:path'

import { boundOf } from './spawn-bound.mjs'

export const TEXT_PROBE_VERSION = 1
export const TEXT_PROBE_TAG = 'TextLayoutProbe'
export const TEXT_PROBE_ACTION = 'com.couturecast.textlayoutprobe.DUMP'
export const TEXT_PROBE_NOTIFICATION = 'com.couturecast.textlayoutprobe.dump'
export const TEXT_PROBE_IOS_DIR = 'Library/Caches/text-layout-probe'
/** How many times the harness asks before the capture fails. */
export const TEXT_PROBE_ASKS = 3
/** How long one ask waits for its answer, and the bound of each external call. */
export const TEXT_PROBE_ANSWER_MS = 8_000
export const TEXT_PROBE_CALL_MS = 30_000
const POLL_MS = 250

/**
 * The text view classes each platform's probe reports; any other is `unknown:<class>`. Text
 * inputs (TEA ruling 2026-11-14) are paired like text; a single-line one (maxLines 1) is judged
 * like text, a multi-line one scrolls its own content and is reported only.
 */
export const TEXT_PROBE_KINDS = {
  android: ['ReactTextView', 'PreparedLayoutTextView', 'ReactEditText'],
  ios: ['RCTParagraphComponentView', 'RCTTextInputComponentView'],
}
export const INPUT_KINDS = new Set(['ReactEditText', 'RCTTextInputComponentView'])

/**
 * TEA ruling, 2026-11-14 (F-00i matching, change 5 as amended): on iOS a hierarchy text node is
 * an accessibility element, and an accessible view (a Pressable, the weather header, an hourly
 * item) groups the text views under it into one label that no text view carries. Under this rule
 * a leftover iOS node is such a group; it holds the leftover records its rect contains. Android
 * lists every text view, so it stays strictly one to one. Removing the rule makes every iOS group
 * unmatched both ways.
 */
export const IOS_ACCESSIBILITY_GROUPS = 'ios-accessibility-groups'

function fail(code, detail) {
  throw Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code })
}

const RECORD_FIELDS = [
  'kind',
  'text',
  'window',
  'viewRect',
  'visibleRect',
  'clipRect',
  'contentRect',
  'scrolledAway',
  'lineCount',
  'maxLines',
  'ellipsized',
  'unlimitedLineCount',
  'opacity',
].sort()
const ANSWER_FIELDS = ['platform', 'records', 'token', 'version', 'windows']
const WINDOW_FIELDS = ['focused', 'id', 'rect', 'z']

const isRect = (value) =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((part) => typeof part === 'number' && Number.isFinite(part)) &&
  value[2] >= value[0] &&
  value[3] >= value[1]
const isCount = (value) => Number.isSafeInteger(value) && value >= 0
const sameFields = (object, fields) =>
  object !== null &&
  typeof object === 'object' &&
  !Array.isArray(object) &&
  JSON.stringify(Object.keys(object).sort()) === JSON.stringify(fields)

const nullOr = (check) => (value) => value === null || check(value)
const isMaxLines = (value) => Number.isSafeInteger(value) && value > 0

/**
 * The record rules in order, each a breach's name and the test it must pass: the shape of each
 * field, then how the rects agree. A view scrolled away shows nothing; what shows also lies in
 * its clipRect; and a view that shows nothing without a scroll view moving it away is hidden by
 * a non-scroll ancestor or a zero size, which leaves no clipRect either.
 */
const RECORD_RULES = [
  ['text', (record) => typeof record.text === 'string'],
  ['viewRect', (record) => isRect(record.viewRect)],
  ['contentRect', (record) => isRect(record.contentRect)],
  ['visibleRect', (record) => nullOr(isRect)(record.visibleRect)],
  ['clipRect', (record) => nullOr(isRect)(record.clipRect)],
  ['scrolledAway', (record) => typeof record.scrolledAway === 'boolean'],
  ['lineCount', (record) => isCount(record.lineCount)],
  ['ellipsized', (record) => isCount(record.ellipsized)],
  ['maxLines', (record) => nullOr(isMaxLines)(record.maxLines)],
  ['unlimitedLineCount', (record) => nullOr(isCount)(record.unlimitedLineCount)],
  [
    'opacity',
    (record) =>
      typeof record.opacity === 'number' && record.opacity >= 0 && record.opacity <= 1,
  ],
  [
    'scrolledAway with a visibleRect',
    (record) => !record.scrolledAway || record.visibleRect === null,
  ],
  [
    'visibleRect without clipRect',
    (record) => record.visibleRect === null || record.clipRect !== null,
  ],
  [
    'hidden with a clipRect',
    (record) =>
      record.scrolledAway || record.visibleRect !== null || record.clipRect === null,
  ],
]

/**
 * `offWindow` (TEA ruling 2026-11-14): true when the text lies wholly outside its window and no
 * scroll view can bring it in (a sheet parked below the screen). Optional: a record from before
 * the field reads as false.
 */
const WITH_OFF_WINDOW = [...RECORD_FIELDS, 'offWindow'].sort()
const OFF_WINDOW_RULES = [
  [
    'offWindow',
    (record) => record.offWindow === undefined || typeof record.offWindow === 'boolean',
  ],
  [
    'offWindow with a visibleRect or scrolled away',
    (record) =>
      record.offWindow !== true || (record.visibleRect === null && !record.scrolledAway),
  ],
]

/** Why `record` breaks the contract, or null. `unknown:*` kinds are judged by the caller. */
function recordProblem(record, platform, windowIds) {
  if (!sameFields(record, RECORD_FIELDS) && !sameFields(record, WITH_OFF_WINDOW))
    return `fields ${JSON.stringify(Object.keys(record ?? {}).sort())}`
  if (!TEXT_PROBE_KINDS[platform].includes(record.kind)) return `kind ${record.kind}`
  if (!windowIds.has(record.window)) return `window ${record.window}`
  return (
    [...RECORD_RULES, ...OFF_WINDOW_RULES].find(([, holds]) => !holds(record))?.[0] ??
    null
  )
}

/** Why the answer's top level breaks the contract, or null. */
function answerProblem(answer, { platform, token }) {
  if (!sameFields(answer, ANSWER_FIELDS))
    return `fields ${JSON.stringify(Object.keys(answer ?? {}))}`
  if (answer.version !== TEXT_PROBE_VERSION) return `version ${answer.version}`
  if (answer.token !== token) return `token ${answer.token}, asked ${token}`
  if (answer.platform !== platform) return `platform ${answer.platform}, run ${platform}`
  if (!Array.isArray(answer.windows) || !Array.isArray(answer.records))
    return 'windows and records must be lists'
  return null
}

const isWindow = (window) =>
  sameFields(window, WINDOW_FIELDS) &&
  Number.isSafeInteger(window.id) &&
  Number.isSafeInteger(window.z) &&
  isRect(window.rect) &&
  typeof window.focused === 'boolean'

/** The ids of well-formed windows with unique ids, at most one of them focused. */
function windowIdsOf(windows) {
  const ids = new Set()
  for (const [index, window] of windows.entries()) {
    if (!isWindow(window) || ids.has(window.id))
      fail('live_font_text_probe_invalid', `window ${index}`)
    ids.add(window.id)
  }
  if (windows.filter((window) => window.focused).length > 1)
    fail('live_font_text_probe_invalid', 'more than one focused window')
  return ids
}

/**
 * The answer, checked against the wire contract: version 1, the token asked for, the run's
 * platform, windows with unique ids and at most one focused, and every record well formed. A
 * text view of a class the probe does not know fails as live_font_text_probe_unknown_view, so a
 * renderer change cannot hide text from the probe; any other breach fails as
 * live_font_text_probe_invalid.
 */
export function validateTextProbeAnswer(answer, { platform, token }) {
  if (!TEXT_PROBE_KINDS[platform])
    fail('live_font_text_probe_invalid', `platform ${platform}`)
  const problem = answerProblem(answer, { platform, token })
  if (problem) fail('live_font_text_probe_invalid', problem)
  const windowIds = windowIdsOf(answer.windows)
  for (const [index, record] of answer.records.entries()) {
    if (typeof record?.kind === 'string' && record.kind.startsWith('unknown:'))
      fail('live_font_text_probe_unknown_view', `record ${index} ${record.kind}`)
    const breach = recordProblem(record, platform, windowIds)
    if (breach) fail('live_font_text_probe_invalid', `record ${index} ${breach}`)
  }
  return answer
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** The `begin`, `chunk` and `done` lines of one token, or the conflict that spoils them. */
function tokenLines(logcat, token) {
  const lines = { begin: undefined, done: false, chunks: new Map() }
  for (const line of String(logcat).split('\n')) {
    const at = line.indexOf(TEXT_PROBE_TAG)
    const message =
      at < 0
        ? undefined
        : /^TextLayoutProbe\s*:\s?(.*)$/.exec(line.slice(at).trimEnd())?.[1]
    const parts = message?.trim().split(/\s+/) ?? []
    if (parts[1] !== token) continue
    const conflict = takeLine(lines, parts)
    if (conflict) return { conflict }
  }
  return lines
}

/** `begin <token> <count> <sha256>`: the one begin line, or a conflict with an earlier one. */
function takeBegin(lines, count, hash) {
  const next = { count: Number(count), hash: hash.toLowerCase() }
  const { begin } = lines
  if (begin && (begin.count !== next.count || begin.hash !== next.hash))
    return 'two begin lines'
  lines.begin = next
  return undefined
}

/** `chunk <token> <index> <base64>`: one chunk, or a conflict with another at its index. */
function takeChunk(lines, at, chunk) {
  const index = Number(at)
  if (!Number.isSafeInteger(index) || index < 0 || !BASE64.test(chunk))
    return `bad chunk ${at}`
  if (lines.chunks.has(index) && lines.chunks.get(index) !== chunk)
    return `two chunks ${index}`
  lines.chunks.set(index, chunk)
  return undefined
}

/** Adds one line's parts to `lines`; the conflict it makes, if any. */
function takeLine(lines, [kind, , third, fourth, ...rest]) {
  if (rest.length) return undefined
  const whole = fourth !== undefined
  if (kind === 'begin' && whole) return takeBegin(lines, third, fourth)
  if (kind === 'chunk' && whole) return takeChunk(lines, third, fourth)
  if (kind === 'done' && third === undefined) lines.done = true
  return undefined
}

/** The chunks in index order, or why they are not a whole answer. */
function orderedChunks({ begin, chunks }) {
  if (
    !(Number.isSafeInteger(begin.count) && begin.count > 0) ||
    !/^[0-9a-f]{64}$/.test(begin.hash)
  )
    return { status: 'conflict', detail: 'bad begin line' }
  if ([...chunks.keys()].some((index) => index >= begin.count))
    return { status: 'conflict', detail: 'chunk past the count' }
  const pieces = []
  for (let index = 0; index < begin.count; index += 1) {
    if (!chunks.has(index)) return { status: 'incomplete', detail: `no chunk ${index}` }
    pieces.push(chunks.get(index))
  }
  return { pieces }
}

/**
 * One token's answer from `logcat -d -s TextLayoutProbe` output: `{ status: 'complete', json }`,
 * or why there is none yet (`absent`, `incomplete`), or why this ask's answer is bad
 * (`hash_mismatch`, `conflict`: two different lines for one slot, or bytes that are no UTF-8).
 * Chunks are joined in index order; chunks that are each whole base64 (a multiple of four
 * characters) are decoded one by one, so a probe that encodes each piece separately and one that
 * cuts one base64 string both read back. The hash is the SHA-256 of the UTF-8 JSON.
 */
export function assembleLogcatAnswer(logcat, token) {
  const lines = tokenLines(logcat, token)
  if (lines.conflict) return { status: 'conflict', detail: lines.conflict }
  if (!lines.begin && !lines.chunks.size && !lines.done) return { status: 'absent' }
  if (!lines.begin || !lines.done)
    return { status: 'incomplete', detail: lines.begin ? 'no done' : 'no begin' }
  const ordered = orderedChunks(lines)
  if (!ordered.pieces) return ordered
  const { pieces } = ordered
  const bytes = pieces.every((piece) => piece.length % 4 === 0)
    ? Buffer.concat(pieces.map((piece) => Buffer.from(piece, 'base64')))
    : Buffer.from(pieces.join(''), 'base64')
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== lines.begin.hash)
    return { status: 'hash_mismatch', detail: `${hash} != ${lines.begin.hash}` }
  try {
    return {
      status: 'complete',
      json: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    }
  } catch {
    return { status: 'conflict', detail: 'answer is no UTF-8' }
  }
}

/** A blocking pause: makeCapture and the hierarchy reads around it are synchronous. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** spawnSync with a bound; a timeout, spawn error or nonzero exit throws a coded error. */
export function boundedCall(binary, args, { timeout = TEXT_PROBE_CALL_MS } = {}) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: boundOf(timeout, 'live_font_text_probe_timeout_invalid'),
    killSignal: 'SIGKILL',
  })
  const call = `${path.basename(binary)} ${args.slice(0, 4).join(' ')}`
  if (result.error)
    fail(
      'live_font_text_probe_command_failed',
      `${call}: ${result.error.code ?? 'spawn_error'}`
    )
  if (result.status !== 0)
    fail(
      'live_font_text_probe_command_failed',
      `${call}: exit ${result.status ?? result.signal}`
    )
  return result.stdout
}

const SHELL_SAFE = /^[A-Za-z0-9._-]+$/

/**
 * The probe for one device. `exec(binary, args, { timeout })` runs one bounded call and returns
 * its stdout (boundedCall by default); `sleep`, `now`, `fs` and `makeToken` are injectable for
 * the units. `read()` asks up to TEXT_PROBE_ASKS times, each with a fresh token and an answer
 * deadline, and returns the checked answer with `asks`, the outcome of every ask.
 */
export function createTextProbe({
  platform,
  device,
  appId,
  adbBinary = 'adb',
  exec = boundedCall,
  sleep = sleepSync,
  now = () => Date.now(),
  fs = nodeFs,
  makeToken = () => `t${Date.now().toString(36)}${randomBytes(4).toString('hex')}`,
  answerMs = TEXT_PROBE_ANSWER_MS,
  callMs = TEXT_PROBE_CALL_MS,
}) {
  if (!TEXT_PROBE_KINDS[platform])
    fail('live_font_text_probe_invalid', `platform ${platform}`)
  // adb shell joins its arguments into one device shell line, so every word must be inert there.
  for (const [name, value] of Object.entries({ device, appId }))
    if (typeof value !== 'string' || !SHELL_SAFE.test(value))
      fail('live_font_text_probe_invalid', `${name} ${value}`)
  const deadlineMs = boundOf(answerMs, 'live_font_text_probe_timeout_invalid')
  const call = (binary, args) => exec(binary, args, { timeout: callMs })

  const askAndroid = (token) => {
    call(adbBinary, [
      '-s',
      device,
      'shell',
      'am',
      'broadcast',
      '-a',
      TEXT_PROBE_ACTION,
      '--es',
      'token',
      token,
      '-p',
      appId,
    ])
    const deadline = now() + deadlineMs
    let outcome
    for (;;) {
      const logcat = call(adbBinary, ['-s', device, 'logcat', '-d', '-s', TEXT_PROBE_TAG])
      outcome = assembleLogcatAnswer(logcat, token)
      if (!['absent', 'incomplete'].includes(outcome.status) || now() >= deadline) break
      sleep(POLL_MS)
    }
    return outcome
  }

  let iosDir
  const askIos = (token) => {
    iosDir ??= path.join(
      call('xcrun', ['simctl', 'get_app_container', device, appId, 'data']).trim(),
      TEXT_PROBE_IOS_DIR
    )
    fs.mkdirSync(iosDir, { recursive: true })
    const request = path.join(iosDir, 'request')
    fs.writeFileSync(`${request}.tmp`, token)
    fs.renameSync(`${request}.tmp`, request)
    call('xcrun', [
      'simctl',
      'spawn',
      device,
      'notifyutil',
      '-p',
      TEXT_PROBE_NOTIFICATION,
    ])
    const answer = path.join(iosDir, `${token}.json`)
    const deadline = now() + deadlineMs
    let outcome = { status: 'absent' }
    for (;;) {
      if (fs.existsSync(answer)) {
        const text = fs.readFileSync(answer, 'utf8')
        try {
          JSON.parse(text)
          outcome = { status: 'complete', json: text }
          fs.rmSync(answer, { force: true })
          break
        } catch {
          // A file the app is still writing; read again until the deadline.
          outcome = { status: 'incomplete', detail: 'unparsed answer file' }
        }
      }
      if (now() >= deadline) break
      sleep(POLL_MS)
    }
    return outcome
  }

  return {
    read() {
      const asks = []
      for (let ask = 1; ask <= TEXT_PROBE_ASKS; ask += 1) {
        const token = makeToken()
        if (!SHELL_SAFE.test(token))
          fail('live_font_text_probe_invalid', `token ${token}`)
        const outcome = platform === 'android' ? askAndroid(token) : askIos(token)
        asks.push({
          token,
          status: outcome.status,
          ...(outcome.detail ? { detail: outcome.detail } : {}),
        })
        if (outcome.status !== 'complete') continue
        let parsed
        try {
          parsed = JSON.parse(outcome.json)
        } catch (error) {
          fail('live_font_text_probe_invalid', `answer is no JSON: ${error.message}`)
        }
        return { ...validateTextProbeAnswer(parsed, { platform, token }), asks }
      }
      return fail(
        'live_font_text_probe_missing',
        asks
          .map(
            (ask) => `${ask.token} ${ask.status}${ask.detail ? ` (${ask.detail})` : ''}`
          )
          .join('; ')
      )
    },
  }
}

// Matching (TEA change 5 and the rulings of 2026-11-14) -----------------------------------------

const area = (rect) => (rect[2] - rect[0]) * (rect[3] - rect[1])
const centre = (rect) => [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2]
const touches = (a, b, tolerance) =>
  a[0] <= b[2] + tolerance &&
  b[0] <= a[2] + tolerance &&
  a[1] <= b[3] + tolerance &&
  b[1] <= a[3] + tolerance
const contains = (outer, inner, tolerance) =>
  outer[0] <= inner[0] + tolerance &&
  outer[1] <= inner[1] + tolerance &&
  outer[2] >= inner[2] - tolerance &&
  outer[3] >= inner[3] - tolerance
function overlapRatio(a, b) {
  const width = Math.min(a[2], b[2]) - Math.max(a[0], b[0])
  const height = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
  if (width <= 0 || height <= 0) return 0
  const shared = width * height
  return shared / (area(a) + area(b) - shared)
}
const distance = (a, b) => {
  const [p, q] = [centre(a), centre(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1])
}
/** Top to bottom, then left to right, then list order: one order for repeats. */
const byPosition = (rectOf) => (a, b) =>
  rectOf(a)[1] - rectOf(b)[1] || rectOf(a)[0] - rectOf(b)[0] || a.index - b.index

/** Where a record shows: its visible part, or its own rect when nothing of it shows. */
export const recordRect = (record) => record.visibleRect ?? record.viewRect

/**
 * Windows under a focused window (higher `z`), by id: `{ by, whole }`. Android's hierarchy holds
 * only the focused window while a modal or a dialog is up, so the records of the Activity under
 * it have no node to match. `whole` when the focused window's rect covers theirs (the composer's
 * full-screen modal): nothing of them shows, so they are left out. Otherwise (a centred dialog,
 * TEA ruling on Antigravity r41 P2-3) they still show around it: out of matching, still judged
 * for clipping.
 */
export function coveredWindows(windows, tolerance) {
  const covered = new Map()
  for (const window of windows) {
    const above = windows.filter(
      (other) => other.focused && other.z > window.z && other.id !== window.id
    )
    const whole = above.find((other) => contains(other.rect, window.rect, tolerance))
    if (whole) covered.set(window.id, { by: whole.id, whole: true })
    else if (above.length) covered.set(window.id, { by: above[0].id, whole: false })
  }
  return covered
}

/** Each record's class (see matchTextProbe) and, for a volatile one, its region's index. */
function classifyRecords(records, coveredIds, volatileRegions) {
  const classes = {
    empty: [],
    covered: [],
    invisible: [],
    offWindow: [],
    behind: [],
    volatile: [],
    scrolled: [],
    hidden: [],
    visible: [],
  }
  const regionOf = new Map()
  for (const record of records) {
    const region = volatileRegionOf(record, volatileRegions)
    let kind = 'visible'
    if (record.text === '') kind = 'empty'
    else if (coveredIds.get(record.window)?.whole) kind = 'covered'
    // TEA ruling 2026-11-14: opacity exactly 0 draws nothing (the inactive copy of a stacked
    // tab icon); anything above 0, a fade caught mid-way, is matched and judged.
    else if (record.opacity === 0) kind = 'invisible'
    // Wholly off its window with no scroll view to bring it in: drawn nowhere, so no clip.
    else if (record.offWindow === true) kind = 'offWindow'
    else if (coveredIds.has(record.window)) kind = 'behind'
    else if (region >= 0) kind = 'volatile'
    else if (record.scrolledAway) kind = 'scrolled'
    else if (record.visibleRect === null) kind = 'hidden'
    classes[kind].push(record)
    if (kind === 'volatile') regionOf.set(record.index, region)
  }
  return { classes, regionOf }
}

/**
 * Each invisible record with the node it would pair with (same text, touching rect, best
 * overlap) or null, for the report only: it takes no node from the matching. `comparable` is
 * false for a record the hidden-text count leaves out (TEA ruling 2026-11-14): one in a window
 * a focused window covers, whole or in part, one in a volatile region, and one scrolled away,
 * none of which can be compared across launches.
 */
function invisibleNodes(nodes, invisible, { covers, inVolatile, tolerance }) {
  return invisible.map((record) => {
    const rect = recordRect(record)
    const touching = nodes
      .filter((node) => node.text === record.text && touches(node.box, rect, tolerance))
      .sort((a, b) => overlapRatio(b.box, rect) - overlapRatio(a.box, rect))
    const comparable =
      !covers.has(record.window) && !inVolatile(record) && !record.scrolledAway
    return { record: record.index, node: touching[0]?.index ?? null, comparable }
  })
}

/** Whether a record's centre lies inside one of the volatile regions. */
const volatileRegionOf = (record, volatileRegions) => {
  const [x, y] = centre(recordRect(record))
  return volatileRegions.findIndex(
    (rect) => x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3]
  )
}

/** Rank of each item in screen order: top to bottom, left to right, then list order. */
const ranks = (items, rectOf) =>
  new Map([...items].sort(byPosition(rectOf)).map((item, rank) => [item.index, rank]))

/**
 * Exact text, one to one: every node and record of one text whose rects touch, the best overlap
 * first, then the nearest centre, then screen order; each side is taken once. Takes the paired
 * ids out of `open` (nodes) and `free` (records).
 */
function pairByText({ nodes, candidates, open, free, tolerance, nodeRank, recordRank }) {
  const pairable = []
  for (const node of nodes)
    for (const record of candidates)
      if (
        open.has(node.index) &&
        node.text === record.text &&
        touches(node.box, recordRect(record), tolerance)
      )
        pairable.push({
          node,
          record,
          overlap: overlapRatio(node.box, recordRect(record)),
          distance: distance(node.box, recordRect(record)),
        })
  pairable.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      a.distance - b.distance ||
      nodeRank.get(a.node.index) - nodeRank.get(b.node.index) ||
      recordRank.get(a.record.index) - recordRank.get(b.record.index)
  )
  const pairs = []
  for (const { node, record } of pairable) {
    if (!open.has(node.index) || !free.has(record.index)) continue
    open.delete(node.index)
    free.delete(record.index)
    pairs.push({ node: node.index, record: record.index, via: 'text' })
  }
  return pairs
}

/**
 * IOS_ACCESSIBILITY_GROUPS: each leftover record joins the smallest open node (by area) whose
 * rect holds its rect within the tolerance; two smallest of one area make it ambiguous. A node
 * that takes at least one record is a group. Takes the grouped ids out of `open` and `free`.
 */
function groupLeftovers({ nodes, leftover, open, free, tolerance }) {
  const openNodes = nodes.filter((node) => open.has(node.index))
  const members = new Map(openNodes.map((node) => [node.index, []]))
  const ambiguous = []
  for (const record of leftover) {
    const holding = openNodes
      .filter((node) => contains(node.box, recordRect(record), tolerance))
      .sort((a, b) => area(a.box) - area(b.box))
    if (!holding.length) continue
    free.delete(record.index)
    const smallest = holding.filter((node) => area(node.box) === area(holding[0].box))
    if (smallest.length > 1)
      ambiguous.push({ record: record.index, nodes: smallest.map((node) => node.index) })
    else members.get(holding[0].index).push(record.index)
  }
  const groups = []
  for (const node of openNodes) {
    const held = members.get(node.index)
    if (!held.length) continue
    open.delete(node.index)
    groups.push({ node: node.index, records: held })
  }
  return { groups, ambiguous }
}

/**
 * Pairs the probe records of one capture with its hierarchy text nodes. `nodes` are the app's
 * text nodes ({ text, id, box }, box as [l, t, r, b]), `answer` the checked probe answer,
 * `window` the capture's window rect, `volatileRegions` the rects of the regions the capture
 * leaves out. Every record falls in one class:
 *   empty      text '' (no text to cut), left out
 *   covered    in a window a focused higher window covers whole, left out
 *   invisible  opacity exactly 0: left out of matching and judging, listed for review
 *   offWindow  wholly off its window, no scroll view to bring it in: may match, never
 *              required, never judged, listed for review
 *   behind     in a window under a focused higher window that does not cover it whole (a
 *              centred dialog): out of matching, still judged for clipping
 *   volatile   centre inside a volatile region: out of matching, still judged for clipping
 *   scrolled   scrolledAway: may match, never required, never judged
 *   hidden     visibleRect null but not scrolled away: a full clip, judged
 *   visible    must match a node
 * Exact text first, one to one: a node and a record of the same text pair only when the node's
 * box touches the record's rect (visibleRect, else viewRect; the Android hierarchy rect is
 * already cut to what shows), the best overlap first, then the nearest centre, then screen
 * order, so five "68°F" labels pair by position whatever order either side lists them in. On
 * iOS (IOS_ACCESSIBILITY_GROUPS) nodes that cover the whole window are left out, and each
 * leftover node is a group: a leftover record joins the smallest group (by area) whose rect
 * holds its rect within the tolerance; two smallest groups of one area are ambiguous. A group
 * that holds no record, a visible record no node takes, and on Android any leftover node, are
 * unmatched. A covering window none of whose records pairs is a missing answer. Indexes refer to
 * `nodes` and `answer.records`.
 */
export function matchTextProbe({
  platform,
  nodes,
  answer,
  window,
  volatileRegions = [],
  tolerance,
  groupRule = platform === 'ios',
}) {
  const records = answer.records.map((record, index) => ({ ...record, index }))
  const covers = coveredWindows(answer.windows, tolerance)
  const { classes, regionOf } = classifyRecords(records, covers, volatileRegions)
  const indexed = nodes.map((node, index) => ({ ...node, index }))
  const windowNodes =
    groupRule && window
      ? indexed.filter((node) => contains(node.box, window, tolerance))
      : []
  const open = new Set(
    indexed.filter((node) => !windowNodes.includes(node)).map((node) => node.index)
  )
  const candidates = [
    ...classes.visible,
    ...classes.hidden,
    ...classes.scrolled,
    ...classes.offWindow,
  ]
  const free = new Set(candidates.map((record) => record.index))
  const nodeRank = ranks(indexed, (node) => node.box)
  const recordRank = ranks(records, recordRect)
  const pairs = pairByText({
    nodes: indexed,
    candidates,
    open,
    free,
    tolerance,
    nodeRank,
    recordRank,
  })
  const leftover = candidates
    .filter((record) => free.has(record.index))
    .sort(byPosition(recordRect))
  const { groups, ambiguous } = groupRule
    ? groupLeftovers({ nodes: indexed, leftover, open, free, tolerance })
    : { groups: [], ambiguous: [] }
  for (const group of groups)
    for (const record of group.records)
      pairs.push({ node: group.node, record, via: 'group' })
  const unmatchedRecords = classes.visible
    .filter((record) => free.has(record.index))
    .map((record) => record.index)
  const unmatchedNodes = [...open].sort((a, b) => nodeRank.get(a) - nodeRank.get(b))
  // A covering window must answer for itself: the hierarchy shows only it, so a capture that
  // pairs none of its records read the wrong windows.
  const coverAnswered = [...new Set([...covers.values()].map((cover) => cover.by))].every(
    (id) => pairs.some((pair) => answer.records[pair.record].window === id)
  )
  let code = null
  if (!coverAnswered) code = 'live_font_text_probe_missing'
  else if (ambiguous.length) code = 'live_font_text_probe_ambiguous'
  else if (unmatchedRecords.length || unmatchedNodes.length)
    code = 'live_font_text_probe_unmatched'
  return {
    pass: code === null,
    code,
    pairs,
    groups,
    ambiguous,
    unmatchedRecords,
    unmatchedNodes,
    offscreen: classes.scrolled
      .filter((record) => free.has(record.index))
      .map((record) => record.index),
    hiddenRecords: classes.hidden.map((record) => record.index),
    volatile: classes.volatile.map((record) => ({
      record: record.index,
      region: regionOf.get(record.index),
    })),
    covered: [...covers].map(([id, { by, whole }]) => ({
      window: id,
      by,
      whole,
      records: records.filter((record) => record.window === id && record.text !== '')
        .length,
    })),
    behind: classes.behind.map((record) => record.index),
    invisible: invisibleNodes(indexed, classes.invisible, {
      covers,
      inVolatile: (record) => volatileRegionOf(record, volatileRegions) >= 0,
      tolerance,
    }),
    offWindow: invisibleNodes(indexed, classes.offWindow, {
      covers,
      inVolatile: (record) => volatileRegionOf(record, volatileRegions) >= 0,
      tolerance,
    }),
    empty: classes.empty.map((record) => record.index),
    windowNodes: windowNodes.map((node) => node.index),
  }
}
