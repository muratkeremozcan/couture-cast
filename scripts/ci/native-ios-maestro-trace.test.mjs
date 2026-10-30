import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  maestroFlowProgress,
  shareCardApiRows,
  recordIosCommandTimings,
  recordIosFlowProgress,
  openerGeometry,
  expoGoScreenSummary,
  readIosAppLogSummary,
  readIosOpenerTrace,
  inputSurface,
  communityPreferenceApiRows,
  recordIosHostSample,
  scheduleIosInFlowSample,
  scrollPath,
  summarizeAppLog,
  failedStepHierarchy,
  systemSurfaceSummary,
  logSize,
  slowMaestroCommands,
} from './native-ios-maestro-trace.mjs'

const row = (
  name,
  duration,
  status = 'COMPLETED',
  selector = { textRegex: 'private' }
) => ({
  metadata: {
    status,
    duration,
    sequenceNumber: 3,
    depth: 0,
    evaluatedCommand: { [name]: { selector } },
  },
})
const outputWith = (t, rows) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-maestro-trace-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(path.join(directory, 'run'))
  fs.writeFileSync(path.join(directory, 'run', 'commands.json'), JSON.stringify(rows))
  return directory
}

test('only slow commands are kept, by name, status and duration without selectors', (t) => {
  const output = outputWith(t, [
    row('extendedWaitUntilCommand', 14210),
    row('tapOnElement', 80),
    row('bad name!', 2000, 'ODD'),
  ])
  const slow = slowMaestroCommands(output)
  assert.deepEqual(
    slow.map((c) => [c.name, c.status, c.durationMs]),
    [
      ['extendedWaitUntilCommand', 'COMPLETED', 14210],
      ['unknown', 'UNAVAILABLE', 2000],
    ]
  )
  assert.doesNotMatch(JSON.stringify(slow), /private/)
})

test('the receipt appends flows, is iOS only and survives a missing trace', (t) => {
  const output = outputWith(t, [row('extendedWaitUntilCommand', 5000)])
  const directory = outputWith(t, [])
  recordIosCommandTimings({ platform: 'ios', flow: 'a.yaml', output, directory })
  recordIosCommandTimings({
    platform: 'ios',
    flow: 'b.yaml',
    output: path.join(output, 'missing'),
    directory,
  })
  assert.equal(
    recordIosCommandTimings({ platform: 'android', flow: 'c.yaml', output, directory }),
    null
  )
  const record = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-flow-command-timings.json'))
  )
  assert.deepEqual(
    record.flows.map((f) => [f.flow, f.commands.length]),
    [
      ['a.yaml', 1],
      ['b.yaml', 0],
    ]
  )
})

const L = 'maestro.cli.runner.MaestroCommandRunner.runCommands$lambda$0'
const stamped = (time, text) => `${time} [ INFO] ${L}: ${text}`
const killedLog = [
  '14:00:00.000 [ INFO] maestro.cli.runner.TestRunner.runSingle: Running flow open-post.yaml...',
  stamped('14:00:01.000', 'Tap on id: tab-community RUNNING'),
  stamped('14:00:03.500', 'Tap on id: tab-community COMPLETED'),
  stamped('14:00:04.000', 'Swipe from (50%,45%) to (50%,80%) RUNNING'),
  stamped('14:00:06.000', 'Swipe from (50%,45%) to (50%,80%) COMPLETED'),
  stamped('14:00:07.000', 'Swipe from (50%,45%) to (50%,80%) RUNNING'),
  stamped('14:00:09.000', 'Swipe from (50%,45%) to (50%,80%) COMPLETED'),
  stamped('14:00:10.000', 'Run flow when visible "Maria Private" SKIPPED'),
  stamped('14:02:00.000', 'Swipe from (50%,75%) to (50%,40%) RUNNING'),
  'a stack trace line that is not a command line',
].join('\n')

