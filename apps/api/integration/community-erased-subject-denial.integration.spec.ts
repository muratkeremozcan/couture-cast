// Story 6.5 PR #157 web review F2: an erased community subject is a terminal, typed denial on
// every shared authorization path, not a retryable outage. Real PG17 UUID database, actual
// controllers, services, flag evaluation and the production realtime server factory.
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { io, type Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createUser, persistUser } from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { listenHttpApp } from './helpers/loopback-http-app.js'
import { bindRequestContext } from '../src/logger/request-context.js'
import { CommunitySyncController } from '../src/modules/community/community-sync.controller.js'
import { CommunitySyncService } from '../src/modules/community/community-sync.service.js'
import { CommunityTargetsService } from '../src/modules/community/community-targets.service.js'
import { CommunityPreferencesService } from '../src/modules/community/community-preferences.service.js'
import { CommunityController } from '../src/modules/community/community.controller.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import {
  CommunitySpotlightService,
  systemSpotlightClock,
} from '../src/modules/community/community-spotlight.service.js'
import { CommunitySpotlightRepository } from '../src/modules/community/community-spotlight.repository.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'
import { createCommunityRealtimeServer } from '../src/realtime/community-realtime.server.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
const remote = { getFeatureFlagValue: vi.fn(() => Promise.resolve<unknown>(true)) }
const flags = new FeatureFlagsService(
  new FeatureFlagsRepository(prisma),
  remote,
  new CommunityFlagEvaluationService(prisma, remote)
)
const repository = new CommunityRepository(prisma)
const access = new CommunityAccessService(prisma, flags)
const streams = new CommunityStreamRepository(prisma)
const identity = new AccessTokenIdentityService(prisma)
// The feed route reads no forecast, analytics or guardian state here; calls fail loudly.
const outside = new Proxy(
  {},
  {
    get: () => {
      throw new Error('Unexpected external dependency invocation')
    },
  }
)
const community = new CommunityService(
  repository,
  flags,
  outside as never,
  outside as never,
  new InMemoryCommunityStorage(),
  outside as never
)
// Story 6.6: the spotlight shares the feed's read gate, so it must refuse the same way.
const spotlightRepository = new CommunitySpotlightRepository(prisma)
const spotlight = new CommunitySpotlightService(
  spotlightRepository,
  community,
  outside as never,
  outside as never,
  systemSpotlightClock,
  'unreachable'
)
const runtimes: ReturnType<typeof createCommunityRealtimeServer>[] = []
const sockets: Socket[] = []
let app: INestApplication
let url: string

const DENIED = {
  statusCode: 403,
  code: 'denied',
  message: 'Community account unavailable.',
}
const member = () =>
  persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
