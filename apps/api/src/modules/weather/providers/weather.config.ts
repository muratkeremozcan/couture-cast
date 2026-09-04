import { z } from 'zod'
import { ConfiguredWeatherIngestionTargetSchema } from './weather.schemas.js'

const WeatherProviderModeSchema = z.enum(['openweather', 'weatherapi'])

// Story 5.5 Decision 3: WeatherAPI's `days` param accepts 1-14, gated by the
// provisioned plan. Default `3` matches the depth already proven safe in
// production; deployed environments raise it to `8` (the planner's own cap)
// only after confirming the plan covers that depth.
export const WeatherApiForecastDaysSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(8)
  .default(3)

const WeatherEnvironmentSchema = z.object({
  OPENWEATHER_API_KEY: z.string().trim().min(1).optional(),
  WEATHERAPI_API_KEY: z.string().trim().min(1).optional(),
  WEATHER_REFRESH_MINUTES: z.coerce.number().int().min(1).max(5).default(5),
  WEATHER_PROVIDER_MODE: WeatherProviderModeSchema.default('openweather'),
  WEATHER_INGESTION_TARGETS_JSON: z.string().default('[]'),
  WEATHERAPI_FORECAST_DAYS: WeatherApiForecastDaysSchema,
})

export interface WeatherConfig {
  openWeatherApiKey?: string
  weatherApiKey?: string
  refreshMinutes: number
  providerMode: z.infer<typeof WeatherProviderModeSchema>
  ingestionTargets: z.infer<typeof ConfiguredWeatherIngestionTargetSchema>[]
  weatherApiForecastDays: number
}

export class WeatherConfigError extends Error {
  constructor(fields: string[]) {
    super(`Invalid weather configuration: ${fields.join(', ')}`)
    this.name = 'WeatherConfigError'
  }
}

function parseTargets(rawTargets: string): unknown {
  if (!rawTargets.trim()) {
    return []
  }
  try {
    return JSON.parse(rawTargets) as unknown
  } catch {
    throw new WeatherConfigError(['WEATHER_INGESTION_TARGETS_JSON'])
  }
}

export function loadWeatherConfig(env: NodeJS.ProcessEnv = process.env): WeatherConfig {
  const environmentResult = WeatherEnvironmentSchema.safeParse(env)
  if (!environmentResult.success) {
    const fields = [
      ...new Set(environmentResult.error.issues.map((issue) => String(issue.path[0]))),
    ]
    throw new WeatherConfigError(fields)
  }

  const targetResult = z
    .array(ConfiguredWeatherIngestionTargetSchema)
    .superRefine((targets, context) => {
      const locationKeys = new Set<string>()
      targets.forEach((target, index) => {
        if (locationKeys.has(target.locationKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Duplicate location key',
            path: [index, 'locationKey'],
          })
        }
        locationKeys.add(target.locationKey)
      })
    })
    .safeParse(parseTargets(environmentResult.data.WEATHER_INGESTION_TARGETS_JSON))

  if (!targetResult.success) {
    throw new WeatherConfigError(['WEATHER_INGESTION_TARGETS_JSON'])
  }

  return {
    openWeatherApiKey: environmentResult.data.OPENWEATHER_API_KEY,
    weatherApiKey: environmentResult.data.WEATHERAPI_API_KEY,
    refreshMinutes: environmentResult.data.WEATHER_REFRESH_MINUTES,
    providerMode: environmentResult.data.WEATHER_PROVIDER_MODE,
    ingestionTargets: targetResult.data,
    weatherApiForecastDays: environmentResult.data.WEATHERAPI_FORECAST_DAYS,
  }
}
