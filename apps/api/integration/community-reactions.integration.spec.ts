import { randomUUID } from 'node:crypto'
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { reactionTestContext } from './helpers/community-reaction-context.js'

const { prisma, repository, namespace, input, fixture, mutate } = reactionTestContext()

describe('Story 6.3 durable reaction semantics', () => {
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
