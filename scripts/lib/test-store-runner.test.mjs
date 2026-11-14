// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseAllDocuments } from 'yaml'
import {
  FLOW_DIR,
  journeySteps,
  REFRESH_PATH,
  TEST_STORE_SHEET,
} from './test-store-journey.mjs'
import {
  artifactSha256,
  stdoutSummary,
  memberRef,
  TD04,
  runJourney,
  verifyWebhookDelivery,
  writeArtifactManifests,
} from './test-store-runner.mjs'

const MARKER = '{"resource-id":"live-font-env-settings~0.81.5~light~ltr~3~en-US"}'
const RESTORE_LINE =
  'Restoring purchases not available in Test Store. Returning current CustomerInfo.'

/**
 * A device, proxy and API in memory. The flows move the server the way the app and RevenueCat
 * would: a forwarded refresh after a purchase or restore pulls the entitlement (local), and on
 * the preview leg the webhook delivers it without any refresh. `faults` breaks one thing.
 */
function fakeIo({ server, faults = {} }) {
  let clock = 1_000_000
  let policyName = 'forward'
  let blockOnceUsed = false
  let ledgerHasPurchase = false
  let paid = false
  let restores = 0
  const flows = []
  const launches = []
  const policies = []
  const log = []
  const subscription = () =>
    paid
      ? {
          status: 'active',
          store: faults.store ?? 'test_store',
          productId: 'premium_monthly',
          currentPeriodEnd: '2026-12-13T00:00:00.000Z',
          syncedAt: new Date(clock).toISOString(),
        }
      : { status: 'none', store: null, productId: null }
  const access = () =>
    paid ? { premium: true, source: 'subscription' } : { premium: false, source: 'none' }
  // Whether the proxy forwards this refresh under the current policy.
  const forwards = () => {
    if (policyName === 'block-once' && !blockOnceUsed) {
      blockOnceUsed = true
      return false
    }
    return policyName !== 'block' || Boolean(faults.leakRefresh)
  }
  const appRefresh = () => {
    clock += 1_000
    const action = forwards() ? 'forward' : 'block'
    log.push({
      at: clock,
      method: 'POST',
      path: REFRESH_PATH,
      action,
      status: action === 'block' ? 503 : 200,
    })
    // A forwarded refresh pulls the ledger; the fault breaks that pull on the local API.
    if (action === 'forward' && ledgerHasPurchase && !faults.pullBroken) paid = true
    return action
  }
  const buy = () => {
    ledgerHasPurchase = true
    appRefresh()
    if (server === 'preview' && !faults.noWebhook) paid = true
  }
  const handlers = {
    'open-premium': () => launches.push('opened'),
    'assert-entitled': () => {
      if (!paid) throw new Error('maestro: premium-status-line active not visible')
    },
    'purchase-failure': () => {
      if (faults.failureEntitles) paid = true
      if (faults.refreshOnFailure) appRefresh()
    },
    'purchase-cancel': () => {
      launches.push('cancelled')
      if (faults.refreshOnCancel) appRefresh()
      if (faults.leakyError)
        throw new Error(
          `maestro failed: GET /api/v1/users/member-1?token=${faults.leakyError}`
        )
    },
    'purchase-success': () => {
      buy()
      handlers['assert-entitled']()
    },
    'purchase-success-webhook': () => {
      buy()
      handlers['assert-entitled']()
    },
    'purchase-unsynced': () => buy(),
    'restore-rejected': () => {
      restores += 1
      if (appRefresh() !== 'block')
        throw new Error('maestro: premium-purchase-error not visible')
      // A proxy that let one refresh through before the tap (it found nothing to pull yet).
      if (faults.forwardBeforeTap)
        log.push({
          at: clock,
          method: 'POST',
          path: REFRESH_PATH,
          action: 'forward',
          status: 200,
        })
    },
    'restore-success': () => {
      if (paid)
        throw new Error('maestro: premium-status-line none not visible before the tap')
      restores += 1
      appRefresh()
      handlers['assert-entitled']()
    },
  }
  const io = {
    flows,
    policies,
    async preflight() {
      return { userId: 'member-1', ledger: 'pull answered 200' }
    },
    async launch() {
      launches.push('launch')
    },
    async flow(name) {
      flows.push(name)
      clock += 500
      handlers[name]()
    },
    hierarchy: async () => (faults.noMarker ? '{}' : MARKER),
    serverState: async () => ({ subscription: subscription(), access: access() }),
    waitForPaid: async () => ({ subscription: subscription(), access: access() }),
    setPolicy: (name) => {
      policyName = name
      policies.push(name)
    },
    proxyLog: () => log,
    minifiedEvidence: async () => ({
      variant: 'minifiedDebuggable',
      nativeDebuggable: { apkManifest: true },
    }),
    overInstall: async () => ({ certificateSha256: 'ab'.repeat(32) }),
    async reinstall() {
      return { uninstalled: true }
    },
    deviceLog: async () =>
      Array.from({ length: restores }, () => RESTORE_LINE).join('\n'),
    // Each reading moves the clock on, as wall time does between a reading and the next request.
    now: () => (clock += 1),
  }
  return io
}

