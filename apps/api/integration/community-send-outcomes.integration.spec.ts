// Story 6.5 owner (D7): each provider outcome settles the durable delivery exactly once,
// and the guarded message names only what still survives at the final handoff.
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { recordCommunityEngagement } from '../src/modules/community/community-engagement-intent.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunitySendGuard } from '../src/modules/community/community-send-guard.js'
import type { CommunityPushProvider } from '../src/modules/community/community-push-provider.js'
import type { CommunityPushOutcome } from '../src/modules/community/community-push-policy.js'
import { CommunityUnavailableException } from '../src/modules/community/community-availability.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'

const db = isolatedCommunityDatabase()
// A test repeats runtime loop passes for up to 20 s each (see `untilDecided`), so the
// file's limit has to outlast a fixture fanout plus three dispatches.
vi.setConfig({ testTimeout: 90_000 })
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
const flags = new CommunityFlagEvaluationService(prisma, {
  getFeatureFlagValue: () => Promise.resolve(true),
})
type Message = Parameters<CommunityPushProvider['send']>[0]
const sent: Message[] = []
/** A provider double that records each invocation and answers with the given outcome. */
const provider = (answer: () => Promise<CommunityPushOutcome>) =>
  ({
    send: (message: Message) => {
      sent.push(message)
      return answer()
    },
  }) as unknown as CommunityPushProvider
const accepted = () =>
  Promise.resolve<CommunityPushOutcome>({ status: 'accepted', ticketId: randomUUID() })

