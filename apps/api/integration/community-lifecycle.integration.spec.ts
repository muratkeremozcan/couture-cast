// Learning path Step 38: Community feed by climate band.
//
// Story 6.1: the state transitions that happen to a post WITHOUT anyone asking
// for them -- consent lapsing, erasure completing, an upload being abandoned,
// moderation stalling -- against real PostgreSQL.
//
// These are the matrix rows that are only true if a sweep actually finds the
// row. Every one of them turns on a WHERE clause over a nullable timestamp
// column, which is precisely what a mocked Prisma cannot get wrong and a real
// one can: an index that does not exist, a predicate that reads
// `objects_purged_at: null` when the column is absent, a sweep that silently
// matches nothing and reports success.
//
// `community-maintenance.service.spec.ts` already covers the branch logic here
// against a mock. What this file adds is that the selection predicates match
// real rows, that the erasure sequence leaves a row that is genuinely
// unattributable rather than merely marked, and that a storage failure mid-way
// leaves the work re-drivable instead of half-done and forgotten.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import {
  CommunityMaintenanceService,
  ERASURE_DEADLINE_HOURS,
  STALE_PENDING_REVIEW_MINUTES,
} from '../src/modules/community/community-maintenance.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import type { CommunityStorage } from '../src/modules/community/community-storage.adapter.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const repository = new CommunityRepository(prisma)

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "LookbookPost" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "JobFailure" LIMIT 1`
    schemaReady = true
  } catch (error) {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[community-lifecycle] Skipped: could not query the Story 6.1 community schema. ' +
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

const namespace = `community-lifecycle-${randomUUID().slice(0, 8)}`

async function createUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${namespace}-${label}-${randomUUID().slice(0, 8)}@synthetic.test` },
  })
  return user.id
}

/**
 * Post ids carry the suite namespace so `JobFailure` rows -- which have no owner
 * column and cannot be reached through the user filter -- are still removable in
 * teardown by matching on `job_id`.
 */
function postId(label: string): string {
  return `${namespace}-${label}-${randomUUID().slice(0, 8)}`
}

async function createPost(
  storage: InMemoryCommunityStorage,
  overrides: Parameters<typeof createLookbookPost>[0] & { id: string; userId: string }
): Promise<{ id: string; objectPath: string }> {
  const fixture = createLookbookPost(overrides)
  await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
  const objectPath = fixture.imageObjectPath ?? ''
  storage.put(objectPath, Buffer.from('seeded-object-bytes'))
  return { id: fixture.id, objectPath }
}

/**
 * The storage double with `remove` replaced by a refusal, delegating everything
 * else. Written out rather than spread from the instance because a spread of a
 * class instance loses the method types and the object stops proving it
 * satisfies `CommunityStorage`.
 */
function storageThatCannotRemove(storage: InMemoryCommunityStorage): CommunityStorage {
  return {
    signReadUrl: (path, expiresIn) => storage.signReadUrl(path, expiresIn),
    signReadUrls: (paths, expiresIn) => storage.signReadUrls(paths, expiresIn),
    createUploadSession: (path, expiresIn) =>
      storage.createUploadSession(path, expiresIn),
    download: (path) => storage.download(path),
    upload: (path, bytes, mimeType) => storage.upload(path, bytes, mimeType),
    remove: () => Promise.reject(new Error('STORAGE_PERMISSION_DENIED')),
  }
}

/**
 * Runs a sweep until the row under test has actually been processed.
 *
 * Every maintenance sweep selects table-wide and takes at most 200 rows per
 * pass, so on a shared development database holding more than a batch of
 * matching rows a single call can legitimately miss the fixture. Asserting
 * after one pass made these tests fail intermittently for a reason that had
 * nothing to do with the behaviour under test.
 *
 * This is not a retry that papers over flake: each pass converts rows
 * permanently, so the fixture is reached in a bounded number of passes or the
 * sweep genuinely is not selecting it, which is what the final assertion then
 * reports.
 */
async function drainSweep(
  sweep: () => Promise<unknown>,
  processed: () => Promise<boolean>,
  maxPasses = 10
): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (await processed()) return
    await sweep()
  }
}

beforeAll(async () => {
  await probeSchema()
})

