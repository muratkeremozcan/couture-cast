import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  simulatorCpu,
  waitForSimulatorCpu,
  assertNativeQuiesceEvidence,
  sampleSimulatorCpu,
} from './native-ios-quiesce.mjs'

const quiet = { STExtractionService: 0, healthappd: 0, diagnosticd: 0 }
const run = async (sample, options = {}) => {
  let at = 0
  return waitForSimulatorCpu({
    sample: () => sample(at / 1000),
    now: () => at,
    pause: async (ms) => {
      at += ms
    },
    record: assertNativeQuiesceEvidence,
    ...options,
  })
}

test('CPU scope includes nested simulator children and excludes host and other devices', () => {
  const ps =
    '100 1 0 /usr/libexec/launchd_sim\n101 100 1 /sim/SpringBoard\n102 100 2 /sim/diagnosticd\n103 102 4 /sim/healthappd\n104 100 3 /sim/STExtractionService\n200 1 99 /host/diagnosticd\n201 200 98 /other/STExtractionService'
  assert.deepEqual(simulatorCpu(ps, 100), {
    STExtractionService: 3,
    healthappd: 4,
    diagnosticd: 2,
  })
  assert.throws(() => simulatorCpu('', 100), /manager_missing/)
  assert.throws(() => simulatorCpu('100 1 0 /s/launchd_sim', 100), /springboard_missing/)
})

test('a full uninterrupted 30 seconds of low CPU is required', async () => {
  const report = await run((at) => (at === 20 ? { ...quiet, diagnosticd: 6 } : quiet))
  assert.equal(report.outcome, 'settled')
  assert.equal(report.elapsedSeconds, 55)
  assertNativeQuiesceEvidence(report)
})

test('all three targets gate settling and the 600 second cap prevents flow eligibility', async () => {
  for (const name of Object.keys(quiet)) {
    const report = await run(() => ({ ...quiet, [name]: 5.1 }))
    assert.equal(report.outcome, 'cap_hit')
    assert.equal(report.elapsedSeconds, 600)
    assertNativeQuiesceEvidence(report)
  }
})

test('unavailable CPU snapshots remain ineligible and wait until the 600 second cap', async () => {
  const report = await run(() => {
    throw new Error('no snapshot')
  })
  assert.equal(report.outcome, 'cap_hit')
  assert.equal(report.elapsedSeconds, 600)
  assert.equal(report.interruptions.length, 121)
})

test('the exact sampler failure reaches the diagnostic publisher before failing closed', async () => {
  const failure = new Error('owned_simulator_springboard_missing')
  let observed
  const report = await run(
    () => {
      throw failure
    },
    {
      onSampleFailure: (error) => {
        observed = error
      },
    }
  )
  assert.equal(report.outcome, 'cap_hit')
  assert.equal(observed, failure)
})

test('a real sampler timeout retains status, signal, error code, stderr and exact failed operation', () => {
  assert.throws(
    () =>
      sampleSimulatorCpu(100, 1000, {
        execute: () => ({
          status: null,
          signal: 'SIGKILL',
          error: { code: 'ETIMEDOUT' },
          stdout: 'partial snapshot',
          stderr: 'snapshot diagnostic',
        }),
      }),
    (error) => {
      assert.equal(error.message, 'simulator_cpu_snapshot_failed')
      assert.deepEqual(
        { ...error.diagnostic, durationMs: 0 },
        {
          operation: 'cpu-processes',
          reason: 'simulator_cpu_snapshot_failed',
          exitCode: null,
          signal: 'SIGKILL',
          errorCode: 'ETIMEDOUT',
          errorName: null,
          errorMessage: null,
          durationMs: 0,
          stdout: 'partial snapshot',
          stderr: 'snapshot diagnostic',
        }
      )
      return true
    }
  )
})

test('the final fractional remaining budget stays valid for the real Node child API', () => {
  let observed
  let calls = 0
  const cpu = sampleSimulatorCpu(100, 4649.61, {
    execute: (_binary, _args, options) => {
      assert.ok(Number.isInteger(options.timeout))
      assert.ok(options.timeout >= 1 && options.timeout <= 4649)
      const text =
        ++calls === 1
          ? '100 1 0 launchd_sim\n101 100 0 /sim/SpringBoard'
          : '100 1 launchd_sim\n101 100 /sim/SpringBoard\n102 100 /sim/log stream'
      return spawnSync(
        process.execPath,
        ['-e', `process.stdout.write(${JSON.stringify(text)})`],
        options
      )
    },
    onCollectors: (clients) => {
      observed = clients
    },
  })
  assert.deepEqual(cpu, quiet)
  assert.equal(calls, 2)
  assert.equal(observed[0].kind, 'log-stream')
  assert.equal(observed[0].ownedSimulator, true)
})