test('a killed flow shows which commands ran, how often and where it stopped, without label text', () => {
  const progress = maestroFlowProgress(killedLog)
  assert.equal(progress.commandLines, 8)
  assert.deepEqual(progress.last, { verb: 'Swipe from', status: 'RUNNING' })
  assert.equal(progress.spanSeconds, 119)
  assert.deepEqual(
    progress.verbs.find((v) => v.verb === 'Swipe from' && v.status === 'COMPLETED'),
    { verb: 'Swipe from', status: 'COMPLETED', count: 2 }
  )
  assert.doesNotMatch(JSON.stringify(progress), /Maria|Private|50%|tab-community/)
  assert.deepEqual(maestroFlowProgress(undefined), {
    commandLines: 0,
    verbs: [],
    last: null,
    spanSeconds: null,
  })
})

test('failed iOS flows append their progress and other platforms record nothing', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-progress-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const lines = []
  recordIosFlowProgress({
    platform: 'ios',
    flow: 'maestro/story68/open-post.yaml',
    maestroLog: killedLog,
    directory,
    report: (line) => lines.push(line),
  })
  assert.equal(
    recordIosFlowProgress({
      platform: 'android',
      flow: 'x',
      maestroLog: killedLog,
      directory,
    }),
    null
  )
  const record = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-flow-progress.json'))
  )
  assert.equal(record.failedFlows.length, 1)
  assert.equal(record.failedFlows[0].flow, 'maestro/story68/open-post.yaml')
  assert.match(lines[0], /iosFlowProgress/)
})

test('a failing progress record or report never throws into the flow failure path', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-progress-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const throwing = () => {
    throw new Error('console closed')
  }
  assert.doesNotThrow(() =>
    recordIosFlowProgress({
      platform: 'ios',
      flow: 'f',
      maestroLog: killedLog,
      directory,
      report: throwing,
    })
  )
  assert.doesNotThrow(() =>
    recordIosFlowProgress({
      platform: 'ios',
      flow: 'f',
      maestroLog: killedLog,
      directory: path.join(directory, 'missing', 'deeper'),
      report: () => undefined,
    })
  )
})

test('share-card API rows keep only path, method, status and duration of share-card requests', () => {
  const log = [
    JSON.stringify({
      path: '/api/v1/share-cards/prepare',
      method: 'POST',
      statusCode: 200,
      durationMs: 812,
      userId: 'u-secret',
    }),
    JSON.stringify({
      path: '/api/v1/community/feed',
      method: 'GET',
      statusCode: 200,
      durationMs: 5,
    }),
    JSON.stringify({
      path: '/api/v1/share-cards/prepare?x=Maria',
      method: 'POST',
      statusCode: 429,
      durationMs: 3,
      body: 'Private',
    }),
    'not json',
    JSON.stringify({
      path: '/api/v1/share-cards/prepare',
      method: 'TRACE',
      statusCode: 'x',
      durationMs: 1.5,
    }),
  ].join('\n')
  const rows = shareCardApiRows(log)
  assert.deepEqual(rows, [
    { path: '/api/v1/share-cards/prepare', method: 'POST', status: 200, ms: 812 },
    { path: '/api/v1/share-cards/prepare_x_Maria', method: 'POST', status: 429, ms: 3 },
    { path: '/api/v1/share-cards/prepare', method: 'OTHER', status: null, ms: null },
  ])
  assert.doesNotMatch(JSON.stringify(rows), /secret|Private|userId/)
  assert.equal(shareCardApiRows(undefined).length, 0)
  assert.equal(shareCardApiRows(log, 1).length, 1)
})

test('a failed flow record carries the recent share-card API rows from the API log tail', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-progress-api-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const apiLogFile = path.join(directory, 'api.log')
  fs.writeFileSync(
    apiLogFile,
    JSON.stringify({
      path: '/api/v1/share-cards/prepare',
      method: 'POST',
      statusCode: 503,
      durationMs: 20100,
    }) + '\n'
  )
  const entry = recordIosFlowProgress({
    platform: 'ios',
    flow: 'maestro/story68/open-outfit.yaml',
    maestroLog: killedLog,
    directory,
    apiLogFile,
    report: () => undefined,
  })
  assert.deepEqual(entry.shareCardApi, [
    { path: '/api/v1/share-cards/prepare', method: 'POST', status: 503, ms: 20100 },
  ])
  const missing = recordIosFlowProgress({
    platform: 'ios',
    flow: 'f',
    maestroLog: killedLog,
    directory,
    apiLogFile: path.join(directory, 'absent.log'),
    report: () => undefined,
  })
  assert.deepEqual(missing.shareCardApi, [])
})

