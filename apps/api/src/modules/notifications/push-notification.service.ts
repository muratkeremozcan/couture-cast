import { Inject, Injectable, Optional } from '@nestjs/common'
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk'

import { PushTokenRepository } from './push-token.repository'

/**
 * Story 0.5 owner file: push delivery leg in the hybrid realtime architecture.
 *
 * Role in delivery strategy:
 * - Realtime gateway handles active sessions with lowest latency.
 * - Push notifications cover backgrounded/offline users.
 * - Polling remains the final fallback when realtime continuity is not possible.
 *
 * Reliability details:
 * - Messages are chunked to provider limits.
 * - Response tickets are classified so invalid/rate-limited tokens can be handled by callers.
 *
 * Alternative:
 * - APNs/FCM direct integrations instead of Expo for more control at higher integration cost.
 *
 * Ownership anchor:
 * - Story 0.5 Task 3 owner: dispatch Expo push notifications for users who are not on an active realtime session.
 *
 * Flow refs:
 * - S0.5/T4: token persistence keeps the push path durable across app restarts and reconnects.
 */
type ExpoClient = Pick<Expo, 'sendPushNotificationsAsync'>
export const EXPO_CLIENT = Symbol('EXPO_CLIENT')
export const EXPO_SEND_ATTEMPT_TIMEOUT = Symbol('EXPO_SEND_ATTEMPT_TIMEOUT')
export const DEFAULT_EXPO_SEND_ATTEMPT_TIMEOUT_MS = 2_000
const EXPO_BATCH_SIZE = 100 // Expo docs: max 100 push tickets per request
const EXPO_BATCH_RETRY_DELAYS_MS = [100, 250] as const

export type NotificationDispatchResult = {
  tickets: ExpoPushTicket[]
  invalidTokens: string[]
  rateLimitedTokens: string[]
  networkFailedTokens: string[]
  prunedInvalidTokenCount: number
  invalidTokenPruneFailed: boolean
}

export class ExpoSendAttemptTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Expo push attempt exceeded ${timeoutMs}ms`)
    this.name = 'ExpoSendAttemptTimeoutError'
  }
}

type IndexedMessage = {
  index: number
  message: ExpoPushMessage
}

function targetsForMessage(message: ExpoPushMessage): string[] {
  return Array.isArray(message.to) ? message.to : [message.to]
}

function waitBeforeRetry(attempt: number): Promise<void> {
  const delay = EXPO_BATCH_RETRY_DELAYS_MS[attempt]
  if (delay === undefined) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delay))
}

@Injectable()
export class PushNotificationService {
  private readonly expo: ExpoClient
  private readonly sendAttemptTimeoutMs: number

  constructor(
    private readonly pushTokenRepository: PushTokenRepository,
    @Inject(EXPO_CLIENT) expoClient: ExpoClient,
    @Inject(EXPO_SEND_ATTEMPT_TIMEOUT)
    @Optional()
    sendAttemptTimeoutMs = DEFAULT_EXPO_SEND_ATTEMPT_TIMEOUT_MS
  ) {
    this.expo = expoClient
    if (!Number.isFinite(sendAttemptTimeoutMs) || sendAttemptTimeoutMs <= 0) {
      throw new Error('sendAttemptTimeoutMs must be a positive finite number')
    }
    this.sendAttemptTimeoutMs = sendAttemptTimeoutMs
  }

  async registerPushToken(userId: string, token: string, platform?: string) {
    // Flow ref S0.5/T3: validate provider-specific token format before dispatch can rely on it.
    if (!Expo.isExpoPushToken(token)) {
      throw new Error(
        'Invalid Expo push token: expected format ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]. See https://docs.expo.dev/push-notifications/overview/.'
      )
    }

    const saved = await this.pushTokenRepository.saveToken(userId, token, platform)
    return saved
  }

  async sendBatchNotifications(
    messages: ExpoPushMessage[]
  ): Promise<NotificationDispatchResult> {
    // Flow ref S0.5/T3: keep batches within Expo API limits to reduce provider-side failures.
    const batches: ExpoPushMessage[][] = []
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      batches.push(messages.slice(i, i + EXPO_BATCH_SIZE))
    }

    const invalidTokens: string[] = []
    const rateLimitedTokens: string[] = []
    const networkFailedTokens: string[] = []
    const tickets: ExpoPushTicket[] = []

    for (const batch of batches) {
      const finalTickets = new Map<number, ExpoPushTicket>()
      let pending: IndexedMessage[] = batch.map((message, index) => ({
        index,
        message,
      }))

      for (
        let attempt = 0;
        pending.length > 0 && attempt <= EXPO_BATCH_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        let response: ExpoPushTicket[]
        try {
          response = await this.sendWithDeadline(pending.map(({ message }) => message))
        } catch {
          if (attempt < EXPO_BATCH_RETRY_DELAYS_MS.length) {
            await waitBeforeRetry(attempt)
            continue
          }

          networkFailedTokens.push(
            ...pending.flatMap(({ message }) => targetsForMessage(message))
          )
          break
        }

        const retry: IndexedMessage[] = []
        pending.forEach((entry, responseIndex) => {
          const ticket = response[responseIndex]
          if (!ticket) {
            if (attempt < EXPO_BATCH_RETRY_DELAYS_MS.length) {
              retry.push(entry)
            } else {
              networkFailedTokens.push(...targetsForMessage(entry.message))
            }
            return
          }

          if (
            ticket.status === 'error' &&
            ticket.details?.error === 'MessageRateExceeded'
          ) {
            if (attempt < EXPO_BATCH_RETRY_DELAYS_MS.length) {
              retry.push(entry)
            } else {
              finalTickets.set(entry.index, ticket)
              rateLimitedTokens.push(...targetsForMessage(entry.message))
            }
            return
          }

          finalTickets.set(entry.index, ticket)
          if (
            ticket.status === 'error' &&
            ticket.details?.error === 'DeviceNotRegistered'
          ) {
            invalidTokens.push(...targetsForMessage(entry.message))
          }
        })

        pending = retry
        if (pending.length > 0) {
          await waitBeforeRetry(attempt)
        }
      }

      tickets.push(
        ...[...finalTickets.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, ticket]) => ticket)
      )
    }

    const uniqueInvalidTokens = [...new Set(invalidTokens)]
    let prunedInvalidTokenCount = 0
    let invalidTokenPruneFailed = false
    if (uniqueInvalidTokens.length > 0) {
      try {
        prunedInvalidTokenCount =
          await this.pushTokenRepository.deleteTokens(uniqueInvalidTokens)
      } catch {
        invalidTokenPruneFailed = true
      }
    }

    return {
      tickets,
      invalidTokens: uniqueInvalidTokens,
      rateLimitedTokens: [...new Set(rateLimitedTokens)],
      networkFailedTokens: [...new Set(networkFailedTokens)],
      prunedInvalidTokenCount,
      invalidTokenPruneFailed,
    }
  }

  private async sendWithDeadline(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.expo.sendPushNotificationsAsync(messages),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new ExpoSendAttemptTimeoutError(this.sendAttemptTimeoutMs)),
            this.sendAttemptTimeoutMs
          )
          timeout.unref?.()
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}
