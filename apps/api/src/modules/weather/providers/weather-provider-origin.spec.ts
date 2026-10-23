import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenWeatherGeocodingClient } from './openweather-geocoding.client'
import { OpenWeatherProvider } from './openweather.provider'
import { WeatherApiGeocodingClient } from './weatherapi-geocoding.client'
import { WeatherApiProvider } from './weatherapi.provider'
import {
  isProductionRuntime,
  OPENWEATHER_DEFAULT_ORIGIN,
  resolveWeatherProviderOrigin,
  WEATHERAPI_DEFAULT_ORIGIN,
} from './weather-provider-origin'

describe('resolveWeatherProviderOrigin', () => {
  it('1.2b-UNIT-ORIGIN-01 uses the live origins when no override is set', () => {
    expect(resolveWeatherProviderOrigin('openweather', { TEST_ENV: 'local' })).toBe(
      OPENWEATHER_DEFAULT_ORIGIN
    )
    expect(resolveWeatherProviderOrigin('weatherapi', { TEST_ENV: 'local' })).toBe(
      WEATHERAPI_DEFAULT_ORIGIN
    )
  })

  it('1.2b-UNIT-ORIGIN-02 honors overrides outside production', () => {
    expect(
      resolveWeatherProviderOrigin('openweather', {
        TEST_ENV: 'local',
        OPENWEATHER_API_ORIGIN: 'http://127.0.0.1:4010/',
      })
    ).toBe('http://127.0.0.1:4010')
    expect(
      resolveWeatherProviderOrigin('weatherapi', {
        VERCEL_ENV: 'preview',
        WEATHERAPI_API_ORIGIN: 'http://127.0.0.1:4010',
      })
    ).toBe('http://127.0.0.1:4010')
  })

  it.each([
    { VERCEL_ENV: 'production', TEST_ENV: 'local' },
    { APP_ENV: 'prod' },
    { NODE_ENV: 'production' },
    // A Vercel production deployment wins over any other declared environment.
    { VERCEL_ENV: 'production', APP_ENV: 'preview' },
    { VERCEL_ENV: 'production', DEPLOY_ENV: 'local', TEST_ENV: 'local' },
    { VERCEL_ENV: 'production', APP_ENV: 'development', DEPLOY_ENV: 'preview' },
    { APP_ENV: 'preview', DEPLOY_ENV: 'production' },
  ])('1.2b-UNIT-ORIGIN-03 ignores overrides in production %j', (env) => {
    expect(
      resolveWeatherProviderOrigin('openweather', {
        ...env,
        OPENWEATHER_API_ORIGIN: 'http://127.0.0.1:4010',
      })
    ).toBe(OPENWEATHER_DEFAULT_ORIGIN)
  })

  it('1.2b-UNIT-ORIGIN-04 classifies runtimes', () => {
    expect(isProductionRuntime({ NODE_ENV: 'production', TEST_ENV: 'local' })).toBe(false)
    expect(isProductionRuntime({ NODE_ENV: 'production', VERCEL_ENV: 'preview' })).toBe(
      false
    )
    expect(isProductionRuntime({ NODE_ENV: 'development' })).toBe(false)
    expect(isProductionRuntime({ DEPLOY_ENV: 'production', NODE_ENV: 'test' })).toBe(true)
  })
})

describe('provider clients in production', () => {
  const override = 'http://127.0.0.1:4010'
  const production = {
    VERCEL_ENV: 'production',
    OPENWEATHER_API_ORIGIN: override,
    WEATHERAPI_API_ORIGIN: override,
  }
  const target = { locationKey: 'chicago-il', latitude: 41.878, longitude: -87.63 }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    [
      'OpenWeatherGeocodingClient',
      OPENWEATHER_DEFAULT_ORIGIN,
      (signal: AbortSignal) =>
        new OpenWeatherGeocodingClient({ apiKey: 'key', env: production }).search(
          'Chicago',
          'en',
          signal
        ),
    ],
    [
      'WeatherApiGeocodingClient',
      WEATHERAPI_DEFAULT_ORIGIN,
      (signal: AbortSignal) =>
        new WeatherApiGeocodingClient({ apiKey: 'key', env: production }).search(
          'Chicago',
          'en',
          signal
        ),
    ],
    [
      'OpenWeatherProvider',
      OPENWEATHER_DEFAULT_ORIGIN,
      (signal: AbortSignal) =>
        new OpenWeatherProvider({ apiKey: 'key', env: production }).fetchForecast(
          target,
          signal
        ),
    ],
    [
      'WeatherApiProvider',
      WEATHERAPI_DEFAULT_ORIGIN,
      (signal: AbortSignal) =>
        new WeatherApiProvider({
          apiKey: 'key',
          env: production,
          forecastDays: 3,
        }).fetchForecast(target, signal),
    ],
  ])(
    '1.2b-UNIT-ORIGIN-05 %s ignores an origin override in production',
    async (_client, liveOrigin, call) => {
      // Rejects every request, so nothing reaches the network either way.
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('request recorded'))

      await call(AbortSignal.timeout(3000)).catch(() => undefined)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [input] = fetchSpy.mock.calls[0]!
      const url = new URL(input instanceof Request ? input.url : String(input))
      expect(url.origin).toBe(liveOrigin)
    }
  )
})
