export * from './lib/weather-provider-double-data.mjs'

export declare const DOUBLE_REQUEST_LOG_LIMIT: number

export interface WeatherProviderDoubleGeocodingRequest {
  seq: number
  provider: 'openweather' | 'weatherapi'
  query: string
}

export interface WeatherProviderDoubleForecastRequest {
  seq: number
  provider: 'openweather' | 'weatherapi'
  latitude: number
  longitude: number
}

export interface WeatherProviderDouble {
  origin: string
  port: number
  stats: { geocoding: number; forecast: number }
  requests: {
    geocoding: WeatherProviderDoubleGeocodingRequest[]
    forecast: WeatherProviderDoubleForecastRequest[]
  }
  close(): Promise<void>
}

export declare function startWeatherProviderDouble(options?: {
  port?: number
  now?: () => number
  /** Hours after the request hour to degrees Celsius; the default curve drifts with the clock. */
  temperatureAt?: (hourIndex: number) => number
}): Promise<WeatherProviderDouble>
