import { describe, expect, it, vi } from 'vitest'

import { PrismaWeatherAlertProcessingRepository } from './weather-alert-processing.repository.js'

const createdAt = new Date('2026-07-13T14:30:00.000Z')

const input = {
  id: 'weather-alert-hash',
  channel: 'alert:weather' as const,
  userId: 'user-1',
  createdAt,
  deduplicationKey: 'weather-alert-fingerprint',
  payload: {
    version: '1' as const,
    timestamp: createdAt.toISOString(),
    userId: 'user-1',
    data: {
      alertType: 'temperature' as const,
      location: 'New York',
      message: 'Temperature rise.',
      severity: 'warning' as const,
    },
  },
}

describe('PrismaWeatherAlertProcessingRepository', () => {
  it('finds enabled rules only for owners with a matching primary location', async () => {
    const prisma = {
      alertRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rule-1',
            user_id: 'user-1',
            rule_type: 'temperature',
            threshold: 5,
            enabled: true,
          },
        ]),
      },
      eventEnvelope: { createManyAndReturn: vi.fn() },
    }
    const repository = new PrismaWeatherAlertProcessingRepository(prisma as never)

    await expect(
      repository.findEnabledRulesForPrimaryLocation(' New-York-NY ')
    ).resolves.toEqual([
      {
        id: 'rule-1',
        userId: 'user-1',
        ruleType: 'temperature',
        threshold: 5,
        enabled: true,
      },
    ])
    expect(prisma.alertRule.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        user: {
          saved_locations: {
            some: {
              is_primary: true,
              location_key: 'new-york-ny',
            },
          },
        },
      },
      orderBy: [{ user_id: 'asc' }, { rule_type: 'asc' }],
      select: {
        enabled: true,
        id: true,
        rule_type: true,
        threshold: true,
        user_id: true,
      },
    })
  })

  it('bulk inserts idempotent weather envelopes and returns only new records', async () => {
    const inserted = [{ id: 'weather-alert-hash' }]
    const transaction = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ deduplication_key: input.deduplicationKey }]),
      eventEnvelope: {
        createManyAndReturn: vi.fn().mockResolvedValue(inserted),
      },
      alertDeliveryOutbox: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const prisma = {
      alertRule: { findMany: vi.fn() },
      $transaction: vi.fn((run: (client: typeof transaction) => Promise<unknown>) =>
        run(transaction)
      ),
    }
    const repository = new PrismaWeatherAlertProcessingRepository(prisma as never)

    await expect(repository.createEvents([input])).resolves.toEqual([input])
    expect(transaction.eventEnvelope.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        {
          id: input.id,
          channel: 'alert:weather',
          user_id: 'user-1',
          created_at: input.createdAt,
          payload: input.payload,
        },
      ],
      select: { id: true },
    })
    expect(transaction.alertDeliveryOutbox.createMany).toHaveBeenCalledWith({
      data: [
        {
          event_id: input.id,
          deduplication_key: input.deduplicationKey,
          reservation_started_at: input.createdAt,
        },
      ],
    })
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('does not persist an envelope when its rolling cooldown cannot be reserved', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      eventEnvelope: { createManyAndReturn: vi.fn() },
      alertDeliveryOutbox: { createMany: vi.fn() },
    }
    const prisma = {
      alertRule: { findMany: vi.fn() },
      $transaction: vi.fn((run: (client: typeof transaction) => Promise<unknown>) =>
        run(transaction)
      ),
    }
    const repository = new PrismaWeatherAlertProcessingRepository(prisma as never)

    await expect(repository.createEvents([input])).resolves.toEqual([])
    expect(transaction.eventEnvelope.createManyAndReturn).not.toHaveBeenCalled()
    expect(transaction.alertDeliveryOutbox.createMany).not.toHaveBeenCalled()
  })

  it('loads pending outbox events in stable bounded batches', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        event: {
          id: input.id,
          channel: input.channel,
          payload: input.payload,
          user_id: input.userId,
          created_at: input.createdAt,
        },
      },
    ])
    const prisma = {
      alertRule: { findMany: vi.fn() },
      alertDeliveryOutbox: { findMany },
    }
    const repository = new PrismaWeatherAlertProcessingRepository(prisma as never)

    await expect(repository.findPendingEvents(500)).resolves.toEqual([
      {
        id: input.id,
        channel: input.channel,
        payload: input.payload,
        userId: input.userId,
        createdAt: input.createdAt,
      },
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { dispatched_at: null },
      orderBy: [{ created_at: 'asc' }, { event_id: 'asc' }],
      take: 500,
      select: {
        event: {
          select: {
            id: true,
            channel: true,
            payload: true,
            user_id: true,
            created_at: true,
          },
        },
      },
    })
  })

  it('records dispatch recovery state without storing unbounded errors', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      alertRule: { findMany: vi.fn() },
      alertDeliveryOutbox: { updateMany },
    }
    const repository = new PrismaWeatherAlertProcessingRepository(prisma as never)

    await repository.recordDispatchFailure([input.id], 'x'.repeat(800))
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { event_id: { in: [input.id] }, dispatched_at: null },
      data: {
        attempts: { increment: 1 },
        last_error: 'x'.repeat(500),
      },
    })

    const dispatchedAt = new Date('2026-07-13T14:31:00.000Z')
    await repository.markEventsDispatched([input.id], dispatchedAt)
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { event_id: { in: [input.id] }, dispatched_at: null },
      data: { dispatched_at: dispatchedAt, last_error: null },
    })
  })
})
