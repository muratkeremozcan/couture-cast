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
  latitude: LatitudeSchema,
  longitude: LongitudeSchema,
})

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

export const OpenWeatherResponseSchema = z.object({
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  timezone: IanaTimeZoneSchema,
  current: OpenWeatherCurrentSchema,
  hourly: z.array(OpenWeatherHourlySchema),
  alerts: z.array(OpenWeatherAlertSchema).optional().nullable(),
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

export const WeatherApiForecastDaySchema = z.object({
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
    latitude: LatitudeSchema,
    longitude: LongitudeSchema,
    timezone: IanaTimeZoneSchema,
    providerUpdatedAt: z.date(),
    fetchedAt: z.date(),
    current: NormalizedCurrentWeatherSchema,
    hourly: z.array(NormalizedHourlyWeatherEntrySchema).length(48),
    alerts: z.array(NormalizedWeatherAlertSchema),
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
