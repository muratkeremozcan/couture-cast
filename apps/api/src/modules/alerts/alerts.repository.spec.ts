import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PrismaAlertsRepository } from './alerts.repository'

describe('PrismaAlertsRepository', () => {
  const transaction = {
    alertRule: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  }
  const prisma = {
    alertRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn((run: (client: typeof transaction) => Promise<unknown>) =>
      run(transaction)
    ),
  }

  let repository: PrismaAlertsRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repository = new PrismaAlertsRepository(prisma as unknown as PrismaClient)
  })

  it('filters every settings read by authenticated user ID', async () => {
    await repository.findSettingsByUserId('user-1')

    expect(prisma.alertRule.findMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
    })
    expect(prisma.notificationPreference.findUnique).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
    })
  })

  it('upserts all rules in one transaction with owner-scoped compound keys', async () => {
    await repository.upsertRules('user-1', [
      { ruleType: 'temperature', threshold: 5, enabled: true },
      { ruleType: 'severe', threshold: 2, enabled: false },
    ])

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(transaction.alertRule.upsert).toHaveBeenNthCalledWith(1, {
      where: {
        user_id_rule_type: {
          user_id: 'user-1',
          rule_type: 'temperature',
        },
      },
      create: {
        user_id: 'user-1',
        rule_type: 'temperature',
        threshold: 5,
        enabled: true,
      },
      update: {
        threshold: 5,
        enabled: true,
      },
    })
    expect(transaction.alertRule.findMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
    })
  })

  it('upserts notification preferences through the owner unique key', async () => {
    await repository.upsertNotificationPreferences('user-1', {
      quietHoursEnabled: true,
      pushEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'America/Chicago',
    })

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      create: {
        user_id: 'user-1',
        quiet_hours_enabled: true,
        push_enabled: false,
        quiet_hours_start: '22:00',
        quiet_hours_end: '07:00',
        timezone: 'America/Chicago',
      },
      update: {
        quiet_hours_enabled: true,
        push_enabled: false,
        quiet_hours_start: '22:00',
        quiet_hours_end: '07:00',
        timezone: 'America/Chicago',
      },
    })
  })
})
