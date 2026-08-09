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
import {
  GARMENT_TAGGING_ANALYSIS_VERSION,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
} from '@couture/api-client'
// `SilhouettePhotoFailureReason` is not part of the curated top-level
// @couture/api-client barrel (packages/api-client/src/index.ts); the
// contracts/http subpath re-exports everything from wardrobe.ts instead.
import type { SilhouettePhotoFailureReason } from '@couture/api-client/contracts/http'
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
            },
            {
              id: 'rec-midday-1',
              scenario: 'midday',
              garmentIds: ['g-2'],
              reasoningBadges: [
                { key: 'light_layers', label: 'Hafif Katmanlar', bullets: ['Ilık gün'] },
              ],
              comfortNotes: 'Ilık ve keyifli bir öğleden sonra.',
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
            },
            {
              id: 'rec-midday-1',
              scenario: 'midday',
              garmentIds: ['g-2'],
              reasoningBadges: [
                { key: 'light_layers', label: 'Light layers', bullets: ['Mild day'] },
              ],
              comfortNotes: 'Pleasant midday',
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

  const mockGuardianService = {
    assertWardrobeUploadAllowed: (userId: string) => {
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
  const capsuleCacheHeaders = new CapsuleCacheHeadersMiddleware()
  localApp.use('/api/v1/wardrobe', (req: Request, res: Response, next: NextFunction) => {
    if (/^\/[^/]+\/capsules(\/|$|\?)/.test(req.url)) {
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
 * Task 3/4's real `wardrobe-onboarding.controller.ts` and
 * `wardrobe-silhouette.controller.ts` are being built concurrently on
 * `feat/epic4-story4-t3t4-api` and are not present in this worktree, so
 * `startLocalPactProvider`'s `moduleFixture` above cannot yet register them
 * or a service double that reads this state. This is state-setup scaffolding
 * only: it lets `pact/http/provider/state-handlers.ts` configure a named,
 * deterministic scenario per interaction exactly like every other state
 * handler here, ready for a service double to consume once those
 * controllers land. Until then, `test:pact:provider`/`npm run test:pact`
 * legitimately fails on the new onboarding/silhouette interactions with 404s
 * (no matching route), not a bug in this state-setup code.
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
