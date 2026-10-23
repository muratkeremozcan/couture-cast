import 'reflect-metadata'
import type { FactoryProvider } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ILocationGeocoder } from '../weather/providers/location-geocoding'
import { OpenWeatherGeocodingClient } from '../weather/providers/openweather-geocoding.client'
import { OpenWeatherProvider } from '../weather/providers/openweather.provider'
import type { IWeatherProvider } from '../weather/providers/weather-provider.interface'
import { WeatherApiGeocodingClient } from '../weather/providers/weatherapi-geocoding.client'
import { WeatherApiProvider } from '../weather/providers/weatherapi.provider'
import { LOCATION_FORECAST_PROVIDER, LOCATION_GEOCODER } from './location-capture.service'
import { LocationPreferencesModule } from './location-preferences.module'

/** The module's own factory for a token, run exactly as Nest would run it. */
function factoryFor(token: symbol): () => unknown {
  const providers = Reflect.getMetadata(
    'providers',
    LocationPreferencesModule
  ) as unknown[]
  const provider = providers.find(
    (candidate): candidate is FactoryProvider =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as FactoryProvider).provide === token
  )
  if (!provider) throw new Error(`No factory for ${String(token)}`)
  return provider.useFactory as () => unknown
}

/** Each provider's own origin and key, distinct so a crossed wire shows. */
const OPENWEATHER = {
  originEnv: 'OPENWEATHER_API_ORIGIN',
  origin: 'http://openweather.test',
  keyEnv: 'OPENWEATHER_API_KEY',
  key: 'openweather-key',
}
const WEATHERAPI = {
  originEnv: 'WEATHERAPI_API_ORIGIN',
  origin: 'http://weatherapi.test',
  keyEnv: 'WEATHERAPI_API_KEY',
  key: 'weatherapi-key',
}

const target = {
  locationKey: 'chicago-illinois-us-41-878n-87-630w',
  locationName: 'Chicago',
  latitude: 41.878,
  longitude: -87.63,
}

describe('LocationPreferencesModule provider selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([
    ['', OpenWeatherGeocodingClient, OpenWeatherProvider, OPENWEATHER, 'appid'],
    [
      'openweather',
      OpenWeatherGeocodingClient,
      OpenWeatherProvider,
      OPENWEATHER,
      'appid',
    ],
    ['weatherapi', WeatherApiGeocodingClient, WeatherApiProvider, WEATHERAPI, 'key'],
  ])(
    '1.2b-UNIT-MODE-04 WEATHER_PROVIDER_MODE=%j selects search and the save forecast together',
    async (mode, geocoder, forecastProvider, provider, keyParam) => {
      vi.stubEnv('WEATHER_PROVIDER_MODE', mode || undefined)
      vi.stubEnv('WEATHERAPI_FORECAST_DAYS', '3')
      for (const configured of [OPENWEATHER, WEATHERAPI]) {
        vi.stubEnv(configured.originEnv, configured.origin)
        vi.stubEnv(configured.keyEnv, configured.key)
      }
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 500 }))

      const search = factoryFor(LOCATION_GEOCODER)() as ILocationGeocoder
      const forecast = factoryFor(LOCATION_FORECAST_PROVIDER)() as IWeatherProvider
      expect(search).toBeInstanceOf(geocoder)
      expect(forecast).toBeInstanceOf(forecastProvider)

      // Both clients call the selected provider, on that provider's own key.
      const signal = new AbortController().signal
      await search.search('Chicago', 'en', signal).catch(() => undefined)
      await forecast.fetchForecast(target, signal).catch(() => undefined)
      const requested = fetchSpy.mock.calls.map(
        ([input]) => new URL(input instanceof Request ? input.url : input)
      )
      expect(requested).toHaveLength(2)
      for (const url of requested) {
        expect(url.origin).toBe(provider.origin)
        expect(url.searchParams.get(keyParam)).toBe(provider.key)
      }
    }
  )

  it('1.2b-UNIT-MODE-05 refuses to build a client for an unknown mode', () => {
    vi.stubEnv('WEATHER_PROVIDER_MODE', 'bogus')

    expect(() => factoryFor(LOCATION_GEOCODER)()).toThrow('WEATHER_PROVIDER_MODE')
    expect(() => factoryFor(LOCATION_FORECAST_PROVIDER)()).toThrow(
      'WEATHER_PROVIDER_MODE'
    )
  })
})
