import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'

import { AlertFanoutProcessor } from '../src/modules/alerts/alert-fanout.processor'
import type {
  AlertFanoutAuditInput,
  AlertFanoutRepository,
  AlertFanoutStoredEvent,
  AlertRealtimePublisher,
} from '../src/modules/alerts/alert-fanout.types'
import { WeatherAlertFanoutQueue } from '../src/modules/alerts/weather-alert-fanout.queue'
import type {
  WeatherAlertEventInput,
  WeatherAlertProcessingRepository,
} from '../src/modules/alerts/weather-alert-processing.repository'
import { WeatherAlertProcessingService } from '../src/modules/alerts/weather-alert-processing.service'
import { PushNotificationService } from '../src/modules/notifications/push-notification.service'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service'
import type {
  NormalizedWeatherForecast,
  WeatherIngestionTarget,
} from '../src/modules/weather/providers/weather.types'
import { WeatherIngestionService } from '../src/modules/weather/weather-ingestion.service'

const SECOND_MS = 1_000
const DELIVERY_DEADLINE_MS = 60 * SECOND_MS
const userId = 'latency-user'
const locationKey = 'chicago-il'

class TestClock {
  constructor(private instantMs: number) {}

  now = (): Date => new Date(this.instantMs)

  advance(milliseconds: number): void {
    this.instantMs += milliseconds
  }
}

function buildForecast(triggeredAt: Date): NormalizedWeatherForecast {
  return {
    provider: 'openweather',
    locationKey,
    locationName: 'Chicago, IL',
    latitude: 41.8781,
    longitude: -87.6298,
    timezone: 'America/Chicago',
    providerUpdatedAt: triggeredAt,
    fetchedAt: triggeredAt,
    current: {
      temperature: 18,
      feelsLike: 18,
      windSpeed: 3,
      humidity: 50,
      condition: 'clear',
      providerConditionText: 'clear sky',
      providerWeatherCode: '800',
    },
    hourly: Array.from({ length: 48 }, (_, index) => ({
      forecastAt: new Date(triggeredAt.getTime() + (index + 1) * 60 * 60 * 1_000),
      temperature: index === 3 ? 29 : 18,
      feelsLike: index === 3 ? 29 : 18,
      precipitationProbability: 0,
      precipitationAmount: 0,
      windSpeed: 3,
      windGust: 4,
      condition: 'clear' as const,
      providerConditionText: 'clear sky',
      providerWeatherCode: '800',
    })),
    alerts: [],
  }
}

