// Learning path Step 16: Weather API ingestion service and durable worker ingestion.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-16-weather-api-ingestion-service-and-durable-worker-ingestion
import { describe, expect, it } from 'vitest'
import { loadWeatherConfig, WeatherConfigError } from './weather.config.js'

describe('loadWeatherConfig', () => {
  it('parses typed weather settings and canonical targets', () => {
    const config = loadWeatherConfig({
      OPENWEATHER_API_KEY: 'open-key',
      WEATHERAPI_API_KEY: 'secondary-key',
      WEATHER_REFRESH_MINUTES: '5',
      WEATHER_PROVIDER_MODE: 'weatherapi',
      WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
        {
          locationKey: 'chi',
          locationName: 'Chicago, IL',
          latitude: 41.8781,
          longitude: -87.6298,
        },
      ]),
    })

    expect(config).toEqual({
      openWeatherApiKey: 'open-key',
      weatherApiKey: 'secondary-key',
      refreshMinutes: 5,
      providerMode: 'weatherapi',
      ingestionTargets: [
        {
          locationKey: 'chi',
          locationName: 'Chicago, IL',
          latitude: 41.8781,
          longitude: -87.6298,
        },
      ],
      weatherApiForecastDays: 3,
    })
  })

  it('applies safe defaults', () => {
    expect(loadWeatherConfig({})).toMatchObject({
      refreshMinutes: 5,
      providerMode: 'openweather',
      ingestionTargets: [],
      weatherApiForecastDays: 3,
    })
  })

  // Story 5.5 Decision 3: validated, capped at 8 (the planner's own window).
  it('parses a configured WeatherAPI forecast depth', () => {
    expect(loadWeatherConfig({ WEATHERAPI_FORECAST_DAYS: '8' })).toMatchObject({
      weatherApiForecastDays: 8,
    })
  })

  it('handles empty target JSON string gracefully', () => {
    const config = loadWeatherConfig({
      WEATHER_INGESTION_TARGETS_JSON: '   ',
    })
    expect(config.ingestionTargets).toEqual([])
  })

  it.each([
    ['refresh cadence', { WEATHER_REFRESH_MINUTES: '6' }],
    ['provider mode', { WEATHER_PROVIDER_MODE: 'unknown' }],
    ['WeatherAPI forecast depth', { WEATHERAPI_FORECAST_DAYS: '14' }],
    ['target JSON', { WEATHER_INGESTION_TARGETS_JSON: '{not-json' }],
    [
      'target coordinates',
      {
        WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
          {
            locationKey: 'invalid',
            locationName: 'Invalid place',
            latitude: 91,
            longitude: 0,
          },
        ]),
      },
    ],
    [
      'duplicate target keys',
      {
        WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
          {
            locationKey: 'chi',
            locationName: 'Chicago, IL',
            latitude: 41.8781,
            longitude: -87.6298,
          },
          {
            locationKey: 'chi',
            locationName: 'Chicago duplicate',
            latitude: 40,
            longitude: -80,
          },
        ]),
      },
    ],
    [
      'target without a descriptive location name',
      {
        WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
          { locationKey: 'chi', latitude: 41.8781, longitude: -87.6298 },
        ]),
      },
    ],
    [
      'target with a blank descriptive location name',
      {
        WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
          {
            locationKey: 'chi',
            locationName: '   ',
            latitude: 41.8781,
            longitude: -87.6298,
          },
        ]),
      },
    ],
  ])('rejects invalid %s without echoing configured values', (_name, env) => {
    expect(() => loadWeatherConfig(env)).toThrow(WeatherConfigError)
  })
})
