import type { Queue } from 'bullmq'

export const WEATHER_SWEEP_JOB_NAME = 'weather-refresh-sweep'
export const WEATHER_LOCATION_JOB_NAME = 'weather-refresh-location'
export const WEATHER_ALERT_OUTBOX_JOB_NAME = 'weather-alert-outbox-dispatch'

type WeatherSchedulerQueue = Pick<Queue, 'upsertJobScheduler'>

export interface WeatherSchedulerConfig {
  refreshMinutes: number
}

export async function registerWeatherRefreshScheduler(
  queue: WeatherSchedulerQueue,
  config: WeatherSchedulerConfig
): Promise<void> {
  await Promise.all([
    queue.upsertJobScheduler(
      WEATHER_SWEEP_JOB_NAME,
      { every: config.refreshMinutes * 60 * 1000 },
      {
        name: WEATHER_SWEEP_JOB_NAME,
        data: { type: 'sweep' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      }
    ),
    queue.upsertJobScheduler(
      WEATHER_ALERT_OUTBOX_JOB_NAME,
      { every: 30_000 },
      {
        name: WEATHER_ALERT_OUTBOX_JOB_NAME,
        data: { type: 'alert-outbox' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      }
    ),
  ])
}
