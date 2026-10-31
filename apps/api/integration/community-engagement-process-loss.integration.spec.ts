// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { randomUUID } from 'node:crypto'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityCommentsRepository } from '../src/modules/community/community-comments.repository.js'
import {
  engagementHarness,
  settle,
  until,
  type EngagementHarness,
} from './helpers/community-engagement-harness.js'
let h: EngagementHarness
beforeEach(async () => {
  h = await engagementHarness()
}, 30_000)
afterEach(async () => {
  await h?.close()
}, 30_000)
async function recoverUnknown(deliveryId: string) {
  const attempt = await h.prisma.communityDeliveryAttempt.findFirstOrThrow({
    where: { delivery_id: deliveryId },
  })
  await h.worker.recover()
  expect(
    await h.prisma.communityDeliveryAttempt.findUnique({ where: { id: attempt.id } })
  ).toMatchObject({ status: 'sending' })
  await until(
    async () => {
      const [clock] = await h.prisma.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`
      return clock!.now > attempt.lease_until && clock!.now > attempt.guard_until
    },
    Boolean,
    12_000
  )
  await h.worker.recover()
  expect(
    await h.prisma.communityDeliveryAttempt.findUnique({ where: { id: attempt.id } })
  ).toMatchObject({ status: 'unknown', reason: 'orphaned_handoff' })
  const replacement = await h.sender()
  await replacement.child.call('dispatch', deliveryId)
  expect(
    await h.prisma.communityDeliveryAttempt.count({ where: { delivery_id: deliveryId } })
  ).toBe(1)
}
describe('6.5-INT-012..018 real engagement process loss', () => {
  it.each(['general', 'community'] as const)(
    'actual %s runtime appends while provider and analytics are both held',
    async (owner) => {
      const f = await h.fixture()
      await h.provider.call('mode', 'hold')
      await h.prisma.communityEngagementTelemetry.create({
        data: {
          event_type: 'community_backlog',
          outcome: 'controlled',
          build_identity: 'unknown',
        },
      })
      const { child } = await h.sender({ owner })
      await child.call('analytics', true)
      expect(await child.call('runtime', owner)).toMatchObject({ status: 'ready' })
      await h.provider.event('request')
      await child.event('analytics-held')
      const started = performance.now()
      const post = await h.prisma.lookbookPost.create({
        data: buildLookbookPostCreateInput(
          createLookbookPost({ userId: f.author.id, status: 'published' })
        ),
      })
      await until(
        () =>
          h.prisma.communityDomainOutbox.count({
            where: { post_id: post.id, appended_at: null },
          }),
        (count) => count === 0,
        2000
      )
      expect(
        await h.prisma.communityStreamEvent.count({ where: { post_id: post.id } })
      ).toBeGreaterThan(0)
      expect(
        z.object({ held: z.number() }).parse(await h.provider.call('state')).held
      ).toBe(1)
      await h.provider.call('release')
      await child.call('analytics', false)
      await until(
        () =>
          h.prisma.communityTokenDelivery.findUniqueOrThrow({
            where: { id: f.delivery.id },
          }),
        (delivery) => delivery.status === 'accepted'
      )
      expect(await h.ledger()).toHaveLength(1)
      console.log(
        JSON.stringify({
          evidence: 'actual-runtime-independent-append',
          owner,
          appendMs: performance.now() - started,
        })
      )
    },
    10_000
  )

  it('a killed durable pre-guard claim waits its real lease and never resends an uncertain attempt', async () => {
    const f = await h.fixture()
    const { child } = await h.sender()
    await child.call('barrier', 'claim')
    const operation = settle(child.call('dispatch', f.delivery.id))
    await child.event('claimed')
    expect(
      await h.prisma.communityTokenDelivery.findUnique({ where: { id: f.delivery.id } })
    ).toMatchObject({ status: 'sending' })
    child.signal('SIGKILL')
    expect(await operation).toEqual({ status: 'rejected' })
    await recoverUnknown(f.delivery.id)
    expect(await h.ledger()).toHaveLength(0)
  }, 25_000)
  it('death after recorded provider acceptance preserves unknown and does not resend when the provider recovers', async () => {
    const f = await h.fixture()
    await h.provider.call('mode', 'accept-hold')
    const { child } = await h.sender()
    const operation = settle(child.call('dispatch', f.delivery.id))
    await h.provider.event('request')
    expect(await h.ledger()).toHaveLength(1)
    const accepted = (await h.ledger())[0]!
    expect(accepted.accepted).toBe(true)
    expect(accepted.acceptedAt).toEqual(expect.any(Number))
    child.signal('SIGKILL')
    await operation
    await h.provider.call('release')
    await recoverUnknown(f.delivery.id)
    expect(await h.ledger()).toHaveLength(1)
    expect(await h.prisma.communityDeliveryReceipt.count()).toBe(0)
  }, 25_000)
  it('accepted durable work creates one receipt and is not replayed', async () => {
    const f = await h.fixture()
    const { child } = await h.sender()
    await child.call('dispatch', f.delivery.id)
    await child.call('dispatch', f.delivery.id)
    expect(await h.ledger()).toHaveLength(1)
    expect(
      await h.prisma.communityDeliveryAttempt.findFirst({
        where: { delivery_id: f.delivery.id },
      })
    ).toMatchObject({ status: 'accepted' })
    expect(await h.prisma.communityDeliveryReceipt.count()).toBe(1)
  })
  it('ordinary reaction and comment producers progress while the real provider is held', async () => {
    const f = await h.fixture()
    await h.provider.call('mode', 'hold')
    const { child } = await h.sender()
    const operation = child.call('dispatch', f.delivery.id)
    await h.provider.event('request')
    expect(
      z.object({ held: z.number() }).parse(await h.provider.call('state')).held
    ).toBe(1)
    const started = performance.now()
    await new CommunityRepository(h.prisma).setReaction({
      userId: f.parentAuthor.id,
      postId: f.post.id,
      platform: 'web',
      input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
      assertEligible: () => Promise.resolve(),
    })
    await new CommunityCommentsRepository(h.prisma).create({
      userId: f.actor.id,
      postId: f.post.id,
      platform: 'web',
      input: {
        body: 'An ordinary held-provider submission',
        locale: 'en-US',
        parentId: null,
        mutationId: randomUUID(),
      },
      eligible: () => Promise.resolve(),
    })
    const elapsedMs = performance.now() - started
    expect(elapsedMs).toBeLessThan(500)
    expect(
      z.object({ held: z.number() }).parse(await h.provider.call('state')).held
    ).toBe(1)
    console.log(
      JSON.stringify({ evidence: 'ordinary-writers-during-held-provider', elapsedMs })
    )
    await h.provider.call('release')
    await operation
    expect(await h.ledger()).toHaveLength(1)
  })
})
