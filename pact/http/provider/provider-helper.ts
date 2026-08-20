// Step 22 step 6 owner: mock localized database state response in Pact provider tests in pact/http/provider/provider-helper.ts

/**
 * Mirrors the identifiers the consumer contract pins in
 * `pact/http/consumer/api-contract-interactions.ts`. Both sides must agree or
 * the pinned `string()` matchers fail verification.
 */
const PACT_CAPSULE_OWNER_ID = 'guardian-1'
const PACT_CAPSULE_ID = '00000000-0000-4000-8000-0000000000c1'
const PACT_CAPSULE_GARMENT_A = '00000000-0000-4000-8000-0000000000a1'
const PACT_CAPSULE_TIMESTAMP = '2026-08-07T10:00:00.000Z'
const PACT_SILHOUETTE_TEEN_ID = 'teen-1'
const PACT_ONBOARDING_STARTED_AT = '2026-08-09T09:00:00.000Z'
const PACT_SILHOUETTE_UPDATED_AT = '2026-08-09T09:05:00.000Z'
const PACT_SILHOUETTE_COMMITTED_AT = '2026-08-09T09:10:00.000Z'
const PACT_SILHOUETTE_IMAGE_EXPIRY = '2026-08-09T09:25:00.000Z'
const PACT_SILHOUETTE_UPLOAD_SESSION_ID = '85b4dde2-3df2-4e81-8c18-d51ae3408ca0'
const PACT_SILHOUETTE_UPLOAD_EXPIRY = '2026-08-09T09:15:00.000Z'
/**
 * Mirrors `SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY`/`SILHOUETTE_COMMIT_IDEMPOTENCY_KEY`
 * in the consumer file exactly: the replay interactions send these same
 * header values, and the doubles below compare the incoming header against
 * them to decide `replayed`/unchanged-row behavior, mirroring
 * `WardrobeSilhouetteService`'s real `*_idempotency_key === idempotencyKey`
 * checks.
 */
const PACT_SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY = '6eae27b8-8335-476e-a3bf-371e9fa5fd26'
const PACT_SILHOUETTE_COMMIT_IDEMPOTENCY_KEY = '760490a0-5049-4cdd-afcf-ac8e7ba0b436'
/**
 * Fixed stand-in for the onboarding-complete double's `completedAt`, kept
 * deterministic like every other timestamp in this file rather than reading
 * the wall clock. Currently unreachable: `requireOnboardingScenario()` only
 * ever returns `currentStep: 'permission'` or `'capture'`, and
 * `ONBOARDING_FORWARD_TRANSITIONS` never allows `'complete'` from either, so
 * no interaction exercises this branch today. Kept fixed anyway so this
 * double stays fully deterministic the moment a completion-success
 * interaction is added.
 */
const PACT_ONBOARDING_COMPLETED_AT = '2026-08-09T09:20:00.000Z'
/**
 * Story 5.1 affiliate commerce. Mirrors the identifiers the consumer pins in
 * `pact/http/consumer/api-contract-interactions.ts`; both sides must agree or
 * the `string()` matchers fail verification.
 *
 * The host is under `.test`, reserved by RFC 2606, so a redirect recorded in a
 * pact file can never resolve on the public internet.
 */
const PACT_COMMERCE_PARTNER_SLUG = 'sample-partner'
const PACT_COMMERCE_PARTNER_NAME = 'Sample Partner'
const PACT_COMMERCE_OFFER_ID = 'offer-pact-1'
const PACT_COMMERCE_OFFER_TITLE = 'Everyday Layering Tee'
const PACT_COMMERCE_REDIRECT_URL =
  'https://partner.couturecast.test/shop?cc=pact-click-token'
/**
 * Story 5.2 premium subscription. Mirrors the identifiers the consumer pins in
 * `pact/http/consumer/api-contract-interactions.ts`; both sides must agree or
 * the `string()` matchers fail verification. Hosts are RFC-2606 `.test`,
 * matching Decision 9's fake Stripe client, so nothing recorded in a pact file
 * can resolve on the public internet.
 */
