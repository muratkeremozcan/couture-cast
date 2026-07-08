import { expect, test } from 'vitest'
import {
  generateHttpOpenApiDocument,
  latestWeatherResponseSchema,
  weatherSnapshotSchema,
} from '../src/contracts/http'

const hourly = Array.from({ length: 48 }, (_, index) => ({
  forecastAt: new Date(Date.UTC(2026, 6, 7, index)).toISOString(),
  temperature: 21 + index * 0.1,
  feelsLike: 20 + index * 0.1,
  precipitationProbability: 0.25,
  precipitationAmount: 0.4,
  windSpeed: 4,
  windGust: index % 2 === 0 ? 6 : null,
  condition: 'rain',
  providerWeatherCode: '500',
}))

const snapshot = {
  locationKey: 'new-york-ny',
  latitude: 40.713,
  longitude: -74.006,
  timezone: 'America/New_York',
  provider: 'openweather',
  providerUpdatedAt: '2026-07-07T13:00:00.000Z',
  fetchedAt: '2026-07-07T13:30:00.000Z',
  current: {
    temperature: 21,
    condition: 'rain',
  },
  hourly,
  alerts: [
    {
      event: 'Flood Watch',
      description: 'Flooding is possible.',
      start: '2026-07-07T14:00:00.000Z',
      end: '2026-07-07T18:00:00.000Z',
      severity: 'medium',
    },
  ],
}

test('validates the canonical latest-weather success envelope and freshness union', () => {
  expect(weatherSnapshotSchema.parse(snapshot).hourly).toHaveLength(48)

  expect(
    latestWeatherResponseSchema.parse({
      data: {
        status: 'fresh',
        weather: snapshot,
      },
    })
  ).toEqual({
    data: {
      status: 'fresh',
      weather: snapshot,
    },
  })

  expect(
    latestWeatherResponseSchema.parse({
      data: {
        status: 'stale',
        weather: snapshot,
        message: 'Weather data is delayed. Check again shortly.',
      },
    })
  ).toMatchObject({
    data: {
      status: 'stale',
      message: 'Weather data is delayed. Check again shortly.',
    },
  })

  expect(
    latestWeatherResponseSchema.parse({
      data: {
        status: 'unavailable',
        weather: null,
        message: 'Weather data is temporarily unavailable.',
      },
    })
  ).toEqual({
    data: {
      status: 'unavailable',
      weather: null,
      message: 'Weather data is temporarily unavailable.',
    },
  })
})

test('registers the authenticated latest-weather route in the canonical OpenAPI document', () => {
  const spec = generateHttpOpenApiDocument()
  const operation = spec.paths?.['/api/v1/weather/{locationKey}']?.get

  expect(operation).toBeDefined()
  expect(operation?.tags).toEqual(['weather'])
  expect(operation?.parameters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'locationKey',
        in: 'path',
        required: true,
      }),
    ])
  )
  expect(operation?.responses?.['200']).toBeDefined()
  expect(operation?.responses?.['401']).toBeDefined()
  expect(operation?.security).toEqual([{ bearerAuth: [] }])
  expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({
    type: 'http',
    scheme: 'bearer',
  })
  const responseSchema = spec.components?.schemas?.LatestWeatherResponse as
    | {
        properties?: {
          data?: {
            oneOf?: {
              properties?: {
                weather?: {
                  properties?: {
                    hourly?: { minItems?: number; maxItems?: number }
                  }
                }
              }
            }[]
          }
        }
      }
    | undefined
  const hourlySchema =
    responseSchema?.properties?.data?.oneOf?.[0]?.properties?.weather?.properties?.hourly

  expect(hourlySchema).toMatchObject({ minItems: 48, maxItems: 48 })
})
