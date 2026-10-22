// Story 6.5 owner (D1/D10): 100 sockets that connect together stay connected through
// revalidation and doorbells on a bounded database pool.
//
// Every socket revalidates its member at most eight seconds apart and immediately before a
// doorbell. When a whole instance's sockets connect at once (any deploy or restart), those
// checks used to fire together; on a bounded pool their transactions waited past the 2 s
// budget and the instance told healthy members it was unavailable.
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { until } from './helpers/community-engagement-harness.js'
import { createCommunityRealtimeServer } from '../src/realtime/community-realtime.server.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'

const SOCKETS = 100
const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
// The instance's own pool is deliberately small, so pool waits are the variable.
const poolUrl = new URL(db.url)
poolUrl.searchParams.set('connection_limit', '5')
const pool = new PrismaClient({ datasources: { db: { url: poolUrl.toString() } } })
const remote = { getFeatureFlagValue: vi.fn(() => Promise.resolve<unknown>(true)) }
const sockets: Socket[] = []
let runtime: ReturnType<typeof createCommunityRealtimeServer>

beforeAll(async () => {
  await db.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
}, 30_000)
afterAll(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect())
  await runtime?.close()
  await pool.$disconnect()
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})

function fixtureToken(member: string) {
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: member,
      role: 'guardian',
      exp: Math.floor((Date.now() + 120_000) / 1000),
      e2e: 'couturecast-mobile-e2e',
    })
  ).toString('base64url')}.couturecast-mobile-e2e`
}

it('keeps 100 sockets that connect together connected through revalidation and doorbells', async () => {
  const access = new CommunityAccessService(
    pool,
    new FeatureFlagsService(
      new FeatureFlagsRepository(pool),
      remote,
      new CommunityFlagEvaluationService(pool, remote)
    )
  )
  runtime = createCommunityRealtimeServer(() =>
    Promise.resolve({
      prisma: pool,
      access,
      streams: new CommunityStreamRepository(pool),
      identity: new AccessTokenIdentityService(pool),
      origins: ['https://story65.synthetic.test'],
    })
  )
  await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`
  const members = await Promise.all(
    Array.from({ length: SOCKETS }, () =>
      persistUser(
        prisma,
        createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
      )
    )
  )
  const controls: unknown[] = []
  const bells = new Map<Socket, number>()
  for (const member of members) {
    const socket = io(`${base}/community`, {
      path: '/api/realtime',
      addTrailingSlash: false,
      transports: ['websocket'],
      auth: { token: fixtureToken(member.id) },
      reconnection: false,
      forceNew: true,
    })
    socket.on('community:availability', (payload: unknown) => controls.push(payload))
    socket.on('community:changed', () => bells.set(socket, (bells.get(socket) ?? 0) + 1))
    sockets.push(socket)
  }
  await until(
    () => Promise.resolve(sockets.filter((socket) => socket.connected).length),
    (count) => count === SOCKETS,
    20_000
  )
  // Two full revalidation rounds (each at most eight seconds apart) plus a doorbell,
  // which revalidates every socket's member immediately before ringing it.
  await delay(4500)
  await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: members[0]!.id, status: 'published' })
    ),
  })
  await delay(5000)

  expect(controls).toEqual([])
  expect(sockets.filter((socket) => socket.connected)).toHaveLength(SOCKETS)
  expect([...bells.values()].filter((count) => count > 0)).toHaveLength(SOCKETS)
}, 60_000)