test('a failed flow record excludes API rows written before the flow began', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-progress-since-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const apiLogFile = path.join(directory, 'api.log')
  const row = (statusCode) =>
    JSON.stringify({
      path: '/api/v1/share-cards/prepare',
      method: 'POST',
      statusCode,
      durationMs: 5,
    }) + '\n'
  assert.equal(logSize(apiLogFile), 0)
  fs.writeFileSync(apiLogFile, row(200))
  const fromByte = logSize(apiLogFile)
  const record = (apiLogFromByte) =>
    recordIosFlowProgress({
      platform: 'ios',
      flow: 'maestro/story68/open-outfit.yaml',
      maestroLog: killedLog,
      directory,
      apiLogFile,
      apiLogFromByte,
      report: () => undefined,
    }).shareCardApi
  assert.deepEqual(record(fromByte), [])
  fs.appendFileSync(apiLogFile, row(503))
  assert.deepEqual(
    record(fromByte).map((entry) => entry.status),
    [503]
  )
  assert.deepEqual(
    record(0).map((entry) => entry.status),
    [200, 503]
  )
})

const alertTree = {
  attributes: { class: 'Root' },
  children: [
    {
      attributes: { text: '"CoutureCast" Would Like to Add to Your Photos' },
      children: [
        { attributes: { text: 'Allow' }, children: [] },
        { attributes: { accessibilityText: 'Don\u2019t Allow' }, children: [] },
        { attributes: { text: 'Private caption 50%' }, children: [] },
      ],
    },
    { attributes: { 'resource-id': 'share-card-save' }, children: [] },
  ],
}

test('the failure summary is closed: counts, listed alert buttons, flags and Apple ids only', () => {
  const summary = systemSurfaceSummary(alertTree)
  assert.deepEqual(summary, {
    nodeCount: 6,
    topLevelCount: 2,
    alertButtons: ["Don't Allow", 'Allow'].sort(),
    permissionTextSeen: true,
    appleResourceIds: [],
    breadcrumbSeen: false,
    returnLinkSeen: false,
  })
  assert.doesNotMatch(JSON.stringify(summary), /Private|caption|50%|share-card-save/)
  const quiet = systemSurfaceSummary({
    attributes: {},
    children: [{ attributes: { text: 'Save to photos' }, children: [] }],
  })
  assert.deepEqual(quiet.alertButtons, [])
  assert.equal(quiet.permissionTextSeen, false)
  assert.equal(systemSurfaceSummary(null), null)
})

test('the failed step hierarchy is read from its Maestro artifact and nothing else', (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-hierarchy-'))
  t.after(() => fs.rmSync(output, { recursive: true, force: true }))
  assert.equal(failedStepHierarchy(output), null)
  fs.mkdirSync(path.join(output, 'screen-hierarchy'))
  fs.writeFileSync(
    path.join(output, 'screen-hierarchy/failure.json'),
    JSON.stringify(alertTree)
  )
  fs.writeFileSync(
    path.join(output, 'commands.json'),
    JSON.stringify([
      { command: {}, metadata: { status: 'COMPLETED', artifacts: [] } },
      {
        command: {},
        metadata: {
          status: 'FAILED',
          artifacts: [
            { type: 'SCREEN_HIERARCHY', path: '../outside.json' },
            { type: 'SCREEN_HIERARCHY', path: '/abs/failure.json' },
            { type: 'SCREEN_HIERARCHY', path: 'screen-hierarchy/failure.json' },
          ],
        },
      },
    ])
  )
  assert.deepEqual(failedStepHierarchy(output), alertTree)
})

