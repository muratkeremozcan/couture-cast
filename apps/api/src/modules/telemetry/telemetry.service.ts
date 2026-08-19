import { Injectable, Inject } from '@nestjs/common'
import { createHmac } from 'node:crypto'
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
  trackGarmentUploadCompleted,
  trackGarmentTaggingCompleted,
  trackAffiliateCtaClicked,
  trackAffiliateConversionRecorded,
  trackPremiumCheckoutStarted,
  trackPremiumEntitlementActivated,
  trackPremiumEntitlementDeactivated,
  trackPremiumThemeSelected,
  garmentTaggingCompletedEventSchema,
  affiliateCtaClickedEventSchema,
  affiliateConversionRecordedEventSchema,
  premiumCheckoutStartedEventSchema,
  premiumEntitlementActivatedEventSchema,
  premiumEntitlementDeactivatedEventSchema,
  premiumThemeSelectedEventSchema,
  type AnalyticsEventName,
  type AffiliateCtaClickedEvent,
  type AffiliateConversionRecordedEvent,
  type GarmentTaggingCompletedProperties,
  type PremiumCheckoutStartedEvent,
  type PremiumEntitlementActivatedEvent,
  type PremiumEntitlementDeactivatedEvent,
  type PremiumThemeSelectedEvent,
} from '@couture/api-client'
import { allowsTestOnlySecrets } from '../../config/runtime-environment'
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
  garment_upload_completed: {
    garmentId: string
    fileSizeBytes: number
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    hasCropping: boolean
    hasBgCleanup: boolean
    durationMs: number
  }
  garment_tagging_completed: {
    analyticsSubjectId: string
    garmentId: string
    suggestedCategory:
      | 'top'
      | 'bottom'
      | 'outerwear'
      | 'dress'
      | 'shoes'
      | 'accessory'
      | null
    confirmedCategory: 'top' | 'bottom' | 'outerwear' | 'dress' | 'shoes' | 'accessory'
    suggestedMaterial:
      | 'cotton'
      | 'wool'
      | 'linen'
      | 'leather'
      | 'denim'
      | 'fleece'
      | 'synthetic'
      | 'down'
      | 'silk'
      | null
    confirmedMaterial:
      | 'cotton'
      | 'wool'
      | 'linen'
      | 'leather'
      | 'denim'
      | 'fleece'
      | 'synthetic'
      | 'down'
      | 'silk'
      | null
    suggestedComfortRange: 'cold' | 'cool' | 'mild' | 'warm' | 'hot' | null
    confirmedComfortRange: 'cold' | 'cool' | 'mild' | 'warm' | 'hot'
    suggestionAvailable: boolean
    analysisVersion: string | null
    wasOverridden: boolean
    overrideFields: ('category' | 'material' | 'comfort_range')[]
  }
  /**
   * Story 5.1. Both affiliate server events omit `analyticsSubjectId`: callers do
   * not hold the pseudonymization secret, so the subject is derived here from the
   * raw user id passed as `captureEvent`'s first argument.
   */
  affiliate_cta_clicked: Omit<AffiliateCtaClickedEvent, 'analyticsSubjectId'>
  affiliate_conversion_recorded: Omit<
    AffiliateConversionRecordedEvent,
    'analyticsSubjectId'
  >
  /**
   * Story 5.2. Same rule as the affiliate server events: callers pass the raw
   * user id as `captureEvent`'s first argument and the HMAC subject is derived
   * here. premium_subscribe_tapped is client-side only and deliberately absent.
   */
  premium_checkout_started: Omit<PremiumCheckoutStartedEvent, 'analyticsSubjectId'>
  premium_entitlement_activated: Omit<
    PremiumEntitlementActivatedEvent,
    'analyticsSubjectId'
  >
  premium_entitlement_deactivated: Omit<
    PremiumEntitlementDeactivatedEvent,
    'analyticsSubjectId'
  >
  /**
   * Story 5.3. Same rule again. `theme: null` is the Default palette, so a reset
   * is a measurable selection rather than a missing event.
   */
  premium_theme_selected: Omit<PremiumThemeSelectedEvent, 'analyticsSubjectId'>
}

/**
 * Derived from the published event schemas rather than restated, so a property
 * added to the contract cannot silently bypass validation here. `.strict()` is
 * what stops a caller from smuggling a URL, a product title, or a raw user id
 * into a commerce event.
 */
