import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  simulatorCommandRecorder,
  simulatorJobs,
  simulatorManager,
  extractionService,
} from './native-ios-command-evidence.mjs'
import { probeSimulatorTuning } from './native-ios-quiesce.mjs'

const ps =
  '100 1 0 /s/launchd_sim\n101 100 0 /s/SpringBoard\n102 100 70 /s/STExtractionService\n200 1 90 /host/STExtractionService'
const jobsText =
  'PID Status Label\n101 0 com.apple.SpringBoard\n102 0 com.apple.STExtractionService\n200 0 host.Service\n- 0 inactive'

test('all command outcomes retain full diagnostics and nonfatal tuning returns to its caller', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-command-record-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const run = simulatorCommandRecorder(dir, () => ({
    status: null,
    signal: 'SIGKILL',
    error: { code: 'ETIMEDOUT' },
    stdout: 'partial output',
    stderr: 'full failure detail',
  }))
  const r = run('log-level-off', 'xcrun', ['simctl', 'spawn', 'owned', 'log'], {
    fatal: false,
  })
  assert.equal(r.errorCode, 'ETIMEDOUT')
  assert.equal(r.stderr, 'full failure detail')
  assert.ok(r.durationMs >= 0)
  assert.throws(
    () => run('bootstatus', 'xcrun', ['simctl', 'bootstatus', 'owned']),
    /bootstatus:ETIMEDOUT/
  )
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'native-ios-startup-private.json')))
      .commands.length,
    2
  )
})

test('service selection uses the exact listed label and verified simulator parent', () => {
  const jobs = simulatorJobs(jobsText)
  assert.equal(simulatorManager(ps, jobs, 1), 100)
  assert.deepEqual(extractionService(ps, jobs, 100), {
    pid: 102,
    label: 'com.apple.STExtractionService',
  })
  assert.equal(
    extractionService(ps, [{ pid: 200, label: 'host.Service' }], 100),
    undefined
  )
  assert.throws(() => simulatorManager('', jobs, 1), /owned_simulator_manager_required/)
})

test('log-level and bootout failures remain nonfatal and the returned manager can enter the gate', () => {
  const calls = []
  const execute = (operation, binary, args, options) => {
    calls.push({ operation, binary, args, options })
    if (operation === 'list-services') return { exitCode: 0, stdout: jobsText }
    if (operation === 'simulator-processes') return { exitCode: 0, stdout: ps }
    if (operation === 'manager-pid') return { exitCode: 0, stdout: '100' }
    return { exitCode: 1, stdout: '', stderr: 'unsupported form' }
  }
  assert.equal(probeSimulatorTuning('owned-uuid', execute), 100)
  const log = calls.find((c) => c.operation === 'log-level-off')
  const bootout = calls.find((c) => c.operation === 'bootout-extraction-service')
  assert.equal(log.options.fatal, false)
  assert.equal(bootout.options.fatal, false)
  assert.deepEqual(bootout.args, [
    'simctl',
    'spawn',
    'owned-uuid',
    'launchctl',
    'bootout',
    'pid/100/com.apple.STExtractionService',
  ])
})
