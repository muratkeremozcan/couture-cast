import { Injectable } from '@nestjs/common'

import {
  WeatherRepository,
  type WeatherSnapshotWithSegments,
} from './weather.repository.js'

export const WEATHER_STALE_MESSAGE = 'Weather data is delayed. Check again shortly.'
export const WEATHER_UNAVAILABLE_MESSAGE = 'Weather data is temporarily unavailable.'
export const WEATHER_CACHED_MESSAGE = 'Using recently cached weather data.'

const STALE_AFTER_MS = 60 * 60 * 1000

export interface WeatherClock {
  now(): Date
}

export const systemWeatherClock: WeatherClock = {
  now: () => new Date(),
}

export type LatestWeatherResult =
  | {
      status: 'fresh'
      data: WeatherSnapshotWithSegments
      message?: undefined
    }
  | {
      status: 'cached'
      data: WeatherSnapshotWithSegments
      message: typeof WEATHER_CACHED_MESSAGE
    }
  | {
      status: 'stale'
      data: WeatherSnapshotWithSegments
      message: typeof WEATHER_STALE_MESSAGE
    }
  | {
      status: 'unavailable'
      data: null
      message: typeof WEATHER_UNAVAILABLE_MESSAGE
    }

export interface LatestWeatherOptions {
  liveProviderFailed?: boolean
}

function hasUnrecoveredProviderFailure(input: {
  failureAt: Date | null | undefined
  successAt: Date | null | undefined
  snapshotFetchedAt: Date
}): boolean {
  if (!input.failureAt) {
    return false
  }

  const failureTime = input.failureAt.getTime()
  const successTime = input.successAt?.getTime() ?? Number.NEGATIVE_INFINITY

  return failureTime > successTime && failureTime >= input.snapshotFetchedAt.getTime()
}

@Injectable()
export class WeatherQueryService {
  constructor(
    private readonly repository: WeatherRepository,
    private readonly clock: WeatherClock = systemWeatherClock
  ) {}

  async getLatestWeather(
    locationKey: string,
    options: LatestWeatherOptions = {}
  ): Promise<LatestWeatherResult> {
    const snapshot = await this.repository.findLatestByLocationKey(locationKey)

    if (!snapshot) {
      return {
        status: 'unavailable',
        data: null,
        message: WEATHER_UNAVAILABLE_MESSAGE,
      }
    }

    const ageMs = this.clock.now().getTime() - snapshot.fetched_at.getTime()

    if (ageMs > STALE_AFTER_MS) {
      return {
        status: 'stale',
        data: snapshot,
        message: WEATHER_STALE_MESSAGE,
      }
    }

    const ingestionState = await this.repository.findIngestionState(locationKey)
    const liveProviderFailed =
      options.liveProviderFailed ||
      hasUnrecoveredProviderFailure({
        failureAt: ingestionState?.last_provider_failure_at,
        successAt: ingestionState?.last_provider_success_at,
        snapshotFetchedAt: snapshot.fetched_at,
      })

    if (liveProviderFailed) {
      return {
        status: 'cached',
        data: snapshot,
        message: WEATHER_CACHED_MESSAGE,
      }
    }

    return {
      status: 'fresh',
      data: snapshot,
    }
  }
}
