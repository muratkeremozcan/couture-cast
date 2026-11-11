// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Learning path Step 54: Complimentary full access (X-DISPATCH).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
//
// The dispatch guard pool when opening a connection is slow. On the hosted worker one guard
// connection (TCP, TLS and the transaction pooler's startup) took 0.6 to 0.7 s idle and 1.0 to
// 1.2 s with its two vCPUs busy (2026-11-11), over the 1 s pool_timeout the pool used to have:
// the startup preflight failed as capability_unavailable and every send that had to open a
// connection failed. Here a TCP proxy holds each new connection for 1.5 s in front of a real
// PostgreSQL 17, so the real Prisma engine pays the same cost.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { connect, createServer, type AddressInfo, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  grant,
  recordingRemote,
  seedMemberFlagsOff,
} from './helpers/complimentary-access-fixtures.js'
import {
  communityGuardPoolUrl,
  openCommunityGuardPool,
  startCommunityEngagementRuntime,
} from '../src/modules/community/community-engagement.runtime.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunitySendGuard } from '../src/modules/community/community-send-guard.js'
import type { CommunityPushProvider } from '../src/modules/community/community-push-provider.js'
import type { CommunityPushOutcome } from '../src/modules/community/community-push-policy.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { ComplimentaryAccessService } from '../src/modules/feature-flags/complimentary-access.service.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'

vi.setConfig({ testTimeout: 120_000 })

const SLOW_CONNECT_MS = 1500

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
const remote = recordingRemote()
const flags = new CommunityFlagEvaluationService(
  prisma,
  remote.provider,
  new ComplimentaryAccessService(prisma, remote.provider)
)

type Message = Parameters<CommunityPushProvider['send']>[0]
const sent: Message[] = []
const provider = {
  send: (message: Message) => {
    sent.push(message)
    return Promise.resolve<CommunityPushOutcome>({
      status: 'accepted',
      ticketId: randomUUID(),
    })
  },
} as unknown as CommunityPushProvider

/** Holds every new connection for SLOW_CONNECT_MS before it reaches the database. */
function slowConnectProxy(target: URL) {
  const sockets = new Set<Socket>()
  let accepted = 0
  const server = createServer((client) => {
    accepted++
    sockets.add(client)
    client.pause()
    const opening = setTimeout(() => {
      const upstream = connect(Number(target.port || 5432), target.hostname)
      sockets.add(upstream)
      const close = () => {
        client.destroy()
        upstream.destroy()
      }
      upstream.on('connect', () => {
        client.pipe(upstream)
        upstream.pipe(client)
        client.resume()
      })
      upstream.on('error', close)
      upstream.on('close', close)
      client.on('close', close)
    }, SLOW_CONNECT_MS)
    client.on('error', () => clearTimeout(opening))
    client.on('close', () => clearTimeout(opening))
  })
  return {
    accepted: () => accepted,
    async listen() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const url = new URL(db.url)
      url.port = String((server.address() as AddressInfo).port)
      return url.toString()
    },
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((socket) => socket.destroy())
        server.close(() => resolve())
      }),
  }
}

const privacyVersion = (version: 0 | 1) =>
  prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = ${version} WHERE id = 1`

const proxy = slowConnectProxy(new URL(db.url))
let guardUrl: string
beforeAll(async () => {
  expect(new URL(db.url).hostname).toBe('127.0.0.1')
  await db.migrate()
  await seedMemberFlagsOff(prisma)
  guardUrl = await proxy.listen()
}, 120_000)
afterEach(() => {
  vi.unstubAllEnvs()
})
afterAll(async () => {
  await proxy.close()
  await prisma.$disconnect()
  await db.drop()
})

const active = () =>
  persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )

/** One granted, opted-in author with one device and a reaction on their post. */
async function grantedDelivery() {
  await privacyVersion(0)
  const author = await active()
  const actor = await active()
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: author.id, status: 'published' })
    ),
  })
  await prisma.notificationPreference.create({ data: { user_id: author.id } })
  await prisma.communityNotificationPreference.create({
    data: { user_id: author.id, enabled: true },
  })
  await new PushRegistrationService(prisma).register(author.id, {
    token: `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`,
    installationId: randomUUID(),
    platform: 'ios',
    permission: 'granted',
  })
  await new CommunityRepository(prisma).setReaction({
    userId: actor.id,
    postId: post.id,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
  await grant(prisma, author.id)
  const worker = new CommunityNotificationsWorker(prisma, {
    dispatch: () => Promise.resolve(false),
  })
  const deadline = Date.now() + 20_000
  for (;;) {
    await worker.group()
    await worker.fanout()
    const delivery = await prisma.communityTokenDelivery.findFirst({
      where: { owner_id: author.id, group: { post_id: post.id } },
    })
    if (delivery) {
      await privacyVersion(1)
      return delivery
    }
    if (Date.now() > deadline) throw new Error('fanout made no delivery within 20 s')
    await delay(50)
  }
}

describe('dispatch guard pool with 1.5 s connection opening', () => {
  it('reaches ready on the first preflight and opens every guard connection before a send', async () => {
    await privacyVersion(1)
    vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'true')
    vi.stubEnv('COMMUNITY_ENGAGEMENT_OWNER', 'general')
    vi.stubEnv('DATABASE_URL', db.url)
    vi.stubEnv('COMMUNITY_GUARD_DATABASE_URL', guardUrl)
    const before = proxy.accepted()
    const started = Date.now()
    const runtime = await startCommunityEngagementRuntime(
      prisma,
      remote.provider,
      'general',
      {
        spotlightRedis: {
          get: () => Promise.resolve(null),
          set: () => Promise.resolve('OK' as const),
          eval: () => Promise.resolve(1),
          disconnect: () => undefined,
        },
      }
    )
    try {
      expect(runtime.dispatch).toEqual({ status: 'ready' })
      // One connection for the preflight, then the rest of the 36 opened together:
      // two connection openings, nowhere near the 7 s of preflight backoff.
      expect(proxy.accepted() - before).toBe(36)
      expect(Date.now() - started).toBeLessThan(6 * SLOW_CONNECT_MS)
    } finally {
      await runtime.close()
    }
  })

  it('sends twelve granted deliveries at once with no deferral and opens no new connection', async () => {
    const deliveries: { id: string }[] = []
    for (let index = 0; index < 12; index++) deliveries.push(await grantedDelivery())
    const pool = new PrismaClient({
      datasources: { db: { url: communityGuardPoolUrl(guardUrl) } },
    })
    try {
      const guard = new CommunitySendGuard(pool, flags, provider)
      const opened = await openCommunityGuardPool(pool, guard)
      expect(opened).toEqual({ attempts: 1, connections: 36 })
      const accepted = proxy.accepted()
      sent.length = 0
      // One pass each, no retry: a send that could not get a connection would be left
      // deferred with no_call:guard_failure, or would throw.
      await Promise.all(deliveries.map((delivery) => guard.dispatch(delivery.id)))
      expect(sent).toHaveLength(12)
      const states = await prisma.communityTokenDelivery.findMany({
        where: { id: { in: deliveries.map((delivery) => delivery.id) } },
      })
      expect(states.map((state) => state.status)).toEqual(Array(12).fill('accepted'))
      const reasons = await prisma.communityDeliveryAttempt.findMany({
        where: { delivery_id: { in: deliveries.map((delivery) => delivery.id) } },
        select: { reason: true },
      })
      expect(reasons.filter((attempt) => attempt.reason?.startsWith('no_call:'))).toEqual(
        []
      )
      expect(proxy.accepted()).toBe(accepted)
    } finally {
      await pool.$disconnect()
    }
  })
})