test('host samples run the evidence script with the label and never throw', () => {
  const calls = []
  const lines = []
  const ok = recordIosHostSample('locale-loop', {
    root: '/r',
    spawn: (binary, args, options) => {
      calls.push({ binary, args, options })
      return { status: 0 }
    },
    report: (line) => lines.push(line),
  })
  assert.equal(ok, true)
  assert.deepEqual(calls[0].args, [
    'scripts/ci/native-host-evidence.mjs',
    'sample',
    'locale-loop',
    '--platform',
    'ios',
  ])
  assert.equal(calls[0].options.cwd, '/r')
  assert.equal(
    recordIosHostSample('flow-failure', {
      spawn: () => ({ status: 3 }),
      report: (line) => lines.push(line),
    }),
    false
  )
  assert.match(lines[0], /hostSampleFailure.*flow-failure.*3/)
  assert.equal(
    recordIosHostSample('flow-failure', {
      spawn: () => {
        throw new Error('boom')
      },
    }),
    false
  )
})

test('a failed flow with its output directory samples the host first and records the surface', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-surface-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const labels = []
  const entry = recordIosFlowProgress({
    platform: 'ios',
    flow: 'maestro/story68/permanent.yaml',
    maestroLog: killedLog,
    directory,
    output: directory,
    spawn: (binary, args) => {
      labels.push(args[2])
      return { status: 0 }
    },
    report: () => undefined,
  })
  assert.deepEqual(labels, ['flow-failure'])
  assert.equal(entry.hostSampled, true)
  assert.equal(entry.systemSurface, null)
})

test('the runner samples the host in the locale loop and hands the failure path its output directory', () => {
  const runner = fs.readFileSync(
    new URL('../run-story68-native.mjs', import.meta.url),
    'utf8'
  )
  assert.match(
    runner,
    /activeLocale = locale\n\s+if \(platform === 'ios'\) recordIosHostSample\('locale-loop', \{ root \}\)\n\s+maestro\('maestro\/story65\/set-locale\.yaml'/
  )
  assert.match(
    runner,
    /apiLogFromByte,\n\s+output,\n\s+root,\n\s+device,\n\s+appId,\n\s+\}\)/
  )
})

const realLayout = new URL('./fixtures/maestro-failed-step/', import.meta.url)

