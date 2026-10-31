// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5 owner: a socket handshake refusal never blanks a feed HTTP is serving.
//
// The real realtime server refuses this handshake before verifying any identity (the bearer
// has already expired), the same outcome as a foreign Origin. The shared client transport and
// sync state must treat it as an ordinary disconnect: keep reconnecting, keep polling HTTP,
// and never report affirmative denial.
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  CommunitySyncState,
  type CommunitySyncCallbacks,
  type CommunitySyncClient,
} from '@couture/api-client'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { until } from './helpers/community-engagement-harness.js'
import { createCommunityRealtimeServer } from '../src/realtime/community-realtime.server.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
let runtime: ReturnType<typeof createCommunityRealtimeServer>
let base = ''
const handshakes = vi.fn()

beforeAll(async () => {
  await db.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  runtime = createCommunityRealtimeServer(() => {
    handshakes()
    return Promise.resolve({
      prisma,
      access: { assert: () => Promise.resolve() },
      streams: new CommunityStreamRepository(prisma),
      identity: new AccessTokenIdentityService(prisma),
      origins: ['https://story65.synthetic.test'],
    })
  })
  await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`
}, 30_000)
afterAll(async () => {
  await runtime.close()
  await new Promise<void>((resolve) => runtime.server.close(() => resolve()))
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})

function lapsedToken() {
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: 'member-refused',
      role: 'guardian',
      exp: Math.floor((Date.now() - 1000) / 1000),
      e2e: 'couturecast-mobile-e2e',
    })
  ).toString('base64url')}.couturecast-mobile-e2e`
}

it('keeps reconnecting and polling HTTP after a refused handshake, without denial', async () => {
  const page = {
    events: [],
    nextCursor: 'cursor',
    hasMore: false,
    resyncRequired: false,
  }
  const client = {
    events: vi.fn<CommunitySyncClient['events']>().mockResolvedValue(page),
    resolve: vi.fn<CommunitySyncClient['resolve']>().mockResolvedValue({ targets: [] }),
  }
  const availability = vi.fn<CommunitySyncCallbacks['availability']>()
  const state = new CommunitySyncState(client, 'all', {
    rendered: () => ['post'],
    rebuild: () => Promise.resolve(),
    changed: () => Promise.resolve(),
    apply: () => undefined,
    availability,
  })
  try {
    state.start(base, () => Promise.resolve(lapsedToken()))
    // Two refused handshakes prove the transport kept retrying rather than stopping.
    await until(
      () => Promise.resolve(handshakes.mock.calls.length),
      (count) => count >= 2,
      5000
    )
    const initialPolls = client.events.mock.calls.length
    expect(initialPolls).toBeGreaterThanOrEqual(1)
    // The fallback timer is 7.5 to 8 s; HTTP keeps serving the feed through it.
    await until(
      () => Promise.resolve(client.events.mock.calls.length),
      (count) => count > initialPolls,
      9000
    )
    const states = availability.mock.calls.map(([status]) => status)
    expect(states).not.toContain('denied')
    // HTTP catch-up keeps reporting the feed as served while the socket keeps recovering.
    expect(new Set(states)).toEqual(new Set(['connected', 'recovering']))
  } finally {
    state.stop()
  }
}, 20_000)
