import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const helper = () => import('../lib/share-card-native-failure.mjs')
const root = fileURLToPath(new URL('../../', import.meta.url))
const personal =
  'Avery Private avery@personal.invalid https://private.invalid/member/123 ' +
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signature access_token=secret'
const input = {
  flow: 'maestro/story65/open-app.yaml',
  platform: 'android',
  durationMs: 1234,
}

test('classifies explicit Maestro failures into closed categories without retaining personal text', async () => {
  const { summarizeNativeFlowFailure } = await helper()
  const cases = [
    [
      'Snapshot failure while getting view hierarchy. Error: Error getting element frame kAXErrorInvalidUIElement',
      'snapshot',
    ],
    ['maestro.MaestroException$ElementNotFound: Element not found', 'elementtimeout'],
    ['Timed out waiting for element to become visible', 'elementtimeout'],
    [
      'io.grpc.StatusRuntimeException: UNAVAILABLE: failed to connect to all addresses',
      'driverconnection',
    ],
    ['maestro.MaestroException$AssertionFailure: Assertion is false', 'assertion'],
    [
      'Maestro Android driver did not start up in time on emulator (driver port 49998)',
      'driverconnection',
    ],
    ['TimeoutException: request took too long', 'unknown'],
    [personal, 'unknown'],
  ]
  for (const [signature, classification] of cases) {
    const result = summarizeNativeFlowFailure({
      ...input,
      log: `${personal}\n${signature}\n${personal}`,
    })
    assert.deepEqual(result, {
      flow: 'open-app.yaml',
      classification,
      durationMs: 1234,
      platform: 'android',
    })
  }
})

test('accepts repository rapid flow and rejects spoofed paths and invalid input without echoing it', async () => {
  const { summarizeNativeFlowFailure } = await helper()
  assert.equal(
    summarizeNativeFlowFailure({
      ...input,
      flow: 'maestro/story68/rapid-watermark-held.yaml',
      log: '',
    }).flow,
    'rapid-watermark-held.yaml'
  )
  for (const invalid of [
    { flow: 'open-app.yaml' },
    { flow: 'maestro/story65/../story65/open-app.yaml' },
    { flow: '/maestro/story65/open-app.yaml' },
    { flow: `maestro/story65/${personal}.yaml` },
    { flow: 'maestro/story65/unknown-flow.yaml' },
    { platform: personal },
    { durationMs: personal },
    { durationMs: -1 },
    { durationMs: 0.5 },
    { durationMs: Infinity },
    { durationMs: Number.MAX_SAFE_INTEGER + 1 },
    { log: { personal } },
  ]) {
    assert.throws(() => summarizeNativeFlowFailure({ ...input, log: '', ...invalid }), {
      message: 'invalid_native_flow_failure',
    })
  }
})

test('closed schema rejects unknown fields and poisoned values without exposing them', async () => {
  const { assertNativeFlowFailure } = await helper()
  const record = {
    flow: 'open-app.yaml',
    classification: 'unknown',
    durationMs: 0,
    platform: 'ios',
  }
  assert.doesNotThrow(() => assertNativeFlowFailure(record))
  for (const poisoned of [
    { ...record, log: personal },
    { ...record, flow: personal },
    { ...record, classification: personal },
    { ...record, durationMs: personal },
    { ...record, platform: personal },
    { ...record, durationMs: -1 },
    { ...record, durationMs: 0.1 },
    { flow: 'open-app.yaml', platform: 'ios', classification: 'unknown' },
    null,
    [],
  ]) {
    assert.throws(() => assertNativeFlowFailure(poisoned), {
      message: 'invalid_native_flow_failure',
    })
  }
})

test('default export flow failure survives classifier and public schema validation', async () => {
  const { summarizeNativeFlowFailure, assertNativeFlowFailure } = await helper()
  const record = summarizeNativeFlowFailure({
    ...input,
    flow: 'maestro/share-card-export.yaml',
    log: 'Assertion is false',
  })
  assert.deepEqual(record, {
    flow: 'share-card-export.yaml',
    classification: 'assertion',
    durationMs: 1234,
    platform: 'android',
  })
  assert.doesNotThrow(() => assertNativeFlowFailure(record))
})

function evidenceFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-closed-failure-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const write = (name, value) =>
    fs.writeFileSync(path.join(directory, name), JSON.stringify(value))
  const run = (environment = {}) =>
    spawnSync(process.execPath, ['scripts/e2e-share-card/public-evidence.mjs'], {
      cwd: root,
      env: { ...process.env, CC68_HARNESS_DIR: directory, ...environment },
      encoding: 'utf8',
    })
  return { directory, write, run }
}

