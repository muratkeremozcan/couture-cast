// Timestamp and date utilities for k6 test scripts.
// Common patterns: date ranges for API filters, unix timestamps for JWT claims.

// 24 hours × 60 minutes × 60 seconds × 1000 milliseconds
const MS_PER_DAY = 86_400_000

export type TimestampRange = {
  from: string
  to: string
}

/**
 * Returns an ISO 8601 date range from `daysBack` ago until now.
 * @returns `{ from: string, to: string }` as ISO 8601 timestamps
 */
export function timestampRange(daysBack: number): TimestampRange {
  const now = new Date()
  const from = new Date(now.getTime() - daysBack * MS_PER_DAY)
  return {
    from: from.toISOString(),
    to: now.toISOString(),
  }
}

/** Returns a `YYYY-MM-DD` date string offset by `daysOffset` from today (0 = today). */
export function dateString(daysOffset = 0): string {
  const d = new Date(Date.now() + daysOffset * MS_PER_DAY)
  return d.toISOString().split('T')[0]!
}

/** Returns a Unix timestamp (seconds) offset by `daysOffset` from now. */
export function unixTimestamp(daysOffset = 0): number {
  return Math.floor((Date.now() + daysOffset * MS_PER_DAY) / 1000)
}
