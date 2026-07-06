import { describe, expect, it } from 'vitest'
import { loadWeatherConfig, WeatherConfigError } from './weather.config.js'

describe('loadWeatherConfig', () => {
  it('parses typed weather settings and canonical targets', () => {
    const config = loadWeatherConfig({
      OPENWEATHER_API_KEY: 'open-key',
      WEATHERAPI_API_KEY: 'secondary-key',
      WEATHER_REFRESH_MINUTES: '15',
      WEATHER_PROVIDER_MODE: 'weatherapi',
      WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
        { locationKey: 'chi', latitude: 41.8781, longitude: -87.6298 },
      ]),
    })

    expect(config).toEqual({
      openWeatherApiKey: 'open-key',
      weatherApiKey: 'secondary-key',
      refreshMinutes: 15,
      providerMode: 'weatherapi',
      ingestionTargets: [{ locationKey: 'chi', latitude: 41.8781, longitude: -87.6298 }],
    })
  })

  it('applies safe defaults', () => {
    expect(loadWeatherConfig({})).toMatchObject({
      refreshMinutes: 30,
      providerMode: 'openweather',
      ingestionTargets: [],
    })
  })

  it('handles empty target JSON string gracefully', () => {
    const config = loadWeatherConfig({
      WEATHER_INGESTION_TARGETS_JSON: '   ',
    })
    expect(config.ingestionTargets).toEqual([])
  })

  it.each([
    ['refresh cadence', { WEATHER_REFRESH_MINUTES: '31' }],
    ['provider mode', { WEATHER_PROVIDER_MODE: 'unknown' }],
    ['target JSON', { WEATHER_INGESTION_TARGETS_JSON: '{not-json' }],
    [
      'target coordinates',
      {
        WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
          { locationKey: 'invalid', latitude: 91, longitude: 0 },
        ]),
      },
    ],
    [
      'duplicate target keys',
      {
        WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
          { locationKey: 'chi', latitude: 41.8781, longitude: -87.6298 },
          { locationKey: 'chi', latitude: 40, longitude: -80 },
        ]),
      },
    ],
  ])('rejects invalid %s without echoing configured values', (_name, env) => {
    expect(() => loadWeatherConfig(env)).toThrow(WeatherConfigError)
  })
})
