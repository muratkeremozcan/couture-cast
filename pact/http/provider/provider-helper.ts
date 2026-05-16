import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Prisma } from '@prisma/client'
import { existsSync, mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { ApiHealthController } from '../../../apps/api/src/controllers/api-health.controller'
import { HealthController } from '../../../apps/api/src/controllers/health.controller'
import { EventsController } from '../../../apps/api/src/modules/events/events.controller'
import { EventsRepository } from '../../../apps/api/src/modules/events/events.repository'
import { EventsService } from '../../../apps/api/src/modules/events/events.service'

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
  findSince(since?: Date) {
    if (!since) {
      return Promise.resolve(providerEvents)
    }

    return Promise.resolve(providerEvents.filter((event) => event.created_at > since))
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

  const moduleFixture = await Test.createTestingModule({
    controllers: [ApiHealthController, HealthController, EventsController],
    providers: [
      EventsService,
      {
        provide: EventsRepository,
        useValue: eventsRepository,
      },
    ],
  }).compile()

  const localApp = moduleFixture.createNestApplication()
  await localApp.init()
  await localApp.listen(0, '127.0.0.1')

  return {
    app: localApp,
    providerBaseUrl: resolveProviderBaseUrl(localApp),
  }
}
