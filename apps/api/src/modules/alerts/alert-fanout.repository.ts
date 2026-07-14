import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'

import type { NotificationPreferenceSnapshot } from './quiet-hours.js'
import {
  AlertFanoutRepository,
  type AlertFanoutAuditInput,
  type AlertFanoutStoredEvent,
} from './alert-fanout.types.js'

@Injectable()
export class PrismaAlertFanoutRepository extends AlertFanoutRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {
    super()
  }

  async findEventById(eventId: string): Promise<AlertFanoutStoredEvent | null> {
    const event = await this.prisma.eventEnvelope.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        channel: true,
        payload: true,
        user_id: true,
        created_at: true,
      },
    })

    if (!event) return null
    return {
      id: event.id,
      channel: event.channel,
      payload: event.payload,
      userId: event.user_id,
      createdAt: event.created_at,
    }
  }

  async findPreferenceByUserId(
    userId: string
  ): Promise<NotificationPreferenceSnapshot | null> {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { user_id: userId },
      select: {
        push_enabled: true,
        quiet_hours_enabled: true,
        quiet_hours_start: true,
        quiet_hours_end: true,
        timezone: true,
      },
    })

    if (!preference) return null
    return {
      pushEnabled: preference.push_enabled,
      quietHoursEnabled: preference.quiet_hours_enabled,
      quietHoursStart: preference.quiet_hours_start,
      quietHoursEnd: preference.quiet_hours_end,
      timezone: preference.timezone,
    }
  }

  async findPushTokensByUserId(userId: string): Promise<string[]> {
    const records = await this.prisma.pushToken.findMany({
      where: { user_id: userId },
      orderBy: { id: 'asc' },
      select: { token: true },
    })
    return records.map((record) => record.token)
  }

  async recordOutcome(input: AlertFanoutAuditInput): Promise<void> {
    const eventData = {
      eventId: input.eventId,
      outcome: input.outcome,
      realtimePublished: input.realtimePublished,
      ...(input.realtimeErrorCode ? { realtimeErrorCode: input.realtimeErrorCode } : {}),
      tokenCount: input.tokenCount,
      successfulTicketCount: input.successfulTicketCount,
      failedTicketCount: input.failedTicketCount,
      invalidTokenCount: input.invalidTokenCount,
      rateLimitedTokenCount: input.rateLimitedTokenCount,
      networkFailedTokenCount: input.networkFailedTokenCount,
      prunedInvalidTokenCount: input.prunedInvalidTokenCount,
      invalidTokenPruneFailed: input.invalidTokenPruneFailed,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.failureStage ? { failureStage: input.failureStage } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    } satisfies Prisma.InputJsonObject

    await this.prisma.auditLog.create({
      data: {
        user_id: input.userId,
        event_type: 'weather_alert_fanout',
        event_data: eventData,
      },
    })
  }

  async hasRealtimeBeenPublished(eventId: string): Promise<boolean> {
    const log = await this.prisma.auditLog.findFirst({
      where: {
        event_type: 'weather_alert_fanout',
        event_data: {
          path: ['eventId'],
          equals: eventId,
        },
      },
    })

    if (!log || !log.event_data || typeof log.event_data !== 'object') {
      return false
    }
    const data = log.event_data as Record<string, unknown>
    return !!data.realtimePublished
  }
}
