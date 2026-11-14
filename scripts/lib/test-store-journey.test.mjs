// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import {
  assertEntitlementPreserved,
  assertNonComplimentary,
  assertSameSigner,
  assertServerPaid,
  assertServerUnpaid,
  attributeRestore,
  attributeServerPath,
  evidenceRecord,
  jsDevEvidence,
  journeyOptions,
  journeySteps,
  journeyVerdict,
  premiumStatusPatterns,
  readData,
  redactMessage,
  MESSAGE_CAP,
  assertNoForwardedRefresh,
  refreshPolicyFor,
  REFRESH_PATH,
  restoreBoundaryObserved,
  SERVER_PATHS,
  signerSha256,
} from './test-store-journey.mjs'

const code = (pattern) => (error) => {
  assert.match(error.code ?? '', pattern)
  return true
}

const paid = {
  subscription: {
    status: 'active',
    store: 'test_store',
    productId: 'premium_monthly',
    willRenew: true,
    currentPeriodEnd: '2026-12-13T00:00:00.000Z',
    syncedAt: '2026-11-13T12:00:05.000Z',
  },
  access: { premium: true, source: 'subscription' },
}
const unpaid = {
  subscription: { status: 'none', store: null, productId: null },
  access: { premium: false, source: 'none' },
}

test('options: the builds D15 names per platform, both legs, restore only on the local leg', () => {
  const base = { server: 'local', scenario: 'purchase', appId: 'com.couturecast.app' }
  assert.ok(journeyOptions({ ...base, platform: 'android', build: 'minifiedDebuggable' }))
  assert.ok(journeyOptions({ ...base, platform: 'ios', build: 'debug' }))
  assert.throws(
    () => journeyOptions({ ...base, platform: 'ios', build: 'minifiedDebuggable' }),
    code(/^test_store_build_invalid$/)
  )
  assert.throws(
    () => journeyOptions({ ...base, platform: 'android', build: 'release' }),
    code(/^test_store_build_invalid$/)
  )
  assert.throws(
    () =>
      journeyOptions({
        ...base,
        platform: 'android',
        build: 'debug',
        server: 'preview',
        scenario: 'restore',
      }),
    code(/^test_store_restore_needs_local$/)
  )
  // An isolated Story 6.8 build turns the live-font marker on by config, so __DEV__ is unreadable.
  assert.throws(
    () =>
      journeyOptions({
        ...base,
        platform: 'android',
        build: 'debug',
        appId: 'com.couturecast.story68',
      }),
    code(/^test_store_isolated_app_id$/)
  )
})

test('steps: unpaid cancel, then failure, then success; sign-in recovery last; minifiedDebuggable adds its build proof', () => {
  const steps = journeySteps({ scenario: 'purchase', server: 'local', build: 'debug' })
  assert.deepEqual(steps, [
    'preflight',
    'open',
    'js-dev',
    'unpaid-cancel',
    'unpaid-failure',
    'purchase-success',
    'paid-controls',
    'reinstall-entitled',
  ])
  const minified = journeySteps({
    scenario: 'purchase',
    server: 'preview',
    build: 'minifiedDebuggable',
    overInstall: true,
  })
  assert.equal(minified[3], 'native-debuggable-r8')
  assert.ok(minified.includes('purchase-success-webhook'))
  assert.deepEqual(minified.slice(-2), ['over-install', 'reinstall-entitled'])
  const restore = journeySteps({ scenario: 'restore', server: 'local', build: 'debug' })
  assert.deepEqual(restore.slice(3), [
    'purchase-unsynced',
    'reinstall',
    'restore-rejected',
    'restore-success',
  ])
})

test('refresh policy: refused for the webhook purchase and the unsynced purchase, once for the rejected restore', () => {
  assert.equal(refreshPolicyFor('purchase-success-webhook'), 'block')
  assert.equal(refreshPolicyFor('purchase-unsynced'), 'block')
  assert.equal(refreshPolicyFor('reinstall'), 'block')
  assert.equal(refreshPolicyFor('restore-rejected'), 'block-once')
  assert.equal(refreshPolicyFor('purchase-success'), 'forward')
  assert.equal(refreshPolicyFor('restore-success'), 'forward')
})

