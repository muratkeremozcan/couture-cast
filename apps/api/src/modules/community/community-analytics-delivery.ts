// Story 6.3/6.4 owner: one vocabulary for why a community analytics delivery was deferred.

/**
 * Why delivering an analytics event to the acknowledged sink failed, from a
 * fixed list. An unconfigured sink (no PostHog key, as in CI) is its own reason,
 * so it is not read as the sink refusing or the network failing.
 */
export function analyticsDeliveryFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return 'delivery_failed'
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'sink_timeout'
  if (/unconfigured|transport unavailable/.test(error.message)) return 'sink_unconfigured'
  if (/refused|acknowledgement|quota limited/.test(error.message)) return 'sink_rejected'
  return 'delivery_failed'
}
