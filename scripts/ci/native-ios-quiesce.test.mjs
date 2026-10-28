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
} from './native-ios-quiesce.mjs'

const quiet = { STExtractionService: 0, healthappd: 0, diagnosticd: 0 }
const run = async (sample) => {
  let at = 0
  return waitForSimulatorCpu({
    sample: () => sample(at / 1000),
    now: () => at,
    pause: async (ms) => {
      at += ms
    },
    record: assertNativeQuiesceEvidence,
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

test('failed process sampling fails closed', async () => {
  const report = await run(() => {
    throw new Error('no snapshot')
  })
  assert.equal(report.outcome, 'sample_failed')
  assert.equal(report.elapsedSeconds, 0)
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
