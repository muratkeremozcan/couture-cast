import type { Prisma, PrismaClient, WeatherSnapshot } from '@prisma/client'

import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export const WEATHER_CONDITIONS = ['clear', 'cloudy', 'rain', 'snow'] as const

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number]

export interface WeatherAlert {
  type: string
  severity?: 'low' | 'medium' | 'high'
}

export interface WeatherSnapshotFixture {
  id: string
  locationId: string
  location: string
  temperature: number
  feelsLike: number
  conditions: WeatherCondition
  windSpeed: number
  humidity: number
  alerts: WeatherAlert[] | null
  timestamp: Date
  createdAt: Date
}

export interface WeatherSnapshotFactoryOverrides
  extends Partial<Omit<WeatherSnapshotFixture, 'alerts'>> {
  alerts?: WeatherAlert[] | null
}

type PersistWeatherSnapshotPrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedWeatherSnapshotOptions {
  persist: true
  prisma: PersistWeatherSnapshotPrismaClient
}

export type PersistedWeatherSnapshotFixture = WeatherSnapshot

const mergeWeatherSnapshotFixture = createFactory<WeatherSnapshotFixture>(
  buildDefaultWeatherSnapshotFixture
)

function buildDefaultWeatherSnapshotFixture(): WeatherSnapshotFixture {
  const temperature = faker.number.int({ min: -10, max: 35 })

  return {
    id: faker.string.uuid(),
    locationId: faker.string.uuid(),
    location: `${faker.location.city()}, ${faker.location.state({ abbreviated: true })}`,
    temperature,
    feelsLike: temperature + faker.number.int({ min: -4, max: 4 }),
    conditions: faker.helpers.arrayElement(WEATHER_CONDITIONS),
    windSpeed: faker.number.int({ min: 0, max: 50 }),
    humidity: faker.number.int({ min: 0, max: 100 }),
    alerts: null,
    timestamp: new Date(),
    createdAt: new Date(),
  }
}

function composeWeatherSnapshotFixture(
  overrides: WeatherSnapshotFactoryOverrides = {}
): WeatherSnapshotFixture {
  const defaults = buildDefaultWeatherSnapshotFixture()

  return mergeWeatherSnapshotFixture({
    ...defaults,
    ...overrides,
    alerts: overrides.alerts ?? defaults.alerts,
  })
}

export function buildWeatherSnapshotCreateInput(
  fixture: WeatherSnapshotFixture
): Prisma.WeatherSnapshotCreateInput {
  return {
    id: fixture.id,
    location: fixture.location,
    temperature: fixture.temperature,
    condition: fixture.conditions,
    alerts: fixture.alerts
      ? (fixture.alerts as unknown as Prisma.InputJsonArray)
      : undefined,
    fetched_at: fixture.timestamp,
  }
}

export async function persistWeatherSnapshot(
  prisma: PersistWeatherSnapshotPrismaClient,
  fixture: WeatherSnapshotFixture
): Promise<PersistedWeatherSnapshotFixture> {
  const weatherSnapshot = await prisma.weatherSnapshot.create({
    data: buildWeatherSnapshotCreateInput(fixture),
  })

  registerCreatedEntity('weatherSnapshots', weatherSnapshot.id)

  return weatherSnapshot
}

function maybePersistWeatherSnapshot(
  fixture: WeatherSnapshotFixture,
  options?: CreatePersistedWeatherSnapshotOptions
): WeatherSnapshotFixture | Promise<PersistedWeatherSnapshotFixture> {
  if (!options?.persist) {
    return fixture
  }

  return persistWeatherSnapshot(options.prisma, fixture)
}

export function createWeatherSnapshot(
  overrides?: WeatherSnapshotFactoryOverrides
): WeatherSnapshotFixture
export function createWeatherSnapshot(
  overrides: WeatherSnapshotFactoryOverrides | undefined,
  options: CreatePersistedWeatherSnapshotOptions
): Promise<PersistedWeatherSnapshotFixture>
export function createWeatherSnapshot(
  overrides: WeatherSnapshotFactoryOverrides = {},
  options?: CreatePersistedWeatherSnapshotOptions
): WeatherSnapshotFixture | Promise<PersistedWeatherSnapshotFixture> {
  return maybePersistWeatherSnapshot(composeWeatherSnapshotFixture(overrides), options)
}
