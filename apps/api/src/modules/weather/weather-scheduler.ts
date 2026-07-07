import type { Queue } from 'bullmq'

export const WEATHER_SWEEP_JOB_NAME = 'weather-refresh-sweep'
export const WEATHER_LOCATION_JOB_NAME = 'weather-refresh-location'

type WeatherSchedulerQueue = Pick<Queue, 'upsertJobScheduler'>

export interface WeatherSchedulerConfig {
  refreshMinutes: number
}

export async function registerWeatherRefreshScheduler(
  queue: WeatherSchedulerQueue,
  config: WeatherSchedulerConfig
): Promise<void> {
  await queue.upsertJobScheduler(
    WEATHER_SWEEP_JOB_NAME,
    { every: config.refreshMinutes * 60 * 1000 },
    {
      name: WEATHER_SWEEP_JOB_NAME,
      data: { type: 'sweep' },
      opts: {
        attempts: 1,
      },
    }
  )
}