const PACT_SUBSCRIPTION_PRODUCT_ID = 'premium_monthly'
const PACT_SUBSCRIPTION_PERIOD_END = '2026-09-11T10:00:00.000Z'
const PACT_SUBSCRIPTION_SYNCED_AT = '2026-08-11T10:00:00.000Z'
const PACT_SUBSCRIPTION_CHECKOUT_URL = 'https://checkout.stripe.test/c/pay/cs-pact-1'
const PACT_SUBSCRIPTION_PORTAL_URL = 'https://billing.stripe.test/p/session/pact-1'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Prisma } from '@prisma/client'
import { existsSync, mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { NextFunction, Request, Response } from 'express'
import { ApiHealthController } from '../../../apps/api/src/controllers/api-health.controller'
import { HealthController } from '../../../apps/api/src/controllers/health.controller'
import { AccessTokenIdentityService } from '../../../apps/api/src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../../../apps/api/src/modules/auth/guardian-consent-state.service'
import { GuardianService } from '../../../apps/api/src/modules/guardian/guardian.service'
import { RequestAuthGuard } from '../../../apps/api/src/modules/auth/security.guards'
import { EventsController } from '../../../apps/api/src/modules/events/events.controller'
import { EventsRepository } from '../../../apps/api/src/modules/events/events.repository'
import { EventsService } from '../../../apps/api/src/modules/events/events.service'
import { RitualController } from '../../../apps/api/src/modules/personalization/ritual.controller'
import { RitualService } from '../../../apps/api/src/modules/personalization/ritual.service'
import { ComfortController } from '../../../apps/api/src/modules/personalization/comfort.controller'
import { ComfortService } from '../../../apps/api/src/modules/personalization/comfort.service'
import { UserController } from '../../../apps/api/src/modules/user/user.controller'
import { UserService } from '../../../apps/api/src/modules/user/user.service'
import { WardrobeController } from '../../../apps/api/src/modules/wardrobe/wardrobe.controller'
import { WardrobeService } from '../../../apps/api/src/modules/wardrobe/wardrobe.service'
import { WardrobeRetentionService } from '../../../apps/api/src/modules/wardrobe/wardrobe-retention.service'
import { WardrobeUploadGuard } from '../../../apps/api/src/modules/wardrobe/wardrobe.guard'
import { WardrobeCapsuleController } from '../../../apps/api/src/modules/wardrobe/wardrobe-capsule.controller'
// The `.js` specifier must match how wardrobe-capsule.controller.ts imports this
// module. Resolving it both ways yields two distinct class objects, and the
// controller's injection token then never matches this provider.
import { WardrobeCapsuleService } from '../../../apps/api/src/modules/wardrobe/wardrobe-capsule.service.js'
import { CapsuleCacheHeadersMiddleware } from '../../../apps/api/src/modules/wardrobe/wardrobe-capsule.cache-headers.middleware'
import { WardrobeOnboardingController } from '../../../apps/api/src/modules/wardrobe/wardrobe-onboarding.controller'
import {
  formatOnboardingETag,
  parseOnboardingIfMatchHeader,
  WardrobeOnboardingService,
} from '../../../apps/api/src/modules/wardrobe/wardrobe-onboarding.service'
import { WardrobeSilhouetteController } from '../../../apps/api/src/modules/wardrobe/wardrobe-silhouette.controller'
import { AffiliateClickController } from '../../../apps/api/src/modules/commerce/affiliate-click.controller'
import { AffiliateClickService } from '../../../apps/api/src/modules/commerce/affiliate-click.service'
import { AffiliateOfferService } from '../../../apps/api/src/modules/commerce/affiliate-offer.service'
import { AffiliateWebhookController } from '../../../apps/api/src/modules/commerce/affiliate-webhook.controller'
import { AffiliateWebhookService } from '../../../apps/api/src/modules/commerce/affiliate-webhook.service'
import { CommerceCacheHeadersMiddleware } from '../../../apps/api/src/modules/commerce/commerce-cache-headers.middleware'
import { CommercePreferencesController } from '../../../apps/api/src/modules/commerce/commerce-preferences.controller'
import { CommercePreferencesService } from '../../../apps/api/src/modules/commerce/commerce-preferences.service'
import { SubscriptionController } from '../../../apps/api/src/modules/commerce/subscription.controller'
import { SubscriptionService } from '../../../apps/api/src/modules/commerce/subscription.service'
import { StripeBillingService } from '../../../apps/api/src/modules/commerce/stripe-billing.service'
import { PremiumThemeController } from '../../../apps/api/src/modules/commerce/premium-theme.controller'
import { PremiumThemeService } from '../../../apps/api/src/modules/commerce/premium-theme.service'
import { PremiumEntitlementGuard } from '../../../apps/api/src/modules/commerce/premium-entitlement.guard'
import { PremiumEntitlementService } from '../../../apps/api/src/modules/commerce/premium-entitlement.service'
import {
  formatSilhouetteETag,
  parseSilhouetteIfMatchHeader,
  WardrobeSilhouetteService,
} from '../../../apps/api/src/modules/wardrobe/wardrobe-silhouette.service'
import {
  GARMENT_TAGGING_ANALYSIS_VERSION,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
} from '@couture/api-client'
// `SilhouettePhotoFailureReason` is not part of the curated top-level
// @couture/api-client barrel (packages/api-client/src/index.ts); the
// contracts/http subpath re-exports everything from wardrobe.ts instead.
import {
  affiliateWebhookPayloadSchema,
  COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  WEBHOOK_SIGNATURE_INVALID_MESSAGE,
  PREMIUM_THEMES_DISABLED_MESSAGE,
} from '@couture/api-client/contracts/http'
import type {
  EntitlementStore,
  Subscription,
  SilhouetteMode,
  SilhouettePhotoFailureReason,
  SilhouettePhotoStatus,
  UpdateWardrobeOnboardingStateInput,
  UpdateSilhouetteSlidersInput,
  WardrobeOnboardingStep,
  WardrobeOnboardingStateResponse,
  PremiumThemeKey,
} from '@couture/api-client/contracts/http'
import type { ApiRole } from '../../../apps/api/src/modules/auth/security.types'

export type PactEvent = {
  id: string
  channel: string
  payload: Prisma.JsonValue
  userId: string | null
  createdAt: string
}

type ProviderEventEnvelope = {
  id: string
  channel: string
  payload: Prisma.JsonValue
  user_id: string | null
  created_at: Date
  updated_at: Date
}

type StartedPactProvider = {
  app: INestApplication
  providerBaseUrl: string
}

let providerEvents: ProviderEventEnvelope[] = []
type ProviderWardrobeOutcome =
  | 'success'
  | 'analysis_pending'
  | 'inference_unavailable'
  | 'not_found'

type ProviderWardrobeState = {
  garmentId: string | null
  userId: string | null
  outcome: ProviderWardrobeOutcome
  guardianAllowed: boolean
}

let providerWardrobeState: ProviderWardrobeState = {
  garmentId: null,
  userId: null,
  outcome: 'not_found',
  guardianAllowed: true,
}

export function resetProviderState() {
  providerEvents = []
  providerWardrobeState = {
    garmentId: null,
    userId: null,
    outcome: 'not_found',
    guardianAllowed: true,
  }
  resetProviderOnboardingState()
  resetProviderSilhouetteState()
  resetProviderCapsuleState()
  resetProviderCommerceState()
  resetProviderSubscriptionState()
  resetProviderPremiumThemeState()
}

export function configureProviderWardrobeState(
  state: Partial<ProviderWardrobeState> & Pick<ProviderWardrobeState, 'outcome'>
) {
  providerWardrobeState = {
    garmentId: state.garmentId ?? null,
    userId: state.userId ?? null,
    outcome: state.outcome,
    guardianAllowed: state.guardianAllowed ?? true,
  }
}

export function parsePactEvent(event: PactEvent | string) {
  if (typeof event === 'string') {
    return JSON.parse(event) as PactEvent
  }

  return event
}

export function configureProviderEvent(event: PactEvent) {
  providerEvents = [
    {
      id: event.id,
      channel: event.channel,
      payload: event.payload,
      user_id: event.userId,
      created_at: new Date(event.createdAt),
      updated_at: new Date(event.createdAt),
    },
  ]
}

const eventsRepository = {
  findSince(userId: string, since?: Date) {
    return Promise.resolve(
      providerEvents.filter(
        (event) =>
          (event.user_id === userId || event.user_id === null) &&
          (!since || event.created_at > since)
      )
    )
  },
  create() {
    return Promise.reject(
      new Error('Pact provider verification does not seed events through create()')
    )
  },
} satisfies Pick<EventsRepository, 'findSince' | 'create'>

function assertPactFilesExist(pactFiles: string[]) {
  const missing = pactFiles.filter((pactFile) => !existsSync(pactFile))

  if (missing.length > 0) {
    throw new Error(
      `Missing local pact file(s):\n${missing.join('\n')}\nRun npm run test:pact:consumer first.`
    )
  }
}

function resolveProviderBaseUrl(app: INestApplication) {
  const server = app.getHttpServer() as { address(): AddressInfo | string | null }
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Pact provider did not start on a TCP port')
  }

  return `http://127.0.0.1:${address.port}`
}

