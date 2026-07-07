import type { WeatherIngestionTarget } from './providers/weather.types.js'
import { loadWeatherConfig } from './providers/weather.config.js'

export interface WeatherTargetSource {
  getTargets(): Promise<WeatherIngestionTarget[]>
}

export class ConfiguredWeatherTargetSource implements WeatherTargetSource {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  getTargets(): Promise<WeatherIngestionTarget[]> {
    return Promise.resolve().then(() => loadWeatherConfig(this.env).ingestionTargets)
  }
}
