import { createBaseLogger } from '../../logger/pino.config.js'
import type { PrismaClient } from '@prisma/client'
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

export class CombinedWeatherTargetSource implements WeatherTargetSource {
  constructor(private readonly sources: WeatherTargetSource[]) {}

  async getTargets(): Promise<WeatherIngestionTarget[]> {
    const targetsByLocationKey = new Map<string, WeatherIngestionTarget>()

    for (const source of this.sources) {
      try {
        const targets = await source.getTargets()

        for (const target of targets) {
          if (!targetsByLocationKey.has(target.locationKey)) {
            targetsByLocationKey.set(target.locationKey, target)
          }
        }
      } catch (error) {
        const logger = createBaseLogger('weather-target-source')
        logger.error(
          error,
          `Failed to get weather targets from source ${source.constructor.name}`
        )
      }
    }

    return [...targetsByLocationKey.values()]
  }
}

export class SavedLocationWeatherTargetSource implements WeatherTargetSource {
  constructor(private readonly prisma: Pick<PrismaClient, 'savedLocation'>) {}

  async getTargets(): Promise<WeatherIngestionTarget[]> {
    const primaryLocations = await this.prisma.savedLocation.findMany({
      where: { is_primary: true },
      orderBy: [{ location_key: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: 5000,
      select: {
        location_key: true,
        city: true,
        label: true,
        latitude: true,
        longitude: true,
      },
    })
    const targetsByLocationKey = new Map<string, WeatherIngestionTarget>()
    const cityByLocationKey = new Map<string, string>()

    for (const location of primaryLocations) {
      const city = location.city?.trim()
      if (city && !cityByLocationKey.has(location.location_key)) {
        cityByLocationKey.set(location.location_key, city)
      }
    }

    for (const location of primaryLocations) {
      if (!targetsByLocationKey.has(location.location_key)) {
        targetsByLocationKey.set(location.location_key, {
          locationKey: location.location_key,
          locationName:
            cityByLocationKey.get(location.location_key) ?? location.label.trim(),
          latitude: location.latitude,
          longitude: location.longitude,
        })
      }
    }

    return [...targetsByLocationKey.values()]
  }
}