const affiliateCtaClickedInputSchema = affiliateCtaClickedEventSchema
  .omit({ analyticsSubjectId: true })
  .strict()

const affiliateConversionRecordedInputSchema = affiliateConversionRecordedEventSchema
  .omit({ analyticsSubjectId: true })
  .strict()

const premiumCheckoutStartedInputSchema = premiumCheckoutStartedEventSchema
  .omit({ analyticsSubjectId: true })
  .strict()

const premiumEntitlementActivatedInputSchema = premiumEntitlementActivatedEventSchema
  .omit({ analyticsSubjectId: true })
  .strict()

const premiumEntitlementDeactivatedInputSchema = premiumEntitlementDeactivatedEventSchema
  .omit({ analyticsSubjectId: true })
  .strict()

const premiumThemeSelectedInputSchema = premiumThemeSelectedEventSchema
  .omit({ analyticsSubjectId: true })
  .strict()

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
  garment_upload_completed: z
    .object({
      garmentId: z.string().min(1).max(64),
      fileSizeBytes: z.number().int().min(1).max(10_485_760),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      hasCropping: z.boolean(),
      hasBgCleanup: z.boolean(),
      durationMs: z.number().int().min(0).max(86_400_000),
    })
    .strict(),
  garment_tagging_completed: garmentTaggingCompletedEventSchema,
  affiliate_cta_clicked: affiliateCtaClickedInputSchema,
  affiliate_conversion_recorded: affiliateConversionRecordedInputSchema,
  premium_checkout_started: premiumCheckoutStartedInputSchema,
  premium_entitlement_activated: premiumEntitlementActivatedInputSchema,
  premium_entitlement_deactivated: premiumEntitlementDeactivatedInputSchema,
  premium_theme_selected: premiumThemeSelectedInputSchema,
}

export function requireAnalyticsIdSecret(): string {
  const configuredSecret = process.env.ANALYTICS_ID_SECRET?.trim()
  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret
  }
  if (allowsTestOnlySecrets()) {
    return 'test-only-analytics-id-secret-at-least-32-bytes'
  }
  throw new Error('ANALYTICS_ID_SECRET must contain at least 32 characters')
}

/**
 * The one place a raw user id becomes an analytics subject. Exported because
 * every pseudonymous event across the API has to produce the same subject for the
 * same user, and a second implementation somewhere else would silently split one
 * person into two identities in PostHog.
 */
