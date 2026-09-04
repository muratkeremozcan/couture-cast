import { z } from 'zod'
import { WEATHER_CONDITIONS } from './weather.types.js'

const NonEmptyStringSchema = z.string().trim().min(1)
const EpochSecondsSchema = z.number().int().nonnegative()
const TemperatureSchema = z.number().finite()
const WindSpeedSchema = z.number().finite().nonnegative()
const HumiditySchema = z.number().finite().min(0).max(100)
const LatitudeSchema = z.number().finite().min(-90).max(90)
const LongitudeSchema = z.number().finite().min(-180).max(180)
const IanaTimeZoneSchema = NonEmptyStringSchema.refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format()
      return true
    } catch {
      return false
    }
  },
  { message: 'Invalid IANA timezone' }
)

export const WeatherIngestionTargetSchema = z.object({
  locationKey: NonEmptyStringSchema,
  locationName: NonEmptyStringSchema.optional(),
  latitude: LatitudeSchema,
  longitude: LongitudeSchema,
})

export const ConfiguredWeatherIngestionTargetSchema = WeatherIngestionTargetSchema.extend(
  {
    locationName: NonEmptyStringSchema,
  }
)

const OpenWeatherConditionSchema = z.object({
  description: NonEmptyStringSchema,
  id: z.number().int().nonnegative(),
  main: NonEmptyStringSchema.optional(),
})

export const OpenWeatherCurrentSchema = z.object({
  dt: EpochSecondsSchema,
  temp: TemperatureSchema,
  feels_like: TemperatureSchema,
  humidity: HumiditySchema,
  wind_speed: WindSpeedSchema,
  weather: z.array(OpenWeatherConditionSchema).min(1),
})

export const OpenWeatherHourlySchema = z.object({
  dt: EpochSecondsSchema,
  temp: TemperatureSchema,
  feels_like: TemperatureSchema,
  pop: z.number().finite().min(0).max(1),
  rain: z
    .object({ '1h': z.number().finite().nonnegative().optional() })
    .optional()
    .nullable(),
  snow: z
    .object({ '1h': z.number().finite().nonnegative().optional() })
    .optional()
    .nullable(),
  wind_speed: WindSpeedSchema,
  wind_gust: WindSpeedSchema.optional().nullable(),
  weather: z.array(OpenWeatherConditionSchema).min(1),
})

export const OpenWeatherAlertSchema = z.object({
  event: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  start: EpochSecondsSchema,
  end: EpochSecondsSchema,
})

// Story 5.5 Decision 3: One Call 3.0's `daily` block, requested by removing
// `daily` from the `exclude` param. `temp` carries min/max; `feels_like` only
// carries day/night/eve/morn (OpenWeather never ships a feels-like min/max),
// so the provider derives min/max from those four values.
export const OpenWeatherDailyTemperatureSchema = z.object({
  min: TemperatureSchema,
  max: TemperatureSchema,
})

export const OpenWeatherDailyFeelsLikeSchema = z.object({
  day: TemperatureSchema,
  night: TemperatureSchema,
  eve: TemperatureSchema,
  morn: TemperatureSchema,
})

export const OpenWeatherDailySchema = z.object({
  dt: EpochSecondsSchema,
  temp: OpenWeatherDailyTemperatureSchema,
  feels_like: OpenWeatherDailyFeelsLikeSchema,
  pop: z.number().finite().min(0).max(1),
  rain: z.number().finite().nonnegative().optional(),
  snow: z.number().finite().nonnegative().optional(),
  wind_speed: WindSpeedSchema,
  weather: z.array(OpenWeatherConditionSchema).min(1),
})

export const OpenWeatherResponseSchema = z.object({
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  timezone: IanaTimeZoneSchema,
  current: OpenWeatherCurrentSchema,
  hourly: z.array(OpenWeatherHourlySchema),
  alerts: z.array(OpenWeatherAlertSchema).optional().nullable(),
  // Story 5.5 Decision 3: loosely typed (`unknown`) at this container level
  // on purpose. Each entry is independently validated against
  // `OpenWeatherDailySchema` in the provider, so one malformed day is
  // dropped rather than rejecting the whole response -- hourly weather must
  // never go down because of a bad daily entry.
  daily: z.array(z.unknown()).max(8).optional().nullable(),
})

export const WeatherApiConditionSchema = z.object({
  text: NonEmptyStringSchema,
  code: z.number().int().nonnegative(),
})

export const WeatherApiCurrentSchema = z.object({
  last_updated_epoch: EpochSecondsSchema,
  temp_c: TemperatureSchema,
  feelslike_c: TemperatureSchema,
  humidity: HumiditySchema,
  wind_kph: WindSpeedSchema,
  condition: WeatherApiConditionSchema,
})

export const WeatherApiHourSchema = z.object({
  time_epoch: EpochSecondsSchema,
  temp_c: TemperatureSchema,
  feelslike_c: TemperatureSchema,
  chance_of_rain: z.number().finite().min(0).max(100),
  chance_of_snow: z.number().finite().min(0).max(100),
  precip_mm: z.number().finite().nonnegative(),
  wind_kph: WindSpeedSchema,
  gust_kph: WindSpeedSchema.optional().nullable(),
  condition: WeatherApiConditionSchema,
})