test('server unpaid: a row or premium access fails', () => {
  assert.doesNotThrow(() => assertServerUnpaid(unpaid))
  assert.throws(
    () => assertServerUnpaid({ ...unpaid, subscription: { status: 'active' } }),
    code(/^test_store_server_unexpected_entitlement$/)
  )
  assert.throws(
    () =>
      assertServerUnpaid({
        ...unpaid,
        access: { premium: true, source: 'subscription' },
      }),
    code(/^test_store_access_unexpected$/)
  )
})

test('server paid: active test_store premium_monthly with subscription-sourced access', () => {
  assert.doesNotThrow(() => assertServerPaid(paid))
  const mutate = (subscription, access = paid.access) => ({
    subscription: { ...paid.subscription, ...subscription },
    access,
  })
  assert.throws(() => assertServerPaid(mutate({ status: 'none' })), code(/not_entitled$/))
  assert.throws(
    () => assertServerPaid(mutate({ store: 'app_store' })),
    code(/store_mismatch$/)
  )
  assert.throws(
    () => assertServerPaid(mutate({ productId: 'premium_annual' })),
    code(/product_mismatch$/)
  )
  assert.throws(
    () => assertServerPaid(mutate({}, { premium: false, source: 'none' })),
    code(/access_not_premium$/)
  )
  assert.throws(
    () => assertServerPaid(mutate({}, { premium: true, source: 'complimentary' })),
    code(/access_source_mismatch$/)
  )
})

test('a complimentary or already-premium member is not a plain member', () => {
  assert.doesNotThrow(() => assertNonComplimentary(unpaid.access))
  assert.throws(
    () => assertNonComplimentary({ premium: true, source: 'complimentary' }),
    code(/^test_store_member_not_plain$/)
  )
})

test('an install that changes the period end, store or status fails preservation', () => {
  assert.doesNotThrow(() =>
    assertEntitlementPreserved(paid.subscription, { ...paid.subscription })
  )
  assert.throws(
    () =>
      assertEntitlementPreserved(paid.subscription, {
        ...paid.subscription,
        currentPeriodEnd: '2026-11-14T00:00:00.000Z',
      }),
    code(/^test_store_entitlement_changed$/)
  )
})

const at = Date.parse('2026-11-13T12:00:00.000Z')
const refresh = (offset, action = 'forward', status = 200) => ({
  at: at + offset,
  method: 'POST',
  path: REFRESH_PATH,
  action,
  status,
})

test('TEA-18 local: a refresh after the purchase began and a sync no earlier than it', () => {
  const result = attributeServerPath({
    server: 'local',
    since: at,
    log: [refresh(-60_000), { at: at + 1000, method: 'GET', path: '/x' }, refresh(4_000)],
    subscription: paid.subscription,
  })
  assert.equal(result.serverPath, SERVER_PATHS.local)
  assert.equal(result.refreshesForwarded, 1)
  // The preflight refresh before the purchase does not count.
  assert.throws(
    () =>
      attributeServerPath({
        server: 'local',
        since: at,
        log: [refresh(-60_000)],
        subscription: paid.subscription,
      }),
    code(/^test_store_path_no_refresh$/)
  )
  // A refused or failed refresh is no reconciliation.
  assert.throws(
    () =>
      attributeServerPath({
        server: 'local',
        since: at,
        log: [refresh(1000, 'block', 503), refresh(2000, 'forward', 503)],
        subscription: paid.subscription,
      }),
    code(/^test_store_path_no_refresh$/)
  )
  assert.throws(
    () =>
      attributeServerPath({
        server: 'local',
        since: at,
        log: [refresh(30_000)],
        subscription: paid.subscription,
      }),
    code(/^test_store_path_sync_predates_refresh$/)
  )
})