export async function startLocalPactProvider({
  artifactsDir,
  pactFiles,
}: {
  artifactsDir: string
  pactFiles: string[]
}): Promise<StartedPactProvider> {
  assertPactFilesExist(pactFiles)
  mkdirSync(artifactsDir, { recursive: true })
  resetProviderState()
  const guardianConsentStateService = {
    canTeenAccess: () => Promise.resolve(true),
  } as unknown as GuardianConsentStateService
  const accessTokenIdentityService = {
    resolveIdentity(token: string) {
      if (token === 'pact-event-token') {
        return Promise.resolve({ userId: 'guardian-1', role: 'guardian' as const })
      }
      // Story 4.4 wardrobe onboarding/silhouette: a second identity whose
      // role is 'teen', needed by the guardian-consent-gate and
      // guardian-notification consumer interactions in
      // pact/http/consumer/api-contract-interactions.ts
      // (pactTeenAuth/verifyMyFormGuardianNotificationInteraction).
      if (token === 'pact-teen-token') {
        return Promise.resolve({ userId: 'teen-1', role: 'teen' as const })
      }
      return Promise.reject(new Error('Unknown Pact access token'))
    },
  } as unknown as AccessTokenIdentityService

  // Story 2.3 Task 3 step 2 owner: update provider mock responses
  const mockRitualService = {
    getOrCreateRitual: (
      _userId: string,
      _locationId?: string,
      acceptLanguage?: string,
      localeOverride?: string
    ) => {
      const selectedLocale = localeOverride ?? acceptLanguage
      const isTurkish = selectedLocale?.toLowerCase().startsWith('tr') ?? false
      const outfits = isTurkish
        ? [
            {
              id: 'rec-morning-1',
              scenario: 'morning',
              garmentIds: ['g-1'],
              reasoningBadges: [
                {
                  key: 'wind_layer',
                  label: 'Rüzgarlık',
                  bullets: ['Yüksek rüzgar nedeniyle rüzgar kesici bir katman önerilir'],
                },
              ],
              comfortNotes: 'Hafif rüzgarlı serin sabah. Trençkot önerilir.',
              shopThisLook: null,
            },
            {
              id: 'rec-midday-1',
              scenario: 'midday',
              garmentIds: ['g-2'],
              reasoningBadges: [
                { key: 'light_layers', label: 'Hafif Katmanlar', bullets: ['Ilık gün'] },
              ],
              comfortNotes: 'Ilık ve keyifli bir öğleden sonra.',
              shopThisLook: null,
            },
            {
              id: 'rec-evening-1',
              scenario: 'evening',
              garmentIds: ['g-3'],
              reasoningBadges: [
                {
                  key: 'evening_chill',
                  label: 'Akşam Serinliği',
                  bullets: ['Serin akşam'],
                },
              ],
              comfortNotes: 'Serin akşam.',
              shopThisLook: null,
            },
          ]
        : [
            {
              id: 'rec-morning-1',
              scenario: 'morning',
              garmentIds: ['g-1'],
              reasoningBadges: [
                { key: 'wind_layer', label: 'Wind layer', bullets: ['Wind is high'] },
              ],
              comfortNotes: 'Chilly morning',
              shopThisLook: null,
            },
            {
              id: 'rec-midday-1',
              scenario: 'midday',
              garmentIds: ['g-2'],
              reasoningBadges: [
                { key: 'light_layers', label: 'Light layers', bullets: ['Mild day'] },
              ],
              comfortNotes: 'Pleasant midday',
              shopThisLook: null,
            },
            {
              id: 'rec-evening-1',
              scenario: 'evening',
              garmentIds: ['g-3'],
              reasoningBadges: [
                {
                  key: 'evening_chill',
                  label: 'Evening chill',
                  bullets: ['Cool evening'],
                },
              ],
              comfortNotes: 'Cool evening',
              shopThisLook: null,
            },
          ]

      const badges = isTurkish ? ['Rüzgarlık'] : ['Wind layer', 'Mild', 'Evening']

      return Promise.resolve({
        weather: {
          locationKey: 'chicago-il',
          latitude: 41.878,
          longitude: -87.63,
          timezone: 'America/Chicago',
          provider: 'weatherapi',
          providerUpdatedAt: '2026-07-16T12:00:00.000Z',
          fetchedAt: '2026-07-16T12:00:00.000Z',
          current: {
            temperature: 16,
            condition: 'clear',
          },
          hourly: Array.from({ length: 48 }, (_, i) => ({
            forecastAt: new Date(
              new Date('2026-07-16T12:00:00.000Z').getTime() + i * 3600 * 1000
            ).toISOString(),
            temperature: 16,
            feelsLike: 15,
            precipitationProbability: 0.1,
            precipitationAmount: 0.0,
            windSpeed: 5.0,
            windGust: null,
            condition: 'clear',
            providerWeatherCode: '1000',
          })),
          alerts: [],
        },
        outfits,
        badges,
      })
    },
  } as unknown as RitualService

  const mockComfortService = {
    getComfortPreferences: (_userId: string) => {
      return Promise.resolve({
        runsColdWarm: 'neutral',
        windTolerance: 'medium',
        precipPreparedness: 'medium',
      })
    },
    updateComfortPreferences: (
      _userId: string,
      input: {
        runsColdWarm: 'cold' | 'neutral' | 'warm'
        windTolerance: 'low' | 'medium' | 'high'
        precipPreparedness: 'low' | 'medium' | 'high'
      }
    ) => {
      return Promise.resolve({
        runsColdWarm: input.runsColdWarm,
        windTolerance: input.windTolerance,
        precipPreparedness: input.precipPreparedness,
      })
    },
  }

  const mockUserService = {
    updatePreferences: (_userId: string, _input: { locale: string }) =>
      Promise.resolve({ success: true }),
  } as unknown as UserService

  const assertProviderWardrobeState = (userId: string, garmentId: string) => {
    if (
      providerWardrobeState.outcome === 'not_found' ||
      providerWardrobeState.garmentId !== garmentId ||
      providerWardrobeState.userId !== userId
    ) {
      throw new NotFoundException('GARMENT_NOT_FOUND')
    }
    if (!providerWardrobeState.guardianAllowed) {
      throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
    }
    if (providerWardrobeState.outcome === 'analysis_pending') {
      throw new ConflictException('GARMENT_ANALYSIS_PENDING')
    }
  }

  const mockWardrobeService = {
    suggestGarmentTags: (userId: string, _role: ApiRole, garmentId: string) => {
      assertProviderWardrobeState(userId, garmentId)
      if (providerWardrobeState.outcome === 'inference_unavailable') {
        throw new ServiceUnavailableException('TAGGING_INFERENCE_UNAVAILABLE')
      }
      return Promise.resolve({
        data: {
          garmentId,
          analysisVersion: GARMENT_TAGGING_ANALYSIS_VERSION,
          suggestions: {
            category: { value: 'top', confidence: 0.85, isConfident: true },
            material: { value: 'cotton', confidence: 0.72, isConfident: true },
            comfortRange: { value: 'mild', confidence: 0.72, isConfident: true },
          },
        },
      })
    },
    updateGarmentTags: (
      userId: string,
      _role: ApiRole,
      garmentId: string,
      input: {
        category: GarmentCategory
        material?: GarmentMaterial | null
        comfortRange: GarmentComfortRange
      }
    ) => {
      assertProviderWardrobeState(userId, garmentId)
      const categoryValue = input.category
      const materialValue = input.material ?? null
      const comfortValue = input.comfortRange
      return Promise.resolve({
        data: {
          id: garmentId,
          status: 'ready',
          category: categoryValue,
          material: materialValue,
          comfortRange: comfortValue,
          tagsConfirmedAt: '2026-08-05T12:00:00.000Z',
          fileSizeBytes: 1024,
          mimeType: 'image/png',
          retentionStatus: 'active',
          createdAt: '2026-08-05T10:00:00.000Z',
          committedAt: '2026-08-05T10:01:00.000Z',
          imageAccess: {
            url: 'https://example.com/read.png',
            expiresAt: '2026-08-05T12:15:00.000Z',
          },
        },
      })
    },
  } as unknown as WardrobeService

  const mockWardrobeRetentionService = {} as unknown as WardrobeRetentionService

  /**
   * Story 4.3 capsule provider double.
   *
   * The verifier sets a named scenario before each interaction and this returns
   * the matching deterministic representation, or throws the documented error.
   * An unconfigured scenario throws NotFound so a missing provider state fails
   * loudly instead of verifying against stale in-memory data.
   */
  const capsuleRepresentation = (revision: number) => ({
    id: PACT_CAPSULE_ID,
    ownerUserId: PACT_CAPSULE_OWNER_ID,
    name: 'Work capsule',
    description: null,
    occasions: ['work'] as const,
    isFavorite: false,
    revision,
    availabilityStatus: 'ready' as const,
    unavailableGarmentCount: 0,
    garments: [
      {
        id: PACT_CAPSULE_GARMENT_A,
        category: 'top' as const,
        material: 'cotton' as const,
        comfortRange: 'mild' as const,
        imageAccess: null,
        availabilityStatus: 'ready' as const,
        garmentOrder: 0,
      },
    ],
    createdAt: PACT_CAPSULE_TIMESTAMP,
    updatedAt: PACT_CAPSULE_TIMESTAMP,
  })

  /**
   * An unconfigured state, or one the provider models as unauthorized, is a
   * masked 404. That matches the story rule that a missing capsule and an
   * unauthorized relationship are indistinguishable to the client.
   */
  const requireCapsuleScenario = () => {
    const state = getProviderCapsuleState()
    if (!state || state.scenario === 'unauthorized-owner') {
      throw new NotFoundException('CAPSULE_NOT_FOUND')
    }
    return state
  }

  const mockWardrobeCapsuleService = {
    createCapsule: (_actor: unknown, _ownerUserId: string, body: { name?: string }) => {
      const { scenario } = requireCapsuleScenario()
      if (scenario === 'ineligible-garment') {
        throw new ConflictException('GARMENT_NOT_CAPSULE_ELIGIBLE')
      }

      /**
       * Replay and key-reuse share one provider state because they differ by
       * payload, not by stored data: an identical normalized payload replays,
       * a changed one conflicts.
       */
      if (scenario === 'idempotency-replay') {
        if (body?.name !== 'Work capsule') {
          throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
        }
        return Promise.resolve({ data: capsuleRepresentation(1), isReplay: true })
      }

      return Promise.resolve({ data: capsuleRepresentation(1), isReplay: false })
    },
    listCapsules: () => {
      requireCapsuleScenario()
      return Promise.resolve({
        data: [capsuleRepresentation(1)],
        total: 1,
        limit: 20,
        offset: 0,
      })
    },
    getCapsule: () => {
      requireCapsuleScenario()
      return Promise.resolve({ data: capsuleRepresentation(1) })
    },
    updateCapsule: (
      _actor: unknown,
      _ownerUserId: string,
      _capsuleId: string,
      ifMatch: string | undefined
    ) => {
      const { scenario } = requireCapsuleScenario()
      if (!ifMatch) {
        throw new HttpException('PRECONDITION_REQUIRED', HttpStatus.PRECONDITION_REQUIRED)
      }
      if (scenario === 'stale-precondition') {
        throw new PreconditionFailedException('CAPSULE_REVISION_MISMATCH')
      }
      return Promise.resolve({ data: capsuleRepresentation(1) })
    },
    setFavoriteStatus: () => {
      requireCapsuleScenario()
      return Promise.resolve({ data: capsuleRepresentation(1) })
    },
    deleteCapsule: () => {
      requireCapsuleScenario()
      return Promise.resolve()
    },
  } as unknown as WardrobeCapsuleService

  /**
   * Story 4.4 onboarding provider double, wired against the real
   * `WardrobeOnboardingController` (unlike Task 7's earlier state-setup-only
   * scaffolding, which had no controller to wire against yet). Mirrors
   * `mockWardrobeCapsuleService`'s level of fidelity: canned responses per
   * named provider state plus the documented error paths, not a full
   * re-simulation of `wardrobe-onboarding.service.ts`'s business logic --
   * that is proven separately against a real database by
   * `apps/api/integration/wardrobe-onboarding.integration.spec.ts`. Reuses
   * the real `formatOnboardingETag`/`parseOnboardingIfMatchHeader` (pure,
   * side-effect-free) so header parsing and the 428/malformed-412 paths
   * match the real service exactly instead of a hand-duplicated copy.
   */
  const ONBOARDING_FORWARD_TRANSITIONS: Record<
    WardrobeOnboardingStep,
    WardrobeOnboardingStep[]
  > = {
    permission: ['capture'],
    capture: ['tagging', 'silhouette'],
    tagging: ['silhouette'],
    silhouette: ['complete'],
    complete: [],
  }

  type OnboardingRow = WardrobeOnboardingStateResponse['data']

  const toOnboardingResponse = (row: OnboardingRow): WardrobeOnboardingStateResponse => ({
    data: row,
  })

  const requireOnboardingScenario = (): { row: OnboardingRow } => {
    const state = getProviderOnboardingState()
    if (!state) {
      throw new NotFoundException('ONBOARDING_STATE_NOT_CONFIGURED')
    }
    if (state.scenario === 'not-started') {
      return {
        row: {
          status: 'not_started',
          currentStep: 'permission',
          usedStarterWardrobe: false,
          garmentsCapturedCount: 0,
          startedAt: null,
          completedAt: null,
          revision: 0,
        },
      }
    }
    return {
      row: {
        status: 'in_progress',
        currentStep: 'capture',
        usedStarterWardrobe: false,
        garmentsCapturedCount: 1,
        startedAt: PACT_ONBOARDING_STARTED_AT,
        completedAt: null,
        revision: state.scenario === 'stale-precondition' ? 2 : 1,
      },
    }
  }

  const mockWardrobeOnboardingService = {
    getState: (userId: string) => {
      const { row } = requireOnboardingScenario()
      return Promise.resolve({
        response: toOnboardingResponse(row),
        etag: formatOnboardingETag(userId, row.revision),
      })
    },
    advanceStep: (
      userId: string,
      ifMatchHeader: string | undefined,
      input: UpdateWardrobeOnboardingStateInput
    ) => {
      // Parsed first, exactly like the real service: a missing/malformed
      // If-Match throws 428/412 before any provider-state scenario lookup.
      const expectedRevision = parseOnboardingIfMatchHeader(ifMatchHeader, userId)
      const { row } = requireOnboardingScenario()
      if (expectedRevision !== null && expectedRevision !== row.revision) {
        throw new PreconditionFailedException('ONBOARDING_REVISION_MISMATCH')
      }

      const usedStarterWardrobe = input.usedStarterWardrobe ?? false
      const isIdenticalReplay =
        row.currentStep === input.targetStep &&
        row.usedStarterWardrobe === usedStarterWardrobe
      if (isIdenticalReplay) {
        return Promise.resolve({ response: toOnboardingResponse(row), isNoOp: true })
      }

      const allowed = ONBOARDING_FORWARD_TRANSITIONS[row.currentStep]
      if (!allowed.includes(input.targetStep)) {
        throw new ConflictException('INVALID_STEP_TRANSITION')
      }

      // Built per variant rather than as one wide object: the contract is a
      // discriminated union, so `completed` carries its terminal step and
      // timestamp together and `in_progress` cannot carry a completedAt at all.
      const advancedShared = {
        usedStarterWardrobe,
        garmentsCapturedCount: row.garmentsCapturedCount,
        startedAt: row.startedAt ?? PACT_ONBOARDING_STARTED_AT,
        revision: row.revision + 1,
      }
      const advanced: OnboardingRow =
        input.targetStep === 'complete'
          ? {
              status: 'completed',
              currentStep: 'complete',
              ...advancedShared,
              completedAt: PACT_ONBOARDING_COMPLETED_AT,
            }
          : {
              status: 'in_progress',
              currentStep: input.targetStep,
              ...advancedShared,
              completedAt: null,
            }
      return Promise.resolve({ response: toOnboardingResponse(advanced), isNoOp: false })
    },
  } as unknown as WardrobeOnboardingService

  /**
   * Story 4.4 silhouette/My Form provider double, wired against the real
   * `WardrobeSilhouetteController`. Same fidelity level as the onboarding
   * double above: canned rows per named provider state (including every
   * documented My Form failure reason and the ready/processing/deleted
   * shapes), reusing the real `formatSilhouetteETag`/
   * `parseSilhouetteIfMatchHeader` for header handling. The guardian-consent
   * gate itself is `mockGuardianService.assertWardrobeUploadAllowed` above
   * (the class-level `WardrobeUploadGuard`), not this double.
   */
  type SilhouetteRow = {
    mode: SilhouetteMode
    heightSlider: number | null
    buildSlider: number | null
    myForm: {
      status: SilhouettePhotoStatus
      failureReason: SilhouettePhotoFailureReason | null
      committedAt: string | null
      imageAccess: { url: string; expiresAt: string } | null
    } | null
    revision: number
  }

  const toSilhouetteResponse = (row: SilhouetteRow) => ({
    data: {
      mode: row.mode,
      heightSlider: row.heightSlider,
      buildSlider: row.buildSlider,
      myForm: row.myForm,
      revision: row.revision,
      updatedAt: PACT_SILHOUETTE_UPDATED_AT,
    },
  })

  const requireSilhouetteScenario = (): SilhouetteRow => {
    const state = getProviderSilhouetteState()
    if (!state) {
      throw new NotFoundException('SILHOUETTE_STATE_NOT_CONFIGURED')
    }
    switch (state.scenario) {
      case 'profile-exists':
      case 'guardian-forbidden':
      case 'my-form-awaiting-commit':
      case 'my-form-upload-already-allocated':
        return {
          mode: 'default_mannequin',
          heightSlider: 50,
          buildSlider: 50,
          myForm: null,
          revision: 1,
        }
      case 'stale-precondition':
        return {
          mode: 'default_mannequin',
          heightSlider: 50,
          buildSlider: 50,
          myForm: null,
          revision: 2,
        }
      case 'my-form-ready':
      case 'my-form-exists':
        return {
          mode: 'my_form',
          heightSlider: 50,
          buildSlider: 50,
          myForm: {
            status: 'ready',
            failureReason: null,
            committedAt: PACT_SILHOUETTE_COMMITTED_AT,
            imageAccess: {
              url: 'https://example.test/silhouette-my-form.png',
              expiresAt: PACT_SILHOUETTE_IMAGE_EXPIRY,
            },
          },
          revision: 3,
        }
      case 'my-form-failed':
      case 'my-form-privacy-violation-teen-notified':
        return {
          mode: 'default_mannequin',
          heightSlider: 50,
          buildSlider: 50,
          myForm: {
            status: 'failed',
            failureReason: state.failureReason ?? 'privacy_violation',
            committedAt: PACT_SILHOUETTE_COMMITTED_AT,
            imageAccess: null,
          },
          revision: 2,
        }
      case 'my-form-commit-already-processed':
        // Identical to a fresh commit's resulting row (see `commitMyForm`
        // below): the replay interaction asserts this exact shape stays
        // unchanged rather than being re-derived, proving no re-processing.
        return {
          mode: 'default_mannequin',
          heightSlider: 50,
          buildSlider: 50,
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: PACT_SILHOUETTE_COMMITTED_AT,
            imageAccess: null,
          },
          revision: 2,
        }
    }
  }

  const mockWardrobeSilhouetteService = {
    getProfile: (userId: string) => {
      const row = requireSilhouetteScenario()
      return Promise.resolve({
        response: toSilhouetteResponse(row),
        etag: formatSilhouetteETag(userId, row.revision),
      })
    },
    updateSliders: (
      userId: string,
      ifMatchHeader: string | undefined,
      input: UpdateSilhouetteSlidersInput
    ) => {
      const expectedRevision = parseSilhouetteIfMatchHeader(ifMatchHeader, userId)
      const row = requireSilhouetteScenario()
      if (expectedRevision !== null && expectedRevision !== row.revision) {
        throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
      }

      const isIdenticalReplay =
        row.mode === 'default_mannequin' &&
        row.heightSlider === input.heightSlider &&
        row.buildSlider === input.buildSlider
      if (isIdenticalReplay) {
        return Promise.resolve({ response: toSilhouetteResponse(row), isNoOp: true })
      }

      const updated: SilhouetteRow = {
        mode: 'default_mannequin',
        heightSlider: input.heightSlider,
        buildSlider: input.buildSlider,
        myForm: row.myForm,
        revision: row.revision + 1,
      }
      return Promise.resolve({ response: toSilhouetteResponse(updated), isNoOp: false })
    },
    createMyFormUploadUrl: (
      _userId: string,
      _role: unknown,
      _input: unknown,
      idempotencyKey: string
    ) => {
      const state = getProviderSilhouetteState()
      requireSilhouetteScenario()
      // Mirrors `createMyFormUploadUrl`'s real
      // `existing.my_form_upload_idempotency_key === idempotencyKey` branch:
      // a repeated call with the same key replays the same session instead
      // of allocating a new one, and the controller's
      // `res.status(result.replayed ? 200 : 201)` reads this flag.
      const replayed =
        state?.scenario === 'my-form-upload-already-allocated' &&
        idempotencyKey === PACT_SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY
      return Promise.resolve({
        replayed,
        response: {
          data: {
            uploadSessionId: PACT_SILHOUETTE_UPLOAD_SESSION_ID,
            uploadUrl: `https://api.example/wardrobe/silhouette/uploads/${PACT_SILHOUETTE_UPLOAD_SESSION_ID}`,
            uploadToken: 'token_my_form_upload',
            requiredHeaders: { 'content-type': 'image/png' as const },
            expiresAt: PACT_SILHOUETTE_UPLOAD_EXPIRY,
          },
        },
      })
    },
    commitMyForm: (
      _userId: string,
      _role: unknown,
      _input: unknown,
      idempotencyKey: string
    ) => {
      const state = getProviderSilhouetteState()
      const row = requireSilhouetteScenario()
      // Mirrors `commitMyForm`'s real
      // `profile.my_form_commit_idempotency_key === idempotencyKey` branch: a
      // repeated commit with the same key returns the existing row
      // unchanged (no re-processing, no revision increment, no re-enqueue).
      // Like upload-url, the real service returns `CommitResult['replayed']`
      // and the controller's `res.status(result.replayed ? 200 : 201)` reads
      // it, so a replay answers 200 where a first commit answers 201. The
      // flag must be set here: this stub is cast to the service type, so an
      // omitted `replayed` reads as `undefined` and silently pins 201.
      if (
        state?.scenario === 'my-form-commit-already-processed' &&
        idempotencyKey === PACT_SILHOUETTE_COMMIT_IDEMPOTENCY_KEY
      ) {
        return Promise.resolve({
          replayed: true,
          response: toSilhouetteResponse(row),
        })
      }
      const committed: SilhouetteRow = {
        mode: 'default_mannequin',
        heightSlider: row.heightSlider,
        buildSlider: row.buildSlider,
        myForm: {
          status: 'processing',
          failureReason: null,
          committedAt: PACT_SILHOUETTE_COMMITTED_AT,
          imageAccess: null,
        },
        revision: row.revision + 1,
      }
      return Promise.resolve({
        replayed: false,
        response: toSilhouetteResponse(committed),
      })
    },
    deleteMyForm: (userId: string, ifMatchHeader: string | undefined) => {
      const expectedRevision = parseSilhouetteIfMatchHeader(ifMatchHeader, userId)
      const row = requireSilhouetteScenario()
      if (expectedRevision !== null && expectedRevision !== row.revision) {
        throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
      }
      const deleted: SilhouetteRow = {
        mode: 'default_mannequin',
        heightSlider: row.heightSlider,
        buildSlider: row.buildSlider,
        myForm: null,
        revision: row.revision + 1,
      }
      return Promise.resolve({ response: toSilhouetteResponse(deleted) })
    },
  } as unknown as WardrobeSilhouetteService

  const mockGuardianService = {
    assertWardrobeUploadAllowed: (userId: string) => {
      // Story 4.4: `WardrobeUploadGuard` applies class-level to
      // WardrobeSilhouetteController (decision 7), so the consent-revoked-teen
      // Pact scenario must be honored here too, independent of the pre-existing
      // garment/capsule providerWardrobeState check below.
      const silhouetteState = getProviderSilhouetteState()
      if (
        silhouetteState?.scenario === 'guardian-forbidden' &&
        userId === (silhouetteState.userId ?? PACT_SILHOUETTE_TEEN_ID)
      ) {
        throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      }
      if (
        !providerWardrobeState.guardianAllowed ||
        (providerWardrobeState.userId !== null && providerWardrobeState.userId !== userId)
      ) {
        throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      }
      return Promise.resolve()
    },
  } as unknown as GuardianService

  /**
   * Story 5.1: `RitualController` injects this, so the fixture cannot build
   * without it even for the interactions that have nothing to do with commerce.
   *
   * It answers a populated block only under the `eligible` scenario. Every other
   * scenario returns an empty map, and the controller writes `null` for each
   * outfit, which is what the pre-existing ritual interactions pin.
   */
  const mockAffiliateOfferService = {
    resolveShopThisLook: (input: { outfits: readonly { id: string }[] }) => {
      const state = getProviderCommerceState()
      if (state?.scenario !== 'eligible') {
        return Promise.resolve(new Map<string, null>())
      }
      return Promise.resolve(
        new Map(
          input.outfits.map((outfit) => [
            outfit.id,
            {
              partnerId: PACT_COMMERCE_PARTNER_SLUG,
              partnerDisplayName: PACT_COMMERCE_PARTNER_NAME,
              offerId: PACT_COMMERCE_OFFER_ID,
              offerTitle: PACT_COMMERCE_OFFER_TITLE,
              garmentCategory: 'top' as const,
            },
          ])
        )
      )
    },
  } as unknown as AffiliateOfferService

  /**
   * The preference endpoints are ungated by the commerce kill switch, so this
   * double answers under every scenario. Only `opted-out` reads as disabled.
   */
  const mockCommercePreferencesService = {
    getPreference: () =>
      Promise.resolve({
        affiliateCtasEnabled: getProviderCommerceState()?.scenario !== 'opted-out',
      }),
    setPreference: (_userId: string, affiliateCtasEnabled: boolean) =>
      Promise.resolve({ affiliateCtasEnabled }),
  } as unknown as CommercePreferencesService

  /**
   * Decision 9's status precedence, expressed as scenarios rather than as
   * re-derived rules. The consumer pins one status per interaction; which
   * condition wins when several hold at once is asserted in
   * `apps/api/src/modules/commerce/affiliate-click.service.spec.ts`.
   */
  const mockAffiliateClickService = {
    recordClick: () => {
      const scenario = getProviderCommerceState()?.scenario
      if (scenario === 'flag-disabled') {
        throw new ServiceUnavailableException(COMMERCE_DISABLED_MESSAGE)
      }
      if (scenario === 'audience-ineligible') {
        throw new ForbiddenException(COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE)
      }
      if (scenario === 'opted-out') {
        throw new ForbiddenException(COMMERCE_OPTED_OUT_MESSAGE)
      }
      if (scenario === 'unknown-offer') {
        throw new NotFoundException(COMMERCE_OFFER_NOT_FOUND_MESSAGE)
      }
      return Promise.resolve({
        redirectUrl: PACT_COMMERCE_REDIRECT_URL,
        // A replay inside the dedupe window returns the SAME URL with a 200.
        created: scenario !== 'click-deduped',
      })
    },
  } as unknown as AffiliateClickService

  /**
   * Signature verification is a scenario flag here, not a real HMAC: the
   * consumer cannot compute one without the partner secret, and proving the
   * five-step verification order is the API suite's job. Body validation is real
   * though, because the 400 the contract records is exactly "the signature
   * passed and then Zod rejected the payload", and running the schema is the
   * only way to record that ordering honestly.
   */
  const mockAffiliateWebhookService = {
    recordConversion: (input: { rawBody?: Buffer }) => {
      if (getProviderCommerceState()?.scenario === 'invalid-signature') {
        throw new UnauthorizedException(WEBHOOK_SIGNATURE_INVALID_MESSAGE)
      }

      const parsed = affiliateWebhookPayloadSchema.safeParse(
        JSON.parse(input.rawBody?.toString('utf8') ?? '{}')
      )
      if (!parsed.success) {
        throw new BadRequestException('Invalid affiliate webhook payload')
      }

      return Promise.resolve({ data: { received: true as const } })
    },
  } as unknown as AffiliateWebhookService

  /**
   * Story 5.2 premium subscription doubles, wired against the real
   * `SubscriptionController`. Same stance as the 5.1 doubles above: the
   * scenario the verifier sets decides the answer; WHEN each status is
   * produced (the flag resolution, the refresh throttle, the entitlement
   * transition table, real Stripe calls) is proven in the API unit and
   * integration suites, where a database and a flag actually exist. An
   * unconfigured scenario fails loudly rather than verifying against stale
   * in-memory data.
   */
  const requireSubscriptionScenario = () => {
    const state = getProviderSubscriptionState()
    if (!state) {
      throw new NotFoundException('SUBSCRIPTION_STATE_NOT_CONFIGURED')
    }
    return state
  }

  const subscriptionRepresentation = (): Subscription => {
    const state = requireSubscriptionScenario()
    if (state.scenario === 'entitled' || state.scenario === 'stripe-billing-profile') {
      return {
        status: 'active',
        store: state.store,
        productId: PACT_SUBSCRIPTION_PRODUCT_ID,
        willRenew: true,
        currentPeriodEnd: PACT_SUBSCRIPTION_PERIOD_END,
        syncedAt: PACT_SUBSCRIPTION_SYNCED_AT,
        purchasesEnabled: true,
      }
    }
    return {
      status: 'none',
      store: null,
      productId: null,
      willRenew: null,
      currentPeriodEnd: null,
      syncedAt: null,
      // The status endpoints stay reachable while purchasing is switched off;
      // the kill switch reaches a client only as this server-evaluated field.
      purchasesEnabled: state.scenario !== 'purchasing-disabled',
    }
  }

  /**
   * Refresh answers the same representation as status: the contract records
   * the body a client must understand after a pull, not the pull itself (the
   * ledger call, throttle window, and 503 timeout path live in
   * `subscription.service.spec.ts` against fake timers).
   */
  const mockSubscriptionService = {
    getSubscription: () => Promise.resolve(subscriptionRepresentation()),
    refreshSubscription: () => Promise.resolve(subscriptionRepresentation()),
  } as unknown as SubscriptionService

  /**
   * Decision 4's checkout status precedence, expressed as scenarios: the
   * controller runs `assertPurchasingEnabled` before parsing the body (503
   * outranks 400), and the service answers 409 for an already-entitled user
   * before any Stripe call. Portal access hinges on the billing profile, not
   * on the entitlement: only the `stripe-billing-profile` scenario has one,
   * so an App Store subscriber correctly gets the 404 the consumer records.
   */
  const mockStripeBillingService = {
    assertPurchasingEnabled: () => {
      if (requireSubscriptionScenario().scenario === 'purchasing-disabled') {
        throw new ServiceUnavailableException(COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE)
      }
      return Promise.resolve()
    },
    createCheckoutSession: () => {
      const { scenario } = requireSubscriptionScenario()
      if (scenario === 'entitled' || scenario === 'stripe-billing-profile') {
        throw new ConflictException(SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE)
      }
      return Promise.resolve({ url: PACT_SUBSCRIPTION_CHECKOUT_URL })
    },
    createPortalSession: () => {
      const { scenario } = requireSubscriptionScenario()
      if (scenario !== 'stripe-billing-profile') {
        throw new NotFoundException(SUBSCRIPTION_NOT_FOUND_MESSAGE)
      }
      return Promise.resolve({ url: PACT_SUBSCRIPTION_PORTAL_URL })
    },
  } as unknown as StripeBillingService

  /**
   * Story 5.3 premium theme switcher doubles, wired against the real
   * `PremiumThemeController` AND the real, un-mocked `PremiumEntitlementGuard`
   * -- the first Pact provider wiring of that guard (5.2's
   * `SubscriptionController` never mounted it). The guard's own
   * `canActivate` runs unmocked below (it is registered as a plain provider,
   * not overridden); only its dependency, `PremiumEntitlementService`, is a
   * scenario-driven double, same stance as `mockSubscriptionService` above.
   * WHEN each field resolves the way it does (Decision 7's entitlement-wins
   * rule, the P2023 stale-enum fallback, the flag-vs-body-parse precedence)
   * is proven in `premium-theme.service.spec.ts` and
   * `premium-theme.controller.spec.ts`; these doubles exist only to produce
   * the outcome the contract records.
   */
  const requirePremiumThemeScenario = () => {
    const state = getProviderPremiumThemeState()
    if (!state) {
      throw new NotFoundException('PREMIUM_THEME_STATE_NOT_CONFIGURED')
    }
    return state
  }

  const mockPremiumEntitlementService = {
    hasPremiumAccess: () =>
      Promise.resolve(requirePremiumThemeScenario().scenario !== 'not-entitled'),
  } as unknown as PremiumEntitlementService

  const mockPremiumThemeService = {
    getTheme: () => {
      const state = requirePremiumThemeScenario()
      const isEntitled = state.scenario !== 'not-entitled'
      return Promise.resolve({
        theme: isEntitled ? state.theme : null,
        isEntitled,
        themesEnabled: state.scenario !== 'themes-disabled',
      })
    },
    assertThemesEnabled: () => {
      if (requirePremiumThemeScenario().scenario === 'themes-disabled') {
        throw new ServiceUnavailableException(PREMIUM_THEMES_DISABLED_MESSAGE)
      }
      return Promise.resolve()
    },
    setTheme: (_userId: string, theme: PremiumThemeKey | null) => {
      // Re-asserted here too, mirroring the real service's own defense --
      // the controller already checked, but this double stays honest on its
      // own the same way `PremiumThemeService.setTheme` does.
      if (requirePremiumThemeScenario().scenario === 'themes-disabled') {
        throw new ServiceUnavailableException(PREMIUM_THEMES_DISABLED_MESSAGE)
      }
      return Promise.resolve({ theme, isEntitled: true, themesEnabled: true })
    },
  } as unknown as PremiumThemeService

  const moduleFixture = await Test.createTestingModule({
    controllers: [
      ApiHealthController,
      HealthController,
      EventsController,
      RitualController,
      ComfortController,
      UserController,
      WardrobeController,
      WardrobeCapsuleController,
      WardrobeOnboardingController,
      WardrobeSilhouetteController,
      CommercePreferencesController,
      AffiliateClickController,
      AffiliateWebhookController,
      SubscriptionController,
      PremiumThemeController,
    ],
    providers: [
      EventsService,
      {
        provide: EventsRepository,
        useValue: eventsRepository,
      },
      {
        provide: GuardianConsentStateService,
        useValue: guardianConsentStateService,
      },
      {
        provide: GuardianService,
        useValue: mockGuardianService,
      },
      {
        provide: AccessTokenIdentityService,
        useValue: accessTokenIdentityService,
      },
      {
        provide: RitualService,
        useValue: mockRitualService,
      },
      {
        provide: ComfortService,
        useValue: mockComfortService,
      },
      {
        provide: UserService,
        useValue: mockUserService,
      },
      {
        provide: WardrobeService,
        useValue: mockWardrobeService,
      },
      {
        provide: WardrobeRetentionService,
        useValue: mockWardrobeRetentionService,
      },
      {
        provide: WardrobeUploadGuard,
        useFactory: () => new WardrobeUploadGuard(mockGuardianService),
      },
      {
        provide: WardrobeCapsuleService,
        useValue: mockWardrobeCapsuleService,
      },
      {
        provide: WardrobeOnboardingService,
        useValue: mockWardrobeOnboardingService,
      },
      {
        provide: WardrobeSilhouetteService,
        useValue: mockWardrobeSilhouetteService,
      },
      {
        provide: AffiliateOfferService,
        useValue: mockAffiliateOfferService,
      },
      {
        provide: CommercePreferencesService,
        useValue: mockCommercePreferencesService,
      },
      {
        provide: AffiliateClickService,
        useValue: mockAffiliateClickService,
      },
      {
        provide: AffiliateWebhookService,
        useValue: mockAffiliateWebhookService,
      },
      {
        provide: SubscriptionService,
        useValue: mockSubscriptionService,
      },
      {
        provide: StripeBillingService,
        useValue: mockStripeBillingService,
      },
      {
        provide: PremiumThemeService,
        useValue: mockPremiumThemeService,
      },
      {
        provide: PremiumEntitlementService,
        useValue: mockPremiumEntitlementService,
      },
      // Deliberately NOT overridden with a mock/useValue, unlike every
      // service above: the guard's own `canActivate` logic must actually run
      // in this fixture, exercised against the mocked
      // `PremiumEntitlementService` above -- same real-instance stance as
      // `RequestAuthGuard`, which is likewise never given a fake
      // implementation (it is overridden below only to hand it its real
      // constructor args explicitly; here plain Nest DI already has
      // `PremiumEntitlementService` in this module's providers, so
      // registering the bare class is enough for DI to construct a real
      // instance with it wired in).
      PremiumEntitlementGuard,
    ],
  })
    .overrideGuard(RequestAuthGuard)
    .useValue(
      new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService)
    )
    .compile()

  /**
   * `rawBody: true` matches all three real bootstraps (`src/main.ts`,
   * `api/index.ts`, and the webhook integration spec). Without it
   * `request.rawBody` is undefined here, the webhook double would read an empty
   * body, and the 400 interaction would pass for the wrong reason.
   */
  const localApp = moduleFixture.createNestApplication({ rawBody: true })

  // WardrobeModule applies this through `configure`, which a bare testing module
  // never calls. Without it every capsule response, including errors, would be
  // missing the `Cache-Control: private, no-store` the contract pins.
  // Story 4.4: `wardrobe.module.ts`'s real `configure()` applies this same
  // middleware to `/api/v1/wardrobe/onboarding{/*path}` and
  // `/api/v1/wardrobe/silhouette{/*path}` too (not just capsules), for the
  // identical reason -- reused as-is here rather than reimplemented.
  const capsuleCacheHeaders = new CapsuleCacheHeadersMiddleware()
  localApp.use('/api/v1/wardrobe', (req: Request, res: Response, next: NextFunction) => {
    if (
      /^\/[^/]+\/capsules(\/|$|\?)/.test(req.url) ||
      /^\/onboarding(\/|$|\?)/.test(req.url) ||
      /^\/silhouette(\/|$|\?)/.test(req.url)
    ) {
      capsuleCacheHeaders.use(req, res, next)
      return
    }
    next()
  })

  /**
   * `commerce.module.ts` applies this through `configure`, which a bare testing
   * module never calls. Without it every commerce response, including the 403,
   * 404, and 503 the contract records, would be missing the
   * `Cache-Control: private, no-store` those interactions pin.
   */
  const commerceCacheHeaders = new CommerceCacheHeadersMiddleware()
  localApp.use('/api/v1/commerce', (req: Request, res: Response, next: NextFunction) => {
    commerceCacheHeaders.use(req, res, next)
  })

  await localApp.init()
  await localApp.listen(0, '127.0.0.1')

  return {
    app: localApp,
    providerBaseUrl: resolveProviderBaseUrl(localApp),
  }
}

