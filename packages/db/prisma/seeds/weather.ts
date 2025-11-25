import type { PrismaClient } from '@prisma/client'

export type SeededWeather = { snapshotIds: string[]; segmentIds: string[] }

export async function seedWeather(prisma: PrismaClient): Promise<SeededWeather> {
  const weatherSeeds = [
    {
      id: 'wx-1',
      location: 'San Francisco, CA',
      baseTemp: 58,
      condition: 'fog',
      alert: null,
    },
    {
      id: 'wx-2',
      location: 'New York, NY',
      baseTemp: 48,
      condition: 'rain',
      alert: 'flood',
    },
    { id: 'wx-3', location: 'Austin, TX', baseTemp: 75, condition: 'sunny', alert: null },
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
      condition: 'sunny',
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
      condition: 'freezing-rain',
      alert: 'ice',
    },
    {
      id: 'wx-10',
      location: 'Phoenix, AZ',
      baseTemp: 88,
      condition: 'hot',
      alert: 'heat',
    },
  ]

  const snapshotIds: string[] = []
  const segmentIds: string[] = []

  const segmentOffsets = [0, 6]

  await Promise.all(
    weatherSeeds.map(async (seed) => {
      const snapshot = await prisma.weatherSnapshot.upsert({
        where: { id: seed.id },
        update: {
          location: seed.location,
          temperature: seed.baseTemp,
          condition: seed.condition,
          alerts: seed.alert ? [{ type: seed.alert }] : undefined,
        },
        create: {
          id: seed.id,
          location: seed.location,
          temperature: seed.baseTemp,
          condition: seed.condition,
          alerts: seed.alert ? [{ type: seed.alert }] : undefined,
        },
      })

      snapshotIds.push(snapshot.id)

      const segments = await Promise.all(
        segmentOffsets.map((offset) => {
          const segmentId = `${seed.id}-seg-${offset}`
          return prisma.forecastSegment
            .upsert({
              where: { id: segmentId },
              update: {
                hour_offset: offset,
                temperature: seed.baseTemp + offset * 0.5,
                condition: offset === 0 ? seed.condition : `${seed.condition}-later`,
                weather_snapshot: { connect: { id: snapshot.id } },
              },
              create: {
                id: segmentId,
                hour_offset: offset,
                temperature: seed.baseTemp + offset * 0.5,
                condition: offset === 0 ? seed.condition : `${seed.condition}-later`,
                weather_snapshot_id: snapshot.id,
              },
            })
            .then(() => segmentId)
        })
      )

      segmentIds.push(...segments)
    })
  )

  return { snapshotIds, segmentIds }
}
