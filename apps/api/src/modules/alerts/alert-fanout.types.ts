import type { AlertWeatherEvent } from '@couture/api-client/types/socket-events'

import type {
  NotificationPreferenceSnapshot,
  PushSuppressionReason,
} from './quiet-hours.js'

export interface AlertFanoutStoredEvent {
  id: string
  channel: string
  payload: unknown
  userId: string | null
  createdAt: Date
}

export type AlertFanoutOutcome = 'sent' | 'suppressed' | 'failed'

export type AlertFanoutSuppressionReason =
  | PushSuppressionReason
  | 'no_push_tokens'
  | 'provider_rejected'
  | 'realtime_active'

export type AlertFanoutFailureStage =
  | 'event_lookup'
  | 'event_validation'
  | 'realtime'
  | 'preferences'
  | 'tokens'
  | 'push_provider'
  | 'audit'

export interface AlertFanoutAuditInput {
  eventId: string
  userId: string
  outcome: AlertFanoutOutcome
  realtimePublished: boolean
  realtimeErrorCode?: string
  tokenCount: number
  successfulTicketCount: number
  failedTicketCount: number
  invalidTokenCount: number
  rateLimitedTokenCount: number
  networkFailedTokenCount: number
  prunedInvalidTokenCount: number
  invalidTokenPruneFailed: boolean
  reason?: AlertFanoutSuppressionReason
  failureStage?: AlertFanoutFailureStage
  errorCode?: string
}

export abstract class AlertFanoutRepository {
  abstract findEventById(eventId: string): Promise<AlertFanoutStoredEvent | null>
  abstract findPreferenceByUserId(
    userId: string
  ): Promise<NotificationPreferenceSnapshot | null>
  abstract findPushTokensByUserId(userId: string): Promise<string[]>
  abstract recordOutcome(input: AlertFanoutAuditInput): Promise<void>
  abstract hasRealtimeBeenPublished(eventId: string): Promise<boolean>
}

export abstract class AlertRealtimePublisher {
  abstract publish(
    eventId: string,
    userId: string,
    payload: AlertWeatherEvent
  ): Promise<boolean>
}

export interface AlertFanoutPushResult {
  outcome: AlertFanoutOutcome
  tokenCount: number
  successfulTicketCount: number
  failedTicketCount: number
  invalidTokenCount: number
  rateLimitedTokenCount: number
  networkFailedTokenCount: number
  prunedInvalidTokenCount: number
  invalidTokenPruneFailed: boolean
  reason?: AlertFanoutSuppressionReason
}

export interface AlertFanoutResult {
  eventId: string
  userId: string
  realtimePublished: boolean
  realtimeErrorCode?: string
  push: AlertFanoutPushResult
}
