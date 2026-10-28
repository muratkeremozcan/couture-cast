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

const flowTimeouts = {
  'maestro/story65/open-app.yaml': Math.ceil(
    OPEN_APP_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN
  ),
}

export function flowTimeoutMs(flow) {
  return flowTimeouts[flow] ?? DEFAULT_FLOW_TIMEOUT_MS
}