// Story 5.5 Decision 3: `date` and `day` are validated independently by the
// provider (via `WeatherApiDaySummarySchema.safeParse`), never as part of
// this container schema, so a malformed daily aggregate is dropped rather
// than rejecting the whole forecast (the hourly array, extracted from
// `hour` alone, is unaffected either way).
export const WeatherApiDaySummarySchema = z.object({
  maxtemp_c: TemperatureSchema,
  mintemp_c: TemperatureSchema,
  maxwind_kph: WindSpeedSchema,
  totalprecip_mm: z.number().finite().nonnegative(),
  daily_chance_of_rain: z.number().finite().min(0).max(100).optional(),
  daily_chance_of_snow: z.number().finite().min(0).max(100).optional(),
  condition: WeatherApiConditionSchema,
})

export const WeatherApiForecastDaySchema = z.object({
  date: z.unknown().optional(),
  day: z.unknown().optional(),
  hour: z.array(WeatherApiHourSchema),
})

const AbsoluteDateTimeSchema = z.string().datetime({ offset: true })

export const WeatherApiAlertItemSchema = z.object({
  event: NonEmptyStringSchema,
  desc: NonEmptyStringSchema,
  effective: AbsoluteDateTimeSchema,
  expires: AbsoluteDateTimeSchema,
  severity: NonEmptyStringSchema.optional(),
})

export const WeatherApiResponseSchema = z.object({
  location: z.object({
    lat: LatitudeSchema,
    lon: LongitudeSchema,
    tz_id: IanaTimeZoneSchema,
  }),
  current: WeatherApiCurrentSchema,
  forecast: z.object({
    forecastday: z.array(WeatherApiForecastDaySchema),
  }),
  alerts: z
    .object({
      alert: z.array(WeatherApiAlertItemSchema).optional().nullable(),
    })
    .optional()
    .nullable(),
})

export const WeatherConditionSchema = z.enum(WEATHER_CONDITIONS)

const NormalizedConditionSchema = z.object({
  condition: WeatherConditionSchema,
  providerConditionText: NonEmptyStringSchema,
  providerWeatherCode: NonEmptyStringSchema,
})

export const NormalizedCurrentWeatherSchema = NormalizedConditionSchema.extend({
  temperature: TemperatureSchema,
  feelsLike: TemperatureSchema,
  windSpeed: WindSpeedSchema,
  humidity: HumiditySchema,
})

export const NormalizedHourlyWeatherEntrySchema = NormalizedConditionSchema.extend({
  forecastAt: z.date(),
  temperature: TemperatureSchema,
  feelsLike: TemperatureSchema,
  precipitationProbability: z.number().finite().min(0).max(1),
  precipitationAmount: z.number().finite().nonnegative(),
  windSpeed: WindSpeedSchema,
  windGust: WindSpeedSchema,
})

// Story 5.5 Decision 3: validated `YYYY-MM-DD`, checked for real calendar
// validity (not just the digit shape) so a malformed provider date can never
// silently become the wrong planner day.
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid local date')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const parsed = new Date(Date.UTC(year!, month! - 1, day))
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === day
    )
  }, 'Invalid calendar date')

export const NormalizedDailyWeatherEntrySchema = z.object({
  localDate: LocalDateSchema,
  condition: WeatherConditionSchema,
  temperatureMin: TemperatureSchema,
  temperatureMax: TemperatureSchema,
  feelsLikeMin: TemperatureSchema.optional(),
  feelsLikeMax: TemperatureSchema.optional(),
  precipitationProbability: z.number().finite().min(0).max(1),
  precipitationAmount: z.number().finite().nonnegative(),
  windSpeed: WindSpeedSchema,
})

export const NormalizedWeatherAlertSchema = z
  .object({
    event: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    start: z.date(),
    end: z.date(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
  })
  .refine((alert) => alert.end.getTime() > alert.start.getTime(), {
    message: 'Alert end must follow its start',
    path: ['end'],
  })

export const NormalizedWeatherForecastSchema = z
  .object({
    provider: z.enum(['openweather', 'weatherapi']),
    locationKey: NonEmptyStringSchema,
    locationName: NonEmptyStringSchema.optional(),
    latitude: LatitudeSchema,
    longitude: LongitudeSchema,
    timezone: IanaTimeZoneSchema,
    providerUpdatedAt: z.date(),
    fetchedAt: z.date(),
    current: NormalizedCurrentWeatherSchema,
    hourly: z.array(NormalizedHourlyWeatherEntrySchema).length(48),
    alerts: z.array(NormalizedWeatherAlertSchema),
    // Story 5.5 Decision 3: additive and optional. Existing hourly-only
    // callers never see this field and keep working unchanged.
    daily: z.array(NormalizedDailyWeatherEntrySchema).max(8).optional(),
  })
  .superRefine((forecast, context) => {
    const providerUpdateAge =
      forecast.fetchedAt.getTime() - forecast.providerUpdatedAt.getTime()
    if (providerUpdateAge < -300000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provider update time exceeds allowed clock skew',
        path: ['providerUpdatedAt'],
      })
    }

    const firstHour = forecast.hourly[0]
    const fetchedHourStart = Math.floor(forecast.fetchedAt.getTime() / 3600000) * 3600000
    if (
      firstHour &&
      (firstHour.forecastAt.getTime() < fetchedHourStart ||
        firstHour.forecastAt.getTime() > fetchedHourStart + 3600000)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Hourly forecast must begin with the current or next hour',
        path: ['hourly', 0, 'forecastAt'],
      })
    }

    forecast.hourly.slice(1).forEach((hour, index) => {
      const previousHour = forecast.hourly[index]
      if (
        previousHour &&
        hour.forecastAt.getTime() - previousHour.forecastAt.getTime() !== 3600000
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Hourly forecast timestamps must be unique and contiguous',
          path: ['hourly', index + 1, 'forecastAt'],
        })
      }
    })
  })