/**
 * Story 4.3 capsule provider states.
 *
 * The verifier configures a named, deterministic scenario before each
 * interaction. Keeping the scenario as a discriminated string means a state the
 * provider does not know fails loudly rather than silently verifying against
 * whatever happened to be in memory.
 */
export type ProviderCapsuleScenario =
  | 'eligible-garments'
  | 'capsule-list'
  | 'capsule-detail'
  | 'stale-precondition'
  | 'idempotency-replay'
  | 'idempotency-conflict'
  | 'ineligible-garment'
  | 'unauthorized-owner'

export type ProviderCapsuleState = {
  ownerUserId: string | null
  capsuleId: string | null
  scenario: ProviderCapsuleScenario
}

let providerCapsuleState: ProviderCapsuleState | null = null

export function configureProviderCapsuleState(state: {
  ownerUserId?: string
  capsuleId?: string
  scenario: ProviderCapsuleScenario
}) {
  providerCapsuleState = {
    ownerUserId: state.ownerUserId ?? null,
    capsuleId: state.capsuleId ?? null,
    scenario: state.scenario,
  }
}

export function getProviderCapsuleState(): ProviderCapsuleState | null {
  return providerCapsuleState
}

export function resetProviderCapsuleState() {
  providerCapsuleState = null
}

