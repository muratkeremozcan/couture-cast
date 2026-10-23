export * from './lib/weather-provider-double-data.mjs'

export interface WeatherProviderDouble {
  origin: string
  port: number
  stats: { geocoding: number; forecast: number }
  close(): Promise<void>
}

export declare function startWeatherProviderDouble(options?: {
  port?: number
  now?: () => number
}): Promise<WeatherProviderDouble>
