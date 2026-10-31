// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
import { randomUUID } from 'node:crypto'
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

import { reactionTestContext } from './helpers/community-reaction-context.js'

const { prisma, repository, namespace, guardian, input, fixture, mutate } =
  reactionTestContext()

describe('Story 6.3 reaction consent, visibility and erasure', () => {
  it('refuses missing age, under-13 and unconsented teens; permits retraction after consent loss', async () => {
    for (const age of [null, '2020-01-01T00:00:00Z', '2012-01-01T00:00:00Z']) {
      const { userId, postId } = await fixture(age ?? undefined)
      if (age === null)
        await prisma.userProfile.update({
          where: { user_id: userId },
          data: { birthdate: null },
        })
      await expect(mutate(userId, postId, input('love'))).rejects.toMatchObject({
        status: 403,
      })
    }
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    await prisma.userProfile.update({
      where: { user_id: userId },
      data: { birthdate: new Date('2012-01-01T00:00:00Z') },
    })
    await expect(mutate(userId, postId, input('applause', 1))).rejects.toMatchObject({
      status: 403,
    })
    expect(await mutate(userId, postId, input(null, 1))).toMatchObject({
      summary: { total: 0, revision: 2 },
    })
  })

  it('withdraws a teens counted votes atomically when the last consent is revoked', async () => {
    const owner = await fixture()
    const teen = await fixture('2012-01-01T00:00:00Z')
    await prisma.guardianConsent.create({
      data: { guardian_id: owner.userId, teen_id: teen.userId, status: 'granted' },
    })
    const firstIntent = input('inspiration')
    await mutate(teen.userId, owner.postId, firstIntent)
    const before = (await repository.reactionSummaries([owner.postId], teen.userId)).get(
      owner.postId
    )
    await guardian.revokeConsent(owner.userId, teen.userId)
    const after = (await repository.reactionSummaries([owner.postId], teen.userId)).get(
      owner.postId
    )
    expect(after).toMatchObject({ total: 0, viewerReaction: null, revision: 2 })
    expect(after?.generation).toBeGreaterThan(before?.generation ?? 0)
    expect(await mutate(teen.userId, owner.postId, firstIntent)).toMatchObject({
      summary: { total: 0, viewerReaction: null, revision: 2 },
    })
  })

  it('serializes consent revocation behind an in-flight accepted reaction', async () => {
    const owner = await fixture()
    const teen = await fixture('2012-01-01T00:00:00Z')
    await prisma.guardianConsent.create({
      data: { guardian_id: owner.userId, teen_id: teen.userId, status: 'granted' },
    })
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = new Promise<void>((resolve) => {
      entered = resolve
    })
    const reaction = repository.setReaction({
      userId: teen.userId,
      postId: owner.postId,
      input: input('love'),
      platform: 'web',
      assertEligible: async (tx, participation) => {
        if (!participation) return
        entered()
        await gate
        await guardian.assertWardrobeUploadAllowed(teen.userId, undefined, tx)
      },
    })
    await locked
    const revocation = guardian.revokeConsent(owner.userId, teen.userId)
    // Wait until PostgreSQL confirms the revoke transaction is waiting for the member lock.
    await vi.waitFor(async () => {
      const waiting = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory' AND cardinality(pg_blocking_pids(pid)) > 0`
      expect(Number(waiting[0]?.count)).toBeGreaterThan(0)
    })
    release()
    await reaction
    await revocation
    expect(
      (await repository.reactionSummaries([owner.postId], teen.userId)).get(owner.postId)
    ).toMatchObject({ total: 0, viewerReaction: null, revision: 2 })
  })

  it('hides summaries on visibility changes and purges retained post rows on erasure', async () => {
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    const original = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: postId },
    })
    await prisma.lookbookPost.update({
      where: { id: postId },
      data: { status: 'flagged' },
    })
    expect((await repository.reactionSummaries([postId], userId)).size).toBe(0)
    await expect(mutate(userId, postId, input(null, 1))).rejects.toMatchObject({
      status: 404,
    })
    const hidden = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    expect(hidden.reaction_generation).toBeGreaterThan(original.reaction_generation)
    await repository.requestErasureForUser(userId, new Date())
    expect(await prisma.communityReaction.count({ where: { post_id: postId } })).toBe(0)
    expect(
      await prisma.communityReactionReceipt.count({ where: { post_id: postId } })
    ).toBe(0)
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: postId } })
    ).toBe(0)
    expect(await prisma.lookbookPost.count({ where: { id: postId } })).toBe(1)
  })

  it('invalidates surviving aggregates on member deletion and purges erased posts through database triggers', async () => {
    const author = await fixture()
    const member = await fixture()
    await mutate(member.userId, author.postId, input('love'))
    const before = (
      await repository.reactionSummaries([author.postId], author.userId)
    ).get(author.postId)
    await prisma.userProfile.delete({ where: { user_id: member.userId } })
    await prisma.user.delete({ where: { id: member.userId } })
    const after = (
      await repository.reactionSummaries([author.postId], author.userId)
    ).get(author.postId)
    expect(after?.total).toBe(0)
    expect(after?.generation).toBeGreaterThan(before?.generation ?? 0)
    await mutate(author.userId, author.postId, input('inspiration'))
    await repository.withdrawPostAndRequestErasure(author.postId, new Date())
    expect(await prisma.lookbookPost.count({ where: { id: author.postId } })).toBe(1)
    expect(
      await prisma.communityReaction.count({ where: { post_id: author.postId } })
    ).toBe(0)
    expect(
      await prisma.communityReactionReceipt.count({ where: { post_id: author.postId } })
    ).toBe(0)
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: author.postId } })
    ).toBe(0)
  })

  it('serializes a new guardian grant and repeated revocation without restoring withdrawn votes', async () => {
    const owner = await fixture()
    const teen = await fixture('2012-01-01T00:00:00Z')
    await prisma.userProfile.update({
      where: { user_id: teen.userId },
      data: {
        preferences: { compliance: { accountStatus: 'pending_guardian_consent' } },
      },
    })
    const invitation = await guardian.inviteGuardian(
      teen.userId,
      `${namespace}-second-${randomUUID()}@synthetic.test`
    )
    await prisma.guardianConsent.create({
      data: { guardian_id: owner.userId, teen_id: teen.userId, status: 'granted' },
    })
    await prisma.userProfile.update({
      where: { user_id: teen.userId },
      data: { preferences: { compliance: { accountStatus: 'active' } } },
    })
    await mutate(teen.userId, owner.postId, input('love'))
    const token = new URL(invitation.invitationLink).searchParams.get('token')
    if (!token) throw new Error('Invitation token missing')
    const [revocation] = await Promise.all([
      guardian.revokeConsent(owner.userId, teen.userId),
      guardian.acceptInvitation(token),
    ])
    expect(
      await prisma.guardianConsent.count({
        where: { teen_id: teen.userId, status: 'granted', revoked_at: null },
      })
    ).toBe(1)
    const current = (await repository.reactionSummaries([owner.postId], teen.userId)).get(
      owner.postId
    )
    expect(current?.total).toBe(revocation.remainingActiveGuardians === 0 ? 0 : 1)
    await expect(guardian.revokeConsent(owner.userId, teen.userId)).rejects.toMatchObject(
      { status: 404 }
    )
    await expect(guardian.acceptInvitation(token)).rejects.toMatchObject({ status: 400 })
  })

  it('erases member reactions on another retained authors public post without deleting either member', async () => {
    const author = await fixture()
    const member = await fixture()
    await mutate(member.userId, author.postId, input('love'))
    const before = (
      await repository.reactionSummaries([author.postId], author.userId)
    ).get(author.postId)!
    const counts = async () => [
      await prisma.communityReaction.count({ where: { user_id: member.userId } }),
      await prisma.communityReactionReceipt.count({ where: { user_id: member.userId } }),
      await prisma.communityReactionOutbox.count({ where: { user_id: member.userId } }),
    ]
    expect(await counts()).toEqual([1, 1, 1])
    await repository.requestErasureForUser(member.userId, new Date())
    expect(await counts()).toEqual([0, 0, 0])
    expect(
      await prisma.user.count({ where: { id: { in: [author.userId, member.userId] } } })
    ).toBe(2)
    expect(
      await prisma.lookbookPost.findUniqueOrThrow({ where: { id: author.postId } })
    ).toMatchObject({ status: 'published', erasure_requested_at: null })
    const after = (
      await repository.reactionSummaries([author.postId], author.userId)
    ).get(author.postId)!
    expect(before.total).toBe(1)
    expect(after.total).toBe(0)
    expect(after.generation).toBeGreaterThan(before.generation)
  })

  it('refuses a report while erasure is pending', async () => {
    const owner = await fixture()
    const reporter = await fixture()
    await prisma.lookbookPost.update({
      where: { id: owner.postId },
      data: { erasure_requested_at: new Date() },
    })
    expect(
      await repository.recordReport({
        postId: owner.postId,
        reporterId: reporter.userId,
        reason: 'spam',
        abuseLimit: 5,
        slaHours: 24,
        subjectAlias: 'synthetic-alias',
      })
    ).toEqual({ kind: 'post_not_visible' })
    expect(
      await prisma.communityPostReport.count({ where: { post_id: owner.postId } })
    ).toBe(0)
  })
})