/**
 * Story 4.4 wardrobe onboarding and silhouette setup — provider state
 * storage, mirroring the capsule state above exactly.
 *
 * `pact/http/provider/state-handlers.ts` configures a named, deterministic
 * scenario per interaction exactly like every other state handler here, and
 * that state is consumed by the real `mockWardrobeOnboardingService`/
 * `mockWardrobeSilhouetteService` doubles below (wired against the real
 * `WardrobeOnboardingController`/`WardrobeSilhouetteController` -- see the
 * doc comments on those doubles for their fidelity level). `npm run
 * test:pact:provider` verifies all onboarding/silhouette interactions
 * genuinely green through this wiring, not just the state-setup half.
 */
export type ProviderOnboardingScenario = 'existing' | 'not-started' | 'stale-precondition'

export type ProviderOnboardingState = {
  userId: string | null
  scenario: ProviderOnboardingScenario
}

let providerOnboardingState: ProviderOnboardingState | null = null

export function configureProviderOnboardingState(state: {
  userId?: string
  scenario: ProviderOnboardingScenario
}) {
  providerOnboardingState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
  }
}

export function getProviderOnboardingState(): ProviderOnboardingState | null {
  return providerOnboardingState
}

export function resetProviderOnboardingState() {
  providerOnboardingState = null
}

