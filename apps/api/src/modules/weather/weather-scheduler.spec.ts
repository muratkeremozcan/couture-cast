import { describe, expect, it, vi } from 'vitest'

import { registerWeatherRefreshScheduler } from './weather-scheduler.js'

describe('registerWeatherRefreshScheduler', () => {
  it('upserts weather refresh and durable alert outbox schedulers', async () => {
    const queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue({ id: 'scheduled-job' }),
    }

    await registerWeatherRefreshScheduler(queue as never, { refreshMinutes: 15 })

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'weather-refresh-sweep',
      { every: 15 * 60 * 1000 },
      {
        name: 'weather-refresh-sweep',
        data: { type: 'sweep' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      }
    )
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'weather-alert-outbox-dispatch',
      { every: 30_000 },
      {
        name: 'weather-alert-outbox-dispatch',
        data: { type: 'alert-outbox' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      }
    )
  })
})
