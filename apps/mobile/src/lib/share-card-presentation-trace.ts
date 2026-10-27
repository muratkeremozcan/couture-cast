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
