import type { Prisma, PrismaClient, WeatherSnapshot } from '@prisma/client'

import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export const WEATHER_CONDITIONS = [
  'clear',
  'partly_cloudy',
  'cloudy',
  'fog',
  'drizzle',
  'rain',
  'sleet',
  'snow',
  'thunderstorm',
  'wind',
  'unknown',
] as const

export const WEATHER_PROVIDERS = ['openweather', 'weatherapi'] as const

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number]
export type WeatherProvider = (typeof WEATHER_PROVIDERS)[number]

export interface WeatherAlert {
  type: string
  severity?: 'low' | 'medium' | 'high'
}

export interface ForecastSegmentFixture {
  id?: string
  forecastAt: Date
  hourOffset: number
  temperature: number
  feelsLike: number
  conditions: WeatherCondition
  precipitationProbability: number
  precipitationAmount: number
  windSpeed: number
  windGust: number | null
  providerWeatherCode: string
  createdAt: Date
}

export interface WeatherSnapshotFixture {
  id: string
  locationId: string
  location: string
  locationKey: string
  latitude: number
  longitude: number
  timezone: string
  provider: WeatherProvider
  providerUpdatedAt: Date
  temperature: number
  feelsLike: number
  conditions: WeatherCondition
  windSpeed: number
  humidity: number
  alerts: WeatherAlert[] | null
  timestamp: Date
  createdAt: Date
  segments: ForecastSegmentFixture[]
}

export interface WeatherSnapshotFactoryOverrides
  extends Partial<Omit<WeatherSnapshotFixture, 'alerts' | 'segments'>> {
  alerts?: WeatherAlert[] | null
  segments?: ForecastSegmentFixture[]
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
  const fetchedAt = new Date()
  const location = `${faker.location.city()}, ${faker.location.state({ abbreviated: true })}`
  const locationKey = slugifyLocation(location)

  return {
    id: faker.string.uuid(),
    locationId: faker.string.uuid(),
    location,
    locationKey,
    latitude: Number(faker.location.latitude({ min: -90, max: 90 }).toFixed(4)),
    longitude: Number(faker.location.longitude({ min: -180, max: 180 }).toFixed(4)),
    timezone: 'UTC',
    provider: faker.helpers.arrayElement(WEATHER_PROVIDERS),
    providerUpdatedAt: fetchedAt,
    temperature,
    feelsLike: temperature + faker.number.int({ min: -4, max: 4 }),
    conditions: faker.helpers.arrayElement(WEATHER_CONDITIONS),
    windSpeed: faker.number.int({ min: 0, max: 50 }),
    humidity: faker.number.int({ min: 0, max: 100 }),
    alerts: null,
    timestamp: fetchedAt,
    createdAt: fetchedAt,
    segments: buildDefaultForecastSegments({
      baseTime: fetchedAt,
      baseTemperature: temperature,
      baseFeelsLike: temperature,
      condition: 'clear',
      windSpeed: 3,
    }),
  }
}

function composeWeatherSnapshotFixture(
  overrides: WeatherSnapshotFactoryOverrides = {}
): WeatherSnapshotFixture {
  const merged = mergeWeatherSnapshotFixture(overrides)

  if (overrides.segments) {
    return merged
  }

  return {
    ...merged,
    segments: buildDefaultForecastSegments({
      baseTime: merged.timestamp,
      baseTemperature: merged.temperature,
      baseFeelsLike: merged.feelsLike,
      condition: merged.conditions,
      windSpeed: merged.windSpeed,
    }),
  }
}

function slugifyLocation(location: string): string {
  return location
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function nextHour(date: Date): Date {
  const next = new Date(date)
  next.setUTCMinutes(0, 0, 0)
  next.setUTCHours(next.getUTCHours() + 1)
  return next
}

function buildDefaultForecastSegments(input: {
  baseTime: Date
  baseTemperature: number
  baseFeelsLike: number
  condition: WeatherCondition
  windSpeed: number
}): ForecastSegmentFixture[] {
  const firstForecastHour = nextHour(input.baseTime)

  return Array.from({ length: 48 }, (_, index) => ({
    forecastAt: new Date(firstForecastHour.getTime() + index * 3600000),
    hourOffset: index,
    temperature: Number((input.baseTemperature + index * 0.1).toFixed(1)),
    feelsLike: Number((input.baseFeelsLike + index * 0.1).toFixed(1)),
    conditions: input.condition,
    precipitationProbability: 0,
    precipitationAmount: 0,
    windSpeed: input.windSpeed,
    windGust: null,
    providerWeatherCode: input.condition,
    createdAt: input.baseTime,
  }))
}

export function buildWeatherSnapshotCreateInput(
  fixture: WeatherSnapshotFixture
): Prisma.WeatherSnapshotCreateInput {
  return {
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
      : undefined,
    fetched_at: fixture.timestamp,
    created_at: fixture.createdAt,
    segments: {
      create: fixture.segments.map((segment) => ({
        id: segment.id,
        forecast_at: segment.forecastAt,
        hour_offset: segment.hourOffset,
        temperature: segment.temperature,
        feels_like: segment.feelsLike,
        precipitation_probability: segment.precipitationProbability,
        precipitation_amount: segment.precipitationAmount,
        wind_speed: segment.windSpeed,
        wind_gust: segment.windGust,
        condition: segment.conditions,
        provider_weather_code: segment.providerWeatherCode,
        created_at: segment.createdAt,
      })),
    },
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