beforeAll(async () => {
  await db.migrate()
}, 60_000)
beforeEach(async () => {
  sent.length = 0
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 0 WHERE id = 1`
})
afterAll(async () => {
  await prisma.$disconnect()
  await db.drop()
})

const active = (preferences: Record<string, string> = {}) =>
  persistUser(
    prisma,
    createUser({
      profilePreferences: { ...preferences, compliance: { accountStatus: 'active' } },
    })
  )

/** One opted-in author with one device, and one contribution from another member. */
async function fixture(source: 'reaction' | 'reply' = 'reaction', locale?: string) {
  const author = await active(locale ? { locale } : {})
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
  let parent: { id: string } | undefined
  let reply: { id: string } | undefined
  if (source === 'reply') {
    const comment = {
      post_id: post.id,
      body: 'Synthetic contribution',
      locale: 'en-US',
      platform: 'web',
      status: 'published' as const,
      published_at: new Date(),
    }
    parent = await prisma.communityComment.create({
      data: { ...comment, user_id: author.id, publication_sequence: 1 },
    })
    reply = await prisma.$transaction(async (tx) => {
      const created = await tx.communityComment.create({
        data: {
          ...comment,
          user_id: actor.id,
          parent_id: parent!.id,
          publication_sequence: 2,
        },
      })
      await recordCommunityEngagement(tx, {
        actor: actor.id,
        post: post.id,
        comment: created.id,
      })
      return created
    })
  } else
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
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
  return { author, actor, post, parent, reply, delivery }
}

/**
 * Repeats one pass of a runtime loop until the pass decides, as the runtime does: it
 * runs group and fanout every 250 ms and dispatch every 50 ms. Each pass enforces real
 * wall-clock limits (the 1 s fanout transaction, the 1950 ms flag authorization budget,
 * the guard's 250 ms transaction wait and 500 ms statements). On a loaded machine a pass
 * can exceed one of them; it then fails or defers without a provider call, by design,
 * and the next pass recovers. A loop that never decides fails with its last error as cause.
 */
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

/**
 * The shortest server-side wait any dispatch pass enforces: the 100 ms lock_timeout of
 * the claim and of the flag evaluation. Every other limit (the guard's 250 ms lock wait
 * and pool wait, 500 ms statements, the 2 s pre-send deadline) is longer.
 */
const LOAD_FLOOR_MS = 100
const LOAD_DEFERRAL_REASON = 'no_call:guard_failure'

/**
 * Dispatches until the guard reaches a decision: a provider call, or a status other than
 * pending or deferred. A pass that left the delivery pending or deferred made no provider
 * call, so it is made due again and repeated. `startedAt` is when the deciding pass began.
 *
 * D7 allows exactly one kind of non-deciding pass: a live pre-send lock or budget failure,
 * proven to precede the provider call, which defers with `no_call:guard_failure`. So the
 * retry is bounded by evidence of load. Each non-deciding pass must have lasted at least
 * one server-side wait, and any attempt it deferred must carry that load reason. A
 * regression that defers a first pass without load (or for another reason) fails here
 * instead of being absorbed by the retry.
 */
const dispatched = async (
  guard: CommunitySendGuard,
  delivery: { id: string; group_id: string }
) => {
  const deferrals: { elapsed: number; reasons: (string | null)[]; error?: Error }[] = []
  const decided = await untilDecided('dispatch', async () => {
    const startedAt = Date.now()
    const calls = sent.length
    const ordinalBefore = (await allAttempts(delivery.id)).length
    let error: Error | undefined
    try {
      await guard.dispatch(delivery.id)
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught))
    }
    const current = await state(delivery.id)
    if (
      error === undefined &&
      (sent.length > calls || !['pending', 'deferred'].includes(current.status))
    )
      return { current, startedAt }
    deferrals.push({
      elapsed: Date.now() - startedAt,
      reasons: (await allAttempts(delivery.id))
        .filter((attempt) => attempt.ordinal > ordinalBefore)
        .map((attempt) => attempt.reason),
      error,
    })
    if (error !== undefined) throw error
    await due(delivery.id, delivery.group_id)
    return undefined
  })
  for (const deferral of deferrals) {
    expect(
      deferral.elapsed,
      `a dispatch pass made no decision in ${deferral.elapsed} ms, faster than any load limit (${deferral.error?.message ?? deferral.reasons.join(', ')})`
    ).toBeGreaterThanOrEqual(LOAD_FLOOR_MS)
    for (const reason of deferral.reasons) expect(reason).toBe(LOAD_DEFERRAL_REASON)
  }
  return decided
}
const state = (id: string) =>
  prisma.communityTokenDelivery.findUniqueOrThrow({ where: { id } })
const allAttempts = (deliveryId: string) =>
  prisma.communityDeliveryAttempt.findMany({
    where: { delivery_id: deliveryId },
    orderBy: { ordinal: 'asc' },
  })
/**
 * Attempts that decided the delivery. A guard pass deferred by load leaves a deferred
 * attempt; `dispatched` bounds each one, and none may carry any other reason.
 */
const attempts = async (deliveryId: string) => {
  const all = await allAttempts(deliveryId)
  const deferred = all.filter((attempt) => attempt.status === 'deferred')
  expect(deferred.map((attempt) => attempt.reason)).toEqual(
    deferred.map(() => LOAD_DEFERRAL_REASON)
  )
  return all.filter((attempt) => attempt.status !== 'deferred')
}
/** Moves a scheduled retry to now so the next dispatch may claim it. */
const due = async (deliveryId: string, groupId: string) => {
  await prisma.communityTokenDelivery.update({
    where: { id: deliveryId },
    data: { next_attempt_at: new Date(Date.now() - 1000) },
  })
  await prisma.communityNotificationGroup.update({
    where: { id: groupId },
    data: { next_attempt_at: new Date(Date.now() - 1000) },
  })
}

describe('guarded handoff message', () => {
  it('names the reply and its parent for a single surviving comment, in the owner locale', async () => {
    const { delivery, post, parent, reply } = await fixture('reply', 'fr-FR')
    await dispatched(new CommunitySendGuard(prisma, flags, provider(accepted)), delivery)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      body: 'Une nouvelle interaction sur votre publication.',
      data: { cardId: post.id, commentId: reply!.id, parentId: parent!.id },
    })
    expect(await state(delivery.id)).toMatchObject({ status: 'accepted' })
  })

  it.each([
    ['the reply is held for review', 'reply'],
    ['the parent comment is held for review', 'parent'],
  ] as const)('makes no provider call when %s', async (_label, withdrawn) => {
    const { delivery, parent, reply } = await fixture('reply')
    await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 0 WHERE id = 1`
    await prisma.communityComment.update({
      where: { id: (withdrawn === 'reply' ? reply : parent)!.id },
      data: { status: 'held_for_review' },
    })
    await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
    await dispatched(new CommunitySendGuard(prisma, flags, provider(accepted)), delivery)
    expect(sent).toHaveLength(0)
    expect(await state(delivery.id)).toMatchObject({ status: 'suppressed' })
    expect((await attempts(delivery.id)).map((attempt) => attempt.reason)).toEqual([
      'no_call:source',
    ])
  })
})

