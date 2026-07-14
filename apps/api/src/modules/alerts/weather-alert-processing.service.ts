import { alertWeatherEventSchema } from '@couture/api-client'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { createHash } from 'node:crypto'

import type { NormalizedWeatherForecast } from '../weather/providers/weather.types.js'
import {
  WeatherAlertFanoutQueue,
  type WeatherAlertFanoutPublisher,
} from './weather-alert-fanout.queue.js'
import { evaluateWeatherAlertRules } from './weather-alert-evaluator.js'
import {
  PrismaWeatherAlertProcessingRepository,
  type WeatherAlertEventCandidate,
  type WeatherAlertEventInput,
  type WeatherAlertProcessingRepository,
  type WeatherAlertRuleRecord,
} from './weather-alert-processing.repository.js'

export interface WeatherAlertClock {
  now(): Date
}

export interface WeatherAlertSnapshot {
  id: string
  location: string
}

const systemWeatherAlertClock: WeatherAlertClock = {
  now: () => new Date(),
}

const OUTBOX_DISPATCH_BATCH_SIZE = 500

function hashParts(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function buildDeduplicationKey(
  userId: string,
  locationKey: string,
  triggerFingerprint: string
): string {
  return `weather-alert-fingerprint-${hashParts([
    userId,
    locationKey.trim().toLowerCase(),
    triggerFingerprint,
  ])}`
}

function buildEventId(deduplicationKey: string, triggeredAt: Date): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([deduplicationKey, triggeredAt.toISOString()]))
    .digest('hex')
  return `weather-alert-${digest}`
}

function groupRulesByUser(
  rules: WeatherAlertRuleRecord[]
): Map<string, WeatherAlertRuleRecord[]> {
  const rulesByUser = new Map<string, WeatherAlertRuleRecord[]>()
  for (const rule of rules) {
    const userRules = rulesByUser.get(rule.userId) ?? []
    userRules.push(rule)
    rulesByUser.set(rule.userId, userRules)
  }
  return rulesByUser
}

@Injectable()
export class WeatherAlertProcessingService {
  private readonly clock: WeatherAlertClock

  constructor(
    @Inject(PrismaWeatherAlertProcessingRepository)
    private readonly repository: WeatherAlertProcessingRepository,
    @Inject('WeatherAlertClock') @Optional() clock?: WeatherAlertClock,
    @Inject(WeatherAlertFanoutQueue)
    @Optional()
    private readonly fanoutQueue?: WeatherAlertFanoutPublisher
  ) {
    this.clock = clock ?? systemWeatherAlertClock
  }

  async process(
    snapshot: WeatherAlertSnapshot,
    forecast: NormalizedWeatherForecast
  ): Promise<WeatherAlertEventInput[]> {
    const rules = await this.repository.findEnabledRulesForPrimaryLocation(
      forecast.locationKey
    )
    const triggeredAt = this.clock.now()
    const timestamp = triggeredAt.toISOString()
    const events: WeatherAlertEventCandidate[] = []

    for (const [userId, userRules] of groupRulesByUser(rules)) {
      const triggers = evaluateWeatherAlertRules(userRules, forecast, snapshot.location)
      for (const trigger of triggers) {
        const deduplicationKey = buildDeduplicationKey(
          userId,
          forecast.locationKey,
          trigger.fingerprint
        )
        const payload = alertWeatherEventSchema.parse({
          version: '1',
          timestamp,
          userId,
          data: {
            alertType: trigger.alertType,
            location: snapshot.location,
            message: trigger.message,
            severity: trigger.severity,
          },
        })
        events.push({
          id: buildEventId(deduplicationKey, triggeredAt),
          channel: 'alert:weather',
          payload,
          userId,
          createdAt: triggeredAt,
          deduplicationKey,
        })
      }
    }

    const insertedEvents = await this.repository.createEvents(events)
    await this.dispatchPending()
    return insertedEvents
  }

  async dispatchPending(): Promise<number> {
    if (!this.fanoutQueue) {
      return 0
    }

    const dispatchedEventIds = new Set<string>()
    let dispatchedCount = 0
    let shouldContinue = true

    while (shouldContinue) {
      const pendingEvents = await this.repository.findPendingEvents(
        OUTBOX_DISPATCH_BATCH_SIZE
      )
      if (pendingEvents.length === 0) {
        break
      }

      const pageEventIds = new Set<string>()
      const undispatchedEvents = pendingEvents.filter((event) => {
        if (dispatchedEventIds.has(event.id) || pageEventIds.has(event.id)) {
          return false
        }
        pageEventIds.add(event.id)
        return true
      })
      if (undispatchedEvents.length === 0) {
        throw new Error('Weather alert outbox dispatch made no progress')
      }

      const eventIds = undispatchedEvents.map((event) => event.id)
      try {
        await this.fanoutQueue.enqueue(undispatchedEvents)
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown alert queue error'
        try {
          await this.repository.recordDispatchFailure(eventIds, errorMessage)
        } catch {
          // Preserve the queue error so BullMQ retries the actual handoff failure.
        }
        throw error
      }

      await this.repository.markEventsDispatched(eventIds, this.clock.now())
      eventIds.forEach((eventId) => dispatchedEventIds.add(eventId))
      dispatchedCount += eventIds.length

      shouldContinue = pendingEvents.length >= OUTBOX_DISPATCH_BATCH_SIZE
    }

    return dispatchedCount
  }
}
