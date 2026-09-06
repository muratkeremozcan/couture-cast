// Learning path Step 38: Community feed by climate band.
//
// Story 6.1: the moderation pipeline from the transactional outbox through to a
// terminal state, against real PostgreSQL.
//
// `community-moderation.worker.spec.ts` already covers the processor against a
// mocked Prisma, and covers it well. What a mock cannot show is the part that is
// a database property rather than a control-flow property: that the outbox claim
// is idempotent because `dispatched_at` is a real column two dispatch passes
// both read, that flagging writes a real ModerationEvent row alongside the post
// update, and that `markFailed` is a conditional UPDATE which declines to touch
// a post that has already left `pending_review`.
//
// THE DEFAULT ENGINE CANNOT PUBLISH ANYTHING. ADR-013 names TensorFlow.js NSFW,
// no model dependency is wired, and `UnavailableNsfwImageScreener` therefore
// returns `passed: false, reasons: ['screening_unavailable']`. That is fail-
// closed and correct, and it means every assertion below that wants a published
// post must pin a verdict with `FixtureCommunityModerationEngine`, and every
// assertion about the default path expects `flagged` rather than `published`.
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityModerationProcessor } from '../src/modules/community/community-moderation.processor.js'
import { CommunityModerationOutboxDispatcher } from '../src/modules/community/community-moderation.outbox.js'
import {
  DefaultCommunityModerationEngine,
  FixtureCommunityModerationEngine,
  SCREENING_UNAVAILABLE_REASON,
} from '../src/modules/community/community-moderation.engine.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { CommunityModerationActionsService } from '../src/modules/community/community-moderation.actions.js'
import {
  buildCommunityModerationJobId,
  type CommunityModerationPublisher,
} from '../src/modules/community/community-moderation.queue.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const repository = new CommunityRepository(prisma)

/** Telemetry is a double: this suite proves persistence, not event delivery. */
const telemetry = {
  captureEvent: vi.fn().mockResolvedValue(undefined),
} as unknown as TelemetryService

/** Records every enqueue so the dispatcher can be observed without Redis. */
class RecordingQueue implements CommunityModerationPublisher {
  readonly jobs: { postId: string; uploadSessionId: string; jobId: string }[] = []

  enqueue(postId: string, uploadSessionId: string): Promise<void> {
    this.jobs.push({
      postId,
      uploadSessionId,
      jobId: buildCommunityModerationJobId(postId, uploadSessionId),
    })
    return Promise.resolve()
  }
}

let schemaReady = false
let jpegBytes: Buffer
let jpegChecksum: string

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "LookbookPost" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "CommunityModerationOutbox" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "ModerationEvent" LIMIT 1`
    schemaReady = true
  } catch (error) {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[community-moderation-pipeline] Skipped: could not query the Story 6.1 community schema. ' +
        'Run `npm run db:migrate` against the integration database. Underlying error:',
      error
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

const namespace = `community-pipeline-${randomUUID().slice(0, 8)}`

async function createUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${namespace}-${label}-${randomUUID().slice(0, 8)}@synthetic.test` },
  })
  return user.id
}

/**
 * A post sitting in `pending_review` with its bytes actually in the storage
 * double, which is what the processor requires: it downloads the object, so a
 * row whose object is absent terminates at `review_failed` rather than being
 * screened at all.
 */
async function createPendingPost(
  storage: InMemoryCommunityStorage,
  options: { caption?: string | null; challengeId?: string | null } = {}
): Promise<{ postId: string; userId: string; objectPath: string }> {
  const userId = await createUser('author')
  const postId = `pending-${randomUUID()}`
  const uploadSessionId = randomUUID()
  const objectPath = `community/${postId}/${uploadSessionId}.jpg`

  const fixture = createLookbookPost({
    id: postId,
    userId,
    status: 'pending_review',
    caption: options.caption ?? 'A classic autumn trench',
    altText: 'Full length photo of a trench coat outfit',
    imageObjectPath: objectPath,
    imageContentType: 'image/jpeg',
    imageChecksum: jpegChecksum,
    imageByteSize: jpegBytes.length,
    challengeId: options.challengeId ?? null,
    publishedAt: null,
    submittedAt: new Date(),
  })
  await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
  await prisma.communityModerationOutbox.create({ data: { post_id: postId } })

  storage.put(objectPath, jpegBytes)
  return { postId, userId, objectPath }
}

