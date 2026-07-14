import { alertWeatherEventSchema, type AlertWeatherEvent } from '@couture/api-client'
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'

import type {
  WeatherAlertEvaluationRule,
  WeatherAlertRuleType,
} from './weather-alert-evaluator.js'

export interface WeatherAlertRuleRecord extends WeatherAlertEvaluationRule {
  id: string
  userId: string
}

export interface WeatherAlertEventInput {
  id: string
  channel: 'alert:weather'
  payload: AlertWeatherEvent
  userId: string
  createdAt: Date
}

export interface WeatherAlertEventCandidate extends WeatherAlertEventInput {
  deduplicationKey: string
}

export interface WeatherAlertProcessingRepository {
  findEnabledRulesForPrimaryLocation(
    locationKey: string
  ): Promise<WeatherAlertRuleRecord[]>
  createEvents(events: WeatherAlertEventCandidate[]): Promise<WeatherAlertEventInput[]>
  findPendingEvents(limit: number): Promise<WeatherAlertEventInput[]>
  markEventsDispatched(eventIds: string[], dispatchedAt: Date): Promise<void>
  recordDispatchFailure(eventIds: string[], errorMessage: string): Promise<void>
}

function isWeatherAlertRuleType(value: string): value is WeatherAlertRuleType {
  return ['temperature', 'precipitation', 'severe'].includes(value)
}

const WEATHER_ALERT_COOLDOWN_MS = 60 * 60 * 1_000

@Injectable()
export class PrismaWeatherAlertProcessingRepository
  implements WeatherAlertProcessingRepository
{
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async findEnabledRulesForPrimaryLocation(
    locationKey: string
  ): Promise<WeatherAlertRuleRecord[]> {
    const records = await this.prisma.alertRule.findMany({
      where: {
        enabled: true,
        user: {
          saved_locations: {
            some: {
              is_primary: true,
              location_key: locationKey.trim().toLowerCase(),
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

    return records.flatMap((record) =>
      isWeatherAlertRuleType(record.rule_type)
        ? [
            {
              id: record.id,
              userId: record.user_id,
              ruleType: record.rule_type,
              threshold: record.threshold,
              enabled: record.enabled,
            },
          ]
        : []
    )
  }

  async createEvents(
    events: WeatherAlertEventCandidate[]
  ): Promise<WeatherAlertEventInput[]> {
    if (events.length === 0) {
      return []
    }

    const inserted = await this.prisma.$transaction(async (transaction) => {
      const reservedEvents: WeatherAlertEventCandidate[] = []
      const reservationOrder = [...events].sort(
        (left, right) =>
          left.deduplicationKey.localeCompare(right.deduplicationKey) ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id)
      )

      const reservationPromises = reservationOrder.map((event) => {
        const nextEligibleAt = new Date(
          event.createdAt.getTime() + WEATHER_ALERT_COOLDOWN_MS
        )
        return transaction
          .$queryRaw<{ deduplication_key: string }[]>(
            Prisma.sql`
          INSERT INTO public."AlertCooldownReservation" (
            "deduplication_key",
            "next_eligible_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            ${event.deduplicationKey},
            ${nextEligibleAt},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT ("deduplication_key") DO UPDATE
          SET
            "next_eligible_at" = EXCLUDED."next_eligible_at",
            "updated_at" = CURRENT_TIMESTAMP
          WHERE public."AlertCooldownReservation"."next_eligible_at" <= ${event.createdAt}
          RETURNING "deduplication_key"
        `
          )
          .then((reservation) => ({ event, reservation }))
      })

      const results = await Promise.all(reservationPromises)
      for (const { event, reservation } of results) {
        if (reservation.length > 0) {
          reservedEvents.push(event)
        }
      }

      if (reservedEvents.length === 0) {
        return []
      }

      const insertedEvents = await transaction.eventEnvelope.createManyAndReturn({
        data: reservedEvents.map((event) => ({
          id: event.id,
          channel: event.channel,
          payload: event.payload as unknown as Prisma.InputJsonValue,
          user_id: event.userId,
          created_at: event.createdAt,
        })),
        select: { id: true },
      })

      await transaction.alertDeliveryOutbox.createMany({
        data: reservedEvents.map((event) => ({
          event_id: event.id,
          deduplication_key: event.deduplicationKey,
          reservation_started_at: event.createdAt,
        })),
      })

      return insertedEvents
    })
    const insertedIds = new Set(inserted.map((event) => event.id))

    return events.filter((event) => insertedIds.has(event.id))
  }

  async findPendingEvents(limit: number): Promise<WeatherAlertEventInput[]> {
    const records = await this.prisma.alertDeliveryOutbox.findMany({
      where: { dispatched_at: null },
      orderBy: [{ created_at: 'asc' }, { event_id: 'asc' }],
      take: Math.min(Math.max(Math.trunc(limit), 1), 500),
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

    return records.map(({ event }) => {
      if (event.channel !== 'alert:weather' || !event.user_id) {
        throw new Error(`Invalid weather alert outbox event: ${event.id}`)
      }

      return {
        id: event.id,
        channel: event.channel,
        payload: alertWeatherEventSchema.parse(event.payload),
        userId: event.user_id,
        createdAt: event.created_at,
      }
    })
  }

  async markEventsDispatched(eventIds: string[], dispatchedAt: Date): Promise<void> {
    if (eventIds.length === 0) {
      return
    }

    await this.prisma.alertDeliveryOutbox.updateMany({
      where: { event_id: { in: eventIds }, dispatched_at: null },
      data: { dispatched_at: dispatchedAt, last_error: null },
    })
  }

  async recordDispatchFailure(eventIds: string[], errorMessage: string): Promise<void> {
    if (eventIds.length === 0) {
      return
    }

    await this.prisma.alertDeliveryOutbox.updateMany({
      where: { event_id: { in: eventIds }, dispatched_at: null },
      data: {
        attempts: { increment: 1 },
        last_error: errorMessage.slice(0, 500),
      },
    })
  }
}
