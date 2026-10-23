import { afterEach, describe, expect, it, vi } from 'vitest'

const { queues } = vi.hoisted(() => ({
  queues: [] as {
    name: string
    options: Record<string, unknown>
    add: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }[],
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn(function (this: unknown, name: string, options: Record<string, unknown>) {
    const queue = {
      name,
      options,
      add: vi.fn().mockResolvedValue({ id: 'job' }),
      close: vi.fn().mockResolvedValue(undefined),
    }
    queues.push(queue)
    return queue
  }),
}))

import { createWeatherLocationJobId } from './weather-processor'
import { WeatherRefreshQueue } from './weather-refresh.queue'

const target = { locationKey: 'chicago-il', latitude: 41.878, longitude: -87.63 }
const now = new Date('2026-10-22T12:07:00.000Z')

describe('WeatherRefreshQueue', () => {
  afterEach(() => {
    queues.length = 0
    vi.unstubAllEnvs()
  })

  it('1.2b-UNIT-QUEUE-01 opens no queue until the first refresh and then reuses one', async () => {
    const refresh = new WeatherRefreshQueue({ prefix: 'cc12b-unit' })
    expect(queues).toHaveLength(0)

    await refresh.enqueueLocationRefresh(target, now)
    await refresh.enqueueLocationRefresh(target, now)

    expect(queues).toHaveLength(1)
    expect(queues[0]).toMatchObject({
      name: 'weather-ingestion',
      options: expect.objectContaining({ prefix: 'cc12b-unit' }) as unknown,
    })
    expect(queues[0]!.add).toHaveBeenCalledTimes(2)
  })

  it('1.2b-UNIT-QUEUE-02 enqueues the worker job with its retries and bucketed id', async () => {
    vi.stubEnv('WEATHER_REFRESH_MINUTES', '3')
    const refresh = new WeatherRefreshQueue()

    await refresh.enqueueLocationRefresh(target, now)

    expect(queues[0]!.add).toHaveBeenCalledWith(
      'weather-refresh-location',
      { type: 'location', target },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        jobId: createWeatherLocationJobId('chicago-il', now, 3),
      }
    )
  })

  it('1.2b-UNIT-QUEUE-03 buckets by five minutes when the weather config cannot load', async () => {
    vi.stubEnv('WEATHER_REFRESH_MINUTES', 'not-a-number')
    const refresh = new WeatherRefreshQueue()

    await refresh.enqueueLocationRefresh(target, now)

    // 12:07 falls in the five-minute bucket that starts at 12:05.
    expect(queues[0]!.add.mock.calls[0]?.[2]).toMatchObject({
      jobId: `weather-refresh-location__chicago-il__${Date.parse('2026-10-22T12:05:00.000Z')}`,
    })
  })

  it('1.2b-UNIT-QUEUE-04 closes an opened queue once on shutdown', async () => {
    const idle = new WeatherRefreshQueue()
    await idle.onModuleDestroy()
    expect(queues).toHaveLength(0)

    const refresh = new WeatherRefreshQueue()
    await refresh.enqueueLocationRefresh(target, now)
    await refresh.onModuleDestroy()
    await refresh.onModuleDestroy()

    expect(queues[0]!.close).toHaveBeenCalledTimes(1)
  })
})
