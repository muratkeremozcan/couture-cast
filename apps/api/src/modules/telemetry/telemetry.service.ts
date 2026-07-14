import { Injectable, Inject } from '@nestjs/common'
import { PrismaClient, Prisma } from '@prisma/client'
import { Cron, CronExpression } from '@nestjs/schedule'
import { z } from 'zod'
import { ANALYTICS_CLIENT, type AnalyticsClient } from '../../analytics/analytics.service'
import {
  trackProfileCompleted,
  trackFirstOutfitGenerated,
  trackForecastViewed,
  trackAlertSent,
  trackLocationSwitched,
  trackApiErrorOccurred,
  type AnalyticsEventName,
} from '@couture/api-client'
import { createBaseLogger } from '../../logger/pino.config'

export interface TelemetryPropertiesMap {
  profile_completed: {
    age: number
    guardianConsentRequired?: boolean
    guardian_consent_required?: boolean
  } & Record<string, unknown>
  first_outfit_generated: {
    locationId?: string
    location_id?: string
    isFirstOutfit?: boolean
    is_first_outfit?: boolean
  } & Record<string, unknown>
  forecast_viewed: {
    locationKey?: string
    location_key?: string
    status: string
  } & Record<string, unknown>
  alert_sent: {
    alertType?: string
    alert_type?: string
    severity: 'info' | 'warning' | 'critical'
    channel: 'realtime' | 'push'
  } & Record<string, unknown>
  location_switched: {
    fromLocation: string | null
    from_location?: string | null
    toLocation: string
    to_location?: string
  } & Record<string, unknown>
  api_error_occurred: {
    route?: string
    endpoint?: string
    method: string
    statusCode?: number
    status_code?: number
    errorCode?: string
    error_code?: string
    errorMessage?: string
    error_message?: string
  } & Record<string, unknown>
}

const telemetryValidators: Record<keyof TelemetryPropertiesMap, z.ZodSchema> = {
  profile_completed: z.object({
    age: z.number().int().positive(),
  }),
  first_outfit_generated: z.object({}),
  forecast_viewed: z.object({
    status: z.string(),
  }),
  alert_sent: z.object({
    severity: z.enum(['info', 'warning', 'critical']),
    channel: z.enum(['realtime', 'push']),
  }),
  location_switched: z.object({}),
  api_error_occurred: z.object({
    method: z.string(),
  }),
}

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

function hashStringToInteger(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

// ---------------------------------------------------------------------------
// Per-event payload builders
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const route = getString(props['route'] ?? props['endpoint'])
  const errorCodeVal = getString(
    props['errorCode'] ??
      props['error_code'] ??
      props['errorMessage'] ??
      props['error_message']
  )
  return trackApiErrorOccurred({
    userId: getStringOrNull(userId ?? props['userId'] ?? props['user_id']),
    route: route !== '' ? route : 'unknown',
    method: getString(props['method']) !== '' ? getString(props['method']) : 'unknown',
    statusCode: getNumber(props['statusCode'] ?? props['status_code']),
    errorCode: errorCodeVal !== '' ? errorCodeVal : 'INTERNAL_ERROR',
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

  async captureEvent<T extends keyof TelemetryPropertiesMap>(
    userId: string | null,
    eventType: T,
    properties: TelemetryPropertiesMap[T]
  ): Promise<void> {
    // Runtime validation before any execution
    const validator = telemetryValidators[eventType]
    if (validator) {
      validator.parse(properties)
    }

    // 1. Start database persistence asynchronously (without awaiting)
    const dbPromise = this.prisma.telemetryEvent
      .create({
        data: {
          user_id: userId,
          event_type: eventType,
          properties: properties as Prisma.InputJsonValue,
        },
      })
      .catch((dbError: unknown) => {
        // Robustness: Database failures MUST NOT crash the application or prevent PostHog delivery.
        this.logger.error(
          { dbError, eventType, userId },
          'Failed to persist telemetry event to database'
        )
      })

    // 2. Format payload via packages/api-client wrappers and call analyticsClient.capture(...)
    try {
      const timestamp = new Date().toISOString()
      const resolvedUserId =
        userId ??
        getStringOrNull(properties['userId']) ??
        getStringOrNull(properties['user_id'])
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

    // Await dbPromise to ensure database writes are settled before the captureEvent promise resolves.
    await dbPromise
  }

  async trackOutfitGenerated(userId: string, locationId: string): Promise<void> {
    try {
      const lockId = hashStringToInteger(`first_outfit_${userId}`)
      // Fallback safely to non-transactional check if $transaction is not mocked or available
      if (typeof this.prisma.$transaction !== 'function') {
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
        return
      }

      await this.prisma.$transaction(async (tx) => {
        // Acquire an advisory lock for this user's first outfit check (Postgres only)
        try {
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockId})`)
        } catch {
          // Ignore locks if database does not support them (e.g. during test setup or SQLite)
        }

        const count = await tx.outfitRecommendation.count({
          where: { user_id: userId },
        })

        if (count === 1) {
          // Double-check lock: check if first_outfit_generated was already captured
          const alreadyCaptured = await tx.telemetryEvent.findFirst({
            where: {
              user_id: userId,
              event_type: 'first_outfit_generated',
            },
          })

          if (!alreadyCaptured) {
            await this.captureEvent(userId, 'first_outfit_generated', {
              userId,
              locationId,
              isFirstOutfit: true,
            })
          }
        }
      })
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
