import { describe, expect, it, vi } from 'vitest'

import { registerWeatherRefreshScheduler } from './weather-scheduler.js'

describe('registerWeatherRefreshScheduler', () => {
  it('upserts the stable BullMQ scheduler with the configured interval', async () => {
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
          attempts: 1,
        },
      }
    )
  })
})