test('a real Maestro artifact layout (failed assertCondition, screen-hierarchy subdirectory) yields a non-null surface', (t) => {
  // The fixture keeps the real FAILED row and a real COMPLETED row verbatim, the real artifact
  // paths, and a pruned copy of the real hierarchy file. Run 23 recorded null on this shape.
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-real-layout-'))
  t.after(() => fs.rmSync(output, { recursive: true, force: true }))
  fs.cpSync(realLayout, output, { recursive: true })
  const hierarchy = failedStepHierarchy(output)
  assert.notEqual(hierarchy, null)
  const summary = systemSurfaceSummary(hierarchy)
  assert.ok(summary.nodeCount > 10, String(summary.nodeCount))
  assert.ok(summary.topLevelCount >= 1)
  assert.deepEqual(summary.alertButtons, [])
  assert.equal(summary.permissionTextSeen, false)
  const lines = []
  const entry = recordIosFlowProgress({
    platform: 'ios',
    flow: 'maestro/story68/community-draft-background-ios.yaml',
    maestroLog: killedLog,
    directory: output,
    output,
    spawn: () => ({ status: 0 }),
    report: (line) => lines.push(line),
  })
  assert.deepEqual(entry.systemSurface, summary)
  assert.match(lines.at(-1), /"systemSurface":\{"nodeCount":\d+/)
})

test('an in-flow sample is scheduled detached, after the delay, for the named flow', () => {
  const calls = []
  const started = scheduleIosInFlowSample('maestro/story68/cancel.yaml', {
    root: '/work',
    seconds: 30,
    spawn: (binary, args, options) => {
      calls.push({ binary, args, options })
      return { unref: () => calls.push('unref') }
    },
  })
  assert.equal(started, true)
  assert.equal(calls[0].binary, '/bin/sh')
  assert.deepEqual(calls[0].args.slice(0, 5), [
    '-c',
    'sleep "$1"; shift; exec "$@"',
    'sh',
    '30',
    process.execPath,
  ])
  assert.deepEqual(calls[0].args.slice(5), [
    'scripts/ci/native-host-evidence.mjs',
    'sample',
    'in-flow',
    '--flow',
    'maestro/story68/cancel.yaml',
    '--platform',
    'ios',
  ])
  assert.equal(calls[0].options.detached, true)
  assert.equal(calls[0].options.stdio, 'ignore')
  assert.equal(calls[1], 'unref')
  assert.equal(
    scheduleIosInFlowSample('maestro/x.yaml', {
      platform: 'android',
      spawn: () => {
        throw new Error('android never samples')
      },
    }),
    false
  )
  assert.equal(
    scheduleIosInFlowSample('maestro/x.yaml', {
      spawn: () => {
        throw new Error('no shell')
      },
    }),
    false
  )
})

test('the runner schedules the in-flow sample for every iOS flow before Maestro starts', () => {
  const runner = fs.readFileSync(
    new URL('../run-story68-native.mjs', import.meta.url),
    'utf8'
  )
  assert.match(
    runner,
    /scheduleIosInFlowSample\(flow, \{ platform, root \}\)\n\s+const result = withNativeTransport/
  )
})

// Node shape and bounds format as Maestro stores them. The opener and tab-home frames are the
// values of run 27 (points); the chip bar frame is the layout arithmetic (header bottom 106 pt,
// 56 pt bar), because no stored hierarchy holds it yet.
const node = (id, bounds, children = []) => ({
  attributes: { 'resource-id': id, bounds },
  children,
})
const screen = (...nodes) => ({ children: [node('root', '[0,0][402,874]', nodes)] })
const CHIPS = node('mobile-chip-navigation', '[0,106][402,162]')
const TAB = node('tab-home', '[0,784][33,802]')

test('the opener geometry names the bar a tap centre would land on', () => {
  const covered = openerGeometry(
    screen(node('outfit-share-card-open', '[16,117][386,165]'), CHIPS, TAB)
  )
  assert.deepEqual(covered, {
    chips: [0, 106, 402, 162],
    opener: [16, 117, 386, 165],
    tab: [0, 784, 33, 802],
    centreCoveredBy: 'chips',
  })
  const clear = openerGeometry(
    screen(node('outfit-share-card-open', '[16,351][386,399]'), CHIPS, TAB)
  )
  assert.equal(clear.centreCoveredBy, null)
  const lowered = openerGeometry(
    screen(
      node('outfit-share-card-open', '[16,770][386,818]'),
      CHIPS,
      node('tab-home', '[0,784][33,802]')
    )
  )
  assert.equal(lowered.centreCoveredBy, 'tab')
  assert.equal(openerGeometry(screen(CHIPS, TAB)), null)
  assert.equal(openerGeometry(null), null)
  assert.equal(openerGeometry(screen(node('outfit-share-card-open', 'not bounds'))), null)
})

test('the scroll path lists the swipes and scrolls with status and the element top at each try', (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-scroll-'))
  t.after(() => fs.rmSync(output, { recursive: true, force: true }))
  fs.mkdirSync(path.join(output, 'a'))
  fs.writeFileSync(
    path.join(output, 'a', 'commands.json'),
    JSON.stringify([
      { command: { tapOnElement: {} }, metadata: { status: 'COMPLETED' } },
      { command: { swipeCommand: {} }, metadata: { status: 'COMPLETED' } },
      { command: { swipeCommand: {} }, metadata: { status: 'COMPLETED' } },
      { command: { scrollUntilVisible: {} }, metadata: { status: 'COMPLETED' } },
      { command: { scrollCommand: {} }, metadata: { status: 'FAILED' } },
    ])
  )
  const log = [
    'Scrolling try count: 0, DeviceWidth: 402, DeviceWidth: 874',
    'Element bounds: Bounds(x=16, y=351, width=370, height=48)',
    'Element bounds: Bounds(x=16, y=117, width=370, height=48)',
  ].join('\n')
  assert.deepEqual(scrollPath(output, log), {
    steps: [
      { kind: 'swipe', status: 'COMPLETED' },
      { kind: 'swipe', status: 'COMPLETED' },
      { kind: 'scrollUntilVisible', status: 'COMPLETED' },
      { kind: 'scroll', status: 'FAILED' },
    ],
    elementTops: [351, 117],
  })
  assert.deepEqual(scrollPath('/nonexistent', ''), { steps: [], elementTops: [] })
})

test('the opener trace is read from the app container and reduced to closed names', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-container-'))
  t.after(() => fs.rmSync(container, { recursive: true, force: true }))
  fs.mkdirSync(path.join(container, 'Documents'))
  fs.writeFileSync(
    path.join(container, 'Documents', 'cc68-opener-trace.json'),
    JSON.stringify({
      version: 1,
      events: [
        { e: 'press', t: 10.4 },
        { e: 'state-open', t: 14 },
        { e: 'secret-token', t: 15 },
        { e: 'composer-prepare', t: -1 },
        { e: 'composer-cached', t: 20 },
        { e: 'signin-code-change', t: 30, n: 6 },
        { e: 'signin-code-change', t: 31, n: '123456' },
        { e: 'signin-verify-press', t: 32, n: 250 },
        { e: 'signin-verify-unavailable', t: 33 },
        { e: 'prefs-token-null', t: 34 },
        { e: 'prefs-loaded', t: 35, n: 3 },
      ],
    })
  )
  const calls = []
  const spawn = (binary, args) => {
    calls.push([binary, ...args])
    return { status: 0, stdout: `${container}\n` }
  }
  assert.deepEqual(readIosOpenerTrace({ device: 'DEV', appId: 'app.id', spawn }), [
    { event: 'press', ms: 10 },
    { event: 'state-open', ms: 14 },
    { event: 'composer-cached', ms: 20 },
    { event: 'signin-code-change', ms: 30, length: 6 },
    { event: 'signin-code-change', ms: 31 },
    { event: 'signin-verify-press', ms: 32 },
    { event: 'signin-verify-unavailable', ms: 33 },
    { event: 'prefs-token-null', ms: 34 },
    { event: 'prefs-loaded', ms: 35, length: 3 },
  ])
  assert.deepEqual(calls[0], [
    'xcrun',
    'simctl',
    'get_app_container',
    'DEV',
    'app.id',
    'data',
  ])
  assert.equal(
    readIosOpenerTrace({ device: 'DEV', appId: 'app.id', spawn: () => ({ status: 1 }) }),
    null
  )
  assert.equal(
    readIosOpenerTrace({
      device: 'DEV',
      appId: 'app.id',
      spawn: () => ({ status: 0, stdout: '/nonexistent\n' }),
    }),
    null
  )
})

