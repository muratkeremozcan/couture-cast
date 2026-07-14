import { Inject, Injectable } from '@nestjs/common'
import {
  alertPreferencesSchema,
  alertRuleSchema,
  updateAlertRulesInputSchema,
  updateNotificationPreferencesInputSchema,
  type AlertPreferences,
  type AlertRule,
  type UpdateAlertRulesInput,
  type UpdateNotificationPreferencesInput,
} from '../../contracts/http'
import {
  PrismaAlertsRepository,
  type AlertRuleRecord,
  type AlertsRepository,
  type NotificationPreferenceRecord,
} from './alerts.repository'

const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  quietHoursEnabled: false,
  pushEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'UTC',
}

const alertRuleOrder = {
  temperature: 0,
  precipitation: 1,
  severe: 2,
} as const

function toAlertRule(record: AlertRuleRecord): AlertRule {
  return alertRuleSchema.parse({
    ruleType: record.rule_type,
    threshold: record.threshold,
    enabled: record.enabled,
  })
}

function toSortedAlertRules(records: AlertRuleRecord[]): AlertRule[] {
  return records
    .map(toAlertRule)
    .sort((left, right) => alertRuleOrder[left.ruleType] - alertRuleOrder[right.ruleType])
}

function toAlertPreferences(
  record: NotificationPreferenceRecord | null
): AlertPreferences {
  if (!record) {
    return { ...DEFAULT_ALERT_PREFERENCES }
  }

  return alertPreferencesSchema.parse({
    quietHoursEnabled: record.quiet_hours_enabled,
    pushEnabled: record.push_enabled,
    quietHoursStart: record.quiet_hours_start,
    quietHoursEnd: record.quiet_hours_end,
    timezone: record.timezone,
  })
}

@Injectable()
export class AlertsService {
  constructor(
    @Inject(PrismaAlertsRepository)
    private readonly repository: AlertsRepository
  ) {}

  async getSettings(userId: string): Promise<{
    preferences: AlertPreferences
    rules: AlertRule[]
  }> {
    const settings = await this.repository.findSettingsByUserId(userId)

    return {
      preferences: toAlertPreferences(settings.preference),
      rules: toSortedAlertRules(settings.rules),
    }
  }

  async updateRules(userId: string, input: UpdateAlertRulesInput): Promise<AlertRule[]> {
    const parsed = updateAlertRulesInputSchema.parse(input)
    const records = await this.repository.upsertRules(userId, parsed.rules)

    return toSortedAlertRules(records)
  }

  async updateNotificationPreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput
  ): Promise<AlertPreferences> {
    const parsed = updateNotificationPreferencesInputSchema.parse(input)
    const record = await this.repository.upsertNotificationPreferences(userId, parsed)

    return toAlertPreferences(record)
  }
}
