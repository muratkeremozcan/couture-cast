import { describe, expect, it, vi } from 'vitest'

import type { WeatherAlertEventInput } from './weather-alert-processing.repository.js'
import {
  ALERT_FANOUT_JOB_NAME,
  WeatherAlertFanoutQueue,
} from './weather-alert-fanout.queue.js'
import { WeatherAlertProcessingService } from './weather-alert-processing.service.js'

function buildEvent(id: string): WeatherAlertEventInput {
  return {
    id,
    channel: 'alert:weather',
    userId: 'user-1',
    createdAt: new Date('2026-07-13T14:30:00.000Z'),
    payload: {
      version: '1',
      timestamp: '2026-07-13T14:30:00.000Z',
      userId: 'user-1',
      data: {
        alertType: 'temperature',
        location: 'New York',
        message: 'Temperature will rise.',
        severity: 'warning',
      },
    },
  }
}

describe('WeatherAlertFanoutQueue', () => {
  it('enqueues one deterministic job per persisted alert event', async () => {
    const queue = { addBulk: vi.fn().mockResolvedValue([]) }
    const publisher = new WeatherAlertFanoutQueue(queue as never)
    const events = [buildEvent('weather-alert-a'), buildEvent('weather-alert-b')]

    await publisher.enqueue(events)

    expect(queue.addBulk).toHaveBeenCalledWith([
      {
        name: ALERT_FANOUT_JOB_NAME,
        data: { eventId: 'weather-alert-a' },
        opts: {
          jobId: 'weather-alert-a',
          removeOnComplete: { age: 7 * 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      },
      {
        name: ALERT_FANOUT_JOB_NAME,
        data: { eventId: 'weather-alert-b' },
        opts: {
          jobId: 'weather-alert-b',
          removeOnComplete: { age: 7 * 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      },
    ])
  })

  it('does not call BullMQ for an empty event list', async () => {
    const queue = { addBulk: vi.fn().mockResolvedValue([]) }
    const publisher = new WeatherAlertFanoutQueue(queue as never)

    await publisher.enqueue([])

    expect(queue.addBulk).not.toHaveBeenCalled()
  })

  it('deduplicates a retry after dispatch marking fails and 100 jobs complete', async () => {
    const acceptedJobIds: string[] = []
    const completedJobs = new Set<string>()
    const countRetainedJobIds: string[] = []
    const queue = {
      addBulk: vi.fn().mockImplementation(
        (
          jobs: {
            opts: {
              jobId?: string
              removeOnComplete?: boolean | number | { age?: number; count?: number }
            }
          }[]
        ) => {
          for (const job of jobs) {
            const jobId = job.opts.jobId
            if (!jobId || completedJobs.has(jobId)) {
              continue
            }

            completedJobs.add(jobId)
            acceptedJobIds.push(jobId)
            const retention = job.opts.removeOnComplete
            if (typeof retention !== 'object' || retention.age === undefined) {
              countRetainedJobIds.push(jobId)
              if (countRetainedJobIds.length > 100) {
                completedJobs.delete(countRetainedJobIds.shift()!)
              }
            }
          }
          return Promise.resolve([])
        }
      ),
    }
    const publisher = new WeatherAlertFanoutQueue(queue as never)
    const original = buildEvent('weather-alert-original')
    let pendingEvents = [original]
    const markEventsDispatched = vi
      .fn<(eventIds: string[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('database unavailable after enqueue'))
      .mockImplementation((eventIds) => {
        const dispatchedIds = new Set(eventIds)
        pendingEvents = pendingEvents.filter((event) => !dispatchedIds.has(event.id))
        return Promise.resolve()
      })
    const service = new WeatherAlertProcessingService(
      {
        findPendingEvents: (limit: number) =>
          Promise.resolve(pendingEvents.slice(0, limit)),
        markEventsDispatched,
      } as never,
      { now: () => new Date('2026-07-13T14:30:00.000Z') },
      publisher
    )

    await expect(service.dispatchPending()).rejects.toThrow(
      'database unavailable after enqueue'
    )
    await publisher.enqueue(
      Array.from({ length: 101 }, (_, index) => buildEvent(`weather-alert-${index}`))
    )
    await expect(service.dispatchPending()).resolves.toBe(1)

    expect(
      acceptedJobIds.filter((jobId) => jobId === 'weather-alert-original')
    ).toHaveLength(1)
    expect(markEventsDispatched).toHaveBeenCalledTimes(2)
    expect(pendingEvents).toEqual([])
  })
})
