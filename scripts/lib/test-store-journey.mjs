// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 (S4-12, S4-15, TEA-18, TEA-19): the decisions of the RevenueCat Test Store
// journey, kept free of devices so node tests can drive them with fakes. The device binding is
// scripts/run-test-store-journey.mjs.
//
// What each check reads, and why it is enough:
//
// - The Test Store purchase sheet (RevenueCat's own alert, the same four labels in
//   purchases-android 10.16 `SimulatedStoreBillingWrapper` and RevenueCat iOS 5.83
//   `SimulatedStorePurchaseUI`) appears only after `getOfferings()` returned the tapped plan's
//   package, so the sheet is the offerings proof.
// - The Premium section renders from our API's subscription alone. A purchase that the SDK
//   reports as success shows `premium-activating`; the entitled status line comes from our API.
// - Which server path delivered the entitlement (TEA-18) is decided from the journey proxy's
//   request log: the app reaches our API only through that proxy, the API's ledger pull runs only
//   on POST /subscription/refresh, and a RevenueCat webhook cannot reach a loopback API. On the
//   preview leg the proxy refuses every refresh, so an entitlement that still arrives can only
//   have come through the webhook.
// - JS `__DEV__` (R3-03) is read from the live-font environment marker: it renders when
//   `__DEV__` is true or the build's `extra.liveFontMountMarkers` is on, and that extra is on only
//   in the isolated Story 6.5 and 6.8 builds (their own package ids and env flags). So for the
//   `com.couturecast.app` build served by a Metro started without those flags, the marker is
//   `__DEV__`.

/** The Test Store sheet's title and buttons, identical on Android and iOS. */
export const TEST_STORE_SHEET = Object.freeze({
  title: 'Test Store Purchase',
  success: 'Test valid purchase',
  failure: 'Test failed purchase',
  cancel: 'Cancel',
})

export const SERVER_LEGS = Object.freeze(['local', 'preview'])

/** The delivery path each server leg proves (TEA-18). */
export const SERVER_PATHS = Object.freeze({
  local: 'local-reconciliation',
  preview: 'preview-webhook',
})

export const SCENARIOS = Object.freeze(['purchase', 'restore'])
export const PLAN_PRODUCT_ID = 'premium_monthly'
export const REFRESH_PATH = '/api/v1/commerce/subscription/refresh'
export const FLOW_DIR = 'maestro/test-store'

/** Builds each platform runs the journey on (D15). */
export const BUILDS = Object.freeze({
  android: ['debug', 'minifiedDebuggable'],
  ios: ['debug'],
})

/** Isolated test builds turn the marker on through their own config; it then proves nothing. */
const ISOLATED_BUILD_ENV = ['STORY65_NATIVE_TEST_BUILD', 'STORY68_NATIVE_TEST_BUILD']
const ISOLATED_APP_ID = /\.story6[58]$/

export class JourneyError extends Error {
  constructor(code, detail) {
    super(detail === undefined ? code : `${code}: ${detail}`)
    this.code = code
  }
}

const fail = (code, detail) => {
  throw new JourneyError(code, detail)
}

/** Validates the run's options; returns them normalized. */
export function journeyOptions({ platform, build, server, scenario, appId }) {
  if (!BUILDS[platform]) fail('test_store_platform_invalid', platform)
  if (!BUILDS[platform].includes(build))
    fail('test_store_build_invalid', `${platform} ${build}`)
  if (!SERVER_LEGS.includes(server)) fail('test_store_server_invalid', server)
  if (!SCENARIOS.includes(scenario)) fail('test_store_scenario_invalid', scenario)
  // The lost-mirror restore needs a purchase the server never heard of; on the preview leg the
  // webhook tells it within seconds.
  if (scenario === 'restore' && server !== 'local')
    fail('test_store_restore_needs_local', server)
  if (ISOLATED_APP_ID.test(appId)) fail('test_store_isolated_app_id', appId)
  return { platform, build, server, scenario, appId }
}

/**
 * The ordered steps of one scenario. `purchase` is the D15 order (TD-03): unpaid failure and
 * cancel, then success. `restore` buys with the refresh refused so the server never learns of
 * the purchase, reinstalls, and restores: once refused (the rejected-restore UI) and once through.
 */