const run = (server, scenario, faults, extra = {}) => {
  const io = fakeIo({ server, faults })
  const steps = journeySteps({ scenario, server, build: 'debug', ...extra })
  return runJourney({
    steps,
    io,
    server,
    platform: 'ios',
    appId: 'com.couturecast.app',
    metroEnv: () => ({}),
  }).then((result) => ({ ...result, io, steps }))
}

test('local purchase: every step passes, the success names local reconciliation', async () => {
  const { verdict, records, io } = await run(
    'local',
    'purchase',
    {},
    {
      overInstall: true,
      reinstall: true,
    }
  )
  assert.deepEqual(verdict, { pass: true, failed: [], missing: [] })
  assert.ok(records.every((record) => record.serverPath === 'local-reconciliation'))
  const success = records.find((record) => record.step === 'purchase-success')
  assert.equal(success.entitlementDelivered, true)
  assert.equal(success.refreshesForwarded, 1)
  assert.equal(records.find((record) => record.step === 'js-dev').jsDev, true)
  assert.equal(
    records.find((record) => record.step === 'paid-controls').restoreOffered,
    false
  )
  assert.deepEqual(io.flows.slice(0, 4), [
    'open-premium',
    'purchase-cancel',
    'purchase-failure',
    'purchase-success',
  ])
  const [cancel, failure] = ['unpaid-cancel', 'unpaid-failure'].map((step) =>
    records.find((record) => record.step === step)
  )
  assert.match(cancel.outcome, /^cancelled/)
  assert.match(failure.outcome, /^failed/)
  assert.equal(cancel.purchaseControlsOffered, true)
  const signIn = records.find((record) => record.step === 'reinstall-entitled')
  assert.equal(signIn.assertion, TD04.signIn)
  assert.equal(signIn.subscription.status, 'active')
  // No user id anywhere in the evidence; the preflight carries a hash reference.
  assert.equal(records[0].memberRef, memberRef('member-1'))
  assert.doesNotMatch(JSON.stringify(records), /member-1/)
})

test('preview purchase: refreshes are refused and the webhook path is named', async () => {
  const { verdict, records, io } = await run('preview', 'purchase', {})
  assert.equal(verdict.pass, true)
  const success = records.find((record) => record.step === 'purchase-success-webhook')
  assert.equal(success.serverPath, 'preview-webhook')
  assert.equal(success.refreshesRefused, 1)
  assert.ok(io.policies.includes('block'))
})

test('preview purchase fails when a refresh reaches the API (the path would be ambiguous)', async () => {
  const { verdict, records } = await run('preview', 'purchase', { leakRefresh: true })
  assert.equal(verdict.pass, false)
  assert.equal(records.at(-1).step, 'purchase-success-webhook')
  assert.equal(records.at(-1).error, 'test_store_path_refresh_leaked')
})

test('a failure that creates an entitlement, a wrong store or a missing marker each fail with their code', async () => {
  const cases = [
    [
      { failureEntitles: true },
      'unpaid-failure',
      'test_store_server_unexpected_entitlement',
    ],
    [{ store: 'app_store' }, 'purchase-success', 'test_store_server_store_mismatch'],
    [{ noMarker: true }, 'js-dev', 'test_store_js_dev_marker_missing'],
  ]
  for (const [faults, step, error] of cases) {
    const { verdict, records, steps } = await run('local', 'purchase', faults)
    assert.equal(verdict.pass, false, step)
    assert.deepEqual(
      {
        step: records.at(-1).step,
        error: records.at(-1).error,
        pass: records.at(-1).pass,
      },
      { step, error, pass: false }
    )
    // The run stops at the failing step; later steps are reported missing.
    assert.ok(verdict.missing.length === steps.length - records.length)
  }
})

