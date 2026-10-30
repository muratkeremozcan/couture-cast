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
 * expo-go-open.yaml, the iOS Expo Go proof opener, on a fresh simulator and a fresh Expo Go. Three
 * waits run once each, in order: the open prompt (30 s, optional), the developer-menu onboarding
 * that follows the project load (150 s, optional) and the named tab-bar wait (60 s). A wait that
 * Maestro ran a second time returned in 0.4 s in run 41019906459, so no wait sits in a `retry` or
 * `repeat`. Three `when` checks cost 0.3 to 0.6 s when absent (run 41019906459) and up to 7.4 s in
 * run 40992501585, budgeted at 8 s, plus 4 s for each of the three taps. The project has 240 s of
 * waits, and one that never loads fails on the named wait inside this budget with the failed-step
 * hierarchy captured.
 * open-app.yaml, which this replaces for Expo Go, declares 100 s of waits per attempt and was pinned
 * to 120 s on iOS: the Maestro process was killed before it could name a failure.
 */
export const EXPO_GO_OPEN_FLOW = 'maestro/story68/expo-go-open.yaml'
export const EXPO_GO_OPEN_WAITS_MS = Object.freeze([30_000, 150_000, 60_000])
export const EXPO_GO_CONDITION_CHECK_MS = 8_000
export const EXPO_GO_CONDITION_CHECKS = 3
export const EXPO_GO_TAP_MS = 4_000
export const EXPO_GO_OPEN_WORST_CASE_MS =
  FLOW_STARTUP_MS +
  EXPO_GO_OPEN_WAITS_MS.reduce((total, wait) => total + wait, 0) +
  EXPO_GO_CONDITION_CHECKS * (EXPO_GO_CONDITION_CHECK_MS + EXPO_GO_TAP_MS)

/**
 * open-post.yaml on iOS (its slower platform): 10 s + 20 s + 20 s of declared waits, and 13
 * budgeted steps outside the guarded opener tap: 2 feed-state checks, 3 up and 5 down walk
 * iterations, 2 opener iterations and the post assertion. The opener tap is a retry of
 * maxRetries 2 (3 attempts); an attempt is the composer-title guard check, the lift swipe, the
 * guard check before the tap and the 5 s wait for the composer title. Every named failure fires inside this budget, so a
 * missing post is reported, not killed.
 */
export const OPEN_POST_TAP_ATTEMPTS = 3
export const OPEN_POST_PRESS_WAIT_MS = 5_000
// The attempt guard, the lift swipe and the guard before the tap each cost one budgeted step.
export const OPEN_POST_ATTEMPT_STEPS = 3
export const OPEN_POST_WORST_CASE_MS =
  FLOW_STARTUP_MS +
  50_000 +
  13 * CONDITION_CHECK_MS +
  OPEN_POST_TAP_ATTEMPTS *
    (OPEN_POST_PRESS_WAIT_MS + OPEN_POST_ATTEMPT_STEPS * CONDITION_CHECK_MS)

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
 * community-draft-background-ios.yaml taps the photo picker's opener inside a retry of maxRetries 3
 * (4 attempts). An attempt is the guard (its two condition checks), the four commands the guard
 * runs (two swipes to the sheet's top, the animation wait, the tap), the 8 s wait for the picker's
 * Cancel and that wait's poll. The flow's other steps are budgeted at one condition check each plus
 * their declared waits. A test reads the flow and keeps these numbers at or above what it declares.
 */
export const PICK_IMAGE_TAP_ATTEMPTS = 4
export const PICK_IMAGE_GUARDED_STEPS = 4
export const PICK_IMAGE_TAP_ATTEMPT_MS =
  (2 + PICK_IMAGE_GUARDED_STEPS + 1) * CONDITION_CHECK_MS + 8_000
export const PICK_IMAGE_TAP_WORST_CASE_MS =
  PICK_IMAGE_TAP_ATTEMPTS * PICK_IMAGE_TAP_ATTEMPT_MS
export const PICK_IMAGE_OTHER_STEPS_MS = 117_000
export const PICK_IMAGE_FLOW = 'maestro/story68/community-draft-background-ios.yaml'

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

/**
 * set-locale.yaml: the Settings tab opener (up to 4 attempts of a tap and a 15 s wait), the
 * 15 s scroll to the language button and the closing settle wait, then the guarded language
 * tap. Each tap attempt is the guard check, the tap, a 15 s wait for a different language button
 * to read enabled (the change finished: every button is disabled while it runs) and a 6 s wait
 * for the target to read disabled (it stayed selected; a rollback enables it); maxRetries 3
 * allows 4 attempts.
 */
export const SET_LOCALE_FLOW = 'maestro/story65/set-locale.yaml'
export const SET_LOCALE_TAP_ATTEMPTS = 4
export const SET_LOCALE_SETTLE_WAIT_MS = 15_000
export const SET_LOCALE_TAP_ATTEMPT_MS =
  CONDITION_CHECK_MS + SET_LOCALE_SETTLE_WAIT_MS + CONDITION_CHECK_MS + 2_000
export const SET_LOCALE_TAP_WORST_CASE_MS =
  SET_LOCALE_TAP_ATTEMPTS * SET_LOCALE_TAP_ATTEMPT_MS
export const SET_LOCALE_OTHER_STEPS_MS = 4 * 17_000 + 15_000 + 2_000

const flowTimeouts = {
  ...Object.fromEntries(SAVE_TAP_FLOWS.map((flow) => [flow, saveTapTimeoutMs])),
  ...Object.fromEntries(WAIT_SETTINGS_FLOWS.map((flow) => [flow, waitSettingsTimeoutMs])),
  [SET_LOCALE_FLOW]: Math.ceil(
    (FLOW_STARTUP_MS + SET_LOCALE_OTHER_STEPS_MS + SET_LOCALE_TAP_WORST_CASE_MS) *
      FLOW_TIMEOUT_MARGIN
  ),
  [PICK_IMAGE_FLOW]: Math.ceil(
    (FLOW_STARTUP_MS + PICK_IMAGE_OTHER_STEPS_MS + PICK_IMAGE_TAP_WORST_CASE_MS) *
      FLOW_TIMEOUT_MARGIN
  ),
  'maestro/story65/open-app.yaml': Math.ceil(
    OPEN_APP_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN
  ),
  [EXPO_GO_OPEN_FLOW]: Math.ceil(EXPO_GO_OPEN_WORST_CASE_MS * FLOW_TIMEOUT_MARGIN),
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
