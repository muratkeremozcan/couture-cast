// Learning path Step 54: Complimentary full access.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
// Story 6.14 TEA, slice 10: push and realtime reach a complimentary member only through
// the grant.
//
// The evaluator is the one the community worker builds: CommunityFlagEvaluationService
// over the real ComplimentaryAccessService, with a remote provider that answers false for
// every member flag. A send or an open socket can therefore only come from the grant.
// Grants and revokes run through the real operator (complimentary-access-fixtures.ts).
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
import { io, type Socket } from 'socket.io-client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  grant,
  recordingRemote,
  revoke,
  seedMemberFlagsOff,
} from './helpers/complimentary-access-fixtures.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunitySendGuard } from '../src/modules/community/community-send-guard.js'
import type { CommunityPushProvider } from '../src/modules/community/community-push-provider.js'
import type { CommunityPushOutcome } from '../src/modules/community/community-push-policy.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { ComplimentaryAccessService } from '../src/modules/feature-flags/complimentary-access.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'
import { createCommunityRealtimeServer } from '../src/realtime/community-realtime.server.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'

vi.setConfig({ testTimeout: 90_000 })

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
// The worker-built evaluator, with PostHog answering false for community read.
const remote = recordingRemote()
const complimentary = new ComplimentaryAccessService(prisma, remote.provider)
const flags = new CommunityFlagEvaluationService(prisma, remote.provider, complimentary)

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
const guard = new CommunitySendGuard(prisma, flags, provider)