describe('provider outcomes', () => {
  it('retries a rate-limited rejection after 2 s, then 10 s, and fails on the third', async () => {
    const { delivery } = await fixture()
    const guard = new CommunitySendGuard(
      prisma,
      flags,
      provider(() =>
        Promise.resolve({ status: 'retryable_rejection', reason: 'rate_limited' })
      )
    )
    const delays: number[] = []
    for (let round = 0; round < 3; round++) {
      if (round) await due(delivery.id, delivery.group_id)
      const { current, startedAt } = await dispatched(guard, delivery)
      delays.push(current.next_attempt_at.getTime() - startedAt)
    }
    expect(sent).toHaveLength(3)
    expect(delays[0]).toBeGreaterThanOrEqual(2000)
    expect(delays[0]).toBeLessThan(10_000)
    expect(delays[1]).toBeGreaterThanOrEqual(10_000)
    expect(await state(delivery.id)).toMatchObject({ status: 'failed' })
    expect((await attempts(delivery.id)).map((attempt) => attempt.status)).toEqual([
      'retryable_rejection',
      'retryable_rejection',
      'failed',
    ])
    await due(delivery.id, delivery.group_id)
    await guard.dispatch(delivery.id)
    expect(sent).toHaveLength(3)
  })

  it('fails an unregistered device token without a receipt or a retry', async () => {
    const { delivery } = await fixture()
    const guard = new CommunitySendGuard(
      prisma,
      flags,
      provider(() =>
        Promise.resolve({ status: 'invalid_token', reason: 'device_not_registered' })
      )
    )
    await dispatched(guard, delivery)
    expect(await state(delivery.id)).toMatchObject({ status: 'failed' })
    expect(
      await prisma.communityDeliveryReceipt.count({
        where: { attempt: { delivery_id: delivery.id } },
      })
    ).toBe(0)
    await due(delivery.id, delivery.group_id)
    await guard.dispatch(delivery.id)
    expect(sent).toHaveLength(1)
  })

  it('settles a failure after the provider was invoked as terminal unknown', async () => {
    const { delivery } = await fixture()
    const guard = new CommunitySendGuard(
      prisma,
      flags,
      provider(() => Promise.reject(new Error('Controlled provider crash')))
    )
    await dispatched(guard, delivery)
    expect(await state(delivery.id)).toMatchObject({ status: 'unknown' })
    expect(await attempts(delivery.id)).toEqual([
      expect.objectContaining({ status: 'unknown', reason: 'handoff_uncertain' }),
    ])
    await due(delivery.id, delivery.group_id)
    await guard.dispatch(delivery.id)
    expect(sent).toHaveLength(1)
  })
})

describe('flag evaluation before the claim', () => {
  it('suppresses the delivery when the member can no longer read community', async () => {
    const { delivery } = await fixture()
    const denied = new CommunityFlagEvaluationService(prisma, {
      getFeatureFlagValue: () => Promise.resolve(false),
    })
    await dispatched(new CommunitySendGuard(prisma, denied, provider(accepted)), delivery)
    expect(sent).toHaveLength(0)
    expect(await state(delivery.id)).toMatchObject({ status: 'suppressed' })
  })

  it('expires instead of deferring when the flag is unavailable past the group expiry', async () => {
    const { delivery } = await fixture()
    await prisma.communityNotificationGroup.update({
      where: { id: delivery.group_id },
      data: { expires_at: new Date(Date.now() - 1000) },
    })
    const unavailable = {
      evaluate: () => Promise.reject(new CommunityUnavailableException()),
    }
    await new CommunitySendGuard(prisma, unavailable, provider(accepted)).dispatch(
      delivery.id
    )
    expect(sent).toHaveLength(0)
    expect(await state(delivery.id)).toMatchObject({ status: 'expired' })
  })

  it('leaves the delivery untouched and surfaces an unexpected evaluation failure', async () => {
    const { delivery } = await fixture()
    const broken = {
      evaluate: () => Promise.reject(new Error('Controlled evaluator defect')),
    }
    await expect(
      new CommunitySendGuard(prisma, broken, provider(accepted)).dispatch(delivery.id)
    ).rejects.toThrow('Controlled evaluator defect')
    expect(sent).toHaveLength(0)
    expect(await state(delivery.id)).toMatchObject({
      status: delivery.status,
      next_attempt_at: delivery.next_attempt_at,
    })
  })
})
