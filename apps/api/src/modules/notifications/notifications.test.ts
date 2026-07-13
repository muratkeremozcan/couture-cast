import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PushNotificationService } from './push-notification.service'
import type { PushTokenRepository } from './push-token.repository'

type MockExpo = {
  sendPushNotificationsAsync: ReturnType<typeof vi.fn>
}

class InMemoryPushTokenRepository
  implements Pick<PushTokenRepository, 'saveToken' | 'deleteTokens'>
{
  tokens = new Map<string, { userId: string; platform?: string }>()
  deletedTokens: string[] = []

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

  deleteTokens(tokens: string[]) {
    this.deletedTokens.push(...tokens)
    let count = 0
    tokens.forEach((token) => {
      if (this.tokens.delete(token)) count += 1
    })
    return Promise.resolve(count)
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
          batch.map((message) =>
            message.to === 'ExponentPushToken[invalid]'
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
    const { repo, service } = createService({ expo: { sendPushNotificationsAsync } })

    const result = await service.sendBatchNotifications([
      { to: 'ExponentPushToken[invalid]', body: 'Hello', sound: 'default' },
      { to: 'ExponentPushToken[rate]', body: 'Hello', sound: 'default' },
    ])

    expect(result.invalidTokens).toContain('ExponentPushToken[invalid]')
    expect(result.rateLimitedTokens).toContain('ExponentPushToken[rate]')
    expect(repo.deletedTokens).toEqual(['ExponentPushToken[invalid]'])
  })

  it('retries only rate-limited messages from the current batch', async () => {
    const sendPushNotificationsAsync = vi
      .fn()
      .mockResolvedValueOnce([
        { status: 'ok', id: 'ticket-ok' },
        {
          status: 'error',
          message: 'Rate limited',
          details: { error: 'MessageRateExceeded' },
        },
      ] satisfies ExpoPushTicket[])
      .mockResolvedValueOnce([{ status: 'ok', id: 'ticket-retried' }])
    const { service } = createService({ expo: { sendPushNotificationsAsync } })
    const messages: ExpoPushMessage[] = [
      { to: 'ExponentPushToken[ok]', body: 'Hello' },
      { to: 'ExponentPushToken[rate]', body: 'Hello' },
    ]

    const result = await service.sendBatchNotifications(messages)

    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(2)
    expect(sendPushNotificationsAsync.mock.calls[0]?.[0]).toEqual(messages)
    expect(sendPushNotificationsAsync.mock.calls[1]?.[0]).toEqual([messages[1]])
    expect(result.tickets).toEqual([
      { status: 'ok', id: 'ticket-ok' },
      { status: 'ok', id: 'ticket-retried' },
    ])
    expect(result.rateLimitedTokens).toEqual([])
  })

  it('retries a network-failed later batch without resending an earlier batch', async () => {
    const sendPushNotificationsAsync = vi
      .fn()
      .mockImplementationOnce((batch: ExpoPushMessage[]) =>
        Promise.resolve(
          batch.map((_, index) => ({
            status: 'ok',
            id: `first-${index}`,
          })) as ExpoPushTicket[]
        )
      )
      .mockRejectedValueOnce(new Error('network reset'))
      .mockImplementationOnce((batch: ExpoPushMessage[]) =>
        Promise.resolve(
          batch.map((_, index) => ({
            status: 'ok',
            id: `second-${index}`,
          })) as ExpoPushTicket[]
        )
      )
    const { service } = createService({ expo: { sendPushNotificationsAsync } })
    const messages: ExpoPushMessage[] = Array.from({ length: 120 }, (_, index) => ({
      to: `ExponentPushToken[token-${index}]`,
      body: 'Hello',
    }))

    const result = await service.sendBatchNotifications(messages)

    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(3)
    const calls = sendPushNotificationsAsync.mock.calls as [ExpoPushMessage[]][]
    expect(calls.map(([batch]) => batch.length)).toEqual([100, 20, 20])
    expect(result.tickets).toHaveLength(120)
    expect(result.networkFailedTokens).toEqual([])
  })

  it('bounds a never-resolving Expo attempt and exhausts only its current batch', async () => {
    const sendPushNotificationsAsync = vi.fn(
      () => new Promise<ExpoPushTicket[]>(() => undefined)
    )
    const service = new PushNotificationService(
      new InMemoryPushTokenRepository() as never,
      { sendPushNotificationsAsync },
      5
    )
    const dispatch = service.sendBatchNotifications([
      { to: 'ExponentPushToken[stalled]', body: 'Hello' },
    ])

    const result = await Promise.race([
      dispatch,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ])

    expect(result).not.toBeNull()
    expect(result?.tickets).toEqual([])
    expect(result?.networkFailedTokens).toEqual(['ExponentPushToken[stalled]'])
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(3)
  })

  it('handles mixed ok and error tickets with receipts', async () => {
    const sendPushNotificationsAsync = vi.fn().mockImplementation(
      (batch: ExpoPushMessage[]): Promise<ExpoPushTicket[]> =>
        Promise.resolve(
          batch.map((message, index) =>
            index === 0
              ? { status: 'ok', id: 'ticket-ok', to: message.to }
              : {
                  status: 'error',
                  message: 'Device not registered',
                  details: { error: 'DeviceNotRegistered' },
                  to: message.to,
                }
          )
        )
    )
    const { service } = createService({ expo: { sendPushNotificationsAsync } })

    const result = await service.sendBatchNotifications([
      { to: 'ExponentPushToken[ok]', body: 'Hello', sound: 'default' },
      { to: 'ExponentPushToken[invalid]', body: 'Hello', sound: 'default' },
    ])

    expect(result.invalidTokens).toContain('ExponentPushToken[invalid]')
    expect(result.tickets).toHaveLength(2)
  })
})
