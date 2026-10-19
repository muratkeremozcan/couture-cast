import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { CommunityCommentsRepository } from '../src/modules/community/community-comments.repository.js'
import { CommunityCommentsService } from '../src/modules/community/community-comments.service.js'
import { CommunityCommentsProcessor } from '../src/modules/community/community-comments.processor.js'
import { CommunityCommentsOutbox } from '../src/modules/community/community-comments.outbox.js'
import { DefaultCommunityModerationEngine } from '../src/modules/community/community-moderation.engine.js'
import { createCommunityModerationWorker } from '../src/modules/community/community-moderation.worker.js'
import {
  COMMUNITY_COMMENT_JOB,
  CommunityModerationQueue,
} from '../src/modules/community/community-moderation.queue.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  commentInput,
  persistCommentFixture,
} from './helpers/community-comments-context.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasourceUrl: database.url })
const flags = { getFeatureFlag: vi.fn().mockResolvedValue(true) }
const engine = new DefaultCommunityModerationEngine()
const service = new CommunityCommentsService(
  new CommunityCommentsRepository(prisma),
  flags as never,
  { assertWardrobeUploadAllowed: vi.fn() } as never
)
// A backlog far past the 15-minute stale cutoff; these cases are not boundary tests.
const STALE_BACKLOG_AT = new Date('2000-01-01T00:00:00.000Z')
// Accepted contract value: one stale sweep handles at most 100 rows.
const STALE_SWEEP_PAGE = 100
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
async function pending() {
  const { user, post } = await persistCommentFixture(prisma)
  return service.create({
    userId: user.id,
    postId: post.id,
    platform: 'web',
    input: commentInput(),
  })
}
async function age(id: string) {
  await prisma.communityComment.update({
    where: { id },
    data: { created_at: STALE_BACKLOG_AT },
  })
  await prisma.communityCommentScreeningOutbox.update({
    where: { comment_id: id },
    data: { updated_at: STALE_BACKLOG_AT },
  })
}
function outbox(
  processor: CommunityCommentsProcessor,
  queue: unknown = { enqueueComment: vi.fn() }
) {
  return new CommunityCommentsOutbox(
    prisma,
    queue as never,
    { captureCommentEvent: vi.fn() } as never,
    processor
  )
}
async function workerRun(
  screenText: typeof engine.screenText,
  run: (queue: Queue) => Promise<void>
) {
  const connection = redisOptionsFromConfig(getRedisConfig()),
    name = `comment-review-${randomUUID()}`
  const queue = new Queue(name, { connection })
  const worker = createCommunityModerationWorker(
    {
      prisma,
      featureFlags: flags,
      engine: { ...engine, screenText } as never,
      storage: new InMemoryCommunityStorage(),
      telemetryService: {} as never,
    },
    { connection },
    name
  )
  try {
    await worker.waitUntilReady()
    await run(queue)
  } finally {
    await worker.close()
    await queue.obliterate({ force: true })
    await queue.close()
  }
}
async function add(queue: Queue, id: string, generation = 0) {
  return queue.add(
    COMMUNITY_COMMENT_JOB,
    { commentId: id, generation },
    {
      jobId: `comment__${id}__${generation}`,
      attempts: 3,
      backoff: { type: 'fixed', delay: 1000 },
    }
  )
}
beforeAll(() => database.migrate(), 30_000)
beforeEach(async () => {
  flags.getFeatureFlag.mockReset().mockResolvedValue(true)
  await prisma.communityComment.deleteMany()
})
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

