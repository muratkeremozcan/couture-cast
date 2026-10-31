// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
import { randomUUID } from 'node:crypto'
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { reactionTestContext } from './helpers/community-reaction-context.js'

const { prisma, repository, namespace, input, fixture, mutate } = reactionTestContext()

describe('Story 6.3 durable reaction semantics', () => {
  it('cascades a member identity through every engagement FK and scalar slot without touching another member', async () => {
    const owner = await fixture()
    const unrelated = await fixture()
    const seed = async (userId: string, postId: string) => {
      const now = new Date()
      const expires = new Date(now.getTime() + 60000)
      const preference = await prisma.communityNotificationPreference.create({
        data: { user_id: userId },
      })
      const cache = await prisma.communityFlagEvaluation.create({
        data: {
          member_id: userId,
          flag_key: 'community_read_enabled',
          subject_generation: 0,
          remote_value: true,
          remote_evaluated_at: now,
          expires_at: expires,
        },
      })
      const token = await prisma.pushToken.create({
        data: {
          user_id: userId,
          token: `ExpoPushToken[identity_${randomUUID()}]`,
          installation_id: randomUUID(),
        },
      })
      const group = await prisma.communityNotificationGroup.create({
        data: {
          recipient_id: userId,
          post_id: postId,
          eligible_at: now,
          next_attempt_at: now,
          expires_at: expires,
        },
      })
      const intent = await prisma.communityNotificationIntent.create({
        data: {
          source_kind: 'reaction',
          post_id: postId,
          actor_id: userId,
          recipient_id: userId,
          preference_generation: 0,
          deliverable: true,
          expires_at: expires,
          group_id: group.id,
        },
      })
      const link = await prisma.communityArtifactSubject.create({
        data: {
          artifact_kind: 'intent',
          artifact_id: intent.id,
          member_id: userId,
          role: 'actor',
          generation: 0,
        },
      })
      const delivery = await prisma.communityTokenDelivery.create({
        data: {
          group_id: group.id,
          registration_id: token.id,
          binding_generation: token.binding_generation,
          owner_id: userId,
          status: 'pending',
          next_attempt_at: now,
        },
      })
      const head = await prisma.communityStreamHead.findFirstOrThrow({
        where: { owner_id: userId },
      })
      return { preference, cache, token, group, intent, link, delivery, head }
    }
    const a = await seed(owner.userId, owner.postId)
    const b = await seed(unrelated.userId, unrelated.postId)
    const constraints = await prisma.$queryRaw<
      { conname: string; confupdtype: string; confdeltype: string }[]
    >`SELECT conname,confupdtype::text,confdeltype::text FROM pg_constraint
      WHERE conname IN ('community_subject_user_fk','community_preference_user_fk',
        'community_flag_subject_fk','community_artifact_subject_fk','community_stream_owner_fk','PushToken_user_id_fkey') ORDER BY conname`
    expect(constraints).toEqual([
      { conname: 'PushToken_user_id_fkey', confupdtype: 'c', confdeltype: 'r' },
      { conname: 'community_artifact_subject_fk', confupdtype: 'c', confdeltype: 'c' },
      { conname: 'community_flag_subject_fk', confupdtype: 'c', confdeltype: 'c' },
      { conname: 'community_preference_user_fk', confupdtype: 'c', confdeltype: 'c' },
      { conname: 'community_stream_owner_fk', confupdtype: 'c', confdeltype: 'c' },
      { conname: 'community_subject_user_fk', confupdtype: 'c', confdeltype: 'c' },
    ])
    const replacement = randomUUID()
    await prisma.user.update({ where: { id: owner.userId }, data: { id: replacement } })
    expect(
      await prisma.communitySubject.findUnique({ where: { member_id: owner.userId } })
    ).toBeNull()
    expect(
      await prisma.communitySubject.findUnique({ where: { member_id: replacement } })
    ).toMatchObject({ generation: 0 })
    expect(
      await prisma.communityNotificationPreference.findUnique({
        where: { user_id: replacement },
      })
    ).toEqual({ ...a.preference, user_id: replacement })
    expect(
      await prisma.communityFlagEvaluation.findUnique({
        where: {
          member_id_flag_key: {
            member_id: replacement,
            flag_key: 'community_read_enabled',
          },
        },
      })
    ).toEqual({ ...a.cache, member_id: replacement })
    expect(
      await prisma.communityArtifactSubject.findUnique({
        where: {
          artifact_kind_artifact_id_member_id_role: {
            artifact_kind: 'intent',
            artifact_id: a.intent.id,
            member_id: replacement,
            role: 'actor',
          },
        },
      })
    ).toEqual({ ...a.link, member_id: replacement })
    expect(
      await prisma.communityStreamHead.findUnique({ where: { id: a.head.id } })
    ).toEqual({ ...a.head, owner_id: replacement })
    expect(
      await prisma.pushToken.findUnique({ where: { id: a.token.id } })
    ).toMatchObject({
      user_id: replacement,
      token: a.token.token,
      binding_generation: a.token.binding_generation,
    })
    expect(
      await prisma.communityNotificationIntent.findUnique({ where: { id: a.intent.id } })
    ).toEqual({ ...a.intent, actor_id: replacement, recipient_id: replacement })
    expect(
      await prisma.communityNotificationGroup.findUnique({ where: { id: a.group.id } })
    ).toEqual({ ...a.group, recipient_id: replacement })
    expect(
      await prisma.communityTokenDelivery.findUnique({ where: { id: a.delivery.id } })
    ).toEqual({ ...a.delivery, owner_id: replacement })
    expect(
      await prisma.communityNotificationPreference.findUnique({
        where: { user_id: unrelated.userId },
      })
    ).toEqual(b.preference)
    expect(
      await prisma.communityFlagEvaluation.findUnique({
        where: {
          member_id_flag_key: {
            member_id: unrelated.userId,
            flag_key: 'community_read_enabled',
          },
        },
      })
    ).toEqual(b.cache)
    expect(
      await prisma.communityArtifactSubject.findUnique({
        where: {
          artifact_kind_artifact_id_member_id_role: {
            artifact_kind: 'intent',
            artifact_id: b.intent.id,
            member_id: unrelated.userId,
            role: 'actor',
          },
        },
      })
    ).toEqual(b.link)
    expect(
      await prisma.communityStreamHead.findUnique({ where: { id: b.head.id } })
    ).toEqual(b.head)
    expect(await prisma.pushToken.findUnique({ where: { id: b.token.id } })).toEqual(
      b.token
    )
    expect(
      await prisma.communityNotificationIntent.findUnique({ where: { id: b.intent.id } })
    ).toEqual(b.intent)
    expect(
      await prisma.communityNotificationGroup.findUnique({ where: { id: b.group.id } })
    ).toEqual(b.group)
    expect(
      await prisma.communityTokenDelivery.findUnique({ where: { id: b.delivery.id } })
    ).toEqual(b.delivery)
  })
  it('preserves reactions, receipts, and queued events through parent identity updates', async () => {
    const { userId, postId } = await fixture()
    const intent = input('applause')
    await mutate(userId, postId, intent)
    const event = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    const before = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    const nextUserId = randomUUID()
    const nextPostId = `${namespace}-${randomUUID()}`
    await prisma.user.update({ where: { id: userId }, data: { id: nextUserId } })
    await prisma.lookbookPost.update({ where: { id: postId }, data: { id: nextPostId } })
    const state = await prisma.communityReaction.findUniqueOrThrow({
      where: { user_id_post_id: { user_id: nextUserId, post_id: nextPostId } },
    })
    expect(state).toMatchObject({ selection: 'applause', revision: 1 })
    expect(
      await prisma.communityReactionReceipt.findUniqueOrThrow({
        where: {
          user_id_mutation_id: { user_id: nextUserId, mutation_id: intent.mutationId },
        },
      })
    ).toMatchObject({ post_id: nextPostId, selection: 'applause', base_revision: 0 })
    expect(
      await prisma.communityReactionOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).toMatchObject({ user_id: nextUserId, post_id: nextPostId, payload: event.payload })
    const after = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: nextPostId },
    })
    expect(after.reaction_generation).toBeGreaterThan(before.reaction_generation)
    expect(await mutate(nextUserId, nextPostId, intent)).toMatchObject({
      summary: { total: 1, viewerReaction: 'applause', revision: 1 },
    })
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: nextPostId } })
    ).toBe(1)
    const constraints = await prisma.$queryRaw<
      { conname: string; confupdtype: string; confdeltype: string }[]
    >`
      SELECT conname, confupdtype::text, confdeltype::text FROM pg_constraint
      WHERE conrelid IN ('"CommunityReaction"'::regclass, '"CommunityReactionReceipt"'::regclass, '"CommunityReactionOutbox"'::regclass) AND contype = 'f'
      ORDER BY conname
    `
    expect(constraints).toHaveLength(6)
    expect(
      constraints.every((row) => row.confupdtype === 'c' && row.confdeltype === 'c')
    ).toBe(true)
  })

  it('adds, replaces, retracts, and fences delayed first attempts and retained retries', async () => {
    const { userId, postId } = await fixture()
    const first = input('applause')
    expect(await mutate(userId, postId, first)).toMatchObject({
      summary: {
        counts: { applause: 1, love: 0, inspiration: 0 },
        total: 1,
        revision: 1,
        viewerReaction: 'applause',
      },
    })
    expect(await mutate(userId, postId, input('love', 1))).toMatchObject({
      summary: { counts: { applause: 0, love: 1, inspiration: 0 }, revision: 2 },
    })
    expect(await mutate(userId, postId, input(null, 2))).toMatchObject({
      summary: { total: 0, revision: 3, viewerReaction: null },
    })
    expect(await mutate(userId, postId, first)).toMatchObject({
      summary: { total: 0, revision: 3, viewerReaction: null },
    })
    await expect(mutate(userId, postId, input('inspiration', 1))).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      mutate(userId, postId, { ...first, selection: 'love' })
    ).rejects.toMatchObject({ status: 409 })
    await prisma.communityReactionReceipt.deleteMany({ where: { user_id: userId } })
    await expect(mutate(userId, postId, first)).rejects.toMatchObject({ status: 409 })
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: postId } })
    ).toBe(3)
  })

  it('retains a null-state revision on an initial retraction', async () => {
    const { userId, postId } = await fixture()
    expect(await mutate(userId, postId, input(null))).toMatchObject({
      summary: { total: 0, revision: 1 },
    })
    await expect(mutate(userId, postId, input('love'))).rejects.toMatchObject({
      status: 409,
    })
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: postId } })
    ).toBe(0)
  })

  it('serializes competing requests and produces coherent batch snapshots', async () => {
    const { userId, postId } = await fixture()
    const competing = await Promise.allSettled([
      mutate(userId, postId, input('love')),
      mutate(userId, postId, input('applause')),
    ])
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const other = await fixture()
    await mutate(other.userId, postId, input('inspiration'))
    const summary = (await repository.reactionSummaries([postId], userId)).get(postId)
    expect(summary?.total).toBe(2)
    expect(
      Object.values(summary?.counts ?? {}).reduce((sum, value) => sum + value, 0)
    ).toBe(2)
    expect(
      await prisma.communityReaction.count({
        where: { post_id: postId, selection: { not: null } },
      })
    ).toBe(2)
  })

  it('limits new mutation IDs to sixty while accepted retries bypass quota', async () => {
    const { userId, postId } = await fixture()
    const first = input('love')
    await mutate(userId, postId, first)
    for (let revision = 1; revision < 60; revision += 1)
      await mutate(userId, postId, input(revision % 2 ? 'applause' : 'love', revision))
    expect(await mutate(userId, postId, input(null, 60))).toHaveProperty(
      'retryAfterSeconds'
    )
    expect(await mutate(userId, postId, first)).toMatchObject({
      summary: { revision: 60, total: 1 },
    })
  })
})
