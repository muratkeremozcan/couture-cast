// Step 3 step 3 owner: searchable owner anchor
import { Prisma, type PrismaClient } from '@prisma/client'
import * as weatherFactories from '../../../testing/src/factories/weather.factory.ts'

import { unwrapCjsNamespace } from './interop.js'

const { createWeatherSnapshot } = unwrapCjsNamespace(weatherFactories)

export type SeededWeather = { snapshotIds: string[]; segmentIds: string[] }

const weatherSeeds = [
  {
    id: 'wx-1',
    location: 'San Francisco, CA',
    locationKey: 'san-francisco-ca',
    latitude: 37.7749,
    longitude: -122.4194,
    timezone: 'America/Los_Angeles',
    baseTempCelsius: 14,
    condition: 'cloudy',
    alert: null,
  },
  {
    id: 'wx-2',
    location: 'New York, NY',
    locationKey: 'new-york-ny',
    latitude: 40.7128,
    longitude: -74.006,
    timezone: 'America/New_York',
    baseTempCelsius: 9,
    condition: 'rain',
    alert: 'flood',
  },
  {
    id: 'wx-3',
    location: 'Austin, TX',
    locationKey: 'austin-tx',
    latitude: 30.2672,
    longitude: -97.7431,
    timezone: 'America/Chicago',
    baseTempCelsius: 24,
    condition: 'clear',
    alert: null,
  },
  {
    id: 'wx-4',
    location: 'Chicago, IL',
    locationKey: 'chicago-il',
    latitude: 41.8781,
    longitude: -87.6298,
    timezone: 'America/Chicago',
    baseTempCelsius: 6,
    condition: 'snow',
    alert: 'winter-storm',
  },
  {
    id: 'wx-5',
    location: 'Seattle, WA',
    locationKey: 'seattle-wa',
    latitude: 47.6062,
    longitude: -122.3321,
    timezone: 'America/Los_Angeles',
    baseTempCelsius: 10,
    condition: 'rain',
    alert: 'wind',
  },
  {
    id: 'wx-6',
    location: 'Miami, FL',
    locationKey: 'miami-fl',
    latitude: 25.7617,
    longitude: -80.1918,
    timezone: 'America/New_York',
    baseTempCelsius: 28,
    condition: 'clear',
    alert: 'heat',
  },
  {
    id: 'wx-7',
    location: 'Denver, CO',
    locationKey: 'denver-co',
    latitude: 39.7392,
    longitude: -104.9903,
    timezone: 'America/Denver',
    baseTempCelsius: 3,
    condition: 'snow',
    alert: null,
  },
  {
    id: 'wx-8',
    location: 'Portland, OR',
    locationKey: 'portland-or',
    latitude: 45.5152,
    longitude: -122.6784,
    timezone: 'America/Los_Angeles',
    baseTempCelsius: 13,
    condition: 'cloudy',
    alert: null,
  },
  {
    id: 'wx-9',
    location: 'Toronto, ON',
    locationKey: 'toronto-on',
    latitude: 43.6532,
    longitude: -79.3832,
    timezone: 'America/Toronto',
    baseTempCelsius: 2,
    condition: 'rain',
    alert: 'ice',
  },
  {
    id: 'wx-10',
    location: 'Phoenix, AZ',
    locationKey: 'phoenix-az',
    latitude: 33.4484,
    longitude: -112.074,
    timezone: 'America/Phoenix',
    baseTempCelsius: 31,
    condition: 'clear',
    alert: 'heat',
  },
] as const

