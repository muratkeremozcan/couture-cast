import { BadRequestException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it, vi } from 'vitest'
import { latestWeatherResponseSchema } from '../../contracts/http'
import { RequestAuthGuard } from '../auth/security.guards'
import { WeatherController } from './weather.controller'
import type { WeatherQueryService } from './weather-query.service'

const createSnapshot = () => ({
  id: 'weather-1',
  location: 'New York',
  location_key: 'new-york-ny',
  latitude: 40.713,
  longitude: -74.006,
  timezone: 'America/New_York',
  provider: 'openweather',
  provider_updated_at: new Date('2026-07-07T13:00:00.000Z'),
  fetched_at: new Date('2026-07-07T13:30:00.000Z'),
  temperature: 21,
  condition: 'rain',
  alerts: [
    {
      event: 'Flood Watch',
      description: 'Flooding is possible.',
      start: '2026-07-07T14:00:00.000Z',
      end: '2026-07-07T18:00:00.000Z',
      severity: 'medium',
    },
  ],
  created_at: new Date('2026-07-07T13:30:01.000Z'),
  segments: Array.from({ length: 48 }, (_, index) => ({
    id: `segment-${index}`,
    weather_snapshot_id: 'weather-1',
    forecast_at: new Date(Date.UTC(2026, 6, 7, index)),
    hour_offset: index,
    temperature: 21 + index * 0.1,
    feels_like: 20 + index * 0.1,
    precipitation_probability: 0.25,
    precipitation_amount: 0.4,
    wind_speed: 4,
    wind_gust: index % 2 === 0 ? 6 : null,
    condition: 'rain',
    provider_weather_code: '500',
    created_at: new Date('2026-07-07T13:30:01.000Z'),
  })),
})

const createController = (
  result: Awaited<ReturnType<WeatherQueryService['getLatestWeather']>>
) => {
  const getLatestWeather = vi.fn().mockResolvedValue(result)
  const service = {
    getLatestWeather,
  } as unknown as WeatherQueryService

  return { controller: new WeatherController(service), getLatestWeather }
}

describe('WeatherController', () => {
  it('is protected by the request auth guard', () => {
    const handler = Object.getOwnPropertyDescriptor(
      WeatherController.prototype,
      'getLatestWeather'
    )?.value as (() => unknown) | undefined

    if (!handler) {
      throw new Error('Expected WeatherController.getLatestWeather to exist')
    }

    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined

    expect(guards).toContain(RequestAuthGuard)
  })

  it('returns a canonical latest-weather success envelope from the query service', async () => {
    const snapshot = createSnapshot()
    const { controller, getLatestWeather } = createController({
      status: 'fresh',
      data: snapshot,
    })

    const response = await controller.getLatestWeather('new-york-ny')

    expect(getLatestWeather).toHaveBeenCalledWith('new-york-ny')
    expect(latestWeatherResponseSchema.parse(response)).toEqual(response)
    expect(response).toMatchObject({
      data: {
        status: 'fresh',
        weather: {
          locationKey: 'new-york-ny',
          provider: 'openweather',
          current: {
            temperature: 21,
            condition: 'rain',
          },
        },
      },
    })
    expect(response.data.weather?.hourly).toHaveLength(48)
  })

  it('returns the exact unavailable fallback contract', async () => {
    const { controller } = createController({
      status: 'unavailable',
      data: null,
      message: 'Weather data is temporarily unavailable.',
    })

    await expect(controller.getLatestWeather('new-york-ny')).resolves.toEqual({
      data: {
        status: 'unavailable',
        weather: null,
        message: 'Weather data is temporarily unavailable.',
      },
    })
  })

  it('returns the exact cached fallback contract', async () => {
    const snapshot = createSnapshot()
    const { controller } = createController({
      status: 'cached',
      data: snapshot,
      message: 'Using recently cached weather data.',
    })

    const response = await controller.getLatestWeather('new-york-ny')

    expect(response.data.status).toBe('cached')
    if (response.data.status !== 'cached') {
      throw new Error('Expected cached weather')
    }
    expect(response.data.message).toBe('Using recently cached weather data.')
    expect(response.data.weather?.locationKey).toBe('new-york-ny')
  })

  it('returns a bad request for a missing location-key route', () => {
    const { controller } = createController({
      status: 'unavailable',
      data: null,
      message: 'Weather data is temporarily unavailable.',
    })

    expect(() => controller.getLatestWeatherMissingLocationKey()).toThrow(
      BadRequestException
    )
  })

  it('rejects an empty canonical location key before querying', async () => {
    const { controller, getLatestWeather } = createController({
      status: 'unavailable',
      data: null,
      message: 'Weather data is temporarily unavailable.',
    })

    await expect(controller.getLatestWeather('   ')).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(getLatestWeather).not.toHaveBeenCalled()
  })
})