export function buildAnalyticsSubjectId(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(userId).digest('base64url')
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

function buildGarmentUploadCompleted(
  userId: string | null,
  props: Record<string, unknown>,
  analyticsIdSecret: string
): PostHogPayload {
  const rawUserId = getString(userId)
  if (!rawUserId) {
    throw new Error('Garment telemetry requires an authenticated user')
  }
  const mimeType = props['mimeType'] as 'image/jpeg' | 'image/png' | 'image/webp'

  return trackGarmentUploadCompleted({
    analyticsSubjectId: buildAnalyticsSubjectId(rawUserId, analyticsIdSecret),
    garmentId: getString(props['garmentId']),
    fileSizeBytes: getNumber(props['fileSizeBytes']),
    mimeType,
    hasCropping: getBool(props['hasCropping']),
    hasBgCleanup: getBool(props['hasBgCleanup']),
    durationMs: getNumber(props['durationMs']),
  })
}

function buildGarmentTaggingCompleted(
  userId: string | null,
  props: Record<string, unknown>,
  analyticsIdSecret: string
): PostHogPayload {
  const rawUserId = getString(userId)
  if (!rawUserId) {
    throw new Error('Garment telemetry requires an authenticated user')
  }

  return trackGarmentTaggingCompleted({
    analyticsSubjectId: buildAnalyticsSubjectId(rawUserId, analyticsIdSecret),
    garmentId: getString(props['garmentId']),
    suggestedCategory:
      (props[
        'suggestedCategory'
      ] as GarmentTaggingCompletedProperties['suggested_category']) ?? null,
    confirmedCategory: props[
      'confirmedCategory'
    ] as GarmentTaggingCompletedProperties['confirmed_category'],
    suggestedMaterial:
      (props[
        'suggestedMaterial'
      ] as GarmentTaggingCompletedProperties['suggested_material']) ?? null,
    confirmedMaterial:
      (props[
        'confirmedMaterial'
      ] as GarmentTaggingCompletedProperties['confirmed_material']) ?? null,
    suggestedComfortRange:
      (props[
        'suggestedComfortRange'
      ] as GarmentTaggingCompletedProperties['suggested_comfort_range']) ?? null,
    confirmedComfortRange: props[
      'confirmedComfortRange'
    ] as GarmentTaggingCompletedProperties['confirmed_comfort_range'],
    suggestionAvailable: getBool(props['suggestionAvailable']),
    analysisVersion: getStringOrNull(props['analysisVersion']),
    wasOverridden: getBool(props['wasOverridden']),
    overrideFields:
      (props['overrideFields'] as GarmentTaggingCompletedProperties['override_fields']) ??
      [],
  })
}

function buildAffiliateCtaClicked(
  userId: string | null,
  props: Record<string, unknown>,
  analyticsIdSecret: string
): PostHogPayload {
  const rawUserId = getString(userId)
  if (!rawUserId) {
    throw new Error('Affiliate click telemetry requires an authenticated user')
  }

  // Re-parsed rather than cast. The validator above already ran, so this costs
  // one pass over five fields and buys full type safety with no `as` in sight,
  // which is what the repo's strict-TypeScript rule asks for.
  const parsed = affiliateCtaClickedInputSchema.parse(props)

  return trackAffiliateCtaClicked({
    ...parsed,
    analyticsSubjectId: buildAnalyticsSubjectId(rawUserId, analyticsIdSecret),
  })
}

function buildAffiliateConversionRecorded(
  userId: string | null,
  props: Record<string, unknown>,
  analyticsIdSecret: string
): PostHogPayload {
  const parsed = affiliateConversionRecordedInputSchema.parse(props)
  const rawUserId = getString(userId)

  if (parsed.matched && !rawUserId) {
    // A matched conversion without a user is a contradiction that would publish
    // the partner slug as if it were a person's pseudonym, quietly corrupting
    // every per-user conversion metric. Better to fail the emission.
    throw new Error(
      'Affiliate conversion telemetry marked matched must carry the matched click owner'
    )
  }

  return trackAffiliateConversionRecorded({
    ...parsed,
    // An unmatched conversion has no user subject at all. The partner slug stands
    // in: it is operator-controlled, already present in the properties, and
    // carries no personal data.
    analyticsSubjectId: rawUserId
      ? buildAnalyticsSubjectId(rawUserId, analyticsIdSecret)
      : parsed.partnerId,
  })
}

function buildPremiumCheckoutStarted(
  userId: string | null,
  props: Record<string, unknown>,
  analyticsIdSecret: string
): PostHogPayload {
  const rawUserId = getString(userId)
  if (!rawUserId) {
    throw new Error('Premium telemetry requires an authenticated user')
  }
  const parsed = premiumCheckoutStartedInputSchema.parse(props)

  return trackPremiumCheckoutStarted({
    ...parsed,
    analyticsSubjectId: buildAnalyticsSubjectId(rawUserId, analyticsIdSecret),
  })
}

function buildPremiumEntitlementActivated(
  userId: string | null,
  props: Record<string, unknown>,
  analyticsIdSecret: string
): PostHogPayload {
  const rawUserId = getString(userId)
  if (!rawUserId) {
    throw new Error('Premium telemetry requires an authenticated user')
  }
  const parsed = premiumEntitlementActivatedInputSchema.parse(props)

  return trackPremiumEntitlementActivated({
    ...parsed,
    analyticsSubjectId: buildAnalyticsSubjectId(rawUserId, analyticsIdSecret),
  })
}

function buildPremiumEntitlementDeactivated(
  userId: string | null,
  props: Record<string, unknown>,
  analyticsIdSecret: string
): PostHogPayload {
  const rawUserId = getString(userId)
  if (!rawUserId) {
    throw new Error('Premium telemetry requires an authenticated user')
  }
  const parsed = premiumEntitlementDeactivatedInputSchema.parse(props)

  return trackPremiumEntitlementDeactivated({
    ...parsed,
    analyticsSubjectId: buildAnalyticsSubjectId(rawUserId, analyticsIdSecret),
  })
}

function buildPremiumThemeSelected(
  userId: string | null,
  props: Record<string, unknown>,
  analyticsIdSecret: string
): PostHogPayload {
  const rawUserId = getString(userId)
  if (!rawUserId) {
    throw new Error('Premium telemetry requires an authenticated user')
  }
  const parsed = premiumThemeSelectedInputSchema.parse(props)

  return trackPremiumThemeSelected({
    ...parsed,
    analyticsSubjectId: buildAnalyticsSubjectId(rawUserId, analyticsIdSecret),
  })
}

/**
 * Events whose PostHog subject is the HMAC pseudonym rather than a raw user id.
 * Membership here drives three things at once: `TelemetryEvent.user_id` is
 * persisted as null, the persisted properties are the mapped payload rather than
 * the caller's input, and `$ip: null` is attached on dispatch.
 *
 * This is a set and a lookup table rather than the pair of hard-coded
 * two-value conditionals it replaced, because the previous shape required
 * editing three separate expressions in lockstep to add one event, and getting
 * two of the three right leaks a raw user id.
 */
const PSEUDONYMOUS_EVENT_TYPES: ReadonlySet<AnalyticsEventName> = new Set([
  'garment_upload_completed',
  'garment_tagging_completed',
  'affiliate_cta_clicked',
  'affiliate_conversion_recorded',
  'premium_checkout_started',
  'premium_entitlement_activated',
  'premium_entitlement_deactivated',
  'premium_theme_selected',
])

const pseudonymousEventBuilders: Partial<
  Record<
    AnalyticsEventName,
    (
      userId: string | null,
      props: Record<string, unknown>,
      analyticsIdSecret: string
    ) => PostHogPayload
  >
> = {
  garment_upload_completed: buildGarmentUploadCompleted,
  garment_tagging_completed: buildGarmentTaggingCompleted,
  affiliate_cta_clicked: buildAffiliateCtaClicked,
  affiliate_conversion_recorded: buildAffiliateConversionRecorded,
  premium_checkout_started: buildPremiumCheckoutStarted,
  premium_entitlement_activated: buildPremiumEntitlementActivated,
  premium_entitlement_deactivated: buildPremiumEntitlementDeactivated,
  premium_theme_selected: buildPremiumThemeSelected,
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
  private readonly analyticsIdSecret: string

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(ANALYTICS_CLIENT) private readonly analyticsClient: AnalyticsClient
  ) {
    this.analyticsIdSecret = requireAnalyticsIdSecret()
  }

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

    const timestamp = new Date().toISOString()
    const resolvedUserId =
      userId ??
      getStringOrNull(properties['userId']) ??
      getStringOrNull(properties['user_id'])
    const pseudonymousBuilder = pseudonymousEventBuilders[eventType]
    const payload = pseudonymousBuilder
      ? pseudonymousBuilder(resolvedUserId, properties, this.analyticsIdSecret)
      : (eventBuilders[eventType]?.(resolvedUserId, properties, timestamp) ?? null)
    const isPseudonymousEvent = PSEUDONYMOUS_EVENT_TYPES.has(eventType)
    const persistedProperties =
      isPseudonymousEvent && payload ? payload.properties : properties

    // 1. Start database persistence asynchronously (without awaiting)
    const dbPromise = this.prisma.telemetryEvent
      .create({
        data: {
          user_id: isPseudonymousEvent ? null : userId,
          event_type: eventType,
          properties: persistedProperties as Prisma.InputJsonValue,
        },
      })
      .catch((dbError: unknown) => {
        // Robustness: Database failures MUST NOT crash the application or prevent PostHog delivery.
        this.logger.error(
          {
            dbError,
            eventType,
            subject: isPseudonymousEvent ? payload?.distinctId : userId,
          },
          'Failed to persist telemetry event to database'
        )
      })

    // 2. Format payload via packages/api-client wrappers and call analyticsClient.capture(...)
    try {
      if (payload) {
        this.analyticsClient.capture({
          distinctId: payload.distinctId,
          event: payload.event,
          properties: isPseudonymousEvent
            ? { ...payload.properties, $ip: null }
            : payload.properties,
        })
      }
    } catch (phError: unknown) {
      // Robustness: PostHog failures MUST NOT crash the application or prevent database persistence.
      this.logger.error(
        {
          phError,
          eventType,
          subject: isPseudonymousEvent ? payload?.distinctId : userId,
        },
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