/**
 * `WeatherSnapshot.daily_summaries`, seeded so the community feed's climate band
 * can actually resolve.
 *
 * `CommunityService.resolveViewerBand` is the only consumer that has no fallback:
 * it reads this column, and nothing else in the snapshot, and returns
 * `weather_malformed` when it is absent. Before this existed every seeded
 * location resolved `viewerBand: null`, so the `auto` feed silently fell back to
 * every region and the "Your climate: X" chip and band-filtered feed were
 * unreachable anywhere that runs off this seed -- the mobile end-to-end suite
 * included. The planner reads the same column, but only as a fallback for days
 * its 48 seeded hourly `ForecastSegment` rows do not cover, so seeding it widens
 * the planner's seeded week from two days to eight rather than changing the two
 * it already had.
 *
 * UNITS, AND WHY THE FIELD CARRIES ITS UNIT IN ITS NAME. `baseTempCelsius` used
 * to be `baseTemp` and used to hold Fahrenheit: Miami 82, Phoenix 88, and
 * Chicago 42 next to `condition: 'snow'`. Everything downstream of the real
 * providers is Celsius -- `openweather.provider.ts` requests `units=metric` --
 * so those values were written straight into a Celsius column, and every seeded
 * surface rendered a number in the wrong unit. Nothing caught it because no test
 * asserts a seeded temperature; the values simply looked plausible as
 * Fahrenheit to anyone reading the seed.
 *
 * The values below are the same weather in Celsius, and the field name now says
 * which unit it is, because that is the only part of this fix that stops the bug
 * coming back. `classifyClimateBand`'s thresholds (cold below 10, warm at or
 * above 22) are Celsius too, so the daily entries built here read
 * `baseTempCelsius` directly rather than converting anything.
 */
const DAILY_SUMMARY_DAYS = 8
const WET_SEED_CONDITIONS = new Set(['rain', 'snow'])

function toLocalDate(day: Date): string {
  return day.toISOString().slice(0, 10)
}

function buildDailySummaries(
  seed: (typeof weatherSeeds)[number],
  from: Date
): Record<string, unknown>[] {
  const midpointCelsius = seed.baseTempCelsius
  const wet = WET_SEED_CONDITIONS.has(seed.condition)

  return Array.from({ length: DAILY_SUMMARY_DAYS }, (_, offset) => {
    const localDate = toLocalDate(new Date(from.getTime() + offset * 24 * 60 * 60 * 1000))
    return {
      localDate,
      condition: seed.condition,
      temperatureMin: midpointCelsius - 4,
      temperatureMax: midpointCelsius + 4,
      // Held flat across the window on purpose. The classifier's moisture axis is
      // a ratio of wet days, so a per-day wobble around the 0.4 threshold would
      // make a location's band depend on which day the seed ran.
      precipitationProbability: wet ? 0.8 : 0.05,
      precipitationAmount: wet ? 4 : 0,
      windSpeed: 3,
    }
  })
}