export function journeySteps({
  scenario,
  server,
  build,
  overInstall = false,
  reinstall = false,
}) {
  // S4-15: the minifiedDebuggable build proves it is debuggable and went through R8, apart from
  // the JS `__DEV__` check.
  const opening = [
    'preflight',
    'open',
    'js-dev',
    ...(build === 'minifiedDebuggable' ? ['native-debuggable-r8'] : []),
  ]
  if (scenario === 'restore')
    return [
      ...opening,
      'purchase-unsynced',
      'reinstall',
      'restore-rejected',
      'restore-success',
      'restore-boundary',
    ]
  return [
    ...opening,
    'unpaid-failure',
    'unpaid-cancel',
    server === 'preview' ? 'purchase-success-webhook' : 'purchase-success',
    'paid-controls',
    ...(overInstall ? ['over-install'] : []),
    ...(reinstall ? ['reinstall-entitled'] : []),
  ]
}

/** The proxy policy each step needs: which refreshes reach the API. */
export function refreshPolicyFor(step) {
  if (step === 'purchase-success-webhook' || step === 'purchase-unsynced') return 'block'
  if (step === 'restore-rejected') return 'block-once'
  return 'forward'
}

/** A member with a complimentary grant never sees a purchase control (Story 6.14). */
export function assertNonComplimentary(access) {
  if (access?.source === 'complimentary' || access?.premium === true)
    fail('test_store_member_not_plain', JSON.stringify(access))
}

/**
 * The server answer for an unpaid member: no entitlement row, no premium.
 * `subscription` and `access` are the `data` of GET subscription and GET premium/access.
 */
export function assertServerUnpaid({ subscription, access }) {
  if (subscription?.status !== 'none')
    fail('test_store_server_unexpected_entitlement', subscription?.status)
  if (access?.premium !== false || access?.source !== 'none')
    fail('test_store_access_unexpected', JSON.stringify(access))
}

/** The server answer for a member the Test Store sold `premium_monthly` to. */
export function assertServerPaid({ subscription, access }) {
  if (subscription?.status !== 'active')
    fail('test_store_server_not_entitled', subscription?.status)
  if (subscription.store !== 'test_store')
    fail('test_store_server_store_mismatch', subscription.store)
  if (subscription.productId !== PLAN_PRODUCT_ID)
    fail('test_store_server_product_mismatch', subscription.productId)
  if (access?.premium !== true) fail('test_store_access_not_premium')
  if (access.source !== 'subscription')
    fail('test_store_access_source_mismatch', access.source)
}

/** The entitlement survived an install: same status, store, product and period end. */
export function assertEntitlementPreserved(before, after) {
  for (const key of ['status', 'store', 'productId', 'currentPeriodEnd'])
    if (before?.[key] !== after?.[key])
      fail('test_store_entitlement_changed', `${key} ${before?.[key]} -> ${after?.[key]}`)
}

const refreshEntries = (log, since) =>
  log.filter(
    (entry) => entry.method === 'POST' && entry.path === REFRESH_PATH && entry.at >= since
  )

/**
 * TEA-18: which path delivered the entitlement now on the server.
 *
 * local: the API pulled the ledger because the app's refresh reached it after the purchase
 * started, and the row was synced no earlier than that refresh (2 s of clock slack; the API and
 * the proxy share the host clock).
 * preview: no refresh reached the API since the purchase started, so the webhook delivered it.
 */
export function attributeServerPath({ server, log, since, subscription }) {
  const refreshes = refreshEntries(log, since)
  if (server === 'local') {
    const forwarded = refreshes.filter(
      (entry) => entry.action === 'forward' && entry.status === 200
    )
    if (forwarded.length === 0) fail('test_store_path_no_refresh')
    const syncedAt = Date.parse(subscription?.syncedAt ?? '')
    if (!Number.isFinite(syncedAt)) fail('test_store_path_synced_at_missing')
    if (syncedAt < forwarded[0].at - 2_000)
      fail('test_store_path_sync_predates_refresh', subscription.syncedAt)
    return {
      serverPath: SERVER_PATHS.local,
      refreshesForwarded: forwarded.length,
      syncedAt: subscription.syncedAt,
    }
  }
  const leaked = refreshes.filter((entry) => entry.action === 'forward')
  if (leaked.length) fail('test_store_path_refresh_leaked', String(leaked.length))
  return {
    serverPath: SERVER_PATHS.preview,
    refreshesRefused: refreshes.length,
    syncedAt: subscription?.syncedAt ?? null,
  }
}