test('an early CI provisioning failure still produces a closed truthful artifact', (t) => {
  const { directory, run } = evidenceFixture(t)
  assert.equal(
    run({
      CC68_CI_PLATFORM: 'ios',
      CC68_CI_API: '0',
      CC68_CI_JOB_STATUS: 'failure',
    }).status,
    0
  )
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(directory, 'public-evidence/ci-job-status.json'))
    ),
    {
      platform: 'ios',
      api: 0,
      jobStatus: 'failure',
    }
  )
})

test('early CI evidence rejects unreviewed fields before publishing any proof', (t) => {
  const { directory, run } = evidenceFixture(t)
  for (const patch of [
    { CC68_CI_PLATFORM: personal },
    { CC68_CI_API: '36' },
    { CC68_CI_JOB_STATUS: personal },
    { CC68_CI_JOB_STATUS: '' },
  ]) {
    const result = run({
      CC68_CI_PLATFORM: 'ios',
      CC68_CI_API: '0',
      CC68_CI_JOB_STATUS: 'failure',
      ...patch,
    })
    assert.notEqual(result.status, 0)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
  }
})

const releaseFontProof = {
  platform: 'android',
  configuration: 'Release',
  debuggable: false,
  apkSha256: 'a'.repeat(64),
  productionPreview: true,
  localizedTitle: true,
  watermarkOff: true,
  fullRenderLabelPreserved: true,
  cardStateRetainedOrRestored: true,
  sameProcess: true,
  noCrash: true,
  noErrorSurface: true,
  beforeTitleHeight: 92,
  afterTitleHeight: 138,
  textNodesPreserved: true,
  beforeTextNodes: 4,
  afterTextNodes: 4,
  fontScaleBefore: 1,
  fontScaleAfter: 1.5,
  originalFontRestored: true,
  passed: true,
}

test('public evidence projects verified Release live-font facts and removes private fields', (t) => {
  const { directory, write, run } = evidenceFixture(t)
  write('native-release-live-font-android.json', {
    ...releaseFontProof,
    privateTree: personal,
    privateLog: personal,
  })
  assert.equal(run().status, 0)
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(directory, 'public-evidence/native-release-live-font-android.json')
      )
    ),
    releaseFontProof
  )
  write('native-release-live-font-android.json', {
    ...releaseFontProof,
    afterTitleHeight: releaseFontProof.beforeTitleHeight,
  })
  assert.equal(run().status, 0)
  const unchanged = JSON.parse(
    fs.readFileSync(
      path.join(directory, 'public-evidence/native-release-live-font-android.json')
    )
  )
  assert.equal(unchanged.afterTitleHeight, unchanged.beforeTitleHeight)
  assert.equal(unchanged.textNodesPreserved, true)
  assert.equal('titleGrew' in unchanged, false)
})

test('public Release font evidence rejects missing state, cleanup, production or text preservation before any copy', (t) => {
  const { directory, write, run } = evidenceFixture(t)
  write('accessibility-bridge.json', { passed: 90 })
  for (const patch of [
    { platform: 'ios' },
    { configuration: 'Debug' },
    { debuggable: true },
    { apkSha256: personal },
    { productionPreview: false },
    { localizedTitle: false },
    { watermarkOff: false },
    { fullRenderLabelPreserved: false },
    { cardStateRetainedOrRestored: false },
    { sameProcess: false },
    { noCrash: false },
    { noErrorSurface: false },
    { originalFontRestored: false },
    { textNodesPreserved: false },
    { beforeTextNodes: 0 },
    { beforeTextNodes: '4' },
    { afterTextNodes: 3 },
    { afterTextNodes: 5 },
    { afterTextNodes: '4' },
    { beforeTitleHeight: 0 },
    { afterTitleHeight: 0 },
    { afterTitleHeight: '138' },
    { fontScaleBefore: 1.5 },
    { fontScaleAfter: 1 },
    { passed: personal },
  ]) {
    write('native-release-live-font-android.json', { ...releaseFontProof, ...patch })
    const result = run()
    assert.notEqual(result.status, 0, JSON.stringify(patch))
    assert.match(result.stderr, /invalid_native_proof_summary/)
    assert.equal(result.stderr.includes(personal), false)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
  }
})

