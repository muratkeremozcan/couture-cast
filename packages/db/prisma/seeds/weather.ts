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
    baseTemp: 58,
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
    baseTemp: 48,
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
    baseTemp: 75,
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
    baseTemp: 42,
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
    baseTemp: 50,
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
    baseTemp: 82,
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
    baseTemp: 38,
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
    baseTemp: 55,
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
    baseTemp: 36,
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
    baseTemp: 88,
    condition: 'clear',
    alert: 'heat',
  },
] as const

export async function seedWeather(prisma: PrismaClient): Promise<SeededWeather> {
  const segmentOffsets = [0, 6]

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
        temperature: seed.baseTemp,
        feelsLike: seed.baseTemp,
        conditions: seed.condition,
        alerts: seed.alert ? [{ type: seed.alert }] : null,
      })

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
        },
      })

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