export type ProviderSilhouetteScenario =
  | 'profile-exists'
  | 'guardian-forbidden'
  | 'stale-precondition'
  | 'my-form-awaiting-commit'
  | 'my-form-ready'
  | 'my-form-failed'
  | 'my-form-privacy-violation-teen-notified'
  | 'my-form-exists'
  | 'my-form-upload-already-allocated'
  | 'my-form-commit-already-processed'

export type ProviderSilhouetteState = {
  userId: string | null
  scenario: ProviderSilhouetteScenario
  /** Only set for the `my-form-failed` scenario, which the state handler parameterizes by reason. */
  failureReason: SilhouettePhotoFailureReason | null
}

let providerSilhouetteState: ProviderSilhouetteState | null = null

export function configureProviderSilhouetteState(state: {
  userId?: string
  scenario: ProviderSilhouetteScenario
  failureReason?: SilhouettePhotoFailureReason
}) {
  providerSilhouetteState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
    failureReason: state.failureReason ?? null,
  }
}

export function getProviderSilhouetteState(): ProviderSilhouetteState | null {
  return providerSilhouetteState
}

export function resetProviderSilhouetteState() {
  providerSilhouetteState = null
}

/* --------------------------------------------------------------------------- *
 * Story 5.1 affiliate commerce provider states.
 *
 * The doubles below decide their answer from the scenario the verifier sets,
 * not from a real database, feature flag, or HMAC. That is deliberate and it is
 * what Pact is for here: the contract records which status, headers, and body a
 * client must understand. WHEN each status is produced, meaning the eligibility
 * chain, the 60-second dedupe window, and the five-step signature verification,
 * is proven in the API unit suite and against real PostgreSQL in
 * `apps/api/integration/commerce-affiliate-*.integration.spec.ts`. Reimplementing
 * those rules here would make this suite agree with itself rather than with the
 * provider.
 * --------------------------------------------------------------------------- */
