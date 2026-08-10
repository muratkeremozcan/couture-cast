import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'
import {
  buildWeatherSnapshotCreateInput,
  createWeatherSnapshot,
} from '../src/factories/weather.factory.js'

describe('weather factory', () => {
  it('creates a normalized weather snapshot with 48 hourly segments', () => {
    const fetchedAt = new Date('2026-07-06T13:30:00.000Z')
    const providerUpdatedAt = new Date('2026-07-06T13:00:00.000Z')

    const fixture = createWeatherSnapshot({
      id: 'weather-1',
      location: 'New York, NY',
      locationKey: 'new-york-ny',
      latitude: 40.7128,
      longitude: -74.006,
      timezone: 'America/New_York',
      provider: 'openweather',
      providerUpdatedAt,
      timestamp: fetchedAt,
      temperature: 21,
      feelsLike: 20,
      conditions: 'rain',
      windSpeed: 4,
      humidity: 55,
    })

    const input = buildWeatherSnapshotCreateInput(fixture)

    expect(fixture.segments).toHaveLength(48)
    expect(fixture.segments[0]).toMatchObject({
      forecastAt: new Date('2026-07-06T14:00:00.000Z'),
      hourOffset: 0,
      feelsLike: 20,
      windSpeed: 4,
    })
    expect(typeof fixture.segments[0]?.precipitationProbability).toBe('number')
    expect(typeof fixture.segments[0]?.precipitationAmount).toBe('number')
    expect(typeof fixture.segments[0]?.providerWeatherCode).toBe('string')
    expect(input).toMatchObject({
      id: 'weather-1',
      location: 'New York, NY',
      location_key: 'new-york-ny',
      latitude: 40.7128,
      longitude: -74.006,
      timezone: 'America/New_York',
      provider: 'openweather',
      provider_updated_at: providerUpdatedAt,
      fetched_at: fetchedAt,
      temperature: 21,
      condition: 'rain',
    })
    const segmentCreateInput = input.segments?.create
    expect(Array.isArray(segmentCreateInput)).toBe(true)
    if (!Array.isArray(segmentCreateInput)) {
      throw new Error('Expected weather factory to create nested forecast segments')
    }
    expect(segmentCreateInput).toHaveLength(48)
    expect(segmentCreateInput[0]).toMatchObject({
      forecast_at: new Date('2026-07-06T14:00:00.000Z'),
      hour_offset: 0,
      feels_like: 20,
      wind_speed: 4,
    })
    expect(typeof segmentCreateInput[0]?.precipitation_probability).toBe('number')
    expect(typeof segmentCreateInput[0]?.precipitation_amount).toBe('number')
    expect(typeof segmentCreateInput[0]?.provider_weather_code).toBe('string')
  })

  it('keeps caller-supplied segments instead of regenerating 48 hours', () => {
    // Forecast assertions need a hand-built hour or two; the factory must not
    // overwrite them with its own randomized horizon.
    const forecastAt = new Date('2026-07-06T14:00:00.000Z')
    const fixture = createWeatherSnapshot({
      id: 'weather-2',
      segments: [
        {
          forecastAt,
          hourOffset: 0,
          temperature: 18,
          feelsLike: 17,
          conditions: 'rain',
          precipitationProbability: 0.9,
          precipitationAmount: 2.5,
          windSpeed: 6,
          windGust: null,
          providerWeatherCode: '500',
          createdAt: forecastAt,
        },
      ],
    })

    expect(fixture.segments).toHaveLength(1)
    expect(fixture.segments[0]).toMatchObject({ temperature: 18, conditions: 'rain' })
  })

  it('writes weather alerts into the snapshot JSON column', () => {
    // Alerts default to null, so the alert-driven paths in the API are only
    // reachable from a fixture that opts in; the JSON has to survive the map.
    const alerts = [
      {
        event: 'Severe thunderstorm warning',
        description: 'Seek shelter indoors',
        start: '2026-07-06T14:00:00.000Z',
        end: '2026-07-06T18:00:00.000Z',
        severity: 'high' as const,
      },
    ]

    const input = buildWeatherSnapshotCreateInput(
      createWeatherSnapshot({ id: 'weather-3', alerts })
    )

    expect(input.alerts).toEqual(alerts)
    expect(buildWeatherSnapshotCreateInput(createWeatherSnapshot()).alerts).toBe(
      undefined
    )
  })

  describe('persistence', () => {
    afterEach(() => {
      resetTrackedEntities()
    })

    it('persists a snapshot and registers it for cleanup', async () => {
      // Forecast segments cascade from the snapshot, so losing the snapshot id
      // strands 48 child rows per leaked fixture.
      const create =
        vi.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>()
      create.mockResolvedValue({ id: 'weather-persisted' })
      const prisma = { weatherSnapshot: { create } } as unknown as PrismaClient

      const persisted = await createWeatherSnapshot(
        { id: 'weather-persisted' },
        { persist: true, prisma }
      )

      expect(persisted).toEqual({ id: 'weather-persisted' })
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        data: { id: 'weather-persisted' },
      })
      expect(getTrackedEntityIds('weatherSnapshots')).toEqual(['weather-persisted'])
    })
  })
})
