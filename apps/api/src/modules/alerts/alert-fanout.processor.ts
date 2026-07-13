import {
  alertWeatherEventSchema,
  type AlertWeatherEvent,
} from '@couture/api-client/types/socket-events'
import { Inject, Injectable, Optional } from '@nestjs/common'
import type { ExpoPushMessage } from 'expo-server-sdk'
import type { Logger } from 'pino'

import { createBaseLogger } from '../../logger/pino.config.js'
import { PushNotificationService } from '../notifications/push-notification.service.js'
import {
  DEFAULT_NOTIFICATION_PREFERENCE,
  evaluatePushSuppression,
} from './quiet-hours.js'
import {
  AlertFanoutRepository,
  AlertRealtimePublisher,
  type AlertFanoutAuditInput,
  type AlertFanoutFailureStage,
  type AlertFanoutPushResult,
  type AlertFanoutResult,
  type AlertFanoutStoredEvent,
} from './alert-fanout.types.js'
import {
  alertFanoutJobDataSchema,
  type AlertFanoutJobData,
} from './weather-alert-fanout.queue.js'

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}

function validateStoredEvent(
  eventId: string,
  event: AlertFanoutStoredEvent | null
): { userId: string; payload: AlertWeatherEvent } {
  if (!event || event.id !== eventId) {
    throw new Error(`Alert event ${eventId} was not found`)
  }
  if (event.channel !== 'alert:weather') {
    throw new Error(`${eventId} is not an alert:weather event`)
  }
  if (!event.userId || event.userId.trim().length === 0) {
    throw new Error(`${eventId} has no owner`)
  }

  const payload = alertWeatherEventSchema.parse(event.payload)
  if (payload.userId !== event.userId) {
    throw new Error(`${eventId} payload owner does not match ${event.userId}`)
  }
  return { userId: event.userId, payload }
}

function pushTitle(payload: AlertWeatherEvent): string {
  if (payload.data.severity === 'critical') {
    return `Critical weather alert for ${payload.data.location}`
  }
  if (payload.data.severity === 'warning') {
    return `Weather warning for ${payload.data.location}`
  }
  return `Weather alert for ${payload.data.location}`
}

function buildPushMessages(
  eventId: string,
  payload: AlertWeatherEvent,
  tokens: string[]
): ExpoPushMessage[] {
  return tokens.map((token) => ({
    to: token,
    sound: 'default',
    title: pushTitle(payload),
    body: payload.data.message,
    data: {
      eventId,
      channel: 'alert:weather',
      alertType: payload.data.alertType,
      location: payload.data.location,
      severity: payload.data.severity,
    },
  }))
}

function emptyPushResult(
  outcome: AlertFanoutPushResult['outcome'],
  reason: AlertFanoutPushResult['reason']
): AlertFanoutPushResult {
  return {
    outcome,
    reason,
    tokenCount: 0,
    successfulTicketCount: 0,
    failedTicketCount: 0,
    invalidTokenCount: 0,
    rateLimitedTokenCount: 0,
    networkFailedTokenCount: 0,
    prunedInvalidTokenCount: 0,
    invalidTokenPruneFailed: false,
  }
}

type RealtimeDeliveryResult = {
  published: boolean
  errorCode?: string
}

export class AlertPushDeliveryRejectedError extends Error {
  constructor(eventId: string) {
    super(`Push provider rejected every delivery for alert event ${eventId}`)
    this.name = 'AlertPushDeliveryRejectedError'
  }
}

export const ALERT_FANOUT_LOGGER = Symbol('ALERT_FANOUT_LOGGER')

@Injectable()
export class AlertFanoutProcessor {
  private readonly logger: Pick<Logger, 'error' | 'info'>