export type ProviderCommerceScenario =
  | 'eligible'
  | 'opted-out'
  | 'audience-ineligible'
  | 'flag-disabled'
  | 'unknown-offer'
  | 'click-deduped'
  | 'invalid-signature'

export type ProviderCommerceState = {
  userId: string | null
  scenario: ProviderCommerceScenario
}

let providerCommerceState: ProviderCommerceState | null = null

export function configureProviderCommerceState(state: {
  userId?: string
  scenario: ProviderCommerceScenario
}) {
  providerCommerceState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
  }
}

export function getProviderCommerceState(): ProviderCommerceState | null {
  return providerCommerceState
}

export function resetProviderCommerceState() {
  providerCommerceState = null
}

/* --------------------------------------------------------------------------- *
 * Story 5.2 premium subscription provider states.
 *
 * Same design as the 5.1 commerce states above: each scenario names an
 * arrangement the contract records an outcome for, and the doubles decide
 * their answer from it rather than from a real database, flag, or Stripe
 * call. The `store` field is the factory override the portal-404 arrangement
 * needs — 'The user has an active premium entitlement' with `store:
 * 'app_store'` is a paying store subscriber with no Stripe billing profile,
 * which is exactly who the portal must answer 404 to.
 * --------------------------------------------------------------------------- */