test('public evidence retains exactly the safe failure record', (t) => {
  const { directory, write, run } = evidenceFixture(t)
  const record = {
    flow: 'open-app.yaml',
    classification: 'unknown',
    durationMs: 100,
    platform: 'android',
  }
  write('native-flow-failure-android.json', record)
  const result = run()
  assert.equal(result.status, 0)
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(directory, 'public-evidence/native-flow-failure-android.json')
      )
    ),
    record
  )
})

test('public evidence validates every failure before any copy and never emits poisoned text', (t) => {
  const { directory, write, run } = evidenceFixture(t)
  const record = {
    flow: 'open-app.yaml',
    classification: 'unknown',
    durationMs: 100,
    platform: 'android',
  }
  write('accessibility-bridge.json', { passed: 90 })
  write('native-flow-failure-android.json', record)
  write('native-flow-failure-ios.json', { ...record, platform: 'ios', log: personal })
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /invalid_native_flow_failure/)
  assert.equal(result.stderr.includes(personal), false)
  assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
})

test('public evidence rejects a platform mismatch in its fixed filename', (t) => {
  const { directory, write, run } = evidenceFixture(t)
  write('native-flow-failure-ios.json', {
    flow: 'open-app.yaml',
    classification: 'unknown',
    durationMs: 100,
    platform: 'android',
  })
  assert.notEqual(run().status, 0)
  assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
})

test('malformed failure JSON never appears in public evidence or console errors', (t) => {
  const { directory, run } = evidenceFixture(t)
  fs.writeFileSync(path.join(directory, 'native-flow-failure-android.json'), personal)
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /invalid_native_flow_failure/)
  assert.equal(result.stderr.includes('Avery'), false)
  assert.equal(result.stderr.includes('private.invalid'), false)
  assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
})

test('public evidence includes closed rapid and fallback proof summaries', (t) => {
  const { directory, write, run } = evidenceFixture(t)
  write('native-rapid-watermark-ios.json', {
    platform: 'ios',
    passed: true,
    heldMs: 6972.05,
    blockedSourceObserved: true,
    requests: 3,
    unavailableResponses: 0,
    freshAppRuntime: true,
    readyOpenerBeforeLock: true,
    privateLog: personal,
  })
  write('native-fallback-focus-android.json', {
    platform: 'android',
    passed: true,
    actualCursor: true,
    existingHeaderTrait: true,
    postRemoved: true,
    actualForegroundRevalidation: true,
    ownedPostContentRestored: true,
    privateLog: personal,
  })
  write('native-fallback-focus-ios.json', {
    platform: 'ios',
    passed: true,
    actualCursor: false,
    intendedHeaderTarget: true,
    strictAuditAll: true,
    postRemoved: true,
    actualForegroundRevalidation: true,
    ownedPostContentRestored: true,
  })
  write('native-rapid-watermark-android.json', {
    platform: 'android',
    passed: false,
    code: personal,
  })
  assert.equal(run().status, 0)
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(directory, 'public-evidence', name)))
  assert.deepEqual(read('native-rapid-watermark-ios.json'), {
    platform: 'ios',
    passed: true,
    heldMs: 6972.05,
    blockedSourceObserved: true,
    requests: 3,
    unavailableResponses: 0,
    freshAppRuntime: true,
    readyOpenerBeforeLock: true,
  })
  assert.deepEqual(read('native-rapid-watermark-android.json'), {
    platform: 'android',
    passed: false,
  })
  assert.deepEqual(read('native-fallback-focus-ios.json'), {
    platform: 'ios',
    passed: true,
    actualCursor: false,
    intendedHeaderTarget: true,
    strictAuditAll: true,
    postRemoved: true,
    actualForegroundRevalidation: true,
    ownedPostContentRestored: true,
  })
  assert.deepEqual(read('native-fallback-focus-android.json'), {
    platform: 'android',
    passed: true,
    actualCursor: true,
    existingHeaderTrait: true,
    postRemoved: true,
    actualForegroundRevalidation: true,
    ownedPostContentRestored: true,
  })
})

test('public proof preflight rejects forged evidence before any copy', (t) => {
  const { directory, write, run } = evidenceFixture(t)
  write('accessibility-bridge.json', { passed: 90 })
  write('native-fallback-focus-ios.json', {
    platform: 'ios',
    passed: true,
    actualCursor: false,
    intendedHeaderTarget: true,
    strictAuditAll: true,
    postRemoved: true,
    actualForegroundRevalidation: true,
    ownedPostContentRestored: personal,
  })
  const result = run()
  assert.notEqual(result.status, 0)
  assert.equal(result.stderr.includes(personal), false)
  assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
})
