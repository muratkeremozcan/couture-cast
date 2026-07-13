import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { PrismaAlertFanoutRepository } from './alert-fanout.repository.js'
import type { AlertFanoutAuditInput } from './alert-fanout.types.js'

function createRepository() {
  const eventFindUnique = vi.fn()
  const preferenceFindUnique = vi.fn()
  const pushTokenFindMany = vi.fn()
  const auditCreate = vi.fn()
  const prisma = {
    eventEnvelope: { findUnique: eventFindUnique },
    notificationPreference: { findUnique: preferenceFindUnique },
    pushToken: { findMany: pushTokenFindMany },
    auditLog: { create: auditCreate },
  } as unknown as PrismaClient

  return {
    repository: new PrismaAlertFanoutRepository(prisma),
    eventFindUnique,
    preferenceFindUnique,
    pushTokenFindMany,
    auditCreate,
  }
}

describe('PrismaAlertFanoutRepository', () => {
  it('loads an event and fresh notification preferences by owner', async () => {
    const { repository, eventFindUnique, preferenceFindUnique } = createRepository()
    const createdAt = new Date('2026-07-13T12:00:00.000Z')
    eventFindUnique.mockResolvedValue({
      id: 'event-1',
      channel: 'alert:weather',
      payload: { version: '1' },
      user_id: 'user-1',
      created_at: createdAt,
    })
    preferenceFindUnique.mockResolvedValue({
      push_enabled: false,
      quiet_hours_enabled: true,
      quiet_hours_start: '21:00',
      quiet_hours_end: '06:00',
      timezone: 'America/Chicago',
    })

    await expect(repository.findEventById('event-1')).resolves.toEqual({
      id: 'event-1',
      channel: 'alert:weather',
      payload: { version: '1' },
      userId: 'user-1',
      createdAt,
    })
    await expect(repository.findPreferenceByUserId('user-1')).resolves.toEqual({
      pushEnabled: false,
      quietHoursEnabled: true,
      quietHoursStart: '21:00',
      quietHoursEnd: '06:00',
      timezone: 'America/Chicago',
    })
    expect(eventFindUnique).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      select: {
        id: true,
        channel: true,
        payload: true,
        user_id: true,
        created_at: true,
      },
    })
    expect(preferenceFindUnique).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      select: {
        push_enabled: true,
        quiet_hours_enabled: true,
        quiet_hours_start: true,
        quiet_hours_end: true,
        timezone: true,
      },
    })
  })

  it('returns null when an event or preference is absent', async () => {
    const { repository, eventFindUnique, preferenceFindUnique } = createRepository()
    eventFindUnique.mockResolvedValue(null)
    preferenceFindUnique.mockResolvedValue(null)

    await expect(repository.findEventById('missing')).resolves.toBeNull()
    await expect(repository.findPreferenceByUserId('user-1')).resolves.toBeNull()
  })

  it('loads only token values for the requested owner', async () => {
    const { repository, pushTokenFindMany } = createRepository()
    pushTokenFindMany.mockResolvedValue([
      { token: 'ExponentPushToken[first]' },
      { token: 'ExponentPushToken[second]' },
    ])

    await expect(repository.findPushTokensByUserId('user-1')).resolves.toEqual([
      'ExponentPushToken[first]',
      'ExponentPushToken[second]',
    ])
    expect(pushTokenFindMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      orderBy: { id: 'asc' },
      select: { token: true },
    })
  })

  it('persists a bounded audit record without accepting token or secret fields', async () => {
    const { repository, auditCreate } = createRepository()
    auditCreate.mockResolvedValue({ id: 'audit-1' })

    const unsafeInput: AlertFanoutAuditInput & {
      rawToken: string
      providerSecret: string
    } = {
      eventId: 'event-1',
      userId: 'user-1',
      outcome: 'sent',
      realtimePublished: false,
      realtimeErrorCode: 'RedisUnavailableError',
      tokenCount: 120,
      successfulTicketCount: 118,
      failedTicketCount: 2,
      invalidTokenCount: 1,
      rateLimitedTokenCount: 1,
      networkFailedTokenCount: 0,
      prunedInvalidTokenCount: 1,
      invalidTokenPruneFailed: false,
      rawToken: 'ExponentPushToken[token-secret]',
      providerSecret: 'provider-secret',
    }
    await repository.recordOutcome(unsafeInput)

    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        user_id: 'user-1',
        event_type: 'weather_alert_fanout',
        event_data: {
          eventId: 'event-1',
          outcome: 'sent',
          realtimePublished: false,
          realtimeErrorCode: 'RedisUnavailableError',
          tokenCount: 120,
          successfulTicketCount: 118,
          failedTicketCount: 2,
          invalidTokenCount: 1,
          rateLimitedTokenCount: 1,
          networkFailedTokenCount: 0,
          prunedInvalidTokenCount: 1,
          invalidTokenPruneFailed: false,
        },
      },
    })
    expect(JSON.stringify(auditCreate.mock.calls[0]?.[0])).not.toMatch(
      /ExponentPushToken|provider-secret|token-secret/
    )
  })
})
