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
 * open-app.yaml, per attempt: 10 s + 60 s + 30 s of declared waits and 15 condition
 * checks (3 dev-client checks, then 4 back-navigation checks repeated 3 times: Navigate
 * up, BackButton, comments-close and the iOS localized back label).
 * maxRetries 3 allows 4 attempts.
 */
export const OPEN_APP_WORST_CASE_MS =
  FLOW_STARTUP_MS + 4 * (100_000 + 15 * CONDITION_CHECK_MS)

/**
 * open-post.yaml on iOS (its slower platform), one attempt: 10 s + 20 s + 20 s of declared
 * waits, and 14 budgeted steps: 2 feed-state checks, 3 up and 5 down walk iterations, 2
 * opener iterations, the post assertion and the final lift swipe. Every named failure fires
 * inside this budget, so a missing post is reported, not killed.
 */
export const OPEN_POST_WORST_CASE_MS = FLOW_STARTUP_MS + 50_000 + 14 * CONDITION_CHECK_MS

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
  ...Object.fromEntries(WAIT_SETTINGS_FLOWS.map((flow) => [flow, waitSettingsTimeoutMs])),
  'maestro/story65/open-app.yaml': Math.ceil(
    OPEN_APP_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN
  ),
  'maestro/story68/open-post.yaml': Math.ceil(
    OPEN_POST_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN
  ),
}

export function flowTimeoutMs(flow) {
  return flowTimeouts[flow] ?? DEFAULT_FLOW_TIMEOUT_MS
}
