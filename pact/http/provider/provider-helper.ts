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
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
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
import type {
  SilhouetteMode,
  SilhouettePhotoFailureReason,
  SilhouettePhotoStatus,
  UpdateWardrobeOnboardingStateInput,
  UpdateSilhouetteSlidersInput,
  WardrobeOnboardingStep,
  WardrobeOnboardingStateResponse,
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
    ],
  })
    .overrideGuard(RequestAuthGuard)
    .useValue(
      new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService)
    )
    .compile()

  const localApp = moduleFixture.createNestApplication()

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