export async function seedWeather(prisma: PrismaClient): Promise<SeededWeather> {
  const segmentOffsets = Array.from({ length: 48 }, (_, i) => i)

  const results = await Promise.all(
    weatherSeeds.map(async (seed, seedIndex) => {
      const now = new Date()
      const providerUpdatedAt = new Date(now.getTime() - 30 * 60 * 1000)
      const fixture = createWeatherSnapshot({
        id: seed.id,
        location: seed.location,
        locationKey: seed.locationKey,
        latitude: seed.latitude,
        longitude: seed.longitude,
        timezone: seed.timezone,
        provider: 'openweather',
        providerUpdatedAt,
        timestamp: now,
        temperature: seed.baseTempCelsius,
        feelsLike: seed.baseTempCelsius,
        conditions: seed.condition,
        alerts: seed.alert
          ? [
              {
                event: seed.alert,
                description: `${seed.alert} warning for local area`,
                start: now,
                end: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                severity: 'medium',
              },
            ]
          : null,
      })

      const dailySummaries = buildDailySummaries(
        seed,
        now
      ) as unknown as Prisma.InputJsonArray

      const snapshot = await prisma.weatherSnapshot.upsert({
        where: { id: fixture.id },
        update: {
          location: fixture.location,
          location_key: fixture.locationKey,
          latitude: fixture.latitude,
          longitude: fixture.longitude,
          timezone: fixture.timezone,
          provider: fixture.provider,
          provider_updated_at: fixture.providerUpdatedAt,
          temperature: fixture.temperature,
          condition: fixture.conditions,
          alerts: fixture.alerts
            ? (fixture.alerts as unknown as Prisma.InputJsonArray)
            : Prisma.JsonNull,
          daily_summaries: dailySummaries,
          // `fetched_at` only defaults on insert, so a re-seed without a reset
          // would leave it at the original run's clock. Anything older than an
          // hour reads as `stale` to `WeatherQueryService`, and a stale snapshot
          // resolves no climate band at all, so a seed that does not move this
          // forward hands back exactly the unresolved band it just seeded data to
          // fix.
          fetched_at: now,
        },
        create: {
          id: fixture.id,
          location: fixture.location,
          location_key: fixture.locationKey,
          latitude: fixture.latitude,
          longitude: fixture.longitude,
          timezone: fixture.timezone,
          provider: fixture.provider,
          provider_updated_at: fixture.providerUpdatedAt,
          temperature: fixture.temperature,
          condition: fixture.conditions,
          alerts: fixture.alerts
            ? (fixture.alerts as unknown as Prisma.InputJsonArray)
            : Prisma.JsonNull,
          daily_summaries: dailySummaries,
          fetched_at: now,
        },
      })

      // Idempotency for standalone re-runs. `forecast_at` is now-relative and
      // (weather_snapshot_id, forecast_at) is unique, so a later run's new
      // schedule overlaps the previous run's rows while the upserts are still
      // in flight and fails with a unique violation. Shifting the existing rows
      // uniformly far out of range first keeps them unique at every step, and
      // the upserts below then move each row to its final slot. Rituals
      // reference segments by id, so rows must be moved, never deleted.
      await prisma.$executeRaw`
        UPDATE "ForecastSegment"
        SET "forecast_at" = "forecast_at" - interval '1000 years'
        WHERE "weather_snapshot_id" = ${snapshot.id}`

      const segments = await Promise.all(
        segmentOffsets.map((offset) => {
          const segmentId = `${seed.id}-seg-${offset}`
          const segmentCondition =
            offset === 0
              ? fixture.conditions
              : (weatherSeeds[(offset + seedIndex) % weatherSeeds.length]?.condition ??
                fixture.conditions)
          return prisma.forecastSegment
            .upsert({
              where: { id: segmentId },
              update: {
                hour_offset: offset,
                forecast_at: fixture.segments[offset]?.forecastAt ?? fixture.timestamp,
                temperature: fixture.temperature + offset * 0.5,
                feels_like: fixture.feelsLike + offset * 0.5,
                precipitation_probability:
                  fixture.segments[offset]?.precipitationProbability ?? 0,
                precipitation_amount: fixture.segments[offset]?.precipitationAmount ?? 0,
                wind_speed: fixture.windSpeed,
                wind_gust: fixture.segments[offset]?.windGust ?? null,
                condition: segmentCondition,
                provider_weather_code: segmentCondition,
                weather_snapshot: { connect: { id: snapshot.id } },
              },
              create: {
                id: segmentId,
                hour_offset: offset,
                forecast_at: fixture.segments[offset]?.forecastAt ?? fixture.timestamp,
                temperature: fixture.temperature + offset * 0.5,
                feels_like: fixture.feelsLike + offset * 0.5,
                precipitation_probability:
                  fixture.segments[offset]?.precipitationProbability ?? 0,
                precipitation_amount: fixture.segments[offset]?.precipitationAmount ?? 0,
                wind_speed: fixture.windSpeed,
                wind_gust: fixture.segments[offset]?.windGust ?? null,
                condition: segmentCondition,
                provider_weather_code: segmentCondition,
                weather_snapshot_id: snapshot.id,
              },
            })
            .then(() => segmentId)
        })
      )

      return { snapshotId: snapshot.id, segmentIds: segments }
    })
  )

  const snapshotIds = results.map((r) => r.snapshotId)
  const segmentIds = results.flatMap((r) => r.segmentIds)

  return { snapshotIds, segmentIds }
}
