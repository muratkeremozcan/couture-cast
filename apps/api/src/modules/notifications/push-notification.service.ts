import { Inject, Injectable } from '@nestjs/common'
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
const EXPO_BATCH_SIZE = 100 // Expo docs: max 100 push tickets per request

export type NotificationDispatchResult = {
  tickets: ExpoPushTicket[]
  invalidTokens: string[]
  rateLimitedTokens: string[]
}

@Injectable()
export class PushNotificationService {
  private readonly expo: ExpoClient

  constructor(
    private readonly pushTokenRepository: PushTokenRepository,
    @Inject(EXPO_CLIENT) expoClient: ExpoClient
  ) {
    this.expo = expoClient
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
    const tickets: ExpoPushTicket[] = []

    for (const batch of batches) {
      const response = await this.expo.sendPushNotificationsAsync(batch)
      response.forEach((ticket, index) => {
        const target = batch[index]?.to
        const targets = Array.isArray(target) ? target : target ? [target] : []

        if (ticket.status === 'error') {
          const detail = ticket.details?.error
          if (detail === 'DeviceNotRegistered' && targets.length) {
            invalidTokens.push(...targets)
          } else if (detail === 'MessageRateExceeded' && targets.length) {
            rateLimitedTokens.push(...targets)
          }
        }
      })

      tickets.push(...response)
    }

    return { tickets, invalidTokens, rateLimitedTokens }
  }
}
