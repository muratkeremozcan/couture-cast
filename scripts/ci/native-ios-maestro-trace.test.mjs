import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  recordIosCommandTimings,
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
