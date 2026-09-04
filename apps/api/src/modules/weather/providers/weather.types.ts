export interface WeatherIngestionTarget {
  locationKey: string
  locationName?: string
  latitude: number
  longitude: number
}

export const WEATHER_CONDITIONS = [
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
] as const

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number]
export type WeatherProviderName = 'openweather' | 'weatherapi'
export type WeatherAlertSeverity = 'low' | 'medium' | 'high'

export interface NormalizedCondition {
  condition: WeatherCondition
  providerConditionText: string
  providerWeatherCode: string
}

export interface NormalizedCurrentWeather extends NormalizedCondition {
  temperature: number
  feelsLike: number
  windSpeed: number
  humidity: number
}

export interface NormalizedHourlyWeatherEntry extends NormalizedCondition {
  forecastAt: Date
  temperature: number
  feelsLike: number
  precipitationProbability: number // 0 to 1
  precipitationAmount: number // in mm
  windSpeed: number
  windGust: number
}

export interface NormalizedWeatherAlert {
  event: string
  description: string
  start: Date
  end: Date
  severity?: WeatherAlertSeverity
}

// Story 5.5 Decision 3: a daily projection alongside the existing 48-hour
// contiguous hourly forecast. `localDate` is a validated `YYYY-MM-DD` string,
// never a `Date`, so it round-trips through JSON storage (WeatherSnapshot's
// `daily_summaries` column) without a timezone-conversion hazard.
export interface NormalizedDailyWeatherEntry {
  localDate: string
  condition: WeatherCondition
  temperatureMin: number
  temperatureMax: number
  feelsLikeMin?: number
  feelsLikeMax?: number
  precipitationProbability: number // 0 to 1
  precipitationAmount: number // in mm
  windSpeed: number
}

export interface NormalizedWeatherForecast {
  provider: WeatherProviderName
  locationKey: string
  locationName?: string
  latitude: number
  longitude: number
  timezone: string
  providerUpdatedAt: Date
  fetchedAt: Date
  current: NormalizedCurrentWeather
  hourly: NormalizedHourlyWeatherEntry[]
  alerts: NormalizedWeatherAlert[]
  // Story 5.5 Decision 3: optional, at most eight entries. Absent or short
  // when a provider's daily coverage is shallower than the planner's 7-day
  // window; callers must treat missing dates as "unavailable", not an error.
  daily?: NormalizedDailyWeatherEntry[]
}