test('errors thrown before a sampling child starts retain their original Node diagnostic', () => {
  assert.throws(
    () =>
      sampleSimulatorCpu(100, 5000, {
        execute: () => {
          throw Object.assign(new RangeError('exact timeout error'), {
            code: 'ERR_OUT_OF_RANGE',
          })
        },
      }),
    (error) => {
      assert.equal(error.diagnostic.errorCode, 'ERR_OUT_OF_RANGE')
      assert.equal(error.diagnostic.errorName, 'RangeError')
      assert.equal(error.diagnostic.errorMessage, 'exact timeout error')
      return true
    }
  )
})

test('a failed collector inventory records its error and preserves valid CPU eligibility', () => {
  const ps = '100 1 0 launchd_sim\n101 100 0 /sim/SpringBoard'
  let calls = 0
  let diagnostic
  const cpu = sampleSimulatorCpu(100, 1000, {
    execute: () =>
      ++calls === 1
        ? { status: 0, stdout: ps }
        : { status: 1, stderr: 'collector snapshot failed' },
    onDiagnosticFailure: (error) => {
      diagnostic = error.diagnostic
    },
  })
  assert.equal(diagnostic.operation, 'collector-processes')
  assert.equal(diagnostic.exitCode, 1)
  assert.equal(diagnostic.stderr, 'collector snapshot failed')
  assert.deepEqual(cpu, quiet)
  assert.throws(
    () =>
      sampleSimulatorCpu(100, 1000, {
        execute: () => ({ status: 0, stdout: '100 1 0 launchd_sim' }),
      }),
    (error) => {
      assert.equal(error.diagnostic.reason, 'owned_simulator_springboard_missing')
      assert.equal(error.diagnostic.stdout, '100 1 0 launchd_sim')
      return true
    }
  )
})

test('a failed snapshot resets the quiet interval, then a full valid interval permits the next flow', async () => {
  let flowStarted = false
  let failureCount = 0
  const report = await run(
    (at) => {
      if (at === 20) throw new Error('transient ps failure')
      return quiet
    },
    {
      onSampleFailure: () => {
        failureCount++
      },
    }
  )
  if (report.outcome === 'settled') flowStarted = true
  assert.equal(failureCount, 1)
  assert.deepEqual(report.interruptions, [20])
  assert.equal(report.elapsedSeconds, 55)
  assert.equal(flowStarted, true)
  assertNativeQuiesceEvidence(report)
  assert.throws(
    () =>
      assertNativeQuiesceEvidence({
        ...report,
        samples: report.samples.filter((s) => s.elapsedSeconds <= 35),
        elapsedSeconds: 35,
      }),
    /invalid_native_quiesce_evidence/
  )
})

test('a broken diagnostic publisher cannot prevent later valid CPU samples from settling', async () => {
  const report = await run(
    (at) => {
      if (at === 0) throw new Error('snapshot failed')
      return quiet
    },
    {
      onSampleFailure: () => {
        throw new Error('diagnostic write failed')
      },
    }
  )
  assert.equal(report.outcome, 'settled')
  assert.equal(report.elapsedSeconds, 35)
})

test('settle evidence rejects private fields and an unproved settled flag', async () => {
  const valid = await run(() => quiet)
  for (const bad of [
    { ...valid, path: '/private' },
    { ...valid, samples: [] },
    { ...valid, samples: [{ elapsedSeconds: 30, cpu: quiet }] },
    { ...valid, samples: [{ elapsedSeconds: 0, cpu: { ...quiet, diagnosticd: '0' } }] },
  ])
    assert.throws(
      () => assertNativeQuiesceEvidence(bad),
      /invalid_native_quiesce_evidence/
    )
})

test('local sessions cannot modify simulator logging', () => {
  const r = spawnSync(
    process.execPath,
    ['scripts/ci/native-ios-quiesce.mjs', 'unowned'],
    { env: { ...process.env, GITHUB_ACTIONS: 'false' }, encoding: 'utf8' }
  )
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /quiesce_requires_disposable_macos/)
})

test('the publisher retains closed settle evidence and rejects poisoned records before any copy', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-quiesce-publish-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'native-quiesce-ios.json')
  const report = await run(() => quiet)
  const publish = () =>
    spawnSync(process.execPath, ['scripts/e2e-share-card/public-evidence.mjs'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, CC68_HARNESS_DIR: directory },
      encoding: 'utf8',
    })
  fs.writeFileSync(file, JSON.stringify(report))
  assert.equal(publish().status, 0)
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(directory, 'public-evidence/native-quiesce-ios.json'),
        'utf8'
      )
    ),
    report
  )
  fs.writeFileSync(file, JSON.stringify({ ...report, raw: 'private' }))
  const result = publish()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /invalid_native_quiesce_evidence/)
  assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
})
