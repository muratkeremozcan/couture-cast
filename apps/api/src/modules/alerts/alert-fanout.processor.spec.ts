import type { AlertWeatherEvent } from '@couture/api-client/types/socket-events'
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { describe, expect, it, vi } from 'vitest'

import { PushNotificationService } from '../notifications/push-notification.service.js'
import { AlertFanoutProcessor } from './alert-fanout.processor.js'
import type {
  AlertFanoutAuditInput,
  AlertFanoutRepository,
  AlertRealtimePublisher,
} from './alert-fanout.types.js'

const now = new Date('2026-07-13T22:00:00.000Z')

const payload: AlertWeatherEvent = {
  version: '1',
  timestamp: '2026-07-13T21:59:30.000Z',
  userId: 'user-1',
  data: {
    alertType: 'severe',
    location: 'Chicago',
    message: 'A severe thunderstorm warning is active.',
    severity: 'critical',
  },
}

function createHarness(options?: {
  event?: {
    id: string
    channel: string
    payload: unknown
    userId: string | null
    createdAt: Date
  } | null
  preference?: {
    pushEnabled: boolean
    quietHoursEnabled: boolean
    quietHoursStart: string
    quietHoursEnd: string
    timezone: string
  } | null
  tokens?: string[]
  realtimeResult?: boolean
  sendPushNotificationsAsync?: (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>
  alreadyPublished?: boolean
}) {
  const repository = {
    findEventById: vi.fn().mockResolvedValue(
      options && 'event' in options
        ? options.event
        : {
            id: 'event-1',
            channel: 'alert:weather',
            payload,
            userId: 'user-1',
            createdAt: new Date(payload.timestamp),
          }
    ),
    findPreferenceByUserId: vi.fn().mockResolvedValue(options?.preference ?? null),
    findPushTokensByUserId: vi.fn().mockResolvedValue(options?.tokens ?? []),
    recordOutcome: vi.fn().mockResolvedValue(undefined),
    hasRealtimeBeenPublished: vi
      .fn()
      .mockResolvedValue(options?.alreadyPublished ?? false),
  } satisfies Record<keyof AlertFanoutRepository, ReturnType<typeof vi.fn>>
  const realtimePublisher = {
    publish: vi.fn().mockResolvedValue(options?.realtimeResult ?? false),
  } satisfies AlertRealtimePublisher
  const sendPushNotificationsAsync = vi.fn(
    options?.sendPushNotificationsAsync ??
      ((messages: ExpoPushMessage[]) =>
        Promise.resolve(
          messages.map((_, index) => ({
            status: 'ok',
            id: `ticket-${index}`,
          })) as ExpoPushTicket[]
        ))
  )
  const deleteTokens = vi.fn((tokens: string[]) => Promise.resolve(tokens.length))
  const pushService = new PushNotificationService(
    { deleteTokens } as never,
    { sendPushNotificationsAsync } as never
  )
  const logger = { error: vi.fn(), info: vi.fn() }
  const processor = new AlertFanoutProcessor(
    repository as unknown as AlertFanoutRepository,
    realtimePublisher,
    pushService,
    logger as never
  )

  return {
    processor,
    realtimePublisher,
    repository,
    sendPushNotificationsAsync,
    deleteTokens,
    logger,
  }
}

function outcomeCalls(recordOutcome: ReturnType<typeof vi.fn>): AlertFanoutAuditInput[] {
  return recordOutcome.mock.calls.map(([input]) => input as AlertFanoutAuditInput)
}

describe('AlertFanoutProcessor', () => {
  it('continues to Expo when realtime publishing throws', async () => {
    const harness = createHarness({ tokens: ['ExponentPushToken[token-1]'] })
    harness.realtimePublisher.publish.mockRejectedValueOnce(
      new Error('redis unavailable')
    )

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).resolves.toMatchObject({
      realtimePublished: false,
      push: { outcome: 'sent', successfulTicketCount: 1 },
    })
    expect(harness.sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    expect(harness.repository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        realtimePublished: false,
        realtimeErrorCode: 'Error',
        outcome: 'sent',
      })
    )
  })

  it('continues to Expo when Redis reports no realtime subscribers', async () => {
    const harness = createHarness({
      realtimeResult: false,
      tokens: ['ExponentPushToken[token-1]'],
    })

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).resolves.toMatchObject({
      realtimePublished: false,
      push: { outcome: 'sent', successfulTicketCount: 1 },
    })
    expect(harness.sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    expect(harness.repository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ realtimePublished: false, outcome: 'sent' })
    )
  })

  it('defaults missing preferences, batches 120 tokens, and audits classifications', async () => {
    const tokens = Array.from(
      { length: 120 },
      (_, index) => `ExponentPushToken[token-${index}]`
    )
    const harness = createHarness({
      tokens,
      sendPushNotificationsAsync: (messages) => {
        return Promise.resolve(
          messages.map((message, index) => {
            if (message.to === 'ExponentPushToken[token-0]') {
              return {
                status: 'error',
                message: 'Device not registered',
                details: { error: 'DeviceNotRegistered' },
              }
            }
            if (message.to === 'ExponentPushToken[token-1]') {
              return {
                status: 'error',
                message: 'Rate limited',
                details: { error: 'MessageRateExceeded' },
              }
            }
            return { status: 'ok', id: `ticket-${index}` }
          }) as ExpoPushTicket[]
        )
      },
    })

    await expect(harness.processor.process({ eventId: 'event-1' }, now)).resolves.toEqual(
      {
        eventId: 'event-1',
        userId: 'user-1',
        realtimePublished: false,
        push: {
          outcome: 'sent',
          tokenCount: 120,
          successfulTicketCount: 118,
          failedTicketCount: 2,
          invalidTokenCount: 1,
          rateLimitedTokenCount: 1,
          networkFailedTokenCount: 0,
          prunedInvalidTokenCount: 1,
          invalidTokenPruneFailed: false,
        },
      }
    )
    expect(harness.sendPushNotificationsAsync).toHaveBeenCalledTimes(4)
    expect(harness.sendPushNotificationsAsync.mock.calls[0]?.[0]).toHaveLength(100)
    expect(harness.sendPushNotificationsAsync.mock.calls[1]?.[0]).toHaveLength(1)
    expect(harness.sendPushNotificationsAsync.mock.calls[2]?.[0]).toHaveLength(1)
    expect(harness.sendPushNotificationsAsync.mock.calls[3]?.[0]).toHaveLength(20)
    expect(harness.sendPushNotificationsAsync.mock.calls[0]?.[0][0]).toEqual({
      to: 'ExponentPushToken[token-0]',
      sound: 'default',
      title: 'Critical weather alert for Chicago',
      body: 'A severe thunderstorm warning is active.',
      data: {
        eventId: 'event-1',
        channel: 'alert:weather',
        alertType: 'severe',
        location: 'Chicago',
        severity: 'critical',
      },
    })
    expect(harness.realtimePublisher.publish).toHaveBeenCalledWith(
      'event-1',
      'user-1',
      payload
    )
    const [audit] = outcomeCalls(harness.repository.recordOutcome)
    expect(audit).toMatchObject({
      outcome: 'sent',
      tokenCount: 120,
      successfulTicketCount: 118,
      failedTicketCount: 2,
      invalidTokenCount: 1,
      rateLimitedTokenCount: 1,
      networkFailedTokenCount: 0,
      prunedInvalidTokenCount: 1,
      invalidTokenPruneFailed: false,
    })
    expect(harness.deleteTokens).toHaveBeenCalledWith(['ExponentPushToken[token-0]'])
    expect(JSON.stringify(audit)).not.toContain('ExponentPushToken')
  })

  it('publishes realtime while suppressing an opted-out push', async () => {
    const harness = createHarness({
      realtimeResult: true,
      preference: {
        pushEnabled: false,
        quietHoursEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'UTC',
      },
      tokens: ['ExponentPushToken[token-1]'],
    })

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).resolves.toMatchObject({
      realtimePublished: true,
      push: { outcome: 'suppressed', reason: 'push_disabled' },
    })
    expect(harness.realtimePublisher.publish).toHaveBeenCalledTimes(1)
    expect(harness.repository.findPushTokensByUserId).not.toHaveBeenCalled()
    expect(harness.sendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('publishes realtime while suppressing push at the quiet-hours start boundary', async () => {
    const harness = createHarness({
      realtimeResult: true,
      preference: {
        pushEnabled: true,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'UTC',
      },
      tokens: ['ExponentPushToken[token-1]'],
    })

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).resolves.toMatchObject({
      realtimePublished: true,
      push: { outcome: 'suppressed', reason: 'quiet_hours' },
    })
    expect(harness.realtimePublisher.publish).toHaveBeenCalledTimes(1)
    expect(harness.repository.findPushTokensByUserId).not.toHaveBeenCalled()
  })

  it('fails safe on an invalid persisted timezone after publishing realtime', async () => {
    const harness = createHarness({
      realtimeResult: true,
      preference: {
        pushEnabled: true,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'Not/A_Timezone',
      },
      tokens: ['ExponentPushToken[token-1]'],
    })

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).resolves.toMatchObject({
      realtimePublished: true,
      push: { outcome: 'suppressed', reason: 'invalid_timezone' },
    })
    expect(harness.realtimePublisher.publish).toHaveBeenCalledTimes(1)
    expect(harness.sendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('audits missing push tokens without calling the provider', async () => {
    const harness = createHarness({ tokens: [] })

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).resolves.toMatchObject({
      realtimePublished: false,
      push: { outcome: 'suppressed', reason: 'no_push_tokens', tokenCount: 0 },
    })
    expect(harness.sendPushNotificationsAsync).not.toHaveBeenCalled()
    expect(harness.repository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'suppressed',
        reason: 'no_push_tokens',
        tokenCount: 0,
      })
    )
  })

  it('rejects the wrong channel before publishing', async () => {
    const harness = createHarness({
      event: {
        id: 'event-1',
        channel: 'lookbook:new',
        payload,
        userId: 'user-1',
        createdAt: now,
      },
    })

    await expect(harness.processor.process({ eventId: 'event-1' }, now)).rejects.toThrow(
      'event-1 is not an alert:weather event'
    )
    expect(harness.realtimePublisher.publish).not.toHaveBeenCalled()
  })

  it('logs a missing stored event without inventing an audit owner', async () => {
    const harness = createHarness({ event: null })

    await expect(harness.processor.process({ eventId: 'event-1' }, now)).rejects.toThrow(
      'Alert event event-1 was not found'
    )
    expect(harness.repository.recordOutcome).not.toHaveBeenCalled()
    expect(harness.realtimePublisher.publish).not.toHaveBeenCalled()
    expect(harness.logger.error).toHaveBeenCalledWith(
      {
        eventId: 'event-1',
        outcome: 'failed',
        realtimePublished: false,
        tokenCount: 0,
        failureStage: 'event_validation',
        errorCode: 'Error',
      },
      'alert_fanout_failed'
    )
    expect(JSON.stringify(harness.logger.error.mock.calls)).not.toContain(
      'ExponentPushToken'
    )
  })

  it('rejects an envelope and payload owner mismatch before publishing', async () => {
    const payloadMismatch = createHarness({
      event: {
        id: 'event-1',
        channel: 'alert:weather',
        payload: { ...payload, userId: 'user-2' },
        userId: 'user-1',
        createdAt: now,
      },
    })
    await expect(
      payloadMismatch.processor.process({ eventId: 'event-1' }, now)
    ).rejects.toThrow('event-1 payload owner does not match user-1')
    expect(payloadMismatch.realtimePublisher.publish).not.toHaveBeenCalled()
  })

  it('rejects an invalid alert payload before publishing', async () => {
    const harness = createHarness({
      event: {
        id: 'event-1',
        channel: 'alert:weather',
        payload: {
          ...payload,
          data: { ...payload.data, message: '' },
        },
        userId: 'user-1',
        createdAt: now,
      },
    })

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).rejects.toMatchObject({ name: 'ZodError' })
    expect(harness.realtimePublisher.publish).not.toHaveBeenCalled()
    expect(harness.repository.findPreferenceByUserId).not.toHaveBeenCalled()
    expect(harness.repository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        userId: 'user-1',
        outcome: 'failed',
        realtimePublished: false,
        failureStage: 'event_validation',
        errorCode: 'ZodError',
      })
    )
  })

  it('marks exhausted network delivery as failed after a best-effort audit', async () => {
    const harness = createHarness({
      tokens: ['ExponentPushToken[token-1]'],
      sendPushNotificationsAsync: () => Promise.reject(new Error('provider unavailable')),
    })
    harness.repository.recordOutcome.mockRejectedValueOnce(
      new Error('audit temporarily unavailable')
    )

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).rejects.toMatchObject({ name: 'AlertPushDeliveryRejectedError' })
    expect(harness.sendPushNotificationsAsync).toHaveBeenCalledTimes(3)
    expect(harness.realtimePublisher.publish).toHaveBeenCalledTimes(1)
    expect(harness.repository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        userId: 'user-1',
        outcome: 'failed',
        realtimePublished: false,
        tokenCount: 1,
        failedTicketCount: 1,
        networkFailedTokenCount: 1,
        failureStage: 'push_provider',
      })
    )
  })

  it('fails the job when every ticket remains rate limited', async () => {
    const harness = createHarness({
      tokens: ['ExponentPushToken[token-1]', 'ExponentPushToken[token-2]'],
      sendPushNotificationsAsync: (messages) =>
        Promise.resolve(
          messages.map(() => ({
            status: 'error',
            message: 'Rate limited',
            details: { error: 'MessageRateExceeded' },
          })) as ExpoPushTicket[]
        ),
    })

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).rejects.toMatchObject({ name: 'AlertPushDeliveryRejectedError' })
    expect(harness.sendPushNotificationsAsync).toHaveBeenCalledTimes(3)
    expect(harness.repository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason: 'provider_rejected',
        successfulTicketCount: 0,
        failedTicketCount: 2,
        rateLimitedTokenCount: 2,
        failureStage: 'push_provider',
      })
    )
  })

  it('does not retry a delivered push when only audit persistence fails', async () => {
    const harness = createHarness({ tokens: ['ExponentPushToken[token-1]'] })
    harness.repository.recordOutcome.mockRejectedValueOnce(
      new Error('audit temporarily unavailable')
    )

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).resolves.toMatchObject({
      realtimePublished: false,
      push: { outcome: 'sent', successfulTicketCount: 1 },
    })
    expect(harness.sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    expect(harness.repository.recordOutcome).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed job data before reading the event store', async () => {
    const harness = createHarness()

    await expect(
      harness.processor.process({ eventId: '   ' }, now)
    ).rejects.toMatchObject({ name: 'ZodError' })
    expect(harness.repository.findEventById).not.toHaveBeenCalled()
  })

  it('rejects an oversized event ID before it can reach structured logs', async () => {
    const harness = createHarness()

    await expect(
      harness.processor.process({ eventId: 'x'.repeat(129) }, now)
    ).rejects.toMatchObject({ name: 'ZodError' })
    expect(harness.repository.findEventById).not.toHaveBeenCalled()
    expect(harness.repository.recordOutcome).not.toHaveBeenCalled()
  })

  it('suppresses push notifications when realtime is successfully published', async () => {
    const harness = createHarness({
      realtimeResult: true,
      tokens: ['ExponentPushToken[token-1]'],
    })

    await expect(
      harness.processor.process({ eventId: 'event-1' }, now)
    ).resolves.toMatchObject({
      realtimePublished: true,
      push: { outcome: 'suppressed', reason: 'realtime_active' },
    })
    expect(harness.sendPushNotificationsAsync).not.toHaveBeenCalled()
  })
})
