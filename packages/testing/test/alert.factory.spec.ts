import { describe, expect, it } from 'vitest'

import {
  buildAlertRuleCreateInput,
  createAlertRule,
} from '../src/factories/alert-rule.factory.js'
import {
  buildNotificationPreferenceCreateInput,
  createNotificationPreference,
} from '../src/factories/notification-preference.factory.js'

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
