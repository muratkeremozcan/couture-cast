import type { Job, JobsOptions, Queue } from 'bullmq'

import type { WeatherIngestionTarget } from './providers/weather.types.js'
import type { WeatherIngestionService } from './weather-ingestion.service.js'
import { WEATHER_LOCATION_JOB_NAME, WEATHER_SWEEP_JOB_NAME } from './weather-scheduler.js'
import type { WeatherTargetSource } from './weather-target-source.js'

type WeatherQueue = Pick<Queue, 'add'>

type WeatherProcessorLogger = {
  warn(message: string, values?: Record<string, unknown>): void
}

export type WeatherJobData =
  | { type: 'sweep' }
  | { type: 'location'; target: WeatherIngestionTarget }
  | { type: 'alert-outbox' }

export interface WeatherAlertDispatcher {
  dispatchPending(): Promise<number>
}

export interface WeatherProcessorClock {
  now(): Date
}

export interface WeatherJobProcessorOptions {
  queue: WeatherQueue
  targetSource: WeatherTargetSource
  ingestionService: WeatherIngestionService
  alertDispatcher?: WeatherAlertDispatcher
  refreshMinutes: number
  clock?: WeatherProcessorClock
  logger?: WeatherProcessorLogger
}

const systemClock: WeatherProcessorClock = {
  now: () => new Date(),
}

const weatherLocationRetryOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
}

export function createWeatherLocationJobId(
  locationKey: string,
  date: Date,
  refreshMinutes: number
): string {
  const bucketMs = refreshMinutes * 60 * 1000
  const bucketStart = Math.floor(date.getTime() / bucketMs) * bucketMs
  return `${WEATHER_LOCATION_JOB_NAME}:${locationKey}:${new Date(bucketStart).toISOString()}`
}

function coalesceTargets(
  targets: readonly WeatherIngestionTarget[]
): WeatherIngestionTarget[] {
  const targetsByKey = new Map<string, WeatherIngestionTarget>()

  for (const target of targets) {
    if (!targetsByKey.has(target.locationKey)) {
      targetsByKey.set(target.locationKey, target)
    }
  }

  return [...targetsByKey.values()]
}

export function createWeatherJobProcessor(options: WeatherJobProcessorOptions) {
  const clock = options.clock ?? systemClock

  return async (job: Job<WeatherJobData>): Promise<void> => {
    if (job.data.type === 'location') {
      await options.ingestionService.ingestTarget(
        job.data.target,
        AbortSignal.timeout(30_000)
      )
      return
    }

    if (job.data.type === 'alert-outbox') {
      if (!options.alertDispatcher) {
        throw new Error('Weather alert outbox dispatcher is not configured')
      }
      await options.alertDispatcher.dispatchPending()
      return
    }

    if (job.name !== WEATHER_SWEEP_JOB_NAME) {
      return
    }

    const bucketTime = clock.now()
    const targets = coalesceTargets(await options.targetSource.getTargets())

    const results = await Promise.allSettled(
      targets.map((target) =>
        options.queue.add(
          WEATHER_LOCATION_JOB_NAME,
          { type: 'location', target },
          {
            ...weatherLocationRetryOptions,
            jobId: createWeatherLocationJobId(
              target.locationKey,
              bucketTime,
              options.refreshMinutes
            ),
          }
        )
      )
    )

    const failures = results
      .map((result, index) => ({ result, target: targets[index] }))
      .filter(
        (
          entry
        ): entry is {
          result: PromiseRejectedResult
          target: WeatherIngestionTarget
        } => entry.result.status === 'rejected' && Boolean(entry.target)
      )

    if (failures.length > 0) {
      const failedTargets = failures.map(({ result, target }) => {
        const reason: unknown = result.reason
        const error = reason instanceof Error ? reason.message : 'Unknown error'
        return { locationKey: target.locationKey, error }
      })
      options.logger?.warn('weather sweep failed to enqueue location jobs', {
        failedTargets,
      })
      throw new AggregateError(
        failures.map(({ result }) => {
          const reason: unknown = result.reason
          return reason instanceof Error ? reason : new Error(String(reason))
        }),
        `Failed to enqueue weather location jobs: ${failedTargets
          .map((failure) => failure.locationKey)
          .join(', ')}`
      )
    }
  }
}
