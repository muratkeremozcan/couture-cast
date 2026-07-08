import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'

export const WEATHER_CACHED_MESSAGE = 'Using recently cached weather data.'
export const WEATHER_STALE_MESSAGE = 'Weather data is delayed. Check again shortly.'
export const WEATHER_UNAVAILABLE_MESSAGE = 'Weather data is temporarily unavailable.'

export const weatherConditionSchema = z.enum([
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
])

export const weatherProviderSchema = z.enum(['openweather', 'weatherapi'])
export const weatherAlertSeveritySchema = z.enum(['low', 'medium', 'high'])

export const latestWeatherPathParamsSchema = z.object({
  locationKey: nonEmptyStringSchema.describe('Canonical weather location key.'),
})

export const weatherCurrentSchema = z.object({
  temperature: z.number().finite(),
  condition: weatherConditionSchema,
})

export const weatherHourlyEntrySchema = z.object({
  forecastAt: isoTimestampSchema,
  temperature: z.number().finite(),
  feelsLike: z.number().finite(),
  precipitationProbability: z.number().finite().min(0).max(1),
  precipitationAmount: z.number().finite().nonnegative(),
  windSpeed: z.number().finite().nonnegative(),
  windGust: z.number().finite().nonnegative().nullable(),
  condition: weatherConditionSchema,
  providerWeatherCode: nonEmptyStringSchema,
})

export const weatherAlertSchema = z.object({
  event: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  start: isoTimestampSchema,
  end: isoTimestampSchema,
  severity: weatherAlertSeveritySchema.optional(),
})

export const weatherSnapshotSchema = z.object({
  locationKey: nonEmptyStringSchema,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  timezone: nonEmptyStringSchema,
  provider: weatherProviderSchema,
  providerUpdatedAt: isoTimestampSchema,
  fetchedAt: isoTimestampSchema,
  current: weatherCurrentSchema,
  hourly: z
    .array(weatherHourlyEntrySchema)
    .length(48)
    .openapi({ minItems: 48, maxItems: 48 }),
  alerts: z.array(weatherAlertSchema),
})

export const freshWeatherDataSchema = z.object({
  status: z.literal('fresh'),
  weather: weatherSnapshotSchema,
})

export const cachedWeatherDataSchema = z.object({
  status: z.literal('cached'),
  weather: weatherSnapshotSchema,
  message: z.literal(WEATHER_CACHED_MESSAGE),
})

export const staleWeatherDataSchema = z.object({
  status: z.literal('stale'),
  weather: weatherSnapshotSchema,
  message: z.literal(WEATHER_STALE_MESSAGE),
})

export const unavailableWeatherDataSchema = z.object({
  status: z.literal('unavailable'),
  weather: z.null(),
  message: z.literal(WEATHER_UNAVAILABLE_MESSAGE),
})

export const latestWeatherDataSchema = z.discriminatedUnion('status', [
  freshWeatherDataSchema,
  cachedWeatherDataSchema,
  staleWeatherDataSchema,
  unavailableWeatherDataSchema,
])

export const latestWeatherResponseSchema = z.object({
  data: latestWeatherDataSchema,
})

export type WeatherCondition = z.infer<typeof weatherConditionSchema>
export type WeatherProvider = z.infer<typeof weatherProviderSchema>
export type WeatherAlertSeverity = z.infer<typeof weatherAlertSeveritySchema>
export type LatestWeatherPathParams = z.infer<typeof latestWeatherPathParamsSchema>
export type WeatherCurrent = z.infer<typeof weatherCurrentSchema>
export type WeatherHourlyEntry = z.infer<typeof weatherHourlyEntrySchema>
export type WeatherAlert = z.infer<typeof weatherAlertSchema>
export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>
export type LatestWeatherData = z.infer<typeof latestWeatherDataSchema>
export type LatestWeatherResponse = z.infer<typeof latestWeatherResponseSchema>

export function registerWeatherContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })
  const registeredLatestWeatherPathParamsSchema = registry.register(
    'LatestWeatherPathParams',
    latestWeatherPathParamsSchema
  )
  registry.register('WeatherCondition', weatherConditionSchema)
  registry.register('WeatherProvider', weatherProviderSchema)
  registry.register('WeatherCurrent', weatherCurrentSchema)
  registry.register('WeatherHourlyEntry', weatherHourlyEntrySchema)
  registry.register('WeatherAlert', weatherAlertSchema)
  registry.register('WeatherSnapshot', weatherSnapshotSchema)
  const registeredLatestWeatherResponseSchema = registry.register(
    'LatestWeatherResponse',
    latestWeatherResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/weather/{locationKey}',
    tags: ['weather'],
    summary: 'Get latest weather for a canonical location',
    description:
      'Returns the latest normalized weather snapshot and freshness outcome for an authenticated request.',
    security: [{ bearerAuth: [] }],
    request: {
      params: registeredLatestWeatherPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Latest weather freshness result returned successfully',
        content: {
          'application/json': {
            schema: registeredLatestWeatherResponseSchema,
          },
        },
      },
      400: {
        description: 'Weather location key failed validation',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })
}