test('TEA-18 preview: only refused refreshes since the purchase, so the webhook delivered it', () => {
  const result = attributeServerPath({
    server: 'preview',
    since: at,
    log: [refresh(1000, 'block', 503)],
    subscription: paid.subscription,
  })
  assert.deepEqual(
    { path: result.serverPath, refused: result.refreshesRefused },
    { path: 'preview-webhook', refused: 1 }
  )
  assert.throws(
    () =>
      attributeServerPath({
        server: 'preview',
        since: at,
        log: [refresh(1000, 'block', 503), refresh(2000)],
        subscription: paid.subscription,
      }),
    code(/^test_store_path_refresh_leaked$/)
  )
})

test('JS __DEV__: the live-font env marker, only for the app id and Metro env that leave it off', () => {
  const hierarchy = '{"resource-id":"live-font-env-root~0.81.5~light~ltr~2.625~en-US"}'
  const ok = jsDevEvidence({ hierarchy, metroEnv: {}, appId: 'com.couturecast.app' })
  assert.equal(ok.jsDev, true)
  assert.equal(ok.marker, 'live-font-env-root')
  assert.throws(
    () => jsDevEvidence({ hierarchy: '{}', metroEnv: {}, appId: 'com.couturecast.app' }),
    code(/^test_store_js_dev_marker_missing$/)
  )
  assert.throws(
    () =>
      jsDevEvidence({
        hierarchy,
        metroEnv: { STORY68_NATIVE_TEST_BUILD: '1' },
        appId: 'com.couturecast.app',
      }),
    code(/^test_store_js_dev_inconclusive$/)
  )
})

test('restore: only the refresh after the tap reached the API, and it delivered the entitlement', () => {
  const tapAt = at + 60_000
  const log = [
    refresh(1_000, 'block', 503),
    refresh(30_000, 'block', 503),
    refresh(61_000),
  ]
  const result = attributeRestore({
    log,
    purchaseStartedAt: at,
    tapAt,
    subscription: { ...paid.subscription, syncedAt: new Date(at + 62_000).toISOString() },
  })
  assert.deepEqual(
    {
      path: result.serverPath,
      before: result.refreshesRefusedBeforeTap,
      after: result.refreshesForwarded,
    },
    { path: 'local-reconciliation', before: 2, after: 1 }
  )
  // A refresh that reached the API before the tap could have delivered it; restore proves nothing.
  assert.throws(
    () =>
      attributeRestore({
        log: [refresh(30_000), refresh(61_000)],
        purchaseStartedAt: at,
        tapAt,
        subscription: {
          ...paid.subscription,
          syncedAt: new Date(at + 62_000).toISOString(),
        },
      }),
    code(/^test_store_restore_refresh_before_tap$/)
  )
  // No refresh after the tap: nothing reconciled the restore.
  assert.throws(
    () =>
      attributeRestore({
        log: [refresh(30_000, 'block', 503)],
        purchaseStartedAt: at,
        tapAt,
        subscription: paid.subscription,
      }),
    code(/^test_store_path_no_refresh$/)
  )
})

test('the SDK restore line is extra evidence and never a pass condition', () => {
  const ios =
    'DEBUG: Restoring purchases not available in Test Store. Returning current CustomerInfo.'
  assert.deepEqual(
    pickObserved(restoreBoundaryObserved({ platform: 'ios', log: `${ios}\n${ios}` })),
    { sdkRestoreLines: 2, passCondition: false }
  )
  assert.deepEqual(
    pickObserved(restoreBoundaryObserved({ platform: 'android', log: 'nothing' })),
    { sdkRestoreLines: 0, passCondition: false }
  )
})

const pickObserved = ({ sdkRestoreLines, passCondition }) => ({
  sdkRestoreLines,
  passCondition,
})

test('status patterns from the app locale full-match the rendered English lines', () => {
  const locale = JSON.parse(
    fs.readFileSync('apps/mobile/assets/locales/en-US.json', 'utf8')
  )
  const patterns = premiumStatusPatterns(locale)
  assert.doesNotMatch(patterns.active, /\\/)
  const full = (pattern, text) => new RegExp(`^(?:${pattern})$`).test(text)
  assert.ok(full(patterns.none, 'You don’t have a Premium subscription.'))
  assert.ok(
    full(
      patterns.active,
      'Premium is active on the Premium Monthly plan. The current period ends December 13, 2026.'
    )
  )
  assert.ok(!full(patterns.active, 'You don’t have a Premium subscription.'))
  assert.ok(!full(patterns.none, patterns.active))
})

