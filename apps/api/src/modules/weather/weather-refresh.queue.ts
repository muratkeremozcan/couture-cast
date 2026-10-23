import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common'
import { Queue, type QueueOptions } from 'bullmq'

import { queueConfigs, type QueueConfig } from '../../config/queues.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { loadWeatherConfig } from './providers/weather.config.js'
import type { WeatherIngestionTarget } from './providers/weather.types.js'
import { createWeatherLocationJobId, type WeatherJobData } from './weather-processor.js'
import { WEATHER_LOCATION_JOB_NAME } from './weather-scheduler.js'

const weatherLocationRetryOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
}

/** Tests isolate the queue under their own Redis key prefix. */
export const WEATHER_REFRESH_QUEUE_OPTIONS = Symbol('WEATHER_REFRESH_QUEUE_OPTIONS')

export interface WeatherRefreshPublisher {
  enqueueLocationRefresh(target: WeatherIngestionTarget, now: Date): Promise<void>
}

function refreshMinutes(): number {
  try {
    return loadWeatherConfig().refreshMinutes
  } catch {
    return 5
  }
}

/**
 * Story 1.2b: the HTTP side's producer for the existing
 * `weather-refresh-location` job. It shares the worker's bucketed job id, so a
 * refresh requested here and the next sweep for the same key collapse into one
 * provider call. The queue client opens lazily, so a cold start that never
 * switches a primary location never connects to Redis.
 */
@Injectable()
export class WeatherRefreshQueue implements WeatherRefreshPublisher, OnModuleDestroy {
  private readonly logger = createBaseLogger().child({ feature: 'weather-refresh-queue' })
  private readonly config: QueueConfig
  private readonly refreshMinutes = refreshMinutes()
  private queue: Queue<WeatherJobData> | null = null

  constructor(
    @Optional()
    @Inject(WEATHER_REFRESH_QUEUE_OPTIONS)
    overrides?: Partial<QueueOptions>
  ) {
    const found = queueConfigs.find((config) => config.name === 'weather-ingestion')
    if (!found) {
      throw new Error('weather-ingestion queue configuration is missing')
    }
    this.config = { ...found, options: { ...found.options, ...overrides } }
  }

  private getQueue(): Queue<WeatherJobData> {
    this.queue ??= new Queue<WeatherJobData>(this.config.name, this.config.options)
    return this.queue
  }

  async enqueueLocationRefresh(target: WeatherIngestionTarget, now: Date): Promise<void> {
    await this.getQueue().add(
      WEATHER_LOCATION_JOB_NAME,
      { type: 'location', target },
      {
        ...weatherLocationRetryOptions,
        jobId: createWeatherLocationJobId(target.locationKey, now, this.refreshMinutes),
      }
    )
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close()
      this.queue = null
      this.logger.debug('WeatherRefreshQueue closed')
    }
  }
}
