/**
 * Closed Android dialog lifecycle events. Only the isolated Story 6.8 native test build
 * installs a sink, so production builds record nothing.
 */
export type ShareCardPresentationEvent =
  | 'open'
  | 'drop:root'
  | 'drop:signed-out'
  | 'render'
  | 'close'
  | 'retire'
let sink: ((event: ShareCardPresentationEvent) => void) | null = null
export function traceShareCardPresentation(event: ShareCardPresentationEvent) {
  sink?.(event)
}
export function installShareCardPresentationTrace(
  next: ((event: ShareCardPresentationEvent) => void) | null
) {
  sink = next
}

/**
 * Closed events along the share-card opener path, recorded by the isolated Story 6.8 native test
 * build only (no sink in production). They show whether a press reached the opener, whether the
 * screen opened the composer, and which guard in the composer ended the attempt.
 */
export type ShareCardOpenerEvent =
  | 'press'
  | 'state-open'
  | 'composer-idle'
  | 'composer-cached'
  | 'composer-prepare'
  | 'reset-identity'
  | 'reset-blur'
  // Sign-in input path of the same build: whether the code field took focus, how many characters
  // its state held after each change (a length, never a character), and how verify ended.
  | 'signin-code-focus'
  | 'signin-code-change'
  | 'signin-verify-press'
  | 'signin-verify-ok'
  | 'signin-verify-denied'
  | 'signin-verify-code_invalid'
  | 'signin-verify-unavailable'
  // Notification settings load after sign-in: why the owner's controls did or did not render.
  | 'prefs-loaded'
  | 'prefs-failed'
  | 'prefs-token-null'
  | 'prefs-stale'
type OpenerSink = (event: ShareCardOpenerEvent, length?: number) => void
let openerSink: OpenerSink | null = null
export function traceShareCardOpener(event: ShareCardOpenerEvent, length?: number) {
  openerSink?.(event, length)
}
export function installShareCardOpenerTrace(next: OpenerSink | null) {
  openerSink = next
}