  constructor(
    @Inject(AlertFanoutRepository)
    private readonly repository: AlertFanoutRepository,
    @Inject(AlertRealtimePublisher)
    private readonly realtimePublisher: AlertRealtimePublisher,
    private readonly pushNotificationService: PushNotificationService,
    @Inject(ALERT_FANOUT_LOGGER)
    @Optional()
    logger?: Pick<Logger, 'error' | 'info'>
  ) {
    this.logger = logger ?? createBaseLogger().child({ feature: 'alert-fanout' })
  }

  async process(
    job: AlertFanoutJobData,
    instant = new Date()
  ): Promise<AlertFanoutResult> {
    const { eventId } = alertFanoutJobDataSchema.parse(job)

    let event: AlertFanoutStoredEvent | null
    try {
      event = await this.repository.findEventById(eventId)
    } catch (error) {
      await this.recordFailure(eventId, undefined, 'event_lookup', error)
      throw error
    }

    let validated: { userId: string; payload: AlertWeatherEvent }
    try {
      validated = validateStoredEvent(eventId, event)
    } catch (error) {
      const auditUserId = event?.userId?.trim() ? event.userId : undefined
      await this.recordFailure(eventId, auditUserId, 'event_validation', error)
      throw error
    }

    const { userId, payload } = validated
    const alreadyPublished = await this.repository.hasRealtimeBeenPublished(eventId)
    const realtime = alreadyPublished
      ? { published: true }
      : await this.publishRealtime(eventId, userId, payload)
    let failureStage: AlertFanoutFailureStage = 'preferences'
    let tokenCount = 0
    let push: AlertFanoutPushResult

    try {
      const preference =
        (await this.repository.findPreferenceByUserId(userId)) ??
        DEFAULT_NOTIFICATION_PREFERENCE
      const suppression = evaluatePushSuppression(preference, instant)
      if (suppression.suppressed) {
        push = emptyPushResult('suppressed', suppression.reason)
      } else if (realtime.published) {
        push = emptyPushResult('suppressed', 'realtime_active')
      } else {
        failureStage = 'tokens'
        const tokens = await this.repository.findPushTokensByUserId(userId)
        tokenCount = tokens.length
        if (tokenCount === 0) {
          push = emptyPushResult('suppressed', 'no_push_tokens')
        } else {
          failureStage = 'push_provider'
          const dispatch = await this.pushNotificationService.sendBatchNotifications(
            buildPushMessages(eventId, payload, tokens)
          )
          const successfulTicketCount = dispatch.tickets.filter(
            (ticket) => ticket.status === 'ok'
          ).length
          push = {
            outcome: successfulTicketCount > 0 ? 'sent' : 'failed',
            ...(successfulTicketCount === 0
              ? { reason: 'provider_rejected' as const }
              : {}),
            tokenCount,
            successfulTicketCount,
            failedTicketCount: tokenCount - successfulTicketCount,
            invalidTokenCount: dispatch.invalidTokens.length,
            rateLimitedTokenCount: dispatch.rateLimitedTokens.length,
            networkFailedTokenCount: dispatch.networkFailedTokens.length,
            prunedInvalidTokenCount: dispatch.prunedInvalidTokenCount,
            invalidTokenPruneFailed: dispatch.invalidTokenPruneFailed,
          }
        }
      }
    } catch (error) {
      await this.recordFailure(eventId, userId, failureStage, error, realtime, tokenCount)
      throw error
    }

    await this.persistOutcome(eventId, userId, realtime, push)
    if (push.outcome === 'failed') {
      const error = new AlertPushDeliveryRejectedError(eventId)
      this.logger.error(
        {
          eventId,
          userId,
          outcome: 'failed',
          realtimePublished: realtime.published,
          tokenCount: push.tokenCount,
          failureStage: 'push_provider',
          errorCode: error.name,
        },
        'alert_fanout_failed'
      )
      throw error
    }

    return {
      eventId,
      userId,
      realtimePublished: realtime.published,
      ...(realtime.errorCode ? { realtimeErrorCode: realtime.errorCode } : {}),
      push,
    }
  }

