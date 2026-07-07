import { describe, expect, it } from 'vitest'

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
})