test('local purchase fails when the pull never delivers (the UI never turns entitled)', async () => {
  const { records } = await run('local', 'purchase', { pullBroken: true })
  assert.equal(records.at(-1).step, 'purchase-success')
  assert.match(records.at(-1).message, /premium-status-line active not visible/)
})

test('restore: unsynced purchase, reinstall, a rejected restore, then a restore that pulls it back', async () => {
  const { verdict, records, io } = await run('local', 'restore', {})
  assert.equal(verdict.pass, true, JSON.stringify(records.at(-1)))
  assert.deepEqual(io.policies.slice(3), ['block', 'block', 'block-once', 'forward'])
  const restored = records.find((record) => record.step === 'restore-success')
  assert.equal(restored.assertion, TD04.restore)
  assert.equal(restored.serverPath, 'local-reconciliation')
  assert.equal(restored.refreshesRefusedBeforeTap, 2)
  assert.equal(restored.refreshesForwarded, 1)
  // The SDK log line rides along as extra evidence only.
  assert.deepEqual(
    [restored.sdkBoundary.sdkRestoreLines, restored.sdkBoundary.passCondition],
    [2, false]
  )
})

test('restore fails when a refresh reached the API before the restore tap', async () => {
  const { verdict, records } = await run('local', 'restore', { forwardBeforeTap: true })
  assert.equal(verdict.pass, false)
  assert.deepEqual(
    [records.at(-1).step, records.at(-1).error],
    ['restore-success', 'test_store_restore_refresh_before_tap']
  )
})

test('verify: a preview run report and a paid read prove the webhook; a local report does not', async () => {
  const { records, io } = await run('preview', 'purchase', {})
  const report = {
    server: 'preview',
    memberRef: memberRef('member-1'),
    records,
    proxyLog: io.proxyLog(),
  }
  const state = await io.serverState()
  assert.equal(
    verifyWebhookDelivery({ report, state, userId: 'member-1' }).serverPath,
    'preview-webhook'
  )
  assert.throws(
    () =>
      verifyWebhookDelivery({
        report: { ...report, server: 'local' },
        state,
        userId: 'member-1',
      }),
    (error) => error.code === 'test_store_verify_not_preview'
  )
  // The member file must belong to the run: its id hashes to the report's memberRef.
  assert.throws(
    () => verifyWebhookDelivery({ report, state, userId: 'someone-else' }),
    (error) => error.code === 'test_store_verify_member_mismatch'
  )
  const leaked = {
    ...report,
    proxyLog: [
      ...report.proxyLog,
      {
        at: Number.MAX_SAFE_INTEGER,
        method: 'POST',
        path: REFRESH_PATH,
        action: 'forward',
        status: 200,
      },
    ],
  }
  assert.throws(
    () => verifyWebhookDelivery({ report: leaked, state, userId: 'member-1' }),
    (error) => error.code === 'test_store_path_refresh_leaked'
  )
})

test('one test-store manifest per artifact, with its build rev and artifact hash', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-store-manifest-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const apk = path.join(dir, 'app-debug.apk')
  fs.writeFileSync(apk, 'apk-bytes')
  const app = path.join(dir, 'CoutureCast.app')
  fs.mkdirSync(path.join(app, 'Frameworks'), { recursive: true })
  fs.writeFileSync(path.join(app, 'Info.plist'), 'plist')
  fs.writeFileSync(path.join(app, 'Frameworks', 'a'), 'a')
  const calls = []
  const written = writeArtifactManifests({
    out: dir,
    cwd: dir,
    artifacts: [
      { name: 'installed', file: apk, rev: 'a'.repeat(40) },
      { name: 'over', file: app, rev: 'b'.repeat(40) },
    ],
    manifest: ({ leg, rev }) => {
      calls.push({ leg, rev })
      return { leg, sha: rev, inputs: { 'apps/api': 'c'.repeat(40) } }
    },
  })
  assert.deepEqual(calls, [
    { leg: 'test-store', rev: 'a'.repeat(40) },
    { leg: 'test-store', rev: 'b'.repeat(40) },
  ])
  const first = JSON.parse(fs.readFileSync(written[0], 'utf8'))
  assert.equal(first.artifact.file, 'app-debug.apk')
  assert.equal(first.artifact.sha256, artifactSha256(apk))
  assert.match(
    JSON.parse(fs.readFileSync(written[1], 'utf8')).artifact.sha256,
    /^[0-9a-f]{64}$/
  )
  // A bundle's hash changes with any file inside it.
  const before = artifactSha256(app)
  fs.writeFileSync(path.join(app, 'Frameworks', 'a'), 'b')
  assert.notEqual(artifactSha256(app), before)
  assert.throws(
    () =>
      writeArtifactManifests({
        out: dir,
        cwd: dir,
        artifacts: [{ name: 'x', file: apk }],
      }),
    /test_store_manifest_rev_missing/
  )
})