const MARKER = /live-font-env-(root|settings)~([^"\s]+)/

/** R3-03: JS `__DEV__` is true in the bundle the device runs. */
export function jsDevEvidence({ hierarchy, metroEnv = {}, appId }) {
  const flagged = ISOLATED_BUILD_ENV.filter((name) => metroEnv[name] === '1')
  if (flagged.length || ISOLATED_APP_ID.test(appId ?? ''))
    fail('test_store_js_dev_inconclusive', flagged.join(',') || appId)
  const match = MARKER.exec(hierarchy ?? '')
  if (!match) fail('test_store_js_dev_marker_missing')
  return {
    jsDev: true,
    via: 'live-font-env marker; extra.liveFontMountMarkers off for this app id and Metro env',
    marker: `live-font-env-${match[1]}`,
  }
}

/**
 * TD-04: SDK-boundary evidence that `Purchases.restorePurchases()` ran, from the device log.
 * Under a Test Store key each call logs, at debug level, "Restoring purchases not available in
 * Test Store. Returning current CustomerInfo." (RevenueCat iOS 5.83 `PurchaseStrings`;
 * purchases-android 10.16 `PurchasesOrchestrator.restorePurchases` spells it "test store").
 * Nothing else in the SDK writes that line. iOS Debug logs debug lines by default; Android writes
 * them only when the SDK's log level is DEBUG.
 */
export const RESTORE_BOUNDARY = /Restoring purchases not available in test store/i

export function restoreBoundaryEvidence({ platform, log, expected }) {
  if (!BUILDS[platform]) fail('test_store_platform_invalid', platform)
  const count = (log ?? '')
    .split('\n')
    .filter((line) => RESTORE_BOUNDARY.test(line)).length
  if (count < expected)
    fail('test_store_restore_boundary_unseen', `${count} of ${expected} ${platform}`)
  return { restoreCalls: count, pattern: RESTORE_BOUNDARY.source }
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g

/**
 * Maestro full-match patterns for the Premium status line, from the app's locale file. Regex
 * characters become `.` (any character, which still matches the literal), so no backslash has to
 * survive Maestro's `${}` substitution; interpolations become `.*`.
 */
export function premiumStatusPatterns(locale) {
  const status = locale?.commerce?.premium?.status
  if (!status?.none || !status?.active) fail('test_store_locale_unreadable')
  const pattern = (text) =>
    text
      .split(/\{\{[^}]+\}\}/)
      .map((part) => part.replace(REGEX_SPECIAL, '.'))
      .join('.*')
  return { none: pattern(status.none), active: pattern(status.active) }
}

/** `apksigner verify --print-certs` output: the signer's certificate SHA-256 (TEA-19). */
export function signerSha256(output) {
  const match = /certificate SHA-256 digest: ([0-9a-f]{64})/i.exec(output ?? '')
  if (!match) fail('test_store_signer_unreadable')
  return match[1].toLowerCase()
}

/** Both sides of a paid over-install carry one certificate (TEA-19). */
export function assertSameSigner(installed, overInstall) {
  if (installed !== overInstall)
    fail('test_store_signer_mismatch', `${installed} vs ${overInstall}`)
  return { certificateSha256: installed }
}

/**
 * One evidence record. Every record names the server leg it ran against and the delivery path
 * that leg proves (TEA-18), whether or not the step delivered an entitlement.
 */
export function evidenceRecord({
  step,
  server,
  pass = true,
  entitlementDelivered,
  ...details
}) {
  if (!SERVER_PATHS[server]) fail('test_store_record_path_missing', step)
  // The leg, path and verdict are written last, so no detail can overwrite them.
  return {
    step,
    ...details,
    server,
    serverPath: SERVER_PATHS[server],
    entitlementDelivered: Boolean(entitlementDelivered),
    pass,
  }
}

/** The report's verdict: every planned step has a passing record, and nothing failed. */
export function journeyVerdict(steps, records) {
  const failed = records.filter((record) => !record.pass).map((record) => record.step)
  const recorded = new Set(records.map((record) => record.step))
  const missing = steps.filter((step) => !recorded.has(step))
  const unnamed = records.filter((record) => !SERVER_PATHS[record.server])
  return {
    pass: failed.length === 0 && missing.length === 0 && unnamed.length === 0,
    failed,
    missing,
  }
}

/** The `data` of an API JSON answer, or a coded failure naming the endpoint and status. */
export async function readData(response, label) {
  const body = await response.json().catch(() => undefined)
  if (!response.ok) fail('test_store_api_failed', `${label} ${response.status}`)
  if (body?.data === undefined) fail('test_store_api_shape', label)
  return body.data
}