export type ProviderSubscriptionScenario =
  | 'entitled'
  | 'never-subscribed'
  | 'purchasing-disabled'
  | 'stripe-billing-profile'

export type ProviderSubscriptionState = {
  userId: string | null
  scenario: ProviderSubscriptionScenario
  store: EntitlementStore
}

let providerSubscriptionState: ProviderSubscriptionState | null = null

export function configureProviderSubscriptionState(state: {
  userId?: string
  scenario: ProviderSubscriptionScenario
  store?: EntitlementStore
}) {
  providerSubscriptionState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
    // The web rail is the default; interactions pinning the store-managed
    // arrangement pass 'app_store' explicitly.
    store: state.store ?? 'stripe',
  }
}

export function getProviderSubscriptionState(): ProviderSubscriptionState | null {
  return providerSubscriptionState
}

export function resetProviderSubscriptionState() {
  providerSubscriptionState = null
}

/* --------------------------------------------------------------------------- *
 * Story 5.3 premium theme switcher provider states.
 *
 * Same design as the 5.2 subscription states above: each scenario names an
 * arrangement the contract records an outcome for, and the doubles above
 * decide their answer from it rather than from a real database, flag, or
 * `PremiumEntitlementService` call to production code -- except for the guard
 * itself, which is the one piece of production logic this fixture leaves
 * unmocked (see the `PremiumEntitlementGuard` provider registration above).
 * The `theme` field is the factory override the entitled-with-no-stored-row
 * (Default) read interaction needs: 'The user has premium theme access' with
 * no `theme` param models an absent/NULL row, and with `theme: 'jewel_radiance'`
 * (or any shipped key) models a stored preference. Both are Decision 8's two
 * spellings of Default when `theme` is omitted, and a real stored choice when
 * it isn't.
 * --------------------------------------------------------------------------- */
export type ProviderPremiumThemeScenario = 'entitled' | 'not-entitled' | 'themes-disabled'

export type ProviderPremiumThemeState = {
  userId: string | null
  scenario: ProviderPremiumThemeScenario
  theme: PremiumThemeKey | null
}

let providerPremiumThemeState: ProviderPremiumThemeState | null = null

export function configureProviderPremiumThemeState(state: {
  userId?: string
  scenario: ProviderPremiumThemeScenario
  theme?: PremiumThemeKey
}) {
  providerPremiumThemeState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
    theme: state.theme ?? null,
  }
}

export function getProviderPremiumThemeState(): ProviderPremiumThemeState | null {
  return providerPremiumThemeState
}

export function resetProviderPremiumThemeState() {
  providerPremiumThemeState = null
}
