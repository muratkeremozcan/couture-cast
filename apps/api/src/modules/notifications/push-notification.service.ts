import { Inject, Injectable, Optional } from '@nestjs/common'
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk'

import { PushTokenRepository } from './push-token.repository'

type ExpoClient = Pick<Expo, 'sendPushNotificationsAsync'>
export const EXPO_CLIENT = Symbol('EXPO_CLIENT')

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
    @Optional() @Inject(EXPO_CLIENT) expoClient?: ExpoClient
  ) {
    this.expo = expoClient ?? new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN })
  }

  async registerPushToken(userId: string, token: string, platform?: string) {
    if (!Expo.isExpoPushToken(token)) {
      throw new Error('Invalid Expo push token')
    }

    const saved = await this.pushTokenRepository.saveToken(userId, token, platform)
    return saved
  }

  async sendBatchNotifications(
    messages: ExpoPushMessage[]
  ): Promise<NotificationDispatchResult> {
    const batches: ExpoPushMessage[][] = []
    for (let i = 0; i < messages.length; i += 100) {
      batches.push(messages.slice(i, i + 100))
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
