// Story 5.5 Decision 3: shared by both providers to format a daily
// forecast's epoch timestamp as a local calendar date. `en-CA` is a
// deliberate trick: that locale's short date format is `YYYY-MM-DD`, which
// is exactly the wire format `NormalizedDailyWeatherEntry.localDate` needs,
// with no manual zero-padding or string surgery.
export function formatLocalDateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