const realLog = fs.readFileSync(
  new URL('./fixtures/app-log/real-log-show.ndjson', import.meta.url),
  'utf8'
)

test('the app log summary counts levels in real log show ndjson and keeps no text', () => {
  const rows = realLog
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const expected = (type) => rows.filter((row) => row.messageType === type).length
  const summary = summarizeAppLog(realLog)
  assert.deepEqual(summary, {
    lines: expected('Default') + expected('Error') + expected('Fault'),
    error: expected('Error'),
    fault: expected('Fault'),
    jsException: 0,
  })
  assert.ok(
    summary.error > 0 && summary.fault > 0,
    'the real sample has error and fault rows'
  )
  const withException = `${realLog}\n${JSON.stringify({ messageType: 'Error', eventMessage: 'Unhandled JS Exception: boom' })}\nnot json\n`
  assert.equal(summarizeAppLog(withException).jsException, 1)
  assert.deepEqual(Object.keys(summary), ['lines', 'error', 'fault', 'jsException'])
  assert.deepEqual(summarizeAppLog(''), { lines: 0, error: 0, fault: 0, jsException: 0 })
})

test('the app log query is bounded to the app process and the last minute', () => {
  const calls = []
  const summary = readIosAppLogSummary({
    device: 'DEV',
    spawn: (binary, args, options) => {
      calls.push({ binary, args, options })
      return { status: 0, stdout: realLog }
    },
  })
  assert.ok(summary.lines > 0)
  assert.deepEqual(calls[0].args, [
    'simctl',
    'spawn',
    'DEV',
    'log',
    'show',
    '--last',
    '60s',
    '--style',
    'ndjson',
    '--predicate',
    'process == "CoutureCastStory68"',
  ])
  assert.equal(calls[0].options.timeout, 30000)
  assert.equal(
    readIosAppLogSummary({ device: 'DEV', spawn: () => ({ status: 1, stdout: '' }) }),
    null
  )
})

