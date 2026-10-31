// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { cleanupCommunityCommentFixtures } from '../../../packages/testing/src/community-comments-cleanup.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'
import { CommunityCommentsProcessor } from '../src/modules/community/community-comments.processor.js'
import { createCommunityModerationWorker } from '../src/modules/community/community-moderation.worker.js'
import { COMMUNITY_COMMENT_JOB } from '../src/modules/community/community-moderation.queue.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import { commentsTestContext } from './helpers/community-comments-context.js'

const { prisma, engine, flags, namespace, input, fixture, create, roots, publish } =
  commentsTestContext()
const COMMUNITY_FLAG_KEYS = ['community_read_enabled', 'community_write_enabled']

describe('Story 6.4 comment rollout authority, cleanup and real worker', () => {
  it('honors per-author remote rollout when the synthetic fallback cache is false and fails closed without authority', async () => {
    const actor = await fixture(),
      pending = await create(actor.userId, actor.postId)
    const remoteProvider = { getFeatureFlagValue: vi.fn().mockResolvedValue(true) }
    const authority = new FeatureFlagsService(
      new FeatureFlagsRepository(prisma),
      remoteProvider as never,
      new CommunityFlagEvaluationService(prisma, remoteProvider)
    )
    const remote = new CommunityCommentsProcessor(prisma, engine, authority)
    try {
      await prisma.featureFlag.updateMany({
        where: { key: { in: COMMUNITY_FLAG_KEYS } },
        data: { value: false },
      })
      await remote.process(pending.id)
      expect(
        (await prisma.communityComment.findUniqueOrThrow({ where: { id: pending.id } }))
          .status
      ).toBe('published')
      expect(remoteProvider.getFeatureFlagValue).toHaveBeenCalledWith(
        'community_write_enabled',
        actor.userId
      )
    } finally {
      await prisma.featureFlag.updateMany({
        where: { key: { in: COMMUNITY_FLAG_KEYS } },
        data: { value: true },
      })
    }
    const missing = await create(actor.userId, actor.postId)
    await new CommunityCommentsProcessor(prisma, engine).process(missing.id)
    expect(
      (await prisma.communityComment.findUniqueOrThrow({ where: { id: missing.id } }))
        .status
    ).toBe('pending_screening')
    expect(
      (
        await prisma.communityCommentScreeningOutbox.findUniqueOrThrow({
          where: { comment_id: missing.id },
        })
      ).generation
    ).toBe(1)
  })

  it('cleans synthetic threads without orphaning another member reply', async () => {
    const actor = await fixture(),
      other = await fixture()
    const root = await publish(actor.userId, actor.postId)
    const reply = await publish(
      other.userId,
      actor.postId,
      input('Other member reply.', root.id)
    )
    const disposableRoot = await publish(actor.userId, actor.postId)
    const disposableReply = await publish(
      actor.userId,
      actor.postId,
      input('Synthetic reply.', disposableRoot.id)
    )
    await prisma.$transaction((tx) =>
      cleanupCommunityCommentFixtures(tx, [
        root.id,
        disposableRoot.id,
        disposableReply.id,
      ])
    )
    expect(
      await prisma.communityComment.count({
        where: { id: { in: [disposableRoot.id, disposableReply.id] } },
      })
    ).toBe(0)
    expect(
      (await prisma.communityComment.findUniqueOrThrow({ where: { id: reply.id } }))
        .parent_id
    ).toBe(root.id)
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: root.id } })
    ).toMatchObject({
      body: null,
      user_id: null,
      status: 'erased',
      screening_reason: null,
      screening_version: null,
    })
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: reply.id } })
    ).toMatchObject({ body: 'Other member reply.', user_id: other.userId })
    await prisma.$transaction((tx) => cleanupCommunityCommentFixtures(tx, []))
  })

  it('processes comment identifier-only jobs through the real Redis worker once', async () => {
    const { userId, postId } = await fixture()
    const pending = await create(userId, postId)
    const queueName = `${namespace}-worker`
    const connection = redisOptionsFromConfig(getRedisConfig())
    const queue = new Queue(queueName, { connection })
    const worker = createCommunityModerationWorker(
      {
        prisma,
        featureFlags: flags,
        storage: new InMemoryCommunityStorage(),
        engine,
        telemetryService: {} as never,
      },
      { connection },
      queueName
    )
    try {
      await worker.waitUntilReady()
      const completed = new Promise<void>((resolve, reject) => {
        worker.once('completed', () => resolve())
        worker.once('failed', (_job, error) => reject(error))
      })
      await queue.add(
        COMMUNITY_COMMENT_JOB,
        { commentId: pending.id, generation: 0 },
        { jobId: `comment__${pending.id}__0`, attempts: 3 }
      )
      await completed
      expect((await roots(userId, postId)).items[0]?.id).toBe(pending.id)
      const job = await queue.getJob(`comment__${pending.id}__0`)
      expect(job?.data).toEqual({ commentId: pending.id, generation: 0 })
    } finally {
      await worker.close()
      await queue.obliterate({ force: true })
      await queue.close()
    }
  }, 20_000)
})
