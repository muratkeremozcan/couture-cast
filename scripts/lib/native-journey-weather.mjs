/**
 * The native journeys (Android and iOS) expect one Home outfit: the starter top, bottom and
 * shoes. The ritual reads the persisted weather snapshot of the saved location and adds outerwear
 * when the morning segment feels below 15 degrees Celsius.
 *
 * The journey database is seeded with `packages/db/prisma/seeds/weather.ts`, whose snapshot for
 * `san-francisco-ca` (the harness account's saved location) ramps its feels-like from 14 degrees
 * up by half a degree per hour, starting at the next full hour. The ritual's morning segment is
 * 08:00 America/Los_Angeles (15:00 UTC), so a run that seeds between 13:00 and 14:59 UTC finds
 * that segment 0 or 1 hours into the ramp, 14 or 14.5 degrees, and every other start time finds
 * 15 degrees or more. The saved original of run 40878814608 shows the cold outfit (Top, Bottom,
 * Outerwear, Shoes) on every lane that seeded inside that window.
 *
 * The journey flattens the seeded segments of its own snapshot to one warm value. The seed stays
 * as it is for every other consumer; the journey owns its database.
 */
export const NATIVE_JOURNEY_LOCATION_KEY = 'san-francisco-ca'
export const NATIVE_JOURNEY_TEMPERATURE_C = 20
export const NATIVE_JOURNEY_FEELS_LIKE_C = 19

/** Sets every forecast segment of the journey location's snapshot to the flat warm value. */
export async function pinNativeJourneyWeather(prisma) {
  const { count } = await prisma.forecastSegment.updateMany({
    where: { weather_snapshot: { location_key: NATIVE_JOURNEY_LOCATION_KEY } },
    data: {
      temperature: NATIVE_JOURNEY_TEMPERATURE_C,
      feels_like: NATIVE_JOURNEY_FEELS_LIKE_C,
    },
  })
  // No segments means the seed did not run for this location: a journey on the mock fallback
  // would pass for the wrong reason.
  if (count === 0) throw new Error('native_journey_weather_missing')
  return count
}