beforeAll(async () => {
  await probeSchema()

  // A real decodable image at a legal size. The validation step re-encodes and
  // compares checksums, so a synthetic byte string would fail before any
  // screening decision was reached and the test would prove nothing.
  jpegBytes = await sharp({
    create: {
      width: 512,
      height: 640,
      channels: 3,
      background: { r: 200, g: 180, b: 160 },
    },
  })
    .jpeg()
    .toBuffer()
  jpegChecksum = createHash('sha256').update(jpegBytes).digest('hex')
})

afterAll(async () => {
  if (schemaReady) {
    const owned = { user: { email: { startsWith: namespace } } }
    await prisma.communityPostReport.deleteMany({
      where: { post: { user: { email: { startsWith: namespace } } } },
    })
    await prisma.moderationEvent.deleteMany({
      where: { post: { user: { email: { startsWith: namespace } } } },
    })
    await prisma.communityModerationOutbox.deleteMany({
      where: { post: { user: { email: { startsWith: namespace } } } },
    })
    await prisma.lookbookPost.deleteMany({ where: owned })
    await prisma.communityAlias.deleteMany({ where: owned })
    await prisma.user.deleteMany({ where: { email: { startsWith: namespace } } })
  }
  await prisma.$disconnect()
})

describe('6.1 community moderation pipeline', () => {
  describe('transactional outbox dispatch', () => {
    it('6.1-INT-020 dispatches each pending row exactly once across two passes', async (context) => {
      if (!requireSchema(context)) return

      // Duplicate-job suppression is a database property: the second pass finds
      // nothing because the first stamped `dispatched_at`. A worker that
      // re-enqueued would screen the same post twice and write two terminal
      // decisions for it.
      const storage = new InMemoryCommunityStorage()
      const queue = new RecordingQueue()
      const dispatcher = new CommunityModerationOutboxDispatcher(prisma, queue)

      const { postId, objectPath } = await createPendingPost(storage)

      const first = await dispatcher.dispatchPending()
      expect(first.dispatched).toBeGreaterThanOrEqual(1)
      expect(first.failed).toBe(0)

      const dispatchedForPost = queue.jobs.filter((job) => job.postId === postId)
      expect(dispatchedForPost).toHaveLength(1)

      // The job id is derived from the post and its upload session, so a retry
      // at the queue layer collapses onto the same job rather than adding one.
      const uploadSessionId = objectPath.split('/')[2]?.replace('.jpg', '') ?? ''
      expect(dispatchedForPost[0]?.jobId).toBe(
        buildCommunityModerationJobId(postId, uploadSessionId)
      )

      const stamped = await prisma.communityModerationOutbox.findUniqueOrThrow({
        where: { post_id: postId },
      })
      expect(stamped.dispatched_at).not.toBeNull()
      expect(stamped.attempts).toBe(1)

      await dispatcher.dispatchPending()
      expect(queue.jobs.filter((job) => job.postId === postId)).toHaveLength(1)
    })

    it('6.1-INT-021 leaves a failed dispatch claimable and counts the attempt', async (context) => {
      if (!requireSchema(context)) return

      // A dispatch that throws must NOT stamp `dispatched_at`, or the post is
      // stranded in `pending_review` with nothing left to re-drive it. The
      // attempt counter still moves, so a poison row is visible to an operator.
      const storage = new InMemoryCommunityStorage()
      const failingQueue: CommunityModerationPublisher = {
        enqueue: () => Promise.reject(new Error('redis unavailable')),
      }
      const dispatcher = new CommunityModerationOutboxDispatcher(prisma, failingQueue)
      const { postId } = await createPendingPost(storage)

      const result = await dispatcher.dispatchPending()
      expect(result.failed).toBeGreaterThanOrEqual(1)

      const outbox = await prisma.communityModerationOutbox.findUniqueOrThrow({
        where: { post_id: postId },
      })
      expect(outbox.dispatched_at).toBeNull()
      expect(outbox.attempts).toBe(1)
      expect(outbox.last_error).toContain('redis unavailable')
    })
  })

  describe('terminal states', () => {
    it('6.1-INT-022 flags rather than publishes while image screening is unavailable', async (context) => {
      if (!requireSchema(context)) return

      // ADR-013's engine is not wired, so the default screener fails closed.
      // This asserts the CURRENT correct behaviour: nothing reaches `published`
      // through the default path, and the reason says why rather than being
      // silently empty.
      const storage = new InMemoryCommunityStorage()
      const processor = new CommunityModerationProcessor(
        prisma,
        storage,
        telemetry,
        new DefaultCommunityModerationEngine()
      )
      const { postId } = await createPendingPost(storage)

      await processor.process({ postId, uploadSessionId: postId })

      const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      expect(post.status).toBe('flagged')
      expect(post.published_at).toBeNull()
      expect(post.moderation_reason).toContain(SCREENING_UNAVAILABLE_REASON)
    })

    it('6.1-INT-023 records both engine verdicts when text and image disagree', async (context) => {
      if (!requireSchema(context)) return

      // Engine disagreement: the image clears and the text does not. The post is
      // flagged, and BOTH engine versions survive on the row as `text;image`, so
      // an operator can tell which half made the decision months later.
      const storage = new InMemoryCommunityStorage()
      const processor = new CommunityModerationProcessor(
        prisma,
        storage,
        telemetry,
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: false, reasons: ['profanity'] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )
      const { postId, userId } = await createPendingPost(storage)

      await processor.process({ postId, uploadSessionId: postId })

      const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      expect(post.status).toBe('flagged')
      expect(post.moderation_reason).toContain('profanity')
      // Both halves say `-fixture`, because both were pinned by the fixture
      // engine. The persisted version is the column an auditor reads to answer
      // "was this screened", so a fixture signing the real model's name is the
      // one lie the audit trail cannot survive.
      expect(post.moderation_engine_version).toBe(
        'adr013-text-v2.0-fixture;adr013-nsfw-v1.0-fixture'
      )

      // The audit row is append-only and separate from the post, so it survives
      // the author erasing their account.
      const event = await prisma.moderationEvent.findFirstOrThrow({
        where: { post_id: postId, action: 'flagged' },
      })
      expect(event.flagged_by_id).toBeNull()
      expect(post.user_id).toBe(userId)

      const outbox = await prisma.communityModerationOutbox.findUniqueOrThrow({
        where: { post_id: postId },
      })
      expect(outbox.dispatched_at).not.toBeNull()
    })

    it('6.1-INT-024 publishes only when a pinned verdict clears both halves', async (context) => {
      if (!requireSchema(context)) return

      const storage = new InMemoryCommunityStorage()
      const processor = new CommunityModerationProcessor(
        prisma,
        storage,
        telemetry,
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )
      const { postId } = await createPendingPost(storage)

      await processor.process({ postId, uploadSessionId: postId })

      const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      expect(post.status).toBe('published')
      // The database CHECK refuses a published row with no publication clock, so
      // reaching this state at all proves the transition set it.
      expect(post.published_at).not.toBeNull()
      expect(post.moderation_reason).toBeNull()
    })

    it('6.1-INT-025 terminates a post whose object is missing from the bucket', async (context) => {
      if (!requireSchema(context)) return

      // The seeded-object defect, from the pipeline's side. A post pointing at an
      // object that is not in the bucket cannot be screened, and the storage
      // adapter raises STORAGE_PERMISSION_DENIED. The exhausted-retry path is
      // what turns that into a terminal state an author can see.
      const storage = new InMemoryCommunityStorage()
      const processor = new CommunityModerationProcessor(
        prisma,
        storage,
        telemetry,
        new DefaultCommunityModerationEngine()
      )
      const { postId, objectPath } = await createPendingPost(storage)
      storage.objects.delete(objectPath)

      await expect(
        processor.process({ postId, uploadSessionId: postId })
      ).rejects.toThrow('STORAGE_PERMISSION_DENIED')

      // Still pending: one failed attempt is a retry, not a verdict.
      const midFlight = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postId },
      })
      expect(midFlight.status).toBe('pending_review')

      // The worker calls this once the retry budget is spent.
      await processor.markFailed(postId, 'STORAGE_PERMISSION_DENIED')

      const terminal = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postId },
      })
      expect(terminal.status).toBe('review_failed')
      expect(terminal.moderation_reason).toBe('STORAGE_PERMISSION_DENIED')

      const outbox = await prisma.communityModerationOutbox.findUniqueOrThrow({
        where: { post_id: postId },
      })
      expect(outbox.dispatched_at).not.toBeNull()
    })

    it('6.1-INT-026 refuses to overwrite a post that already reached a terminal state', async (context) => {
      if (!requireSchema(context)) return

      // `markFailed` is a conditional UPDATE on `status = 'pending_review'`. A
      // late retry firing after the post published must not drag it back to
      // `review_failed`, which is a real ordering hazard once retries and the
      // stale sweep can both fire for the same post.
      const storage = new InMemoryCommunityStorage()
      const processor = new CommunityModerationProcessor(
        prisma,
        storage,
        telemetry,
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )
      const { postId } = await createPendingPost(storage)
      await processor.process({ postId, uploadSessionId: postId })

      await processor.markFailed(postId, 'LATE_RETRY')

      const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      expect(post.status).toBe('published')
      expect(post.moderation_reason).toBeNull()
    })

    /*
     * 6.1-INT-027 (moderation timeout guard) was DELETED from this tier, not
     * from the estate. It exercised `withModerationTimeout` against a promise
     * that never settles and asserted a constant, touching no database while
     * still paying this tier's connection and schema-probe cost.
     * `community-moderation.worker.spec.ts` already covers it as a unit, which
     * is where a pure timing helper belongs.
     */
    it('6.1-INT-028 leaves a post alone once it is no longer pending review', async (context) => {
      if (!requireSchema(context)) return

      // Duplicate delivery of the same job. The second pass sees a status other
      // than `pending_review` and returns without touching the row, which is what
      // makes redelivery safe.
      const storage = new InMemoryCommunityStorage()
      const processor = new CommunityModerationProcessor(
        prisma,
        storage,
        telemetry,
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )
      const { postId } = await createPendingPost(storage)

      await processor.process({ postId, uploadSessionId: postId })
      const afterFirst = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postId },
      })

      await processor.process({ postId, uploadSessionId: postId })
      const afterSecond = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postId },
      })

      expect(afterSecond.published_at).toEqual(afterFirst.published_at)
      expect(afterSecond.updated_at).toEqual(afterFirst.updated_at)
    })
  })

  describe('concurrent paging while moderation completes', () => {
    it('6.1-INT-060 never loses or duplicates a post that publishes mid-page', async (context) => {
      if (!requireSchema(context)) return

      // AC3's concurrency half: "Given publication and concurrent feed paging,
      // when moderation completes, then the post appears once under
      // `published_at,id` ordering." Every other test covers the ordering half;
      // nothing held a cursor across a publication until this one.
      //
      // The fixture is built to fail under the OLD `created_at` ordering: the
      // post is drafted BEFORE the reader starts paging (old `created_at`) and
      // published AFTER the reader takes a cursor (new `published_at`). Ordered
      // by creation it sorts behind a cursor the reader has already consumed and
      // is never seen at all; ordered by publication it is newer than the cursor
      // and simply waits at the top of the feed. That is the exact regression the
      // index and cursor rebuild was made for, and it had no test.
      const storage = new InMemoryCommunityStorage()
      const processor = new CommunityModerationProcessor(
        prisma,
        storage,
        telemetry,
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      // A band this suite owns outright, so the page contents are exactly the
      // fixture and not whatever else the shared database holds.
      const band = 'warm_wet' as const
      const authorId = await createUser('pager')
      const backlogIds: string[] = []
      for (let index = 0; index < 6; index += 1) {
        const publishedAt = new Date(Date.UTC(2025, 0, 1 + index))
        const fixture = createLookbookPost({
          id: `${namespace}-backlog-${index}-${randomUUID().slice(0, 8)}`,
          userId: authorId,
          status: 'published',
          climateBand: band,
          publishedAt,
          createdAt: publishedAt,
          updatedAt: publishedAt,
        })
        await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
        backlogIds.push(fixture.id)
      }

      // The reader takes the first page and holds its cursor.
      const firstPage = await repository.findPublishedFeedPosts({
        filterBand: band,
        limit: 3,
        mode: band,
      })
      expect(firstPage.posts).toHaveLength(3)
      expect(firstPage.nextCursor).not.toBeNull()

      // Meanwhile a post drafted BEFORE the reader arrived clears moderation.
      const draftedAt = new Date(Date.UTC(2024, 0, 1))
      const latePostId = `${namespace}-late-${randomUUID().slice(0, 8)}`
      const uploadSessionId = randomUUID()
      const objectPath = `community/${latePostId}/${uploadSessionId}.jpg`
      const late = createLookbookPost({
        id: latePostId,
        userId: authorId,
        status: 'pending_review',
        climateBand: band,
        altText: 'Full length photo of a trench coat outfit',
        imageObjectPath: objectPath,
        imageContentType: 'image/jpeg',
        imageChecksum: jpegChecksum,
        imageByteSize: jpegBytes.length,
        publishedAt: null,
        createdAt: draftedAt,
        updatedAt: draftedAt,
        submittedAt: draftedAt,
      })
      await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(late) })
      await prisma.communityModerationOutbox.create({ data: { post_id: latePostId } })
      storage.put(objectPath, jpegBytes)

      await processor.process({ postId: latePostId, uploadSessionId })
      const publishedLate = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: latePostId },
      })
      expect(publishedLate.status).toBe('published')
      // Drafted in 2024, published now: the two clocks disagree by years, which
      // is what makes the ordering choice observable at all.
      expect(publishedLate.created_at.getTime()).toBeLessThan(
        publishedLate.published_at?.getTime() ?? 0
      )

      // The reader resumes with the cursor they were holding.
      const secondPage = await repository.findPublishedFeedPosts({
        filterBand: band,
        cursor: {
          publishedAt: (firstPage.posts.at(-1)?.published_at ?? new Date()).toISOString(),
          id: firstPage.posts.at(-1)?.id ?? '',
          mode: band,
          band,
        },
        limit: 3,
        mode: band,
      })

      const firstIds = firstPage.posts.map((post) => post.id)
      const secondIds = secondPage.posts.map((post) => post.id)

      // NEVER TWICE: no row is served by both pages.
      expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([])
      const seen = [...firstIds, ...secondIds]
      expect(new Set(seen).size).toBe(seen.length)

      // The late post is newer than the cursor, so it correctly does not appear
      // in the continuation -- the reader is paging backwards through time.
      expect(secondIds).not.toContain(latePostId)

      // NEVER LOST: it is at the top of the feed for anyone who starts fresh.
      // Under `created_at` ordering it would have sorted into 2024, behind the
      // whole backlog and behind the cursor, invisible to both pages and to a
      // reload.
      const reload = await repository.findPublishedFeedPosts({
        filterBand: band,
        limit: 3,
        mode: band,
      })
      expect(reload.posts.map((post) => post.id)).toContain(latePostId)
      expect(reload.posts[0]?.id).toBe(latePostId)

      // And the backlog is still reachable in full across the two pages plus the
      // late arrival, so nothing was displaced by the insert.
      expect(new Set([...seen, latePostId]).size).toBe(seen.length + 1)
      expect(backlogIds.filter((id) => seen.includes(id)).length).toBe(6)
    })
  })

  describe('publish path writes the outbox atomically', () => {
    it('6.1-INT-029 makes a submitted post dispatchable in the same commit', async (context) => {
      if (!requireSchema(context)) return

      // Ties the two halves together end to end: the repository's publish
      // transaction is what creates the outbox row, and the dispatcher is what
      // consumes it. Neither half is useful without the other.
      const storage = new InMemoryCommunityStorage()
      const queue = new RecordingQueue()
      const dispatcher = new CommunityModerationOutboxDispatcher(prisma, queue)

      const userId = await createUser('atomic')
      const postId = `atomic-${randomUUID()}`
      const fixture = createLookbookPost({
        id: postId,
        userId,
        status: 'draft',
        publishedAt: null,
        submittedAt: null,
        altTextConfirmedAt: null,
      })
      await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
      storage.put(fixture.imageObjectPath ?? '', jpegBytes)

      const published = await repository.publishWithinQuota({
        userId,
        postId,
        cap: 10,
        data: {
          altText: 'Full length photo of a trench coat outfit',
          caption: null,
          climateBand: 'cold_wet',
          locale: 'en-US',
          challengeId: null,
        },
      })
      expect(published.kind).toBe('published')

      await dispatcher.dispatchPending()
      expect(queue.jobs.some((job) => job.postId === postId)).toBe(true)
    })
  })

  describe('operator actions under concurrency', () => {
    /*
     * WHY THESE ARE HERE AND NOT IN `community-moderation.actions.spec.ts`.
     *
     * That spec covers the service well at fourteen tests, and it cannot cover
     * the one property the service is built around. `lockPost` issues
     * `SELECT id FROM "LookbookPost" WHERE id = $1 FOR UPDATE` and the method's
     * own comment names the race it closes: "without the lock two operators
     * acting at once could each read `flagged` and both write an audit row for a
     * release that only happened once." The unit spec's `$queryRaw` is a bare
     * `vi.fn()` whose resolved value is set in `beforeEach` and whose SQL text is
     * never asserted, so DELETING `FOR UPDATE` LEAVES ALL FOURTEEN GREEN.
     *
     * That matters more here than it would elsewhere because there is nothing
     * underneath the lock. `releaseFlaggedPost` writes with a bare
     * `tx.lookbookPost.update({ where: { id } })` carrying no status predicate,
     * so the in-memory `post.status !== 'flagged'` check plus the row lock are
     * the entire mechanism -- no unique index, no CHECK, no conditional UPDATE
     * that would return zero rows for the loser. This is the same shape as
     * `publishWithinQuota`, whose rolling cap is likewise unexpressible as a
     * constraint, and 6.1-INT-011 exists for exactly that reason.
     *
     * So these are written the way 6.1-INT-011 was: real parallel transactions
     * against real PostgreSQL, built to go red when the lock is removed. A
     * failure here is an API defect and must not be retried, serialised, or
     * given a longer timeout.
     */
    const actions = () => new CommunityModerationActionsService(prisma)

    async function createPostInStatus(
      status: 'flagged' | 'published',
      label: string
    ): Promise<{ postId: string; userId: string }> {
      const userId = await createUser(label)
      const postId = `${status}-${randomUUID()}`
      const fixture = createLookbookPost({
        id: postId,
        userId,
        status,
        caption: 'A classic autumn trench',
        altText: 'Full length photo of a trench coat outfit',
        // A flagged post carries the screener's verdict, which is what an
        // operator release overrides and what the audit row has to name.
        moderationReason: status === 'flagged' ? SCREENING_UNAVAILABLE_REASON : null,
        moderationEngineVersion:
          status === 'flagged' ? 'adr013-text-v2.0;adr013-nsfw-v1.0' : null,
        publishedAt: status === 'published' ? new Date() : null,
        submittedAt: new Date(),
      })
      await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
      return { postId, userId }
    }

    const eventsFor = (postId: string, action: string) =>
      prisma.moderationEvent.count({ where: { post_id: postId, action } })

    it('6.1-INT-080 releases a flagged post exactly once when two operators act at once', async (context) => {
      if (!requireSchema(context)) return

      const { postId } = await createPostInStatus('flagged', 'race-release')
      const [operatorA, operatorB] = await Promise.all([
        createUser('operator-a'),
        createUser('operator-b'),
      ])
      const service = actions()

      const results = await Promise.all([
        service.releaseFlaggedPost({
          postId,
          operatorId: operatorA,
          reason: 'Reviewed: the screener was unavailable, not offended',
        }),
        service.releaseFlaggedPost({
          postId,
          operatorId: operatorB,
          reason: 'Reviewed: the screener was unavailable, not offended',
        }),
      ])

      // Exactly one operator performed the release. Without the lock both read
      // `flagged`, both return true, and the post is released twice.
      expect(results.filter((result) => result.released)).toHaveLength(1)
      expect(results.filter((result) => !result.released)).toHaveLength(1)

      // And the database agrees with the return values, which is the half the
      // unit spec cannot check: one audit row, not two. A duplicated row here
      // would tell a compliance reader two humans independently overruled the
      // screener when only one did.
      expect(await eventsFor(postId, 'released_by_operator')).toBe(1)

      const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      expect(post.status).toBe('published')
      expect(post.published_at).not.toBeNull()
    })

    it('6.1-INT-081 takes a published post down exactly once when two operators act at once', async (context) => {
      if (!requireSchema(context)) return

      // The mirror of 6.1-INT-080 on the other write path. Both go through the
      // same `lockPost`, and a takedown duplicated in the audit trail is worse
      // than a duplicated release: the row is the evidence a takedown happened,
      // and two of them for one action makes the trail unusable as a count.
      const { postId } = await createPostInStatus('published', 'race-takedown')
      const [operatorA, operatorB] = await Promise.all([
        createUser('takedown-a'),
        createUser('takedown-b'),
      ])
      const service = actions()

      const results = await Promise.all([
        service.takeDownPublishedPost({
          postId,
          operatorId: operatorA,
          reason: 'Reported and confirmed',
        }),
        service.takeDownPublishedPost({
          postId,
          operatorId: operatorB,
          reason: 'Reported and confirmed',
        }),
      ])

      expect(results.filter((result) => result.takenDown)).toHaveLength(1)
      expect(await eventsFor(postId, 'taken_down_by_operator')).toBe(1)

      const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      expect(post.status).toBe('flagged')
    })

    it('6.1-INT-082 leaves the post agreeing with its own audit trail when a release races a takedown', async (context) => {
      if (!requireSchema(context)) return

      /*
       * The two actions are inverses on the same row, and either order is legal:
       * a takedown then a release ends published with two rows, a release
       * refused then a takedown ends flagged with one. What is NOT legal is the
       * post disagreeing with the last thing the audit trail says happened to
       * it, because the trail is what an operator and a regulator both read.
       *
       * Honest about its strength: unlike the two above, this one is not proven
       * red by deleting `FOR UPDATE`. Under READ COMMITTED the loser either sees
       * the committed new status or the old one, and both readings produce a
       * self-consistent pair, so removing the lock does not reliably break it.
       * It is an invariant test rather than a race test, kept because the
       * invariant is the thing anyone actually reasons about and nothing else
       * asserts it.
       */
      const { postId } = await createPostInStatus('published', 'race-mixed')
      const [releaser, taker] = await Promise.all([
        createUser('mixed-release'),
        createUser('mixed-takedown'),
      ])
      const service = actions()

      await Promise.all([
        service.takeDownPublishedPost({
          postId,
          operatorId: taker,
          reason: 'Reported and confirmed',
        }),
        service.releaseFlaggedPost({
          postId,
          operatorId: releaser,
          reason: 'Reviewed and cleared',
        }),
      ])

      const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      const latest = await prisma.moderationEvent.findFirstOrThrow({
        where: {
          post_id: postId,
          action: { in: ['released_by_operator', 'taken_down_by_operator'] },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      })

      const expectedStatus =
        latest.action === 'released_by_operator' ? 'published' : 'flagged'
      expect(
        post.status,
        `the post is ${post.status} but the newest operator event is ${latest.action}`
      ).toBe(expectedStatus)

      // Neither action may fire twice, whichever order they landed in.
      expect(await eventsFor(postId, 'released_by_operator')).toBeLessThanOrEqual(1)
      expect(await eventsFor(postId, 'taken_down_by_operator')).toBeLessThanOrEqual(1)
    })
  })
})