const http = (path: string, owner: string, init: RequestInit = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer test-token:guardian:${owner}`,
      'x-couture-platform': 'web',
      'content-type': 'application/json',
      ...init.headers,
    },
  })
const routes = (owner: string) => ({
  preferences: () => http('/api/v1/community/notification-preferences', owner),
  targets: () =>
    http('/api/v1/community/targets/resolve', owner, {
      method: 'POST',
      body: JSON.stringify({ targets: [{ key: 'post', postId: 'lookbook-probe' }] }),
    }),
  feed: () => http('/api/v1/community/feed?mode=all&limit=12', owner),
  spotlight: () => http('/api/v1/community/spotlight', owner),
})
function realtimeToken(owner: string) {
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: owner,
      role: 'guardian',
      exp: Math.floor((Date.now() + 60_000) / 1000),
      e2e: 'couturecast-mobile-e2e',
    })
  ).toString('base64url')}.couturecast-mobile-e2e`
}
async function realtime() {
  const runtime = createCommunityRealtimeServer(() =>
    Promise.resolve({ prisma, access, streams, identity, origins: [] })
  )
  runtimes.push(runtime)
  await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`
  return (owner: string) => {
    const socket = io(`${base}/community`, {
      path: '/api/realtime',
      addTrailingSlash: false,
      transports: ['websocket'],
      auth: { token: realtimeToken(owner) },
      reconnection: false,
      forceNew: true,
      autoConnect: false,
    })
    sockets.push(socket)
    return socket
  }
}
async function untouched(owner: string) {
  expect(await prisma.communitySubject.count({ where: { member_id: owner } })).toBe(0)
  expect(
    await prisma.communityFlagEvaluation.count({ where: { member_id: owner } })
  ).toBe(0)
  expect(await prisma.communityStreamHead.count({ where: { owner_id: owner } })).toBe(0)
  expect(
    await prisma.communitySpotlightReadWindow.count({ where: { user_id: owner } })
  ).toBe(0)
}

beforeAll(async () => {
  await db.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
  const module = await Test.createTestingModule({
    controllers: [CommunitySyncController, CommunityController],
    providers: [
      {
        provide: CommunitySyncService,
        useValue: new CommunitySyncService(prisma, access, community, streams),
      },
      {
        provide: CommunityTargetsService,
        useValue: new CommunityTargetsService(prisma, access, repository, community),
      },
      {
        provide: CommunityPreferencesService,
        useValue: new CommunityPreferencesService(prisma, access),
      },
      { provide: CommunityService, useValue: community },
      { provide: CommunitySpotlightService, useValue: spotlight },
      { provide: AccessTokenIdentityService, useValue: identity },
      {
        provide: GuardianConsentStateService,
        useValue: new GuardianConsentStateService(prisma),
      },
    ],
  }).compile()
  app = module.createNestApplication()
  app.useLogger(false)
  app.use(bindRequestContext)
  url = await listenHttpApp(app)
}, 30_000)
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect())
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  remote.getFeatureFlagValue.mockImplementation(() => Promise.resolve<unknown>(true))
})
afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})

describe('6.5 F2 erased subject is a terminal typed denial on every shared authorization path', () => {
  it.each(['preferences', 'targets', 'feed', 'spotlight'] as const)(
    '%s answers 403 denied after same-session erasure and recreates nothing',
    async (route) => {
      const owner = await member()
      // A live session with a warm flag cache, then the existing erasure hook.
      expect((await routes(owner.id).preferences()).status).toBe(200)
      await repository.requestErasureForUser(owner.id, new Date())
      const response = await routes(owner.id)[route]()
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual(DENIED)
      await untouched(owner.id)
    }
  )

  it('erasure deletes the spotlight read window a first-page read left behind', async () => {
    const owner = await member()
    expect((await routes(owner.id).spotlight()).status).toBe(200)
    expect(
      await prisma.communitySpotlightReadWindow.count({ where: { user_id: owner.id } })
    ).toBe(1)
    await repository.requestErasureForUser(owner.id, new Date())
    expect((await routes(owner.id).spotlight()).status).toBe(403)
    await untouched(owner.id)
  })

  it('a spotlight read authorized before erasure never writes the erased member back', async () => {
    const owner = await member()
    expect((await routes(owner.id).preferences()).status).toBe(200)
    // Hold the read after the read gate let it through, right before its
    // limiter write, and commit the erasure in that gap.
    // The real write, through an unspied repository on the same database.
    const writer = new CommunitySpotlightRepository(prisma)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached!: () => void
    const atWrite = new Promise<void>((resolve) => {
      reached = resolve
    })
    const spy = vi
      .spyOn(spotlightRepository, 'recordRead')
      .mockImplementationOnce(async (userId: string, now: Date) => {
        reached()
        await held
        return writer.recordRead(userId, now)
      })
    try {
      const response = routes(owner.id).spotlight()
      await atWrite
      await repository.requestErasureForUser(owner.id, new Date())
      release()
      const refused = await response
      expect(refused.status).toBe(403)
      expect(await refused.json()).toEqual(DENIED)
      await untouched(owner.id)
    } finally {
      spy.mockRestore()
    }
  })

  it('the realtime handshake of an erased member is refused with the denied control', async () => {
    const socketFor = await realtime()
    const owner = await member()
    await repository.requestErasureForUser(owner.id, new Date())
    const socket = socketFor(owner.id)
    const refusal = new Promise<unknown>((resolve) =>
      socket.once('connect_error', (error: Error & { data?: unknown }) =>
        resolve(error.data)
      )
    )
    socket.connect()
    expect(await refusal).toEqual({ version: 1, status: 'denied' })
    await untouched(owner.id)
  })

  it('a connected member erased mid-session receives the denied control on revalidation', async () => {
    const socketFor = await realtime()
    const owner = await member()
    const socket = socketFor(owner.id)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
      socket.connect()
    })
    const control = new Promise<unknown>((resolve) =>
      socket.on('community:availability', resolve)
    )
    await repository.requestErasureForUser(owner.id, new Date())
    expect(await control).toEqual({ version: 1, status: 'denied' })
    await untouched(owner.id)
  }, 15_000)

  it('a real flag-provider outage for a surviving subject stays retryable unavailable', async () => {
    const owner = await member()
    remote.getFeatureFlagValue.mockImplementation(() =>
      Promise.reject(new Error('provider down'))
    )
    const response = await routes(owner.id).preferences()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'unavailable' })
    expect(await prisma.communitySubject.count({ where: { member_id: owner.id } })).toBe(
      1
    )
  })
})
