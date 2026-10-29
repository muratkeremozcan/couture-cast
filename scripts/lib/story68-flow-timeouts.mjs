/** Maestro process budget for flows whose declared waits stay well under it. */
export const DEFAULT_FLOW_TIMEOUT_MS = 120_000
// Slowest single `when: visible` check in CI run 40599341508 (API36 open-app.yaml,
// sequence 23): 5996 ms. Each condition check is budgeted at 6 s.
export const CONDITION_CHECK_MS = 6_000
// Maestro CLI start plus driver handshake before the first command.
export const FLOW_STARTUP_MS = 30_000
// 25% over the computed worst case absorbs a slower host than the one measured.
export const FLOW_TIMEOUT_MARGIN = 1.25

/**
 * open-app.yaml, per attempt: 10 s + 60 s + 30 s of declared waits and 17 condition
 * checks (the Android not-responding dialog guard at the start and again before the tab
 * wait, 3 dev-client checks, then 4 back-navigation checks repeated 3 times: Navigate
 * up, BackButton, comments-close and the iOS localized back label).
 * maxRetries 3 allows 4 attempts.
 */
export const OPEN_APP_WORST_CASE_MS =
  FLOW_STARTUP_MS + 4 * (100_000 + 17 * CONDITION_CHECK_MS)

/**
 * open-post.yaml on iOS (its slower platform), one attempt: 10 s + 20 s + 20 s of declared
 * waits, and 14 budgeted steps: 2 feed-state checks, 3 up and 5 down walk iterations, 2
 * opener iterations, the post assertion and the final lift swipe. Every named failure fires
 * inside this budget, so a missing post is reported, not killed.
 */
export const OPEN_POST_WORST_CASE_MS = FLOW_STARTUP_MS + 50_000 + 14 * CONDITION_CHECK_MS

/**
 * The guarded watermark taps (watermark.yaml, release-watermark-off.yaml). Each tap sits in a
 * retry of maxRetries 3 (4 attempts); an attempt is the guard's condition check, the 8 s wait for
 * the switch to flip and that wait's poll. A test reads both flows and keeps these numbers equal to
 * what they declare.
 */
export const WATERMARK_TAP_ATTEMPTS = 4
export const WATERMARK_ATTEMPT_MS = 8_000 + 2 * CONDITION_CHECK_MS
// watermark.yaml: two guarded taps, three 20 s preview waits and four asserts.
export const WATERMARK_WORST_CASE_MS =
  FLOW_STARTUP_MS +
  2 * WATERMARK_TAP_ATTEMPTS * WATERMARK_ATTEMPT_MS +
  3 * 20_000 +
  4 * CONDITION_CHECK_MS
// release-watermark-off.yaml: one guarded tap and one 20 s render wait.
export const RELEASE_WATERMARK_OFF_WORST_CASE_MS =
  FLOW_STARTUP_MS + WATERMARK_TAP_ATTEMPTS * WATERMARK_ATTEMPT_MS + 20_000

/**
 * tap-save.yaml, which the Save flows run for their first Save tap: a retry of maxRetries 3 (4
 * attempts). An attempt is the guard (its two condition checks), the 8 s wait for what a received
 * press shows and that wait's poll. The calling flow's own steps keep the default budget; a test
 * reads the subflow and keeps these numbers equal to what it declares.
 */
export const SAVE_TAP_ATTEMPTS = 4
export const SAVE_TAP_ATTEMPT_MS = 2 * CONDITION_CHECK_MS + 8_000 + CONDITION_CHECK_MS
export const SAVE_TAP_WORST_CASE_MS = SAVE_TAP_ATTEMPTS * SAVE_TAP_ATTEMPT_MS
export const SAVE_TAP_FLOWS = [
  'maestro/story68/permanent.yaml',
  'maestro/story68/save.yaml',
  'maestro/story68/denied.yaml',
  'maestro/story68/failure.yaml',
  'maestro/story68/precommit-cancel.yaml',
  'maestro/story68/pending.yaml',
]
const saveTapTimeoutMs = Math.ceil(
  (DEFAULT_FLOW_TIMEOUT_MS + SAVE_TAP_WORST_CASE_MS) * FLOW_TIMEOUT_MARGIN
)

/**
 * wait-notification-settings.yaml waits for the member's notification controls or fails when the
 * Try again button shows. Its repeat count only bounds a stuck screen and must equal `times` in
 * that flow (a test reads it). Each turn is a 1 s wait plus two condition checks (the Try again
 * guard and the loop condition), each budgeted at the slowest observed check.
 */
export const WAIT_SETTINGS_TURNS = 60
export const WAIT_SETTINGS_TURN_MS = 1_000 + 2 * CONDITION_CHECK_MS
export const WAIT_SETTINGS_WORST_CASE_MS = WAIT_SETTINGS_TURNS * WAIT_SETTINGS_TURN_MS
export const WAIT_SETTINGS_FLOWS = [
  'maestro/story65/signin-verify.yaml',
  'maestro/story65/notification-settings-loaded.yaml',
  'maestro/story65/session-restore.yaml',
]
// The flow's own steps keep the default budget; the subflow adds its declared worst case.
const waitSettingsTimeoutMs = Math.ceil(
  (DEFAULT_FLOW_TIMEOUT_MS + WAIT_SETTINGS_WORST_CASE_MS) * FLOW_TIMEOUT_MARGIN
)

const flowTimeouts = {
  ...Object.fromEntries(SAVE_TAP_FLOWS.map((flow) => [flow, saveTapTimeoutMs])),
  ...Object.fromEntries(WAIT_SETTINGS_FLOWS.map((flow) => [flow, waitSettingsTimeoutMs])),
  'maestro/story65/open-app.yaml': Math.ceil(
    OPEN_APP_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN
  ),
  'maestro/story68/open-post.yaml': Math.ceil(
    OPEN_POST_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN
  ),
  'maestro/story68/watermark.yaml': Math.ceil(
    WATERMARK_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN
  ),
  'maestro/story68/release-watermark-off.yaml': Math.ceil(
    RELEASE_WATERMARK_OFF_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN
  ),
}

export function flowTimeoutMs(flow) {
  return flowTimeouts[flow] ?? DEFAULT_FLOW_TIMEOUT_MS
}