describe('weather alert delivery latency integration', () => {
  it('persists, enqueues, and completes fanout within 60 seconds of a rule trigger', async () => {
    const clock = new TestClock(Date.parse('2026-07-13T15:00:00.000Z'))
    const forecast = buildForecast(clock.now())
    const lifecycle: string[] = []
    const storedEvents = new Map<string, WeatherAlertEventInput>()
    const pendingEventIds = new Set<string>()
    const queuedJobs: { data: { eventId: string }; opts?: { jobId?: string } }[] = []
    const audits: AlertFanoutAuditInput[] = []
    const realtimeDeliveries: {
      eventId: string
      userId: string
      deliveredAt: Date
    }[] = []
    const pushBatches: ExpoPushMessage[][] = []

    const processingRepository: WeatherAlertProcessingRepository = {
      findEnabledRulesForPrimaryLocation(requestedLocationKey) {
        expect(requestedLocationKey).toBe(locationKey)
        clock.advance(SECOND_MS)
        return Promise.resolve([
          {
            id: 'temperature-rule',
            userId,
            ruleType: 'temperature',
            threshold: 5,
            enabled: true,
          },
        ])
      },
      createEvents(events) {
        clock.advance(2 * SECOND_MS)
        for (const event of events) {
          storedEvents.set(event.id, event)
          pendingEventIds.add(event.id)
        }
        lifecycle.push('event:persisted')
        return Promise.resolve(events)
      },
      findPendingEvents() {
        return Promise.resolve(
          [...pendingEventIds].flatMap((eventId) => {
            const event = storedEvents.get(eventId)
            return event ? [event] : []
          })
        )
      },
      markEventsDispatched(eventIds) {
        for (const eventId of eventIds) pendingEventIds.delete(eventId)
        return Promise.resolve()
      },
      recordDispatchFailure: vi.fn(),
    }
    const queueClient = {
      addBulk(jobs: typeof queuedJobs) {
        expect(storedEvents.size).toBe(1)
        clock.advance(SECOND_MS)
        queuedJobs.push(...jobs)
        lifecycle.push('queue:enqueued')
        return Promise.resolve([])
      },
    }
    const fanoutQueue = new WeatherAlertFanoutQueue(queueClient as never)
    const alertProcessingService = new WeatherAlertProcessingService(
      processingRepository,
      clock,
      fanoutQueue
    )

    const fanoutRepository: AlertFanoutRepository = {
      findEventById(eventId): Promise<AlertFanoutStoredEvent | null> {
        clock.advance(SECOND_MS)
        const event = storedEvents.get(eventId)
        return Promise.resolve(
          event
            ? {
                id: event.id,
                channel: event.channel,
                payload: event.payload,
                userId: event.userId,
                createdAt: event.createdAt,
              }
            : null
        )
      },
      findPreferenceByUserId(requestedUserId) {
        expect(requestedUserId).toBe(userId)
        clock.advance(SECOND_MS)
        return Promise.resolve({
          pushEnabled: true,
          quietHoursEnabled: false,
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'America/Chicago',
        })
      },
      findPushTokensByUserId(requestedUserId) {
        expect(requestedUserId).toBe(userId)
        clock.advance(SECOND_MS)
        return Promise.resolve(['ExponentPushToken[latency-test-token]'])
      },
      recordOutcome(input) {
        clock.advance(SECOND_MS)
        audits.push(input)
        lifecycle.push('audit:recorded')
        return Promise.resolve()
      },
      hasRealtimeBeenPublished() {
        return Promise.resolve(false)
      },
    }
    const realtimePublisher: AlertRealtimePublisher = {
      publish(eventId: string, ownerId: string) {
        clock.advance(2 * SECOND_MS)
        realtimeDeliveries.push({
          eventId,
          userId: ownerId,
          deliveredAt: clock.now(),
        })
        lifecycle.push('realtime:published')
        return Promise.resolve(false)
      },
    }
    const expoClient = {
      sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
        clock.advance(4 * SECOND_MS)
        pushBatches.push(messages)
        lifecycle.push('push:sent')
        return Promise.resolve(
          messages.map((_, index) => ({
            status: 'ok',
            id: `latency-ticket-${index}`,
          }))
        )
      },
    }
    const pushService = new PushNotificationService({} as never, expoClient)
    const fanoutProcessor = new AlertFanoutProcessor(
      fanoutRepository,
      realtimePublisher,
      pushService,
      { captureEvent: () => Promise.resolve() } as unknown as TelemetryService,
      pino({ level: 'silent' })
    )

    const weatherRepository = {
      persistForecast() {
        clock.advance(4 * SECOND_MS)
        lifecycle.push('forecast:persisted')
        return Promise.resolve({
          id: 'weather-snapshot-1',
          location: 'Chicago, IL',
          fetched_at: forecast.fetchedAt,
          segments: [],
        })
      },
      recordProviderSuccess() {
        clock.advance(SECOND_MS)
        return Promise.resolve()
      },
      recordProviderFailure: vi.fn(),
    }
    const ingestionService = new WeatherIngestionService(
      {
        fetchForecast(target: WeatherIngestionTarget) {
          expect(target.locationKey).toBe(locationKey)
          clock.advance(3 * SECOND_MS)
          return Promise.resolve(forecast)
        },
      },
      { fetchForecast: vi.fn() },
      weatherRepository as never,
      { getLatestWeather: vi.fn() } as never,
      clock,
      vi.fn(),
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      {
        recordProviderRequest: vi.fn(),
        recordRateLimit: vi.fn(),
        recordIngestion: vi.fn(),
        recordFallbackOutcome: vi.fn(),
        recordSnapshotAge: vi.fn(),
      },
      alertProcessingService
    )

    await expect(
      ingestionService.ingestTarget(
        {
          locationKey,
          locationName: 'Chicago, IL',
          latitude: 41.8781,
          longitude: -87.6298,
        },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ outcome: 'persisted', provider: 'openweather' })

    expect(queuedJobs).toHaveLength(1)
    const queuedJob = queuedJobs[0]
    expect(queuedJob?.opts?.jobId).toBe(queuedJob?.data.eventId)

    clock.advance(30 * SECOND_MS)
    const fanoutResult = await fanoutProcessor.process(queuedJob!.data, clock.now())

    const storedEvent = storedEvents.get(queuedJob!.data.eventId)
    expect(storedEvent?.payload.data).toMatchObject({
      alertType: 'temperature',
      location: 'Chicago, IL',
      severity: 'warning',
    })
    expect(realtimeDeliveries).toHaveLength(1)
    expect(pushBatches).toHaveLength(1)
    expect(pushBatches[0]?.[0]).toMatchObject({
      to: 'ExponentPushToken[latency-test-token]',
      data: {
        eventId: queuedJob?.data.eventId,
        channel: 'alert:weather',
        alertType: 'temperature',
        location: 'Chicago, IL',
        severity: 'warning',
      },
    })
    expect(fanoutResult).toMatchObject({
      eventId: queuedJob?.data.eventId,
      userId,
      realtimePublished: false,
      push: { outcome: 'sent', successfulTicketCount: 1 },
    })
    expect(audits).toEqual([
      expect.objectContaining({
        eventId: queuedJob?.data.eventId,
        userId,
        outcome: 'sent',
        realtimePublished: false,
      }),
    ])
    expect(lifecycle).toEqual([
      'forecast:persisted',
      'event:persisted',
      'queue:enqueued',
      'realtime:published',
      'push:sent',
      'audit:recorded',
    ])

    const triggerTime = new Date(storedEvent!.payload.timestamp)
    const fanoutCompletedAt = clock.now()
    expect(fanoutCompletedAt.getTime() - triggerTime.getTime()).toBeLessThanOrEqual(
      DELIVERY_DEADLINE_MS
    )
    expect(realtimeDeliveries[0]!.deliveredAt.getTime() - triggerTime.getTime()).toBe(
      37 * SECOND_MS
    )
  })
})
