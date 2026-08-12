// Learning path Step 17: Weather alert rules and notification pipeline.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-17-weather-alert-rules-and-notification-pipeline
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildAlertRuleCreateInput,
  createAlertRule,
} from '../src/factories/alert-rule.factory.js'
import {
  buildNotificationPreferenceCreateInput,
  createNotificationPreference,
} from '../src/factories/notification-preference.factory.js'
import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'

type PrismaCreateArgs = { data: Record<string, unknown> }

/**
 * Each factory persists through exactly one delegate, so the stub models that
 * delegate and is cast to the client type the factory expects.
 */
function createPrismaStub(delegate: 'alertRule' | 'notificationPreference', id: string) {
  const create = vi.fn<(args: PrismaCreateArgs) => Promise<{ id: string }>>()
  create.mockResolvedValue({ id })

  return {
    prisma: { [delegate]: { create } } as unknown as PrismaClient,
    create,
  }
}

describe('alert factories', () => {
  it('builds an alert rule and maps it to Prisma fields', () => {
    const fixture = createAlertRule({
      id: 'rule-1',
      userId: 'user-1',
      ruleType: 'precipitation',
      threshold: 0.7,
      enabled: false,
    })

    expect(buildAlertRuleCreateInput(fixture)).toMatchObject({
      id: 'rule-1',
      user_id: 'user-1',
      rule_type: 'precipitation',
      threshold: 0.7,
      enabled: false,
    })
  })

  it('builds notification preferences and maps opt-out fields', () => {
    const fixture = createNotificationPreference({
      id: 'preference-1',
      userId: 'user-1',
      quietHoursEnabled: true,
      pushEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'America/Chicago',
    })

    expect(buildNotificationPreferenceCreateInput(fixture)).toMatchObject({
      id: 'preference-1',
      user_id: 'user-1',
      quiet_hours_enabled: true,
      push_enabled: false,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      timezone: 'America/Chicago',
    })
  })
})

describe('alert factory persistence', () => {
  afterEach(() => {
    resetTrackedEntities()
  })

  it('persists an alert rule and registers it for cleanup', async () => {
    // Alert rules outlive their owner's teardown unless they are tracked, and a
    // stale rule fires notifications during a later suite.
    const { prisma, create } = createPrismaStub('alertRule', 'rule-persisted')

    const persisted = await createAlertRule(
      { id: 'rule-persisted', userId: 'user-1' },
      { persist: true, prisma }
    )

    expect(persisted).toEqual({ id: 'rule-persisted' })
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { id: 'rule-persisted', user_id: 'user-1' },
    })
    expect(getTrackedEntityIds('alertRules')).toEqual(['rule-persisted'])
  })

  it('persists a notification preference and registers it for cleanup', async () => {
    const { prisma, create } = createPrismaStub(
      'notificationPreference',
      'preference-persisted'
    )

    const persisted = await createNotificationPreference(
      { id: 'preference-persisted', userId: 'user-1' },
      { persist: true, prisma }
    )

    expect(persisted).toEqual({ id: 'preference-persisted' })
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { id: 'preference-persisted', user_id: 'user-1' },
    })
    expect(getTrackedEntityIds('notificationPreferences')).toEqual([
      'preference-persisted',
    ])
  })
})
