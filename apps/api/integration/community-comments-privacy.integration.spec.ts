import { describe, expect, it } from 'vitest'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityCommentsProcessor } from '../src/modules/community/community-comments.processor.js'
import { commentsTestContext } from './helpers/community-comments-context.js'

const {
  prisma,
  engine,
  flags,
  processor,
  guardian,
  service,
  input,
  fixture,
  create,
  roots,
  publish,
} = commentsTestContext()

async function consentingTeen() {
  const adult = await fixture()
  const teen = await fixture('teen')
  const consent = await prisma.guardianConsent.create({
    data: { guardian_id: adult.userId, teen_id: teen.userId, status: 'granted' },
  })
  return { adult, teen, consent }
}

/** Delete an account row directly, bypassing the erasure service, so only database rules run. */
async function deleteAccountDirectly(userId: string) {
  await prisma.lookbookPost.deleteMany({ where: { user_id: userId } })
  await prisma.userProfile.delete({ where: { user_id: userId } })
  await prisma.comfortPreferences.deleteMany({ where: { user_id: userId } })
  await prisma.communityAlias.deleteMany({ where: { user_id: userId } })
  await prisma.user.delete({ where: { id: userId } })
}

describe('Story 6.4 comment consent gates', () => {
  it('refuses a teen without guardian consent', async () => {
    const adult = await fixture()
    const teen = await fixture('teen')
    await expect(create(teen.userId, adult.postId)).rejects.toMatchObject({ status: 403 })
  })

  it('suspends published and pending comments inside the revocation transaction itself', async () => {
    const { adult, teen } = await consentingTeen()
    const root = await publish(teen.userId, adult.postId)
    const pending = await create(teen.userId, adult.postId)
    await guardian.revokeConsent(adult.userId, teen.userId)
    // No worker has run: the revocation transaction alone must hide both rows.
    expect(
      await prisma.communityComment.findMany({
        where: { id: { in: [root.id, pending.id] } },
        select: { id: true, status: true, body: true },
        orderBy: { created_at: 'asc' },
      })
    ).toEqual([
      { id: root.id, status: 'consent_suspended', body: null },
      { id: pending.id, status: 'consent_suspended', body: null },
    ])
    await processor.process(pending.id)
    expect((await roots(adult.userId, adult.postId)).items[0]).toMatchObject({
      unavailable: true,
      body: null,
    })
  })

  it('keeps deletion eligible after revocation and never restores text on a later grant', async () => {
    const { adult, teen, consent } = await consentingTeen()
    const root = await publish(teen.userId, adult.postId)
    const pending = await create(teen.userId, adult.postId)
    await guardian.revokeConsent(adult.userId, teen.userId)
    expect(
      (
        await service.delete({
          userId: teen.userId,
          postId: adult.postId,
          commentId: pending.id,
          platform: 'web',
        })
      ).status
    ).toBe('author_deleted')
    await prisma.guardianConsent.update({
      where: { id: consent.id },
      data: { status: 'granted', revoked_at: null },
    })
    expect(
      (await prisma.communityComment.findUniqueOrThrow({ where: { id: root.id } })).body
    ).toBeNull()
  })

  it('answers reads with 503 while the read flag is off', async () => {
    const adult = await fixture()
    flags.getFeatureFlag.mockResolvedValueOnce(false)
    await expect(roots(adult.userId, adult.postId)).rejects.toMatchObject({ status: 503 })
  })

  it('fences a genuinely delayed screening result against consent revocation and a posting freeze', async () => {
    const { adult: owner, teen } = await consentingTeen()
    const pending = await create(teen.userId, owner.postId)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => undefined
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const delayed = new CommunityCommentsProcessor(
      prisma,
      {
        screenText: async (params) => {
          started()
          await gate
          return engine.screenText(params)
        },
        screenImage: (buffer) => engine.screenImage(buffer),
        moderatePost: (params) => engine.moderatePost(params),
      },
      flags
    )
    const screening = delayed.process(pending.id)
    await ready
    await guardian.revokeConsent(owner.userId, teen.userId)
    release()
    await screening
    expect(
      (await prisma.communityComment.findUniqueOrThrow({ where: { id: pending.id } }))
        .status
    ).toBe('consent_suspended')
    const frozen = await create(owner.userId, owner.postId)
    try {
      flags.getFeatureFlag.mockResolvedValue(false)
      await processor.process(frozen.id)
      expect(
        (await prisma.communityComment.findUniqueOrThrow({ where: { id: frozen.id } }))
          .status
      ).toBe('pending_screening')
    } finally {
      flags.getFeatureFlag.mockResolvedValue(true)
    }
  })
})

