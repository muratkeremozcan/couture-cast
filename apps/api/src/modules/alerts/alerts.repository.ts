import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'

export type AlertRuleRecord = Prisma.AlertRuleGetPayload<Record<string, never>>
export type NotificationPreferenceRecord = Prisma.NotificationPreferenceGetPayload<
  Record<string, never>
>

export type AlertRuleType = 'temperature' | 'precipitation' | 'severe'

export interface UpsertAlertRuleCommand {
  ruleType: AlertRuleType
  threshold: number
  enabled: boolean
}

export interface UpsertNotificationPreferencesCommand {
  quietHoursEnabled: boolean
  pushEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  timezone: string
}

export interface AlertSettingsRecords {
  preference: NotificationPreferenceRecord | null
  rules: AlertRuleRecord[]
}

export interface AlertsRepository {
  findSettingsByUserId(userId: string): Promise<AlertSettingsRecords>
  upsertNotificationPreferences(
    userId: string,
    command: UpsertNotificationPreferencesCommand
  ): Promise<NotificationPreferenceRecord>
  upsertRules(
    userId: string,
    commands: UpsertAlertRuleCommand[]
  ): Promise<AlertRuleRecord[]>
}

@Injectable()
export class PrismaAlertsRepository implements AlertsRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async findSettingsByUserId(userId: string): Promise<AlertSettingsRecords> {
    const [preference, rules] = await Promise.all([
      this.prisma.notificationPreference.findUnique({
        where: { user_id: userId },
      }),
      this.prisma.alertRule.findMany({
        where: { user_id: userId },
      }),
    ])

    return { preference, rules }
  }

  upsertNotificationPreferences(
    userId: string,
    command: UpsertNotificationPreferencesCommand
  ): Promise<NotificationPreferenceRecord> {
    const data = {
      quiet_hours_enabled: command.quietHoursEnabled,
      push_enabled: command.pushEnabled,
      quiet_hours_start: command.quietHoursStart,
      quiet_hours_end: command.quietHoursEnd,
      timezone: command.timezone,
    }

    return this.prisma.notificationPreference.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        ...data,
      },
      update: data,
    })
  }

  upsertRules(
    userId: string,
    commands: UpsertAlertRuleCommand[]
  ): Promise<AlertRuleRecord[]> {
    return this.prisma.$transaction(async (transaction) => {
      for (const command of commands) {
        await transaction.alertRule.upsert({
          where: {
            user_id_rule_type: {
              user_id: userId,
              rule_type: command.ruleType,
            },
          },
          create: {
            user_id: userId,
            rule_type: command.ruleType,
            threshold: command.threshold,
            enabled: command.enabled,
          },
          update: {
            threshold: command.threshold,
            enabled: command.enabled,
          },
        })
      }

      return transaction.alertRule.findMany({
        where: { user_id: userId },
      })
    })
  }
}
