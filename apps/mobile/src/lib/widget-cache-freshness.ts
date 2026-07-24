export const widgetCacheExpiryMs = 30 * 60 * 1000

export function isWidgetCacheFresh(
  timestamp: number,
  now = Date.now(),
  expiryMs = widgetCacheExpiryMs
): boolean {
  const age = now - timestamp
  return Number.isFinite(timestamp) && age >= 0 && age < expiryMs
}
