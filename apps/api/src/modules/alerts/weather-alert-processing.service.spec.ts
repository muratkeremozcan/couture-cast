import { alertWeatherEventSchema } from '@couture/api-client'
import { describe, expect, it, vi } from 'vitest'

import type { NormalizedWeatherForecast } from '../weather/providers/weather.types.js'
import type {
  WeatherAlertEventCandidate,
  WeatherAlertEventInput,
} from './weather-alert-processing.repository.js'
import { WeatherAlertProcessingService } from './weather-alert-processing.service.js'

const triggeredAt = new Date('2026-07-13T14:30:00.000Z')

function buildForecast(): NormalizedWeatherForecast {
  return {
    provider: 'openweather',
    locationKey: 'new-york-ny',
    locationName: 'New York',
    latitude: 40.7128,
    longitude: -74.006,
    timezone: 'America/New_York',
    providerUpdatedAt: new Date('2026-07-13T14:00:00.000Z'),
    fetchedAt: triggeredAt,
    current: {
      temperature: 20,
      feelsLike: 20,
      windSpeed: 2,
      humidity: 50,
      condition: 'clear',
      providerConditionText: 'clear sky',
      providerWeatherCode: '800',
    },
    hourly: Array.from({ length: 48 }, (_, index) => ({
      forecastAt: new Date(triggeredAt.getTime() + (index + 1) * 3_600_000),
      temperature: index === 4 ? 31 : 20,
      feelsLike: 20,
      precipitationProbability: index === 1 ? 0.8 : 0,
      precipitationAmount: index === 1 ? 1 : 0,
      windSpeed: 2,
      windGust: 3,
      condition: index === 1 ? ('rain' as const) : ('clear' as const),
      providerConditionText: index === 1 ? 'rain' : 'clear sky',
      providerWeatherCode: index === 1 ? '500' : '800',
    })),
    alerts: [
      {
        event: 'Tornado warning',
        description: 'Take shelter now.',
        start: triggeredAt,
        end: new Date(triggeredAt.getTime() + 3_600_000),
        severity: 'high',
      },
    ],
  }
}

function buildPendingEvent(index: number): WeatherAlertEventInput {
  return {
    id: `weather-alert-${index}`,
    channel: 'alert:weather',
    userId: `user-${index}`,
    createdAt: triggeredAt,
    payload: {
      version: '1',
      timestamp: triggeredAt.toISOString(),
      userId: `user-${index}`,
      data: {
        alertType: 'temperature',
        location: 'New York',
        message: 'Temperature will rise.',
        severity: 'warning',
      },
    },
  }
}

function createRollingCooldownRepository() {
  const nextEligibleByKey = new Map<string, number>()
  const createEvents = vi.fn(
    (events: WeatherAlertEventCandidate[]): Promise<WeatherAlertEventInput[]> => {
      const accepted: WeatherAlertEventInput[] = []

      for (const event of events) {
        const nextEligibleAt = nextEligibleByKey.get(event.deduplicationKey)
        if (nextEligibleAt !== undefined && event.createdAt.getTime() < nextEligibleAt) {
          continue
        }

        nextEligibleByKey.set(
          event.deduplicationKey,
          event.createdAt.getTime() + 60 * 60 * 1_000
        )
        accepted.push(event)
      }

      return Promise.resolve(accepted)
    }
  )

  return {
    createEvents,
    repository: {
      findEnabledRulesForPrimaryLocation: vi.fn().mockResolvedValue([
        {
          id: 'rule-temp-a',
          userId: 'user-a',
          ruleType: 'temperature',
          threshold: 10,
          enabled: true,
        },
      ]),
      createEvents,
    },
  }
}