// The flows the runner calls exist, and every id they wait on is a testID the app renders, so a
// renamed testID fails here before a device run.
test('every flow the runner calls exists and only targets testIDs the app defines', () => {
  const runner = fs.readFileSync('scripts/lib/test-store-runner.mjs', 'utf8')
  const called = [...runner.matchAll(/io\.flow\('([^']+)'\)/g)].map((match) => match[1])
  assert.ok(called.length >= 10)
  const appSource = [
    'apps/mobile/app/(tabs)/settings.tsx',
    'apps/mobile/app/(tabs)/_layout.tsx',
  ]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
  const flows = fs.readdirSync(FLOW_DIR).filter((name) => name.endsWith('.yaml'))
  for (const name of new Set(called)) assert.ok(flows.includes(`${name}.yaml`), name)
  for (const name of flows) {
    const text = fs.readFileSync(path.join(FLOW_DIR, name), 'utf8')
    for (const doc of parseAllDocuments(text)) assert.equal(doc.errors.length, 0, name)
    for (const [, id] of text.matchAll(/^\s+id: (?:'|")?([\w-]+)(?:'|")?$/gm))
      assert.ok(
        appSource.includes(`testID="${id}"`) ||
          (id.startsWith('premium-subscribe-') &&
            appSource.includes('premium-subscribe-')) ||
          appSource.includes(`'${id}'`),
        `${name}: ${id}`
      )
    for (const [, flow] of text.matchAll(/runFlow: (\S+)/g))
      assert.ok(fs.existsSync(path.join(FLOW_DIR, flow)), `${name}: ${flow}`)
  }
  const sheet = fs.readFileSync(path.join(FLOW_DIR, 'open-sheet.yaml'), 'utf8')
  assert.ok(sheet.includes(TEST_STORE_SHEET.title))
  for (const [flow, label] of [
    ['purchase-failure.yaml', TEST_STORE_SHEET.failure],
    ['purchase-cancel.yaml', TEST_STORE_SHEET.cancel],
    ['purchase-success.yaml', TEST_STORE_SHEET.success],
  ])
    assert.ok(fs.readFileSync(path.join(FLOW_DIR, flow), 'utf8').includes(label), flow)
})

test('a refresh during the unpaid cancel fails that step', async () => {
  const { records } = await run('local', 'purchase', { refreshOnCancel: true })
  assert.deepEqual(
    [records.at(-1).step, records.at(-1).error],
    ['unpaid-cancel', 'test_store_unpaid_refresh_forwarded']
  )
})

test('a failing step records a redacted message: no bearer or member id reaches the evidence', async () => {
  const bearer = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJtZW1iZXItMSJ9.couturecast-mobile-e2e'
  const { records } = await run('local', 'purchase', { leakyError: bearer })
  const failed = records.at(-1)
  assert.equal(failed.step, 'unpaid-cancel')
  assert.ok(!JSON.stringify(records).includes(bearer))
  assert.ok(!JSON.stringify(records).includes('eyJ'))
  assert.ok(!JSON.stringify(records).includes('member-1'))
})

test('a refresh during the unpaid failure fails that step', async () => {
  const { records } = await run('local', 'purchase', { refreshOnFailure: true })
  assert.deepEqual(
    [records.at(-1).step, records.at(-1).error],
    ['unpaid-failure', 'test_store_unpaid_refresh_forwarded']
  )
})

test('stdout carries error codes only: an uncoded message prints uncoded_error', () => {
  const summary = stdoutSummary({
    verdict: { pass: false, failed: ['open', 'js-dev'], missing: [] },
    records: [
      { step: 'preflight', pass: true },
      { step: 'open', pass: false, error: 'test_store_command_failed' },
      { step: 'js-dev', pass: false, error: 'Error for stub-member-7b2c4e8a boom' },
    ],
  })
  assert.deepEqual(summary.errors, ['test_store_command_failed', 'uncoded_error'])
  assert.ok(!JSON.stringify(summary).includes('stub-member'))
})
