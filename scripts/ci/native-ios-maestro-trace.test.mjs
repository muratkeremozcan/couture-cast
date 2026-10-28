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