describe('WeatherAlertProcessingService', () => {
  it('persists validated, owner-specific envelopes for each triggered rule', async () => {
    const repository = {
      findEnabledRulesForPrimaryLocation: vi.fn().mockResolvedValue([
        {
          id: 'rule-temp-a',
          userId: 'user-a',
          ruleType: 'temperature',
          threshold: 10,
          enabled: true,
        },
        {
          id: 'rule-severe-a',
          userId: 'user-a',
          ruleType: 'severe',
          threshold: 2,
          enabled: true,
        },
        {
          id: 'rule-precip-b',
          userId: 'user-b',
          ruleType: 'precipitation',
          threshold: 0.6,
          enabled: true,
        },
      ]),
      createEvents: vi.fn().mockImplementation((events) => Promise.resolve(events)),
    }
    const service = new WeatherAlertProcessingService(repository as never, {
      now: () => triggeredAt,
    })

    const events = await service.process(
      { id: 'snapshot-1', location: 'New York' },
      buildForecast()
    )

    expect(repository.findEnabledRulesForPrimaryLocation).toHaveBeenCalledWith(
      'new-york-ny'
    )
    expect(events).toHaveLength(3)
    expect(events.map((event) => event.userId)).toEqual(['user-a', 'user-a', 'user-b'])
    expect(new Set(events.map((event) => event.id)).size).toBe(3)
    for (const event of events) {
      expect(event.channel).toBe('alert:weather')
      expect(event.createdAt).toEqual(triggeredAt)
      expect(alertWeatherEventSchema.parse(event.payload).data.location).toBe('New York')
      expect(event.payload.userId).toBe(event.userId)
    }
  })

  it('returns only envelopes inserted by the idempotent repository', async () => {
    const createEvents = vi
      .fn<(events: WeatherAlertEventInput[]) => Promise<WeatherAlertEventInput[]>>()
      .mockImplementationOnce((events) => Promise.resolve(events))
      .mockResolvedValueOnce([])
    const repository = {
      findEnabledRulesForPrimaryLocation: vi.fn().mockResolvedValue([
        {
          id: 'rule-temp-a',
          userId: 'user-a',
          ruleType: 'temperature',
          threshold: 10,
          enabled: true,
        },
      ]),
      createEvents,
    }
    const service = new WeatherAlertProcessingService(repository as never, {
      now: () => triggeredAt,
    })
    const forecast = buildForecast()

    await expect(
      service.process({ id: 'snapshot-1', location: 'New York' }, forecast)
    ).resolves.toHaveLength(1)
    await expect(
      service.process({ id: 'snapshot-2', location: 'New York' }, forecast)
    ).resolves.toEqual([])
    const firstId = createEvents.mock.calls[0]?.[0][0]?.id
    const secondId = createEvents.mock.calls[1]?.[0][0]?.id
    expect(secondId).toBe(firstId)
  })

  it('re-enqueues deterministic candidates when an ingestion retry finds existing events', async () => {
    const enqueue = vi
      .fn<(events: WeatherAlertEventInput[]) => Promise<void>>()
      .mockResolvedValue(undefined)
    let pendingEvents: WeatherAlertEventInput[] = []
    const repository = {
      findEnabledRulesForPrimaryLocation: vi.fn().mockResolvedValue([
        {
          id: 'rule-temp-a',
          userId: 'user-a',
          ruleType: 'temperature',
          threshold: 10,
          enabled: true,
        },
      ]),
      createEvents: vi.fn().mockImplementation((events: WeatherAlertEventInput[]) => {
        pendingEvents = events
        return Promise.resolve([])
      }),
      findPendingEvents: vi.fn().mockImplementation(() => Promise.resolve(pendingEvents)),
      markEventsDispatched: vi.fn().mockResolvedValue(undefined),
      recordDispatchFailure: vi.fn().mockResolvedValue(undefined),
    }
    const fanoutQueue = { enqueue }
    const service = new WeatherAlertProcessingService(
      repository as never,
      { now: () => triggeredAt },
      fanoutQueue
    )

    await expect(
      service.process({ id: 'snapshot-1', location: 'New York' }, buildForecast())
    ).resolves.toEqual([])

    expect(enqueue).toHaveBeenCalledTimes(1)
    const queuedEvents = enqueue.mock.calls[0]?.[0]
    expect(queuedEvents).toHaveLength(1)
    expect(queuedEvents?.[0]?.id).toMatch(/^weather-alert-[a-f0-9]{64}$/)
    expect(queuedEvents?.[0]?.userId).toBe('user-a')
    expect(repository.markEventsDispatched).toHaveBeenCalledWith(
      [queuedEvents?.[0]?.id],
      triggeredAt
    )
  })

  it('propagates queue failures so ingestion can retry the durable event', async () => {
    let pendingEvents: WeatherAlertEventInput[] = []
    const repository = {
      findEnabledRulesForPrimaryLocation: vi.fn().mockResolvedValue([
        {
          id: 'rule-temp-a',
          userId: 'user-a',
          ruleType: 'temperature',
          threshold: 10,
          enabled: true,
        },
      ]),
      createEvents: vi.fn().mockImplementation((events: WeatherAlertEventInput[]) => {
        pendingEvents = events
        return Promise.resolve(events)
      }),
      findPendingEvents: vi.fn().mockImplementation(() => Promise.resolve(pendingEvents)),
      markEventsDispatched: vi.fn().mockResolvedValue(undefined),
      recordDispatchFailure: vi.fn().mockResolvedValue(undefined),
    }
    const fanoutQueue = {
      enqueue: vi.fn().mockRejectedValue(new Error('queue unavailable')),
    }
    const service = new WeatherAlertProcessingService(
      repository as never,
      { now: () => triggeredAt },
      fanoutQueue
    )

    await expect(
      service.process({ id: 'snapshot-1', location: 'New York' }, buildForecast())
    ).rejects.toThrow('queue unavailable')
    expect(repository.createEvents).toHaveBeenCalledTimes(1)
    expect(repository.recordDispatchFailure).toHaveBeenCalledWith(
      [pendingEvents[0]?.id],
      'queue unavailable'
    )
    expect(repository.markEventsDispatched).not.toHaveBeenCalled()
  })

  it('recovers a durable pending event after a transient queue failure', async () => {
    let pendingEvents: WeatherAlertEventInput[] = []
    const repository = {
      findEnabledRulesForPrimaryLocation: vi.fn().mockResolvedValue([
        {
          id: 'rule-temp-a',
          userId: 'user-a',
          ruleType: 'temperature',
          threshold: 10,
          enabled: true,
        },
      ]),
      createEvents: vi.fn().mockImplementation((events: WeatherAlertEventInput[]) => {
        pendingEvents = events
        return Promise.resolve(events)
      }),
      findPendingEvents: vi.fn().mockImplementation(() => Promise.resolve(pendingEvents)),
      markEventsDispatched: vi.fn().mockImplementation(() => {
        pendingEvents = []
        return Promise.resolve()
      }),
      recordDispatchFailure: vi.fn().mockResolvedValue(undefined),
    }
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(undefined)
    const service = new WeatherAlertProcessingService(
      repository as never,
      { now: () => triggeredAt },
      { enqueue }
    )

    await expect(
      service.process({ id: 'snapshot-1', location: 'New York' }, buildForecast())
    ).rejects.toThrow('queue unavailable')
    await expect(service.dispatchPending()).resolves.toBe(1)

    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(repository.recordDispatchFailure).toHaveBeenCalledTimes(1)
    expect(repository.markEventsDispatched).toHaveBeenCalledTimes(1)
    expect(pendingEvents).toEqual([])
  })

  it('drains more than two bounded outbox pages in one dispatch run', async () => {
    let pendingEvents = Array.from({ length: 1_201 }, (_, index) =>
      buildPendingEvent(index)
    )
    const repository = {
      findPendingEvents: vi
        .fn<(limit: number) => Promise<WeatherAlertEventInput[]>>()
        .mockImplementation((limit) => Promise.resolve(pendingEvents.slice(0, limit))),
      markEventsDispatched: vi
        .fn<(eventIds: string[]) => Promise<void>>()
        .mockImplementation((eventIds) => {
          const dispatchedIds = new Set(eventIds)
          pendingEvents = pendingEvents.filter((event) => !dispatchedIds.has(event.id))
          return Promise.resolve()
        }),
      recordDispatchFailure: vi.fn().mockResolvedValue(undefined),
    }
    const enqueue = vi
      .fn<(events: WeatherAlertEventInput[]) => Promise<void>>()
      .mockResolvedValue(undefined)
    const service = new WeatherAlertProcessingService(
      repository as never,
      { now: () => triggeredAt },
      { enqueue }
    )

    await expect(service.dispatchPending()).resolves.toBe(1_201)

    expect(enqueue).toHaveBeenCalledTimes(3)
    expect(enqueue.mock.calls.map(([events]) => events.length)).toEqual([500, 500, 201])
    expect(repository.markEventsDispatched).toHaveBeenCalledTimes(3)
    expect(pendingEvents).toEqual([])
  })

  it('fails without replaying when a full outbox page makes no progress', async () => {
    const stuckPage = Array.from({ length: 500 }, (_, index) => buildPendingEvent(index))
    const repository = {
      findPendingEvents: vi.fn().mockResolvedValue(stuckPage),
      markEventsDispatched: vi.fn().mockResolvedValue(undefined),
      recordDispatchFailure: vi.fn().mockResolvedValue(undefined),
    }
    const enqueue = vi
      .fn<(events: WeatherAlertEventInput[]) => Promise<void>>()
      .mockResolvedValue(undefined)
    const service = new WeatherAlertProcessingService(
      repository as never,
      { now: () => triggeredAt },
      { enqueue }
    )

    await expect(service.dispatchPending()).rejects.toThrow(
      'Weather alert outbox dispatch made no progress'
    )

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(repository.findPendingEvents).toHaveBeenCalledTimes(2)
  })

  it('enforces a rolling cooldown across UTC hour boundaries and permits distinct triggers', async () => {
    const firstTriggerAt = new Date('2026-07-13T14:59:00.000Z')
    const now = vi.fn().mockReturnValue(firstTriggerAt)
    const { createEvents, repository } = createRollingCooldownRepository()
    const service = new WeatherAlertProcessingService(repository as never, { now })

    const first = await service.process(
      { id: 'snapshot-1', location: 'New York' },
      buildForecast()
    )
    now.mockReturnValue(new Date('2026-07-13T15:00:00.000Z'))
    const acrossHourBoundary = await service.process(
      { id: 'snapshot-2', location: 'New York' },
      buildForecast()
    )
    const dropForecast = buildForecast()
    dropForecast.hourly[4] = {
      ...dropForecast.hourly[4]!,
      temperature: 9,
    }
    const differentFingerprint = await service.process(
      { id: 'snapshot-3', location: 'New York' },
      dropForecast
    )
    now.mockReturnValue(new Date('2026-07-13T15:58:59.999Z'))
    const beforeCooldown = await service.process(
      { id: 'snapshot-4', location: 'New York' },
      buildForecast()
    )
    now.mockReturnValue(new Date('2026-07-13T15:59:00.000Z'))
    const afterCooldown = await service.process(
      { id: 'snapshot-5', location: 'New York' },
      buildForecast()
    )
    now.mockReturnValue(firstTriggerAt)
    const staleReplay = await service.process(
      { id: 'snapshot-replay', location: 'New York' },
      buildForecast()
    )

    expect(first).toHaveLength(1)
    expect(acrossHourBoundary).toEqual([])
    expect(differentFingerprint).toHaveLength(1)
    expect(beforeCooldown).toEqual([])
    expect(afterCooldown).toHaveLength(1)
    expect(afterCooldown[0]?.id).not.toBe(first[0]?.id)
    expect(staleReplay).toEqual([])
    expect(createEvents).toHaveBeenCalledTimes(6)
  })

  it('returns only one event when identical trigger evaluations race', async () => {
    const { repository } = createRollingCooldownRepository()
    const service = new WeatherAlertProcessingService(repository as never, {
      now: () => triggeredAt,
    })

    const results = await Promise.all([
      service.process({ id: 'snapshot-a', location: 'New York' }, buildForecast()),
      service.process({ id: 'snapshot-b', location: 'New York' }, buildForecast()),
    ])

    expect(results.flat()).toHaveLength(1)
  })
})
