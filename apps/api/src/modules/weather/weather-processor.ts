import type { Job, JobsOptions, Queue } from 'bullmq'

import type { WeatherIngestionTarget } from './providers/weather.types.js'
import type { WeatherIngestionService } from './weather-ingestion.service.js'
import { WEATHER_LOCATION_JOB_NAME, WEATHER_SWEEP_JOB_NAME } from './weather-scheduler.js'
import type { WeatherTargetSource } from './weather-target-source.js'

type WeatherQueue = Pick<Queue, 'add'>

export type WeatherJobData =
  | { type: 'sweep' }
  | { type: 'location'; target: WeatherIngestionTarget }

export interface WeatherProcessorClock {
  now(): Date
}

export interface WeatherJobProcessorOptions {
  queue: WeatherQueue
  targetSource: WeatherTargetSource
  ingestionService: WeatherIngestionService
  refreshMinutes: number
  clock?: WeatherProcessorClock
}

const systemClock: WeatherProcessorClock = {
  now: () => new Date(),
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
      await options.ingestionService.ingestTarget(job.data.target)
      return
    }

    if (job.name !== WEATHER_SWEEP_JOB_NAME) {
      return
    }

    const jobOptions: JobsOptions = {
      attempts: 1,
    }
    const bucketTime = clock.now()
    const targets = coalesceTargets(await options.targetSource.getTargets())

    await Promise.all(
      targets.map((target) =>
        options.queue.add(
          WEATHER_LOCATION_JOB_NAME,
          { type: 'location', target },
          {
            ...jobOptions,
            jobId: createWeatherLocationJobId(
              target.locationKey,
              bucketTime,
              options.refreshMinutes
            ),
          }
        )
      )
    )
  }
}
