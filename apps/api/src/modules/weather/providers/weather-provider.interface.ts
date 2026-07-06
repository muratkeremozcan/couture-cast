import type {
  NormalizedWeatherForecast,
  WeatherIngestionTarget,
} from './weather.types.js'

export interface IWeatherProvider {
  fetchForecast(
    target: WeatherIngestionTarget,
    signal: AbortSignal
  ): Promise<NormalizedWeatherForecast>
}
