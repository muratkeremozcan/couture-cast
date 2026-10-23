import 'reflect-metadata'
import type { FactoryProvider } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenWeatherGeocodingClient } from '../weather/providers/openweather-geocoding.client'
import { OpenWeatherProvider } from '../weather/providers/openweather.provider'
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

describe('LocationPreferencesModule provider selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    ['', OpenWeatherGeocodingClient, OpenWeatherProvider],
    ['openweather', OpenWeatherGeocodingClient, OpenWeatherProvider],
    ['weatherapi', WeatherApiGeocodingClient, WeatherApiProvider],
  ])(
    '1.2b-UNIT-MODE-04 WEATHER_PROVIDER_MODE=%j selects search and the save forecast together',
    (mode, geocoder, forecastProvider) => {
      vi.stubEnv('WEATHER_PROVIDER_MODE', mode || undefined)
      vi.stubEnv('WEATHERAPI_FORECAST_DAYS', '3')

      expect(factoryFor(LOCATION_GEOCODER)()).toBeInstanceOf(geocoder)
      expect(factoryFor(LOCATION_FORECAST_PROVIDER)()).toBeInstanceOf(forecastProvider)
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
