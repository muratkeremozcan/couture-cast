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
}
