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
import {
  probeSimulatorTuning,
  bootoutQuietServices,
  QUIET_SERVICES,
  bootoutOwnedEmitter,
  shouldEscalateEmitter,
  EMITTER_ESCALATION_SECONDS,
  EMITTER,
} from './native-ios-quiesce.mjs'

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
  assert.equal(
    calls.some((c) => c.operation === 'log-level-off'),
    false
  )
  const bootout = calls.find((c) => c.operation === 'bootout-extraction-service')
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

const apsdPs = ps + '\n103 100 80 /s/apsd\n300 1 80 /host/apsd'
const apsdJobs = jobsText + '\n103 0 com.apple.apsd\n300 0 com.apple.apsd'
const probe = (answer) => {
  const calls = []
  const execute = (operation, binary, args, options) => {
    calls.push({ operation, binary, args, options })
    if (operation === 'list-services') return { exitCode: 0, stdout: apsdJobs }
    if (operation === 'simulator-processes') return { exitCode: 0, stdout: apsdPs }
    if (operation === 'manager-pid') return { exitCode: 0, stdout: '100' }
    return { exitCode: answer(operation), stdout: '', stderr: 'recorded' }
  }
  const tuning = {}
  probeSimulatorTuning('owned-uuid', execute, tuning)
  return { calls, tuning }
}

test('an accepted process-scoped apsd log level change leaves the job running', () => {
  const { calls, tuning } = probe(() => 0)
  const level = calls.find((c) => c.operation === 'apsd-log-level')
  assert.deepEqual(level.args, [
    'simctl',
    'spawn',
    'owned-uuid',
    'log',
    'config',
    '--process',
    '103',
    '--mode',
    'level:off,persist:off',
  ])
  assert.equal(level.options.fatal, false)
  assert.equal(tuning.levelApplied, true)
  assert.equal(tuning.bootedOut, undefined)
  assert.deepEqual(tuning.emitter, { pid: 103, label: EMITTER.label })
  assert.equal(
    calls.some((c) => /apsd/.test(c.operation) && /bootout|remove/.test(c.operation)),
    false
  )
})

test('a rejected level change boots out the exact owned apsd label and stops at the first success', () => {
  const { calls, tuning } = probe((op) => (op === 'bootout-apsd-pid' ? 0 : 1))
  const names = calls.map((c) => c.operation).filter((o) => /apsd/.test(o))
  assert.deepEqual(names, [
    'apsd-log-level',
    'bootout-apsd-system',
    'bootout-apsd-pid',
    'list-services-after-apsd-stop',
  ])
  assert.equal(tuning.levelApplied, false)
  assert.equal(tuning.bootedOut, true)
  const pid = calls.find((c) => c.operation === 'bootout-apsd-pid')
  assert.equal(pid.args.at(-1), 'pid/100/com.apple.apsd')
  assert.equal(pid.options.fatal, false)
})

test('every bootout form is attempted and recorded before giving up', () => {
  const calls = []
  const ok = bootoutOwnedEmitter(
    'owned-uuid',
    100,
    { pid: 103, label: EMITTER.label },
    (operation) => {
      calls.push(operation)
      return { exitCode: 1 }
    }
  )
  assert.equal(ok, false)
  assert.deepEqual(calls, ['bootout-apsd-system', 'bootout-apsd-pid', 'remove-apsd'])
})

test('a host apsd outside the owned simulator is never targeted', () => {
  const { calls, tuning } = probe(() => 0)
  assert.equal(tuning.emitter.pid, 103)
  assert.equal(
    calls.some((c) => c.args.includes('300')),
    false
  )
})

test('apsd is stopped only after the accepted level change fails to quiet diagnosticd', () => {
  const late = EMITTER_ESCALATION_SECONDS * 1000
  const busy = { diagnosticd: 40 }
  const applied = { levelApplied: true }
  assert.equal(shouldEscalateEmitter(applied, late, busy), true)
  assert.equal(shouldEscalateEmitter(applied, late - 1, busy), false)
  assert.equal(shouldEscalateEmitter(applied, late, { diagnosticd: 5 }), false)
  assert.equal(shouldEscalateEmitter({}, late, busy), false)
  assert.equal(
    shouldEscalateEmitter({ levelApplied: true, bootedOut: true }, late, busy),
    false
  )
  assert.equal(
    shouldEscalateEmitter({ levelApplied: true, escalated: true }, late, busy),
    false
  )
})

test('quiet services are stopped by exact listed label, only when owned by the simulator manager', () => {
  const quietPs =
    ps +
    '\n110 100 1 /s/chronod\n111 100 1 /s/healthappd\n112 100 1 /s/tccd\n300 1 1 /host/chronod'
  const quietJobs = simulatorJobs(
    jobsText +
      '\n110 0 com.apple.chronod\n111 0 com.apple.healthappd\n112 0 com.apple.tccd\n300 0 host.chronod'
  )
  const calls = []
  const execute = (operation, binary, args, options) => {
    calls.push({ operation, binary, args, options })
    return { exitCode: operation === 'bootout-quiet-healthappd' ? 1 : 0 }
  }
  const stopped = bootoutQuietServices('owned-uuid', quietPs, quietJobs, 100, execute)
  assert.deepEqual(stopped, ['chronod'])
  assert.deepEqual(
    calls.map((c) => c.operation),
    ['bootout-quiet-chronod', 'bootout-quiet-healthappd']
  )
  assert.deepEqual(calls[0].args, [
    'simctl',
    'spawn',
    'owned-uuid',
    'launchctl',
    'bootout',
    'system/com.apple.chronod',
  ])
  assert.equal(calls[0].options.fatal, false)
  for (const protectedName of ['SpringBoard', 'tccd', 'backboardd', 'launchd_sim'])
    assert.equal(QUIET_SERVICES.includes(protectedName), false, protectedName)
})