  private async publishRealtime(
    eventId: string,
    userId: string,
    payload: AlertWeatherEvent
  ): Promise<RealtimeDeliveryResult> {
    try {
      return {
        published: await this.realtimePublisher.publish(eventId, userId, payload),
      }
    } catch (error) {
      const code = errorCode(error)
      this.logger.error(
        { eventId, userId, failureStage: 'realtime', errorCode: code },
        'alert_fanout_realtime_failed'
      )
      return { published: false, errorCode: code }
    }
  }

  private async recordFailure(
    eventId: string,
    userId: string | undefined,
    failureStage: AlertFanoutFailureStage,
    error: unknown,
    realtime: RealtimeDeliveryResult = { published: false },
    tokenCount = 0
  ): Promise<void> {
    const code = errorCode(error)
    if (userId) {
      const failure: AlertFanoutAuditInput = {
        eventId,
        userId,
        outcome: 'failed',
        realtimePublished: realtime.published,
        ...(realtime.errorCode ? { realtimeErrorCode: realtime.errorCode } : {}),
        tokenCount,
        successfulTicketCount: 0,
        failedTicketCount: 0,
        invalidTokenCount: 0,
        rateLimitedTokenCount: 0,
        networkFailedTokenCount: 0,
        prunedInvalidTokenCount: 0,
        invalidTokenPruneFailed: false,
        failureStage,
        errorCode: code,
      }
      try {
        await this.repository.recordOutcome(failure)
      } catch (auditError) {
        this.logger.error(
          {
            eventId,
            userId,
            outcome: 'failed',
            failureStage: 'audit',
            errorCode: errorCode(auditError),
          },
          'alert_fanout_audit_failed'
        )
      }
    }

    this.logger.error(
      {
        eventId,
        ...(userId ? { userId } : {}),
        outcome: 'failed',
        realtimePublished: realtime.published,
        tokenCount,
        failureStage,
        errorCode: code,
      },
      'alert_fanout_failed'
    )
  }

  private async persistOutcome(
    eventId: string,
    userId: string,
    realtime: RealtimeDeliveryResult,
    push: AlertFanoutPushResult
  ): Promise<void> {
    const auditInput: AlertFanoutAuditInput = {
      eventId,
      userId,
      outcome: push.outcome,
      realtimePublished: realtime.published,
      ...(realtime.errorCode ? { realtimeErrorCode: realtime.errorCode } : {}),
      tokenCount: push.tokenCount,
      successfulTicketCount: push.successfulTicketCount,
      failedTicketCount: push.failedTicketCount,
      invalidTokenCount: push.invalidTokenCount,
      rateLimitedTokenCount: push.rateLimitedTokenCount,
      networkFailedTokenCount: push.networkFailedTokenCount,
      prunedInvalidTokenCount: push.prunedInvalidTokenCount,
      invalidTokenPruneFailed: push.invalidTokenPruneFailed,
      ...(push.reason ? { reason: push.reason } : {}),
      ...(push.outcome === 'failed' ? { failureStage: 'push_provider' as const } : {}),
    }
    try {
      await this.repository.recordOutcome(auditInput)
    } catch (error) {
      this.logger.error(
        {
          eventId,
          userId,
          outcome: push.outcome,
          failureStage: 'audit',
          errorCode: errorCode(error),
        },
        'alert_fanout_audit_failed'
      )
    }
    this.logger.info(
      {
        eventId,
        userId,
        outcome: push.outcome,
        realtimePublished: realtime.published,
        tokenCount: push.tokenCount,
        successfulTicketCount: push.successfulTicketCount,
        failedTicketCount: push.failedTicketCount,
        invalidTokenCount: push.invalidTokenCount,
        rateLimitedTokenCount: push.rateLimitedTokenCount,
        networkFailedTokenCount: push.networkFailedTokenCount,
        prunedInvalidTokenCount: push.prunedInvalidTokenCount,
        invalidTokenPruneFailed: push.invalidTokenPruneFailed,
        ...(push.reason ? { reason: push.reason } : {}),
      },
      'alert_fanout_completed'
    )
  }
}