test('an Expo Go flow reads the Expo Go process log and every other flow the dev client log', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-progress-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const predicates = []
  const spawn = (binary, args) => {
    const at = args.indexOf('--predicate')
    if (at !== -1) predicates.push(args[at + 1])
    return { status: 1, stdout: '' }
  }
  for (const appId of ['host.exp.Exponent', 'com.couturecast.story68'])
    recordIosFlowProgress({
      platform: 'ios',
      flow: 'maestro/story68/expo-go-open.yaml',
      maestroLog: killedLog,
      directory,
      device: 'DEV',
      appId,
      spawn,
      report: () => undefined,
    })
  assert.deepEqual(predicates, [
    'process == "Expo Go"',
    'process == "CoutureCastStory68"',
  ])
})

test('an Expo Go screen is named by flags and counts, never by its text', () => {
  const screen = (...texts) => ({
    attributes: {},
    children: texts.map((text) => ({ attributes: { text }, children: [] })),
  })
  const flags = (hierarchy) => {
    const { nodeCount, textNodes, ...seen } = expoGoScreenSummary(hierarchy)
    return { nodeCount, textNodes, on: Object.keys(seen).filter((key) => seen[key]) }
  }
  assert.deepEqual(
    flags(screen('Something went wrong', 'Reload', 'private stack frame')),
    {
      nodeCount: 4,
      textNodes: 3,
      on: ['error', 'retry'],
    }
  )
  assert.deepEqual(flags(screen('Opening exp://127.0.0.1:8089', 'Downloading 45%')).on, [
    'loading',
  ])
  assert.deepEqual(flags(screen('Development servers', 'Expo Go')).on, ['projectList'])
  assert.deepEqual(flags(screen('This is the developer menu.')).on, ['developerMenu'])
  assert.deepEqual(flags(screen('Project is incompatible with this version')).on, [
    'incompatible',
  ])
  assert.equal(expoGoScreenSummary(null), null)
  assert.doesNotMatch(
    JSON.stringify(expoGoScreenSummary(screen('private stack frame', 'exp://127.0.0.1'))),
    /private|exp:/
  )
})

test('only an Expo Go flow carries the Expo Go screen record', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-progress-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  for (const appId of ['host.exp.Exponent', 'com.couturecast.story68'])
    recordIosFlowProgress({
      platform: 'ios',
      flow: 'maestro/story68/expo-go-open.yaml',
      maestroLog: killedLog,
      directory,
      appId,
      report: () => undefined,
    })
  const [expoGo, devClient] = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-flow-progress.json'))
  ).failedFlows
  assert.ok('expoGoScreen' in expoGo)
  assert.equal(expoGo.expoGoScreen, null)
  assert.ok(!('expoGoScreen' in devClient))
})

const field = (attributes, extra = {}) => ({ attributes, children: [], ...extra })

test('the input surface reports the code field flags and length, never a character', () => {
  const hierarchy = {
    attributes: {},
    children: [
      field({ 'resource-id': 'other', text: 'Private Person person@private.invalid' }),
      field(
        { 'resource-id': 'signin-code-input', text: '493817', enabled: 'true' },
        { focused: true }
      ),
    ],
  }
  const surface = inputSurface(hierarchy)
  assert.deepEqual(surface, {
    codeInput: { focused: true, enabled: true, textLength: 6 },
    focusedNodeCount: 1,
  })
  const text = JSON.stringify(surface)
  assert.ok(!/493817|Private|person@/.test(text))
})

