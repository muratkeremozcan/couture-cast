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
let openerSink: ((event: ShareCardOpenerEvent) => void) | null = null
export function traceShareCardOpener(event: ShareCardOpenerEvent) {
  openerSink?.(event)
}
export function installShareCardOpenerTrace(
  next: ((event: ShareCardOpenerEvent) => void) | null
) {
  openerSink = next
}
