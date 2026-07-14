import { Injectable, Inject } from '@nestjs/common'
import { PrismaClient, Prisma } from '@prisma/client'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ANALYTICS_CLIENT, type AnalyticsClient } from '../../analytics/analytics.service'
import {
  trackProfileCompleted,
  trackFirstOutfitGenerated,
  trackForecastViewed,
  trackAlertSent,
  trackLocationSwitched,
  trackApiErrorOccurred,
  type AnalyticsEventName,
  type ProfileCompletedEvent,
  type FirstOutfitGeneratedEvent,
  type ForecastViewedEvent,
  type AlertSentEvent,
  type LocationSwitchedEvent,
  type ApiErrorOccurredEvent,
} from '@couture/api-client'
import { createBaseLogger } from '../../logger/pino.config'

/** Typed properties union covering all telemetry events this service handles. */
export type TelemetryEventProperties =
  | (Omit<ProfileCompletedEvent, 'timestamp'> & Record<string, unknown>)
  | (Omit<FirstOutfitGeneratedEvent, 'timestamp'> & Record<string, unknown>)
  | (Omit<ForecastViewedEvent, 'timestamp'> & Record<string, unknown>)
  | (Omit<AlertSentEvent, 'timestamp'> & Record<string, unknown>)
  | (Omit<LocationSwitchedEvent, 'timestamp'> & Record<string, unknown>)
  | (Omit<ApiErrorOccurredEvent, 'timestamp'> & Record<string, unknown>)
  | Record<string, unknown>

type PostHogPayload = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Type-safe property extractor helpers
// ---------------------------------------------------------------------------
function getString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function getStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function getNumber(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

function getBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

// ---------------------------------------------------------------------------
// Per-event payload builders (one function per event = lower per-function complexity)
// ---------------------------------------------------------------------------
function buildProfileCompleted(
  userId: string,
  props: Record<string, unknown>,
  timestamp: string
): PostHogPayload {
  return trackProfileCompleted({
    userId,
    age: getNumber(props['age']),
    guardianConsentRequired:
      getBool(props['guardianConsentRequired']) ||
      getBool(props['guardian_consent_required']),
    timestamp,
  })
}

function buildFirstOutfitGenerated(
  userId: string,
  props: Record<string, unknown>,
  timestamp: string
): PostHogPayload {
  return trackFirstOutfitGenerated({
    userId,
    locationId: getString(props['locationId'] ?? props['location_id']),
    timestamp,
    isFirstOutfit: getBool(props['isFirstOutfit'] ?? props['is_first_outfit'], true),
  })
}

function buildForecastViewed(
  userId: string,
  props: Record<string, unknown>,
  timestamp: string
): PostHogPayload {
  return trackForecastViewed({
    userId,
    locationKey: getString(props['locationKey'] ?? props['location_key']),
    status: getString(props['status']),
    timestamp,
  })
}

function buildAlertSent(
  userId: string,
  props: Record<string, unknown>,
  timestamp: string
): PostHogPayload {
  return trackAlertSent({
    userId,
    alertType: getString(props['alertType'] ?? props['alert_type']),
    severity: (props['severity'] as 'info' | 'warning' | 'critical') ?? 'info',
    channel: (props['channel'] as 'realtime' | 'push') ?? 'realtime',
    timestamp,
  })
}

function buildLocationSwitched(
  userId: string,
  props: Record<string, unknown>,
  timestamp: string
): PostHogPayload {
  return trackLocationSwitched({
    userId,
    fromLocation: getStringOrNull(props['fromLocation'] ?? props['from_location']),
    toLocation: getString(props['toLocation'] ?? props['to_location']),
    timestamp,
  })
}

function buildApiErrorOccurred(
  userId: string | null,
  props: Record<string, unknown>,
  timestamp: string
): PostHogPayload {
  return trackApiErrorOccurred({
    userId: getStringOrNull(userId ?? props['userId'] ?? props['user_id']),
    endpoint: getString(props['endpoint']),
    method: getString(props['method']),
    statusCode: getNumber(props['statusCode'] ?? props['status_code']),
    errorMessage: getString(props['errorMessage'] ?? props['error_message']),
    timestamp,
  })
}

const eventBuilders: Partial<
  Record<
    AnalyticsEventName,
    (userId: string | null, props: Record<string, unknown>, ts: string) => PostHogPayload
  >
> = {
  profile_completed: (uid, p, ts) => buildProfileCompleted(getString(uid ?? ''), p, ts),
  first_outfit_generated: (uid, p, ts) =>
    buildFirstOutfitGenerated(getString(uid ?? ''), p, ts),
  forecast_viewed: (uid, p, ts) => buildForecastViewed(getString(uid ?? ''), p, ts),
  alert_sent: (uid, p, ts) => buildAlertSent(getString(uid ?? ''), p, ts),
  location_switched: (uid, p, ts) => buildLocationSwitched(getString(uid ?? ''), p, ts),
  api_error_occurred: (uid, p, ts) => buildApiErrorOccurred(uid, p, ts),
}

@Injectable()
export class TelemetryService {
  private readonly logger = createBaseLogger().child({ feature: 'telemetry' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(ANALYTICS_CLIENT) private readonly analyticsClient: AnalyticsClient
  ) {}

  async captureEvent(
    userId: string | null,
    eventType: AnalyticsEventName,
    properties: Record<string, unknown>
  ): Promise<void> {
    try {
      // 1. Persist to Postgres database
      await this.prisma.telemetryEvent.create({
        data: {
          user_id: userId,
          event_type: eventType,
          properties: properties as Prisma.InputJsonValue,
        },
      })
    } catch (dbError: unknown) {
      // Robustness: Database failures MUST NOT crash the application or prevent PostHog delivery.
      this.logger.error(
        { dbError, eventType, userId },
        'Failed to persist telemetry event to database'
      )
    }

    try {
      // 2. Format payload via packages/api-client wrappers and call analyticsClient.capture(...)
      const timestamp = new Date().toISOString()
      const resolvedUserId =
        userId ?? getString(properties['userId']) ?? getString(properties['user_id'])
      const builder = eventBuilders[eventType]
      const payload = builder ? builder(resolvedUserId, properties, timestamp) : null

      if (payload) {
        this.analyticsClient.capture({
          distinctId: payload.distinctId,
          event: payload.event,
          properties: payload.properties,
        })
      }
    } catch (phError: unknown) {
      // Robustness: PostHog failures MUST NOT crash the application or prevent database persistence.
      this.logger.error(
        { phError, eventType, userId },
        'Failed to dispatch telemetry event to PostHog'
      )
    }
  }

  async trackOutfitGenerated(userId: string, locationId: string): Promise<void> {
    try {
      const count = await this.prisma.outfitRecommendation.count({
        where: { user_id: userId },
      })

      if (count === 1) {
        await this.captureEvent(userId, 'first_outfit_generated', {
          userId,
          locationId,
          isFirstOutfit: true,
        })
      }
    } catch (error: unknown) {
      this.logger.error(
        { error, userId, locationId },
        'Failed to track outfit generated telemetry'
      )
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async pruneOldTelemetryEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    try {
      const deleteResult = await this.prisma.telemetryEvent.deleteMany({
        where: {
          created_at: {
            lt: cutoff,
          },
        },
      })
      this.logger.info(
        { deletedCount: deleteResult.count },
        'Pruned old telemetry events'
      )
    } catch (pruneError: unknown) {
      this.logger.error({ pruneError }, 'Failed to prune old telemetry events')
    }
  }
}
