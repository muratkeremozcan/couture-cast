import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { reactionTestContext } from './helpers/community-reaction-context.js'

const { prisma, repository, input, fixture, mutate } = reactionTestContext()

describe('Story 6.3 concurrent snapshots and hidden-post privacy', () => {
  it('serializes twelve different members on one post with exact intermediate snapshots', async () => {
    const owner = await fixture()
    const members = await Promise.all(Array.from({ length: 12 }, () => fixture()))
    const palette = ['applause', 'love', 'inspiration'] as const
    const results = await Promise.all(
      members.map((member, index) =>
        mutate(member.userId, owner.postId, input(palette[index % 3]!))
      )
    )
    const totals = results.map((result) => {
      if (!('summary' in result)) throw new Error('Unexpected rate limit')
      expect(result.summary.total).toBe(
        Object.values(result.summary.counts).reduce((a, b) => a + b, 0)
      )
      expect(result.summary.revision).toBe(1)
      return result.summary.total
    })
    expect(totals.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1)
    )
    const summary = (
      await repository.reactionSummaries([owner.postId], owner.userId)
    ).get(owner.postId)
    expect(summary).toMatchObject({
      counts: { applause: 4, love: 4, inspiration: 4 },
      total: 12,
      viewerReaction: null,
      revision: 0,
    })
    expect(
      await prisma.communityReaction.count({
        where: { post_id: owner.postId, selection: { not: null } },
      })
    ).toBe(12)
  })

  it.each([
    'draft',
    'uploading',
    'pending_review',
    'flagged',
    'review_failed',
    'withdrawn',
    'consent_suspended',
  ] as const)(
    'rejects a fresh add and a retraction on %s and returns no aggregate',
    async (status) => {
      const { userId, postId } = await fixture()
      await mutate(userId, postId, input('love'))
      await prisma.lookbookPost.update({ where: { id: postId }, data: { status } })
      for (const selection of ['applause', null] as const)
        await expect(mutate(userId, postId, input(selection, 1))).rejects.toMatchObject({
          status: 404,
        })
      expect((await repository.reactionSummaries([postId], userId)).size).toBe(0)
      expect(await prisma.communityReaction.count({ where: { post_id: postId } })).toBe(1)
    }
  )

  it('binds one mutation identity across posts and records no-change intent without duplicate analytics', async () => {
    const actor = await fixture()
    const other = await fixture()
    const first = input('love')
    await mutate(actor.userId, actor.postId, first)
    await expect(mutate(actor.userId, other.postId, first)).rejects.toMatchObject({
      status: 409,
    })
    expect(
      (await repository.reactionSummaries([other.postId], actor.userId)).get(other.postId)
        ?.total
    ).toBe(0)
    await mutate(actor.userId, actor.postId, input('love', 1))
    expect(await mutate(actor.userId, actor.postId, first)).toMatchObject({
      summary: { total: 1, viewerReaction: 'love', revision: 2 },
    })
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: actor.postId } })
    ).toBe(1)
    expect(
      await prisma.communityReactionReceipt.count({ where: { user_id: actor.userId } })
    ).toBe(2)
  })
})