const privacyVersion = (version: 0 | 1) =>
  prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = ${version} WHERE id = 1`

beforeAll(async () => {
  await db.migrate()
  await seedMemberFlagsOff(prisma)
}, 120_000)
beforeEach(async () => {
  sent.length = 0
  await privacyVersion(0)
})
afterAll(async () => {
  await prisma.$disconnect()
  await db.drop()
})

const active = () =>
  persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )

/** Repeats one runtime loop pass until it decides, as the 6.5 suites do. */
async function untilDecided<T>(loop: string, pass: () => Promise<T | undefined>) {
  const deadline = Date.now() + 20_000
  for (;;) {
    let failure: unknown
    try {
      const decided = await pass()
      if (decided !== undefined) return decided
    } catch (error) {
      failure = error
    }
    if (Date.now() >= deadline)
      throw new Error(`The ${loop} loop did not decide within 20 s`, { cause: failure })
    await delay(50)
  }
}

/** One opted-in author with one device, and a reaction on their post from another member. */
async function fixture() {
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
  const worker = new CommunityNotificationsWorker(prisma, {
    dispatch: () => Promise.resolve(),
  })
  const delivery = await untilDecided('fanout', async () => {
    await worker.group()
    await worker.fanout()
    const created = await prisma.communityTokenDelivery.findFirst({
      where: { owner_id: author.id, group: { post_id: post.id } },
    })
    return created ?? undefined
  })
  return { author, delivery }
}

const state = (id: string) =>
  prisma.communityTokenDelivery.findUniqueOrThrow({ where: { id } })
const attempts = (deliveryId: string) =>
  prisma.communityDeliveryAttempt.findMany({
    where: { delivery_id: deliveryId },
    orderBy: { ordinal: 'asc' },
  })

/**
 * Dispatches one delivery until the guard decides, and returns the provider calls that
 * this delivery's passes made. A pass that leaves it pending or deferred made no call,
 * so the delivery is made due again and repeated.
 */
async function dispatch(delivery: { id: string; group_id: string }) {
  const before = sent.length
  await untilDecided('dispatch', async () => {
    const calls = sent.length
    await guard.dispatch(delivery.id)
    const current = await state(delivery.id)
    if (sent.length > calls || !['pending', 'deferred'].includes(current.status))
      return current
    await prisma.communityTokenDelivery.update({
      where: { id: delivery.id },
      data: { next_attempt_at: new Date(Date.now() - 1000) },
    })
    await prisma.communityNotificationGroup.update({
      where: { id: delivery.group_id },
      data: { next_attempt_at: new Date(Date.now() - 1000) },
    })
    return undefined
  })
  return sent.slice(before)
}

describe('complimentary push', () => {
  it('I-PUSH-GRANTEE: only the grantee delivery reaches the provider; the non-grantee is suppressed with no call', async () => {
    const grantee = await fixture()
    const control = await fixture()
    await grant(prisma, grantee.author.id)
    await privacyVersion(1)

    const granteeCalls = await dispatch(grantee.delivery)
    const controlCalls = await dispatch(control.delivery)

    expect(granteeCalls).toHaveLength(1)
    expect(await state(grantee.delivery.id)).toMatchObject({ status: 'accepted' })
    expect(controlCalls).toEqual([])
    expect(await state(control.delivery.id)).toMatchObject({ status: 'suppressed' })
    // The evaluator answers false before any attempt is claimed, so the control has no
    // attempt row; the read_disabled reason exists only on the in-transaction recheck.
    expect(await attempts(control.delivery.id)).toEqual([])
    // PostHog was asked about the control only; the grantee answered from the grant.
    const asked = remote.calls
      .filter((call) => call.flagKey === 'community_read_enabled')
      .map((call) => call.subjectId)
    expect(asked).toContain(control.author.id)
    expect(asked).not.toContain(grantee.author.id)
  })

  it('I-PUSH-REVOKED: a grant revoked before dispatch sends nothing', async () => {
    const grantee = await fixture()
    await grant(prisma, grantee.author.id)
    await revoke(prisma, grantee.author.id)
    await privacyVersion(1)

    expect(await dispatch(grantee.delivery)).toEqual([])
    expect(await state(grantee.delivery.id)).toMatchObject({ status: 'suppressed' })
    expect(await attempts(grantee.delivery.id)).toEqual([])
  })

  it('I-PUSH-REVOKED (cached true): a revoke after the grantee was evaluated true still sends nothing', async () => {
    const grantee = await fixture()
    await grant(prisma, grantee.author.id)
    expect((await flags.evaluate(grantee.author.id)).value).toBe(true)
    await revoke(prisma, grantee.author.id)
    await privacyVersion(1)

    expect(await dispatch(grantee.delivery)).toEqual([])
    expect(await state(grantee.delivery.id)).toMatchObject({ status: 'suppressed' })
  })

  it('I-PUSH-OPT-OUT: a grantee who turned push off is suppressed with no_call:opt_out', async () => {
    const grantee = await fixture()
    await prisma.notificationPreference.update({
      where: { user_id: grantee.author.id },
      data: { push_enabled: false },
    })
    await grant(prisma, grantee.author.id)
    await privacyVersion(1)

    expect(await dispatch(grantee.delivery)).toEqual([])
    expect(await state(grantee.delivery.id)).toMatchObject({ status: 'suppressed' })
    expect(
      (await attempts(grantee.delivery.id)).map((attempt) => attempt.reason)
    ).toEqual(['no_call:opt_out'])
  })
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

describe('complimentary realtime', () => {
  beforeAll(() => {
    vi.stubEnv('TEST_ENV', 'local')
    vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('I-REALTIME-REVOKE: a revoked grantee socket is denied and closed within one revalidation', async () => {
    const access = new CommunityAccessService(
      prisma,
      new FeatureFlagsService(
        new FeatureFlagsRepository(prisma),
        remote.provider,
        flags,
        complimentary
      )
    )
    const runtime = createCommunityRealtimeServer(() =>
      Promise.resolve({
        prisma,
        access,
        streams: new CommunityStreamRepository(prisma),
        identity: new AccessTokenIdentityService(prisma),
        origins: ['https://story614.synthetic.test'],
      })
    )
    const sockets: Socket[] = []
    try {
      await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`
      const grantee = await active()
      const control = await active()
      await grant(prisma, grantee.id)

      const connect = (member: string) => {
        const socket = io(`${base}/community`, {
          path: '/api/realtime',
          addTrailingSlash: false,
          transports: ['websocket'],
          auth: { token: fixtureToken(member) },
          reconnection: false,
          forceNew: true,
        })
        sockets.push(socket)
        const availability: unknown[] = []
        socket.on('community:availability', (payload: unknown) =>
          availability.push(payload)
        )
        const outcome = new Promise<'connected' | 'refused'>((resolve) => {
          socket.once('connect', () => resolve('connected'))
          socket.once('connect_error', () => resolve('refused'))
        })
        return { socket, availability, outcome }
      }

      // Control: flags off and no grant, so the handshake is refused.
      expect(await connect(control.id).outcome).toBe('refused')

      const granted = connect(grantee.id)
      expect(await granted.outcome).toBe('connected')
      const closed = new Promise<number>((resolve) =>
        granted.socket.once('disconnect', () => resolve(performance.now()))
      )

      const revokedAt = performance.now()
      await revoke(prisma, grantee.id)
      const disconnectedAt = await Promise.race([
        closed,
        delay(10_000).then(() => Number.POSITIVE_INFINITY),
      ])

      expect(disconnectedAt - revokedAt).toBeLessThan(7_000)
      expect(granted.availability).toEqual([{ version: 1, status: 'denied' }])
    } finally {
      sockets.forEach((socket) => socket.disconnect())
      await runtime.close()
    }
  })
})
