import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AlertsService } from './alerts.service'
import type {
  AlertRuleRecord,
  AlertsRepository,
  NotificationPreferenceRecord,
} from './alerts.repository'

const now = new Date('2026-07-13T12:00:00.000Z')

function alertRule(overrides: Partial<AlertRuleRecord> = {}): AlertRuleRecord {
  return {
    id: overrides.id ?? 'rule-1',
    user_id: overrides.user_id ?? 'user-1',
    rule_type: overrides.rule_type ?? 'temperature',
    threshold: overrides.threshold === undefined ? 5 : overrides.threshold,
    enabled: overrides.enabled ?? true,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  }
}

function notificationPreference(
  overrides: Partial<NotificationPreferenceRecord> = {}
): NotificationPreferenceRecord {
  return {
    id: overrides.id ?? 'preference-1',
    user_id: overrides.user_id ?? 'user-1',
    quiet_hours_enabled: overrides.quiet_hours_enabled ?? true,
    push_enabled: overrides.push_enabled ?? true,
    quiet_hours_start: overrides.quiet_hours_start ?? '22:00',
    quiet_hours_end: overrides.quiet_hours_end ?? '07:00',
    timezone: overrides.timezone ?? 'America/Chicago',
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  }
}

function createRepositoryStub() {
  return {
    findSettingsByUserId: vi.fn().mockResolvedValue({
      preference: notificationPreference(),
      rules: [
        alertRule({ id: 'severe', rule_type: 'severe', threshold: 2 }),
        alertRule({ id: 'temperature', rule_type: 'temperature', threshold: 5 }),
      ],
    }),
    upsertNotificationPreferences: vi.fn().mockResolvedValue(notificationPreference()),
    upsertRules: vi.fn().mockResolvedValue([alertRule()]),
  } satisfies AlertsRepository
}

describe('AlertsService', () => {
  let repository: ReturnType<typeof createRepositoryStub>
  let service: AlertsService

  beforeEach(() => {
    repository = createRepositoryStub()
    service = new AlertsService(repository)
  })

  it('returns defaults without creating a missing preference row', async () => {
    repository.findSettingsByUserId.mockResolvedValueOnce({
      preference: null,
      rules: [],
    })

    await expect(service.getSettings('user-1')).resolves.toEqual({
      preferences: {
        quietHoursEnabled: false,
        pushEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'UTC',
      },
      rules: [],
    })
    expect(repository.findSettingsByUserId).toHaveBeenCalledWith('user-1')
  })

  it('maps and sorts stored settings deterministically', async () => {
    const result = await service.getSettings('user-1')

    expect(result.preferences).toMatchObject({
      quietHoursEnabled: true,
      timezone: 'America/Chicago',
    })
    expect(result.rules.map((rule) => rule.ruleType)).toEqual(['temperature', 'severe'])
  })

  it('validates and transactionally upserts rules for one owner', async () => {
    await service.updateRules('user-1', {
      rules: [
        {
          ruleType: 'temperature',
          threshold: 7,
          enabled: true,
        },
      ],
    })

    expect(repository.upsertRules).toHaveBeenCalledWith('user-1', [
      {
        ruleType: 'temperature',
        threshold: 7,
        enabled: true,
      },
    ])

    await expect(
      service.updateRules('user-1', {
        rules: [
          {
            ruleType: 'precipitation',
            threshold: 2,
            enabled: true,
          },
        ],
      })
    ).rejects.toThrow()
  })

  it('validates and upserts notification preferences for one owner', async () => {
    const input = {
      quietHoursEnabled: true,
      pushEnabled: false,
      quietHoursStart: '21:30',
      quietHoursEnd: '06:15',
      timezone: 'Europe/London',
    }

    await service.updateNotificationPreferences('user-1', input)

    expect(repository.upsertNotificationPreferences).toHaveBeenCalledWith('user-1', input)

    await expect(
      service.updateNotificationPreferences('user-1', {
        ...input,
        timezone: 'Invalid/Timezone',
      })
    ).rejects.toThrow()
  })
})