test('signer digest from apksigner and the over-install signer match (TEA-19)', () => {
  const digest = 'ab'.repeat(32)
  const output = `Signer #1 certificate DN: CN=test\nSigner #1 certificate SHA-256 digest: ${digest}\n`
  assert.equal(signerSha256(output), digest)
  assert.throws(() => signerSha256('nothing'), code(/^test_store_signer_unreadable$/))
  assert.deepEqual(assertSameSigner(digest, digest), { certificateSha256: digest })
  assert.throws(
    () => assertSameSigner(digest, 'cd'.repeat(32)),
    code(/^test_store_signer_mismatch$/)
  )
})

test('every record names its leg and path, and no detail can overwrite them', () => {
  const record = evidenceRecord({
    step: 'unpaid-failure',
    server: 'local',
    serverPath: 'preview-webhook',
    pass: true,
  })
  assert.equal(record.serverPath, 'local-reconciliation')
  assert.equal(
    evidenceRecord({ step: 'x', server: 'preview' }).serverPath,
    'preview-webhook'
  )
  assert.throws(
    () => evidenceRecord({ step: 'x', server: 'staging' }),
    code(/path_missing$/)
  )
})

test('verdict: a failed, missing or unnamed step fails the run', () => {
  const steps = ['preflight', 'open']
  const ok = steps.map((step) => evidenceRecord({ step, server: 'local' }))
  assert.equal(journeyVerdict(steps, ok).pass, true)
  assert.deepEqual(journeyVerdict(steps, ok.slice(0, 1)).missing, ['open'])
  const failed = [ok[0], evidenceRecord({ step: 'open', server: 'local', pass: false })]
  assert.deepEqual(journeyVerdict(steps, failed).failed, ['open'])
  assert.equal(
    journeyVerdict(steps, [ok[0], { ...ok[1], server: 'nowhere' }]).pass,
    false
  )
})

test('readData: a non-2xx or a body without data is a coded failure', async () => {
  const response = (status, body) => ({
    ok: status < 300,
    status,
    json: async () => body,
  })
  assert.deepEqual(await readData(response(200, { data: { a: 1 } }), 'x'), { a: 1 })
  await assert.rejects(
    readData(response(503, {}), 'refresh'),
    code(/^test_store_api_failed$/)
  )
  await assert.rejects(readData(response(200, {}), 'x'), code(/^test_store_api_shape$/))
})

test('failure messages lose ids, bearers, keys and queries, and are capped', () => {
  const member = '7b2c4e8a-1f3d-4c5b-9a6e-0d1f2a3b4c5d'
  const bearer = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiI3YjJjIn0.couturecast-mobile-e2e'
  const key = 'test_AbCdEfGhIjKlMnOp1234'
  const message = `test_store_command_failed: maestro test failed at premium-status-line: GET /api/v1/users/${member}?token=${bearer} key=${key} $RCAnonymousID:abc123def`
  const redacted = redactMessage(message)
  for (const secret of [member, bearer, key, 'RCAnonymousID', 'eyJ', 'abc123def'])
    assert.ok(!redacted.includes(secret), secret)
  // Readable names survive, so the message still says what failed.
  assert.match(redacted, /premium-status-line/)
  assert.ok(redactMessage('x '.repeat(400)).length <= MESSAGE_CAP + 3)
})

test('an unpaid cancel or failure fails when a refresh reached the API', () => {
  const log = [
    { at: at + 5, method: 'POST', path: REFRESH_PATH, action: 'forward', status: 200 },
  ]
  assert.deepEqual(assertNoForwardedRefresh(log, at + 10), { refreshesForwarded: 0 })
  assert.throws(
    () => assertNoForwardedRefresh(log, at),
    code(/^test_store_unpaid_refresh_forwarded$/)
  )
})
