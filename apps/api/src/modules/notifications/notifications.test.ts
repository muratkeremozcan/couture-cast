import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PushNotificationService } from './push-notification.service'
import type { PushTokenRepository } from './push-token.repository'

type MockExpo = {
  sendPushNotificationsAsync: ReturnType<typeof vi.fn>
}

class InMemoryPushTokenRepository implements Pick<PushTokenRepository, 'saveToken'> {
  tokens = new Map<string, { userId: string; platform?: string }>()

  saveToken(userId: string, token: string, platform?: string) {
    this.tokens.set(token, { userId, platform })
    const now = new Date()
    return Promise.resolve({
      id: token,
      token,
      user_id: userId,
      platform: platform ?? null,
      last_used_at: now,
      created_at: now,
      updated_at: now,
    })
  }
}

const createService = (overrides?: {
  expo?: MockExpo
  repo?: InMemoryPushTokenRepository
}) => {
  const repo = overrides?.repo ?? new InMemoryPushTokenRepository()
  const expo =
    overrides?.expo ??
    ({
      sendPushNotificationsAsync: vi.fn(),
    } satisfies MockExpo)

  return {
    repo,
    expo,
    service: new PushNotificationService(repo as never, expo as never),
  }
}

describe('PushNotificationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects invalid Expo push tokens and does not persist them', async () => {
    const { repo, service } = createService()
    vi.spyOn(Expo, 'isExpoPushToken').mockReturnValue(false)

    await expect(
      service.registerPushToken('user-1', 'not-an-expo-token', 'ios')
    ).rejects.toThrow(/Invalid Expo push token/)

    expect(repo.tokens.size).toBe(0)
  })

  it('stores valid push tokens with platform metadata', async () => {
    const { repo, service } = createService()
    vi.spyOn(Expo, 'isExpoPushToken').mockReturnValue(true)

    const record = await service.registerPushToken(
      'user-42',
      'ExponentPushToken[abc123]',
      'android'
    )

    expect(record.user_id).toBe('user-42')
    expect(record.token).toBe('ExponentPushToken[abc123]')
    expect(repo.tokens.get('ExponentPushToken[abc123]')?.platform).toBe('android')
  })

  it('batches notifications in chunks of 100', async () => {
    const sendPushNotificationsAsync = vi.fn().mockImplementation(
      (batch: ExpoPushMessage[]): Promise<ExpoPushTicket[]> =>
        Promise.resolve(
          batch.map((message, index) => ({
            status: 'ok',
            id: `ticket-${index}`,
            to: message.to,
          }))
        )
    )
    const { service } = createService({
      expo: { sendPushNotificationsAsync },
    })
    vi.spyOn(Expo, 'isExpoPushToken').mockReturnValue(true)

    const messages: ExpoPushMessage[] = Array.from({ length: 120 }, (_, idx) => ({
      to: `ExponentPushToken[token-${idx}]`,
      sound: 'default',
      body: 'Hi!',
    }))

    await service.sendBatchNotifications(messages)

    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(2)
    const firstBatch = sendPushNotificationsAsync.mock.calls[0]?.[0] as
      | ExpoPushMessage[]
      | undefined
    const secondBatch = sendPushNotificationsAsync.mock.calls[1]?.[0] as
      | ExpoPushMessage[]
      | undefined
    expect(firstBatch).toBeDefined()
    expect(secondBatch).toBeDefined()
    expect(firstBatch).toHaveLength(100)
    expect(secondBatch).toHaveLength(20)
  })

  it('surfaces invalid tokens and rate limit errors from Expo responses', async () => {
    const sendPushNotificationsAsync = vi.fn().mockImplementation(
      (batch: ExpoPushMessage[]): Promise<ExpoPushTicket[]> =>
        Promise.resolve(
          batch.map((message, index) =>
            index === 0
              ? {
                  status: 'error',
                  message: 'Device not registered',
                  details: { error: 'DeviceNotRegistered' },
                  to: message.to,
                }
              : {
                  status: 'error',
                  message: 'Rate limited',
                  details: { error: 'MessageRateExceeded' },
                  to: message.to,
                }
          )
        )
    )
    const { service } = createService({ expo: { sendPushNotificationsAsync } })

    const result = await service.sendBatchNotifications([
      { to: 'ExponentPushToken[invalid]', body: 'Hello', sound: 'default' },
      { to: 'ExponentPushToken[rate]', body: 'Hello', sound: 'default' },
    ])

    expect(result.invalidTokens).toContain('ExponentPushToken[invalid]')
    expect(result.rateLimitedTokens).toContain('ExponentPushToken[rate]')
  })
})