test('the input surface tells an unfocused empty field from an absent one', () => {
  assert.deepEqual(
    inputSurface({
      attributes: {},
      children: [field({ 'resource-id': 'signin-code-input', enabled: 'true' })],
    }),
    {
      codeInput: { focused: false, enabled: true, textLength: 0 },
      focusedNodeCount: 0,
    }
  )
  assert.deepEqual(inputSurface({ attributes: {}, children: [] }), {
    codeInput: null,
    focusedNodeCount: 0,
  })
  assert.equal(inputSurface(null), null)
})

test('community preference rows keep phase, method, status and duration only', () => {
  const line = (extra) =>
    JSON.stringify({
      path: '/api/v1/community/notification-preferences',
      method: 'GET',
      ...extra,
    })
  const log = [
    line({ message: 'request_received' }),
    line({
      message: 'request_failed',
      statusCode: 503,
      durationMs: 2195,
      userId: 'cc68-native-secret',
    }),
    JSON.stringify({ path: '/api/v1/share-cards/x', method: 'GET', statusCode: 200 }),
    JSON.stringify({ path: '/x/notification-preferences', method: 'TRACE' }),
    'not json',
  ].join('\n')
  const rows = communityPreferenceApiRows(log)
  assert.deepEqual(rows, [
    { phase: 'received', method: 'GET', status: null, ms: null },
    { phase: 'failed', method: 'GET', status: 503, ms: 2195 },
    { phase: 'other', method: 'OTHER', status: null, ms: null },
  ])
  assert.ok(!JSON.stringify(rows).includes('secret'))
})

test('the request phase is read from own names only, so inherited property names stay other', () => {
  const line = (message) =>
    JSON.stringify({
      path: '/api/v1/community/notification-preferences',
      method: 'GET',
      message,
    })
  const rows = communityPreferenceApiRows(
    ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'request_completed']
      .map(line)
      .join('\n')
  )
  assert.deepEqual(
    rows.map((row) => row.phase),
    ['other', 'other', 'other', 'other', 'completed']
  )
})

test('the system surface records Apple resource ids, the breadcrumb and a return link, and nothing the app owns', () => {
  const node = (attributes, children = []) => ({ attributes, children })
  const summary = systemSurfaceSummary(
    node({}, [
      node({ 'resource-id': 'com.apple.settings.general', text: 'General' }),
      node({ 'resource-id': 'com.apple.settings.siri' }),
      node({ 'resource-id': 'breadcrumb', text: 'Return to CoutureCast Story68' }),
      node({ 'resource-id': 'garment-tile-8F3C6A1E-1B2D-4C5E-9A7B-0123456789AB' }),
      node({ 'resource-id': 'com.apple.' + 'x'.repeat(70) }),
      node({ 'resource-id': 'share-card-title' }),
    ])
  )
  assert.deepEqual(summary.appleResourceIds, [
    'com.apple.settings.general',
    'com.apple.settings.siri',
  ])
  assert.equal(summary.breadcrumbSeen, true)
  assert.equal(summary.returnLinkSeen, true)
  assert.doesNotMatch(JSON.stringify(summary), /garment|share-card-title|8F3C/)
  const none = systemSurfaceSummary(
    node({}, [node({ 'resource-id': 'share-card-title' })])
  )
  assert.deepEqual(none.appleResourceIds, [])
  assert.equal(none.breadcrumbSeen, false)
  assert.equal(none.returnLinkSeen, false)
})

test('a zero threshold keeps every command of the flow', (t) => {
  const output = outputWith(t, [
    row('tapOnElement', 40),
    row('assertConditionCommand', 700),
  ])
  const directory = outputWith(t, [])
  const entry = recordIosCommandTimings({
    platform: 'ios',
    flow: 'held.yaml',
    output,
    directory,
    minMs: 0,
  })
  assert.deepEqual(
    entry.commands.map((c) => [c.name, c.durationMs]),
    [
      ['tapOnElement', 40],
      ['assertConditionCommand', 700],
    ]
  )
})
