import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createApiClient,
  communitySyncClient,
  CommunitySyncState,
} from '@couture/api-client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { drainCommunityOutbox } from './helpers/community-outbox-drain.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import { createCommunityRealtimeServer } from '../src/realtime/community-realtime.server.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { CommunitySyncController } from '../src/modules/community/community-sync.controller.js'
import { CommunitySyncService } from '../src/modules/community/community-sync.service.js'
import { CommunityTargetsService } from '../src/modules/community/community-targets.service.js'
import { CommunityPreferencesService } from '../src/modules/community/community-preferences.service.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
const remote = { getFeatureFlagValue: vi.fn(() => Promise.resolve(true)) }
const flags = new FeatureFlagsService(
  new FeatureFlagsRepository(prisma),
  remote,
  new CommunityFlagEvaluationService(prisma, remote)
)
const access = new CommunityAccessService(prisma, flags)
const streams = new CommunityStreamRepository(prisma)
const repository = new CommunityRepository(prisma)
const outside = new Proxy(
  {},
  {
    get: () => {
      throw new Error('Unexpected unrelated dependency')
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
let app: INestApplication
let httpUrl: string
const coordinators: CommunitySyncState[] = []
const runtimes: ReturnType<typeof createCommunityRealtimeServer>[] = []

beforeAll(async () => {
  await db.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
  const module = await Test.createTestingModule({
    controllers: [CommunitySyncController],
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
      {
        provide: AccessTokenIdentityService,
        useValue: new AccessTokenIdentityService(prisma),
      },
      {
        provide: GuardianConsentStateService,
        useValue: new GuardianConsentStateService(prisma),
      },
    ],
  }).compile()
  app = module.createNestApplication()
  app.useLogger(false)
  httpUrl = await listenHttpApp(app)
}, 30_000)
afterEach(async () => {
  coordinators.splice(0).forEach((state) => state.stop())
  vi.restoreAllMocks()
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
})
afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})
function fixtureToken(member: string) {
  // Local fixture-auth lane; real Supabase-session/provider/hosted proof remains separate.
  return `e30.${Buffer.from(JSON.stringify({ sub: member, role: 'guardian', exp: Math.floor(Date.now() / 1000) + 120, e2e: 'couturecast-mobile-e2e' })).toString('base64url')}.couturecast-mobile-e2e`
}
async function setup() {
  const owner = await persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
  const actor = await persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: owner.id, status: 'published' })
    ),
  })
  // The previous case's sync reads and realtime ticks leave detached assists that can
  // still hold a head; drain the way the runtime does.
  await drainCommunityOutbox(prisma, streams)
  const runtime = createCommunityRealtimeServer(() =>
    Promise.resolve({
      prisma,
      access,
      streams,
      identity: new AccessTokenIdentityService(prisma),
      origins: [],
    })
  )
  runtimes.push(runtime)
  await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
  const socketUrl = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`
  const token = vi.fn(() => Promise.resolve(fixtureToken(owner.id)))
  const client = communitySyncClient(createApiClient(httpUrl, { accessToken: token }))
  // These spies forward to actual HTTP wrappers; no response or callback is injected.
  const eventStarts: number[] = []
  const realEvents = client.events
  const events = vi.spyOn(client, 'events').mockImplementation((...args) => {
    eventStarts.push(performance.now())
    return realEvents(...args)
  })
  const changed = vi.fn<
    (
      events: Parameters<
        ConstructorParameters<typeof CommunitySyncState>[2]['changed']
      >[0],
      signal?: AbortSignal
    ) => Promise<void>
  >(() => Promise.resolve())
  const availability = vi.fn()
  let visibleTotal: number | undefined
  const state = new CommunitySyncState(client, 'all', {
    rendered: () => [post.id],
    rebuild: () => {
      visibleTotal = undefined
      return Promise.resolve()
    },
    apply: (target) => {
      visibleTotal =
        target.status === 'available' ? target.post.reactions.total : undefined
    },
    changed,
    availability,
  })
  coordinators.push(state)
  state.start(socketUrl, token)
  await vi.waitFor(
    () => {
      expect(visibleTotal).toBe(0)
      expect(availability).toHaveBeenCalledWith('connected', true)
    },
    { timeout: 5000 }
  )
  await state.catchUp()
  return {
    eventStarts,
    owner,
    actor,
    post,
    runtime,
    state,
    events,
    changed,
    availability,
    total: () => visibleTotal,
  }
}

describe('Story 6.5 R16 V2: real server through production transport and coordinator', () => {
  it('reconciles a real committed reaction through a doorbell with periodic polling disabled', async () => {
    const nativeTimeout = globalThis.setTimeout
    let blockedPollExecutions = 0
    // Disable only the coordinator 7.5..8s fallback lane. Server, Socket.IO,
    // HTTP, reconnect and auth timers continue at real wall time.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (typeof delay === 'number' && delay >= 7500 && delay <= 8000) {
        return nativeTimeout(() => {
          blockedPollExecutions++
        }, delay)
      }
      return nativeTimeout(callback, delay, ...args)
    }) as typeof setTimeout)
    const f = await setup()
    const transportNames = [...f.runtime.io.of('/community').sockets.values()].map(
      (socket) => socket.conn.transport.name
    )
    expect(transportNames).toEqual(['websocket'])
    f.changed.mockClear()
    const before = f.events.mock.calls.length
    await prisma.communityReaction.create({
      data: { user_id: f.actor.id, post_id: f.post.id, selection: 'love' },
    })
    await vi.waitFor(() => expect(f.total()).toBe(1), { timeout: 5000 })
    expect(f.changed).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'reactions.changed', postId: f.post.id }),
      ]),
      expect.any(AbortSignal)
    )
    const changedSignal = f.changed.mock.calls.at(-1)![1]!
    expect(changedSignal.aborted).toBe(false)
    expect(f.events.mock.calls.length).toBeGreaterThan(before)
    expect(blockedPollExecutions).toBe(0)
    // A full fallback interval proves that healthy transport cancelled polling.
    const afterDoorbell = f.events.mock.calls.length
    await new Promise<void>((resolve) => nativeTimeout(resolve, 8100))
    expect(f.events).toHaveBeenCalledTimes(afterDoorbell)
    expect(blockedPollExecutions).toBe(0)
    expect(f.total()).toBe(1)
  }, 20_000)

  it('keeps HTTP reconciliation available within the fallback interval after the real socket server closes', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const f = await setup()
    const outageStarted = performance.now()
    const beforeOutage = f.eventStarts.length
    await f.runtime.close()
    runtimes.splice(runtimes.indexOf(f.runtime), 1)
    await vi.waitFor(() =>
      expect(f.availability).toHaveBeenCalledWith('recovering', false)
    )
    f.changed.mockClear()
    await prisma.communityReaction.create({
      data: { user_id: f.actor.id, post_id: f.post.id, selection: 'love' },
    })
    const started = performance.now()
    // Recovery applies the target snapshot before its owned event replay completes.
    // Observe both results within the original 10s budget.
    await vi.waitFor(
      () => {
        expect(f.total()).toBe(1)
        expect(f.changed).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'reactions.changed', postId: f.post.id }),
          ]),
          expect.any(AbortSignal)
        )
        expect(f.availability).toHaveBeenLastCalledWith('connected', false)
      },
      { timeout: 10_000, interval: 50 }
    )
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(f.eventStarts[beforeOutage]! - outageStarted).toBeLessThanOrEqual(8000)
    expect(f.changed).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'reactions.changed', postId: f.post.id }),
      ]),
      expect.any(AbortSignal)
    )
    const changedSignal = f.changed.mock.calls.at(-1)![1]!
    expect(changedSignal.aborted).toBe(false)
    expect(f.availability).toHaveBeenLastCalledWith('connected', false)
  }, 15_000)
})
