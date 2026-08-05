// Step 22 step 6 owner: mock localized database state response in Pact provider tests in pact/http/provider/provider-helper.ts
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Prisma } from '@prisma/client'
import { existsSync, mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
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
import {
  GARMENT_TAGGING_ANALYSIS_VERSION,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
} from '@couture/api-client'
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
      return token === 'pact-event-token'
        ? Promise.resolve({ userId: 'guardian-1', role: 'guardian' as const })
        : Promise.reject(new Error('Unknown Pact access token'))
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
    ],
  })
    .overrideGuard(RequestAuthGuard)
    .useValue(
      new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService)
    )
    .compile()

  const localApp = moduleFixture.createNestApplication()
  await localApp.init()
  await localApp.listen(0, '127.0.0.1')

  return {
    app: localApp,
    providerBaseUrl: resolveProviderBaseUrl(localApp),
  }
}
