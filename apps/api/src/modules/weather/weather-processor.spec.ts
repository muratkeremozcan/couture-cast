import { describe, expect, it, vi } from 'vitest'

import {
  createWeatherJobProcessor,
  createWeatherLocationJobId,
} from './weather-processor.js'

const target = {
  locationKey: 'new-york-ny',
  latitude: 40.7128,
  longitude: -74.006,
}

describe('weather processor', () => {
  it('creates stable interval-bucketed location job IDs', () => {
    expect(
      createWeatherLocationJobId('new-york-ny', new Date('2026-07-06T13:44:00.000Z'), 30)
    ).toBe('weather-refresh-location:new-york-ny:2026-07-06T13:30:00.000Z')
  })

  it('coalesces duplicate targets and enqueues one attempts-1 location job per key', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({ id: 'location-job' }),
    }
    const targetSource = {
      getTargets: vi
        .fn()
        .mockResolvedValue([
          target,
          { ...target, latitude: 41 },
          { locationKey: 'chicago-il', latitude: 41.8781, longitude: -87.6298 },
        ]),
    }
    const ingestionService = {
      ingestTarget: vi.fn(),
    }
    const processor = createWeatherJobProcessor({
      queue: queue as never,
      targetSource,
      ingestionService: ingestionService as never,
      refreshMinutes: 30,
      clock: { now: () => new Date('2026-07-06T13:44:00.000Z') },
    })

    await processor({ name: 'weather-refresh-sweep', data: { type: 'sweep' } } as never)

    expect(queue.add).toHaveBeenCalledTimes(2)
    expect(queue.add).toHaveBeenCalledWith(
      'weather-refresh-location',
      { type: 'location', target },
      expect.objectContaining({
        attempts: 1,
        jobId: 'weather-refresh-location:new-york-ny:2026-07-06T13:30:00.000Z',
      })
    )
    expect(ingestionService.ingestTarget).not.toHaveBeenCalled()
  })

  it('processes location jobs through the ingestion service', async () => {
    const ingestionService = {
      ingestTarget: vi.fn().mockResolvedValue({ outcome: 'persisted' }),
    }
    const processor = createWeatherJobProcessor({
      queue: { add: vi.fn() } as never,
      targetSource: { getTargets: vi.fn() },
      ingestionService: ingestionService as never,
      refreshMinutes: 30,
    })

    await processor({
      name: 'weather-refresh-location',
      data: { type: 'location', target },
    } as never)

    expect(ingestionService.ingestTarget).toHaveBeenCalledWith(target)
  })
})
