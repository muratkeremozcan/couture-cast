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
    baseTemp: 58,
    condition: 'cloudy',
    alert: null,
  },
  {
    id: 'wx-2',
    location: 'New York, NY',
    baseTemp: 48,
    condition: 'rain',
    alert: 'flood',
  },
  { id: 'wx-3', location: 'Austin, TX', baseTemp: 75, condition: 'clear', alert: null },
  {
    id: 'wx-4',
    location: 'Chicago, IL',
    baseTemp: 42,
    condition: 'snow',
    alert: 'winter-storm',
  },
  {
    id: 'wx-5',
    location: 'Seattle, WA',
    baseTemp: 50,
    condition: 'rain',
    alert: 'wind',
  },
  {
    id: 'wx-6',
    location: 'Miami, FL',
    baseTemp: 82,
    condition: 'clear',
    alert: 'heat',
  },
  { id: 'wx-7', location: 'Denver, CO', baseTemp: 38, condition: 'snow', alert: null },
  {
    id: 'wx-8',
    location: 'Portland, OR',
    baseTemp: 55,
    condition: 'cloudy',
    alert: null,
  },
  {
    id: 'wx-9',
    location: 'Toronto, ON',
    baseTemp: 36,
    condition: 'rain',
    alert: 'ice',
  },
  {
    id: 'wx-10',
    location: 'Phoenix, AZ',
    baseTemp: 88,
    condition: 'clear',
    alert: 'heat',
  },
] as const

export async function seedWeather(prisma: PrismaClient): Promise<SeededWeather> {
  const segmentOffsets = [0, 6]

  const results = await Promise.all(
    weatherSeeds.map(async (seed, seedIndex) => {
      const fixture = createWeatherSnapshot({
        id: seed.id,
        location: seed.location,
        temperature: seed.baseTemp,
        feelsLike: seed.baseTemp,
        conditions: seed.condition,
        alerts: seed.alert ? [{ type: seed.alert }] : null,
      })

      const snapshot = await prisma.weatherSnapshot.upsert({
        where: { id: fixture.id },
        update: {
          location: fixture.location,
          temperature: fixture.temperature,
          condition: fixture.conditions,
          alerts: fixture.alerts
            ? (fixture.alerts as unknown as Prisma.InputJsonArray)
            : Prisma.JsonNull,
        },
        create: {
          id: fixture.id,
          location: fixture.location,
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
                temperature: fixture.temperature + offset * 0.5,
                condition: segmentCondition,
                weather_snapshot: { connect: { id: snapshot.id } },
              },
              create: {
                id: segmentId,
                hour_offset: offset,
                temperature: fixture.temperature + offset * 0.5,
                condition: segmentCondition,
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
