// Story 1.1 Task 1 step 1 owner: define `IWeatherProvider` and normalized weather target/forecast types in `apps/api/src/modules/weather/providers/weather-provider.interface.ts` and `apps/api/src/modules/weather/providers/weather.types.ts`
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