afterAll(async () => {
  if (schemaReady) {
    const owned = { user: { email: { startsWith: namespace } } }
    await prisma.jobFailure.deleteMany({ where: { job_id: { contains: namespace } } })
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

describe('6.1 community lifecycle sweeps', () => {
  describe('consent suspension', () => {
    it('6.1-INT-030 hides a consent-suspended post from the feed but not from its author', async (context) => {
      if (!requireSchema(context)) return

      // A teen's guardian consent lapses. The post must leave the public feed
      // immediately, and the author must still be able to see it and its state,
      // because "resubmit after fresh consent" is meaningless if the post has
      // vanished from their own view too.
      const storage = new InMemoryCommunityStorage()
      const userId = await createUser('consent')
      const publishedAt = new Date()

      const suspended = await createPost(storage, {
        id: postId('suspended'),
        userId,
        status: 'consent_suspended',
        climateBand: 'cold_wet',
        publishedAt,
      })
      const live = await createPost(storage, {
        id: postId('live'),
        userId,
        status: 'published',
        climateBand: 'cold_wet',
        publishedAt,
      })

      const feed = await repository.findPublishedFeedPosts({
        filterBand: 'cold_wet',
        limit: 50,
        mode: 'cold_wet',
      })
      const feedIds = feed.posts.map((post) => post.id)
      expect(feedIds).toContain(live.id)
      expect(feedIds).not.toContain(suspended.id)

      const authorStates = await repository.findAuthorPostStates(userId)
      const authorIds = authorStates.map((post) => post.id)
      expect(authorIds).toContain(suspended.id)
      // Published posts are deliberately absent from the author section: they
      // are already in the feed, and listing them twice would double them in the
      // client's merged view.
      expect(authorIds).not.toContain(live.id)
    })
  })

  describe('erasure', () => {
    it('6.1-INT-031 hides, anonymizes and purges in one sweep', async (context) => {
      if (!requireSchema(context)) return

      const storage = new InMemoryCommunityStorage()
      const maintenance = new CommunityMaintenanceService(prisma, storage)
      const userId = await createUser('erasure')
      const requestedAt = new Date(Date.now() - 60 * 60 * 1000)

      const post = await createPost(storage, {
        id: postId('erasure'),
        userId,
        status: 'published',
        publishedAt: new Date(),
        caption: 'A caption that must not survive erasure',
        altText: 'Alt text that must not survive erasure',
        locationKey: 'us-il-chicago',
        erasureRequestedAt: requestedAt,
      })

      await drainSweep(
        () => maintenance.sweepErasureRequests(new Date()),
        async () =>
          (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } }))
            .objects_purged_at !== null
      )

      const erased = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: post.id },
      })
      expect(erased.status).toBe('withdrawn')
      expect(erased.caption).toBeNull()
      expect(erased.alt_text).toBeNull()
      expect(erased.locale).toBeNull()
      expect(erased.location_key).toBeNull()
      expect(erased.image_checksum).toBeNull()
      expect(erased.anonymized_at).not.toBeNull()
      // The object reference is dropped only after the object itself is gone, so
      // a crash between the two leaves a findable path rather than an orphan.
      expect(erased.image_object_path).toBeNull()
      expect(erased.objects_purged_at).not.toBeNull()
      expect(storage.removed).toContain(post.objectPath)
    })

    it('6.1-INT-032 leaves the work re-drivable when storage refuses', async (context) => {
      if (!requireSchema(context)) return

      // The 72-hour deletion deadline is only meetable if a failed purge stays
      // claimable. Stamping `objects_purged_at` on a failure would mark the row
      // done while the object is still in the bucket, and nothing would ever
      // look at it again.
      const storage = new InMemoryCommunityStorage()
      const refusing = storageThatCannotRemove(storage)
      const maintenance = new CommunityMaintenanceService(prisma, refusing)
      const userId = await createUser('erasure-fail')

      const post = await createPost(storage, {
        id: postId('erasure-fail'),
        userId,
        status: 'published',
        publishedAt: new Date(),
        erasureRequestedAt: new Date(Date.now() - 60 * 60 * 1000),
      })

      await drainSweep(
        () => maintenance.sweepErasureRequests(new Date()),
        async () =>
          (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } }))
            .anonymized_at !== null
      )

      const row = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } })
      expect(row.objects_purged_at).toBeNull()
      expect(row.image_object_path).not.toBeNull()
      // Anonymization already happened and is not undone: the personal fields
      // are gone even though the object purge still has to be retried.
      expect(row.anonymized_at).not.toBeNull()
    })

    it('6.1-INT-033 counts a request past the 72-hour deadline as overdue', async (context) => {
      if (!requireSchema(context)) return

      const storage = new InMemoryCommunityStorage()
      const refusing = storageThatCannotRemove(storage)
      const maintenance = new CommunityMaintenanceService(prisma, refusing)
      const userId = await createUser('erasure-overdue')

      const post = await createPost(storage, {
        id: postId('erasure-overdue'),
        userId,
        status: 'published',
        publishedAt: new Date(),
        erasureRequestedAt: new Date(
          Date.now() - (ERASURE_DEADLINE_HOURS + 1) * 60 * 60 * 1000
        ),
      })

      let overdue = 0
      await drainSweep(
        async () => {
          overdue = (await maintenance.sweepErasureRequests(new Date())).overdue
        },
        async () =>
          (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } }))
            .anonymized_at !== null
      )

      expect(overdue).toBeGreaterThanOrEqual(1)
    })
  })

  describe('abandoned uploads', () => {
    it('6.1-INT-034 deletes an expired draft and its object', async (context) => {
      if (!requireSchema(context)) return

      const storage = new InMemoryCommunityStorage()
      const maintenance = new CommunityMaintenanceService(prisma, storage)
      const userId = await createUser('expired')

      const expired = await createPost(storage, {
        id: postId('expired'),
        userId,
        status: 'draft',
        publishedAt: null,
        submittedAt: null,
        uploadExpiresAt: new Date(Date.now() - 60 * 1000),
      })
      // A draft whose reservation has not lapsed yet is left alone; the sweep
      // must be bounded by the expiry column, not by the status alone.
      const live = await createPost(storage, {
        id: postId('unexpired'),
        userId,
        status: 'draft',
        publishedAt: null,
        submittedAt: null,
        uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })

      await drainSweep(
        () => maintenance.sweepExpiredUploads(new Date()),
        async () =>
          (await prisma.lookbookPost.findUnique({ where: { id: expired.id } })) === null
      )
      expect(storage.removed).toContain(expired.objectPath)

      expect(
        await prisma.lookbookPost.findUnique({ where: { id: expired.id } })
      ).toBeNull()
      expect(
        await prisma.lookbookPost.findUnique({ where: { id: live.id } })
      ).not.toBeNull()
    })
  })

  describe('stalled moderation', () => {
    it('6.1-INT-035 fails a stuck pending_review post closed and records an operator alert', async (context) => {
      if (!requireSchema(context)) return

      // "Fail closed, alert operations, and show author recovery state." A post
      // that has been pending longer than the stall window is not left in limbo:
      // it becomes terminal, and a JobFailure row exists for an operator to find
      // rather than a log line nobody greps for.
      const storage = new InMemoryCommunityStorage()
      const maintenance = new CommunityMaintenanceService(prisma, storage)
      const userId = await createUser('stalled')
      const stalledSince = new Date(
        Date.now() - (STALE_PENDING_REVIEW_MINUTES + 5) * 60 * 1000
      )

      const post = await createPost(storage, {
        id: postId('stalled'),
        userId,
        status: 'pending_review',
        publishedAt: null,
        submittedAt: stalledSince,
        createdAt: stalledSince,
        updatedAt: stalledSince,
      })

      await drainSweep(
        () => maintenance.sweepStalePendingReview(new Date()),
        async () =>
          (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } }))
            .status !== 'pending_review'
      )

      const failed = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: post.id },
      })
      expect(failed.status).toBe('review_failed')
      expect(failed.moderation_reason).toBe('moderation_stalled')

      const alert = await prisma.jobFailure.findFirstOrThrow({
        where: { job_id: `stalled__${post.id}` },
      })
      expect(alert.queue_name).toBe('community-moderation')
      expect(alert.error_message).toContain('Moderation stalled in pending_review since')
    })

    it('6.1-INT-036 leaves a freshly submitted post pending', async (context) => {
      if (!requireSchema(context)) return

      const storage = new InMemoryCommunityStorage()
      const maintenance = new CommunityMaintenanceService(prisma, storage)
      const userId = await createUser('fresh')

      const post = await createPost(storage, {
        id: postId('fresh'),
        userId,
        status: 'pending_review',
        publishedAt: null,
        submittedAt: new Date(),
      })

      await maintenance.sweepStalePendingReview(new Date())

      const row = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } })
      expect(row.status).toBe('pending_review')
    })
  })
})