describe('comment worker Redis retry and generation ownership', () => {
  it('keeps a real frozen job pending beyond retries and stale age, then publishes once after unfreeze', async () => {
    const row = await pending(),
      screen = vi.fn<typeof engine.screenText>((input) => engine.screenText(input))
    await age(row.id)
    flags.getFeatureFlag.mockResolvedValue(false)
    await workerRun(screen, async (queue) => {
      const job = await add(queue, row.id)
      await expect
        .poll(() => queue.getJob(job.id!).then((j) => j?.getState()))
        .toBe('completed')
      // A frozen deferral completes the job, so nothing remains to retry.
      expect(await queue.getJobCounts('waiting', 'delayed', 'active', 'failed')).toEqual({
        waiting: 0,
        paused: 0,
        delayed: 0,
        active: 0,
        failed: 0,
      })
      const processor = new CommunityCommentsProcessor(prisma, engine, flags),
        box = outbox(processor)
      await age(row.id)
      await box.sweepStale()
      expect(
        await prisma.communityComment.findUniqueOrThrow({ where: { id: row.id } })
      ).toMatchObject({ status: 'pending_screening', body: 'Beautiful layers.' })
      expect(
        await prisma.communityCommentReport.count({ where: { comment_id: row.id } })
      ).toBe(0)
      expect(screen).not.toHaveBeenCalled()
      flags.getFeatureFlag.mockResolvedValue(true)
      await prisma.communityCommentScreeningOutbox.update({
        where: { comment_id: row.id },
        data: { updated_at: STALE_BACKLOG_AT },
      })
      const publisher = {
        enqueueComment: async (id: string, generation: number) => {
          await add(queue, id, generation)
        },
      }
      await outbox(processor, publisher).dispatchPending()
      await expect
        .poll(() =>
          prisma.communityComment
            .findUniqueOrThrow({ where: { id: row.id } })
            .then((r) => r.status)
        )
        .toBe('published')
      await outbox(processor, publisher).dispatchPending()
      expect(screen).toHaveBeenCalledTimes(1)
      expect(
        await prisma.lookbookPost.findUniqueOrThrow({ where: { id: row.postId } })
      ).toMatchObject({ comment_publication_sequence: 1 })
    })
  }, 20_000)

  it('stays private while real engine retries remain and creates one failed intake only on exhaustion', async () => {
    const row = await pending(),
      third = gate(),
      release = gate()
    const screen = vi
      .fn<typeof engine.screenText>()
      .mockRejectedValueOnce(new Error('synthetic technical failure'))
      .mockRejectedValueOnce(new Error('synthetic technical failure'))
      .mockImplementationOnce(async () => {
        third.release()
        await release.promise
        throw new Error('synthetic technical failure')
      })
    await workerRun(screen, async (queue) => {
      const job = await add(queue, row.id)
      await third.promise
      expect(
        await prisma.communityComment.findUniqueOrThrow({ where: { id: row.id } })
      ).toMatchObject({ status: 'pending_screening' })
      expect(
        await prisma.communityCommentReport.count({ where: { comment_id: row.id } })
      ).toBe(0)
      release.release()
      await expect
        .poll(() => queue.getJob(job.id!).then((j) => j?.getState()))
        .toBe('failed')
      expect(
        await prisma.communityComment.findUniqueOrThrow({ where: { id: row.id } })
      ).toMatchObject({ status: 'screening_failed' })
      const reports = await prisma.communityCommentReport.findMany({
        where: { comment_id: row.id },
        include: { audit: true },
      })
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        content_snapshot: null,
        audit: [{ action: 'screening_failed', reason: 'screening_unavailable' }],
      })
      expect(screen).toHaveBeenCalledTimes(3)
    })
  }, 20_000)

  it('does not let an old exhausted attempt fail a generation rearmed during screening', async () => {
    const row = await pending(),
      third = gate(),
      release = gate()
    const screen = vi
      .fn<typeof engine.screenText>()
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockImplementationOnce(async () => {
        third.release()
        await release.promise
        throw new Error('old final attempt')
      })
      .mockImplementation((input) => engine.screenText(input))
    await workerRun(screen, async (queue) => {
      const job = await add(queue, row.id)
      await third.promise
      flags.getFeatureFlag.mockResolvedValue(false)
      await age(row.id)
      const processor = new CommunityCommentsProcessor(prisma, engine, flags)
      await outbox(processor).sweepStale()
      const rearmed = await prisma.communityCommentScreeningOutbox.findUniqueOrThrow({
        where: { comment_id: row.id },
      })
      expect(rearmed.generation).toBe(1)
      flags.getFeatureFlag.mockResolvedValue(true)
      release.release()
      await expect
        .poll(() => queue.getJob(job.id!).then((j) => j?.getState()))
        .toBe('failed')
      expect(
        await prisma.communityComment.findUniqueOrThrow({ where: { id: row.id } })
      ).toMatchObject({ status: 'pending_screening' })
      expect(
        await prisma.communityCommentReport.count({ where: { comment_id: row.id } })
      ).toBe(0)
      await add(queue, row.id, rearmed.generation)
      await expect
        .poll(() =>
          prisma.communityComment
            .findUniqueOrThrow({ where: { id: row.id } })
            .then((r) => r.status)
        )
        .toBe('published')
      expect(screen).toHaveBeenCalledTimes(4)
    })
  }, 20_000)

  it('dispatches an identifier-only job through the real producer and replaces a retained completed job', async () => {
    const row = await pending()
    const connection = redisOptionsFromConfig(getRedisConfig())
    const target = new Queue(`comment-dispatch-${randomUUID()}`, { connection })
    const producer = new CommunityModerationQueue()
    // Point the real producer at this test's queue; enqueueComment itself runs unchanged.
    Reflect.set(producer, 'queue', target)
    const jobId = `comment__${row.id}__0`
    const processor = new CommunityCommentsProcessor(prisma, engine, flags)
    try {
      await outbox(processor, producer).dispatchPending()
      const job = await target.getJob(jobId)
      expect(job?.name).toBe(COMMUNITY_COMMENT_JOB)
      expect(job?.data).toEqual({ commentId: row.id, generation: 0 })
      expect(JSON.stringify(job?.data)).not.toContain('Beautiful layers.')
      const dispatched = await prisma.communityCommentScreeningOutbox.findUniqueOrThrow({
        where: { comment_id: row.id },
      })
      expect(dispatched).toMatchObject({ generation: 0, attempts: 1 })
      expect(dispatched.dispatched_at).toBeInstanceOf(Date)
      const worker = createCommunityModerationWorker(
        {
          prisma,
          featureFlags: flags,
          engine,
          storage: new InMemoryCommunityStorage(),
          telemetryService: {} as never,
        },
        { connection },
        target.name
      )
      try {
        await expect
          .poll(() => target.getJob(jobId).then((j) => j?.getState()))
          .toBe('completed')
      } finally {
        await worker.close()
      }
      await producer.enqueueComment(row.id, 0)
      const replacement = await target.getJob(jobId)
      expect(await replacement?.getState()).toBe('waiting')
      expect(replacement?.processedOn).toBeUndefined()
      expect(replacement?.data).toEqual({ commentId: row.id, generation: 0 })
    } finally {
      await target.obliterate({ force: true })
      await producer.onModuleDestroy()
    }
  }, 20_000)

  it('advances past one bounded page of frozen stale work on the next sweep', async () => {
    const row = await pending()
    await prisma.communityComment.delete({ where: { id: row.id } })
    const post = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: row.postId },
    })
    const rows = Array.from({ length: STALE_SWEEP_PAGE + 1 }, (_, index) => ({
      id: `frozen-${index}-${randomUUID()}`,
      post_id: post.id,
      user_id: post.user_id,
      body: 'Synthetic stale comment',
      locale: 'en-US',
      platform: 'web',
      created_at: new Date(STALE_BACKLOG_AT.getTime() + index),
    }))
    await prisma.communityComment.createMany({ data: rows })
    await prisma.communityCommentScreeningOutbox.createMany({
      data: rows.map((r) => ({ comment_id: r.id, updated_at: STALE_BACKLOG_AT })),
    })
    flags.getFeatureFlag.mockResolvedValue(false)
    const processor = new CommunityCommentsProcessor(prisma, engine, flags),
      box = outbox(processor)
    await box.sweepStale()
    flags.getFeatureFlag.mockResolvedValue(true)
    await box.sweepStale()
    expect(
      await prisma.communityComment.count({ where: { status: 'pending_screening' } })
    ).toBe(100)
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: rows[100]!.id } })
    ).toMatchObject({ status: 'screening_failed' })
    expect(
      await prisma.communityCommentReport.count({
        where: { comment_id: { in: rows.map((r) => r.id) } },
      })
    ).toBe(1)
  }, 20_000)
})