describe('Story 6.4 comment erasure', () => {
  it('scrubs erasure content, receipts and pending analytics immediately and preserves other replies', async () => {
    const author = await fixture(),
      other = await fixture()
    const root = await publish(author.userId, other.postId)
    await publish(other.userId, other.postId, input('My reply remains.', root.id))
    await service.report({
      userId: other.userId,
      postId: other.postId,
      commentId: root.id,
      reason: 'spam',
      platform: 'web',
    })
    await new CommunityRepository(prisma).requestErasureForUser(author.userId, new Date())
    expect(
      await prisma.communityCommentReceipt.count({ where: { user_id: author.userId } })
    ).toBe(0)
    expect(
      await prisma.communityCommentAnalyticsSubject.count({
        where: { user_id: author.userId },
      })
    ).toBe(0)
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: root.id } })
    ).toMatchObject({ status: 'erased', body: null, user_id: null })
    expect((await roots(other.userId, other.postId)).items[0]).toMatchObject({
      unavailable: true,
      replyCount: 1,
    })
    expect(
      (
        await prisma.communityCommentReport.findFirstOrThrow({
          where: { comment_id: root.id },
        })
      ).content_snapshot
    ).toBeNull()
  })

  it("removes a pending author's screening and analytics outbox rows on erasure", async () => {
    const author = await fixture(),
      other = await fixture()
    const pending = await create(author.userId, other.postId)
    const subject = await prisma.communityCommentAnalyticsSubject.findUniqueOrThrow({
      where: { user_id: author.userId },
    })
    expect(
      await prisma.communityCommentAnalyticsOutbox.count({
        where: { actor: subject.actor },
      })
    ).toBe(1)
    await new CommunityRepository(prisma).requestErasureForUser(author.userId, new Date())
    expect(
      await prisma.communityCommentScreeningOutbox.count({
        where: { comment_id: pending.id },
      })
    ).toBe(0)
    expect(
      await prisma.communityCommentAnalyticsOutbox.count({
        where: { actor: subject.actor },
      })
    ).toBe(0)
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: pending.id } })
    ).toMatchObject({ status: 'erased', body: null, user_id: null })
  })

  it("detaches an erased reporter and scrubs that reporter's snapshot while the comment stays public", async () => {
    const author = await fixture(),
      reporter = await fixture()
    const root = await publish(author.userId, author.postId)
    await service.report({
      userId: reporter.userId,
      postId: author.postId,
      commentId: root.id,
      reason: 'spam',
      platform: 'web',
    })
    await new CommunityRepository(prisma).requestErasureForUser(
      reporter.userId,
      new Date()
    )
    expect(
      await prisma.communityCommentReport.findFirstOrThrow({
        where: { comment_id: root.id },
        select: { reporter_id: true, content_snapshot: true, reason: true },
      })
    ).toEqual({ reporter_id: null, content_snapshot: null, reason: 'spam' })
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: root.id } })
    ).toMatchObject({ status: 'published', body: 'Beautiful layers.' })
  })

  it('scrubs direct account deletion and makes all thread operations unavailable on hidden posts', async () => {
    const author = await fixture(),
      other = await fixture()
    const root = await publish(author.userId, other.postId)
    await service.report({
      userId: other.userId,
      postId: other.postId,
      commentId: root.id,
      reason: 'other',
      platform: 'web',
    })
    await deleteAccountDirectly(author.userId)
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: root.id } })
    ).toMatchObject({ body: null, user_id: null, status: 'erased' })
    expect(
      (
        await prisma.communityCommentReport.findFirstOrThrow({
          where: { comment_id: root.id },
        })
      ).content_snapshot
    ).toBeNull()
    await prisma.lookbookPost.update({
      where: { id: other.postId },
      data: { status: 'withdrawn' },
    })
    await expect(roots(other.userId, other.postId)).rejects.toMatchObject({ status: 404 })
    await expect(
      service.submissions({ userId: other.userId, postId: other.postId, limit: 20 })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('removes pending screening and analytics work when an author row is deleted directly', async () => {
    const author = await fixture(),
      other = await fixture()
    const pending = await create(author.userId, other.postId)
    const subject = await prisma.communityCommentAnalyticsSubject.findUniqueOrThrow({
      where: { user_id: author.userId },
    })
    await deleteAccountDirectly(author.userId)
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: pending.id } })
    ).toMatchObject({ status: 'erased', body: null, user_id: null })
    expect(
      await prisma.communityCommentScreeningOutbox.count({
        where: { comment_id: pending.id },
      })
    ).toBe(0)
    expect(
      await prisma.communityCommentAnalyticsOutbox.count({
        where: { actor: subject.actor },
      })
    ).toBe(0)
  })

  it("scrubs a directly deleted reporter's snapshot through the account trigger", async () => {
    const author = await fixture(),
      reporter = await fixture()
    const root = await publish(author.userId, author.postId)
    await service.report({
      userId: reporter.userId,
      postId: author.postId,
      commentId: root.id,
      reason: 'spam',
      platform: 'web',
    })
    await deleteAccountDirectly(reporter.userId)
    expect(
      await prisma.communityCommentReport.findFirstOrThrow({
        where: { comment_id: root.id },
        select: { reporter_id: true, content_snapshot: true },
      })
    ).toEqual({ reporter_id: null, content_snapshot: null })
  })
})
