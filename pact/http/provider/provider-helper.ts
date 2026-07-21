import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Prisma } from '@prisma/client'
import { existsSync, mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { ApiHealthController } from '../../../apps/api/src/controllers/api-health.controller'
import { HealthController } from '../../../apps/api/src/controllers/health.controller'
import { AccessTokenIdentityService } from '../../../apps/api/src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../../../apps/api/src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../../../apps/api/src/modules/auth/security.guards'
import { EventsController } from '../../../apps/api/src/modules/events/events.controller'
import { EventsRepository } from '../../../apps/api/src/modules/events/events.repository'
import { EventsService } from '../../../apps/api/src/modules/events/events.service'
import { RitualController } from '../../../apps/api/src/modules/personalization/ritual.controller'
import { RitualService } from '../../../apps/api/src/modules/personalization/ritual.service'
import { ComfortController } from '../../../apps/api/src/modules/personalization/comfort.controller'
import { ComfortService } from '../../../apps/api/src/modules/personalization/comfort.service'

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

export function resetProviderState() {
  providerEvents = []
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

  const mockRitualService = {
    getOrCreateRitual: (_userId: string, _locationId?: string) => {
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
        outfits: [
          {
            id: 'rec-morning-1',
            scenario: 'morning',
            garmentIds: ['g-1'],
            reasoningBadges: [{ label: 'Wind layer' }],
            comfortNotes: 'Chilly morning',
          },
          {
            id: 'rec-midday-1',
            scenario: 'midday',
            garmentIds: ['g-2'],
            reasoningBadges: [{ label: 'Mild' }],
            comfortNotes: 'Pleasant midday',
          },
          {
            id: 'rec-evening-1',
            scenario: 'evening',
            garmentIds: ['g-3'],
            reasoningBadges: [{ label: 'Evening' }],
            comfortNotes: 'Cool evening',
          },
        ],
        badges: ['Wind layer', 'Mild', 'Evening'],
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

  const moduleFixture = await Test.createTestingModule({
    controllers: [
      ApiHealthController,
      HealthController,
      EventsController,
      RitualController,
      ComfortController,
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
