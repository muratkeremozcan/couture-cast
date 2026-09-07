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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
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

/**
 * Every published fixture in this suite is stamped here rather than at `new
 * Date()`, and the date is deliberately older than the seeded feed's
 * `2026-01-01`.
 *
 * A run of this suite that does not reach its teardown leaves published rows
 * behind, and stamped with the current time those rows LEAD the public feed.
 * That is what broke `maestro/community-feed.yaml`, which opens on
 * `extendedWaitUntil: visible: community-post-card-lookbook-5` on the premise
 * that the newest seeded post leads: two newer cards above it push it off a
 * phone viewport and the flow fails as though the feature were broken. Residue
 * is still a defect and `reapPreviousRuns` below is the actual fix; this is the
 * second line, so residue can never again disguise itself as a broken flow.
 *
 * Nothing in this suite asserts on feed ORDER, only on presence and status, so
 * a fixed timestamp costs the tests nothing.
 */
const FIXTURE_PUBLISHED_AT = new Date('2025-06-01T00:00:00.000Z')

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

/**
 * The prefix every account this suite creates shares, across every run.
 *
 * `namespace` carries a per-run UUID so one run's teardown cannot touch another
 * run's rows while it is in flight. This is the wider prefix, used only to reap
 * what a run that never finished left behind.
 */
const SUITE_ACCOUNT_PREFIX = 'community-lifecycle-'

/**
 * Removes residue from PREVIOUS runs of this suite.
 *
 * `afterAll` is the primary cleanup and it is correct, but it only runs if the
 * process reaches it. A run that is killed, times out, or dies on an
 * unrecoverable error leaves its accounts and posts behind for good, and because
 * nothing ever looked for them again they accumulated silently: a measurement of
 * the development feed found ten orphaned rows from a single interrupted run,
 * two of them `published` and leading the public feed.
 *
 * Reaping at the START rather than only at the end is what makes the suite
 * self-healing. Teardown cannot fix a run that already died; the next run can.
 *
 * SCOPED TO THIS SUITE'S OWN ACCOUNTS AND NOTHING ELSE. The filter is a join
 * onto `User.email` under the reserved `@synthetic.test` domain with this
 * suite's prefix, so it cannot reach a seeded account, a real one, or another
 * suite's fixtures, and there is no second naming scheme to keep in step.
 *
 * A user carrying an `AuditLog` row is deliberately left standing. That table
 * refuses DELETE by trigger because it is the immutable consent and moderation
 * record, so the row pins its owner permanently; deleting the posts and aliases
 * still removes everything that can affect a feed or a flow.
 */
async function reapPreviousRuns(): Promise<void> {
  const stale = await prisma.user.findMany({
    where: {
      email: { startsWith: SUITE_ACCOUNT_PREFIX, endsWith: '@synthetic.test' },
      NOT: { email: { startsWith: namespace } },
    },
    select: { id: true },
  })
  if (stale.length === 0) return

  const userIds = stale.map((user) => user.id)
  const posts = await prisma.lookbookPost.findMany({
    where: { user_id: { in: userIds } },
    select: { id: true },
  })
  const postIds = posts.map((post) => post.id)

  await prisma.moderationEvent.deleteMany({ where: { post_id: { in: postIds } } })
  await prisma.communityPostReport.deleteMany({ where: { post_id: { in: postIds } } })
  await prisma.lookbookPost.deleteMany({ where: { id: { in: postIds } } })
  await prisma.communityAlias.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.guardianConsent.deleteMany({
    where: {
      OR: [{ teen_id: { in: userIds } }, { guardian_id: { in: userIds } }],
    },
  })

  const pinned = await prisma.auditLog.findMany({
    where: { user_id: { in: userIds } },
    select: { user_id: true },
    distinct: ['user_id'],
  })
  const pinnedIds = new Set(pinned.map((row) => row.user_id))
  await prisma.user.deleteMany({
    where: { id: { in: userIds.filter((id) => !pinnedIds.has(id)) } },
  })
}

beforeAll(async () => {
  await probeSchema()
  if (schemaReady) {
    await reapPreviousRuns()
  }
})

afterAll(async () => {
  if (schemaReady) {
    const owned = { user: { email: { startsWith: namespace } } }
    await prisma.jobFailure.deleteMany({ where: { job_id: { contains: namespace } } })
    // Consent rows hold a foreign key onto `User`, so they go before the users
    // do or the delete below fails on the constraint. `AuditLog` deliberately
    // has no cleanup: a trigger refuses DELETE on it because those rows are the
    // immutable consent and moderation record.
    //
    // THIS COMMENT USED TO CLAIM NO AUDIT ROWS ACCUMULATE, on the grounds that
    // 6.1-INT-090 rolls its transaction back. That was measured and found false:
    // a `consent_revoked` row was committed by this suite and is on the
    // development database now. An audit row pins its user permanently, so
    // `user.deleteMany` below silently leaves that account standing. Everything
    // that can affect a feed or a flow -- posts, aliases, consents -- is removed
    // regardless, and `reapPreviousRuns` skips pinned users for the same reason.
    await prisma.guardianConsent.deleteMany({
      where: { teen: { email: { startsWith: namespace } } },
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
      const publishedAt = FIXTURE_PUBLISHED_AT

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

      // READ FROM A CURSOR ANCHORED ON THIS SPEC'S OWN FIXTURES, not from the
      // head of the global feed.
      //
      // `community-feed-query-plan.integration.spec.ts` inserts 2000 posts in
      // its `beforeAll`, cycling all six bands with half of them `published` and
      // `published_at` spread across the preceding 2000 minutes. These fixtures
      // publish at `FIXTURE_PUBLISHED_AT`, over a year earlier, and the feed
      // orders `published_at DESC`. So whenever Vitest happens to run that file
      // alongside this one, several hundred fresher `cold_wet` rows fill the
      // page and this assertion fails on a post that is present and correct.
      //
      // The cursor filters `published_at < cursor.publishedAt`, so anchoring one
      // millisecond after the fixture timestamp puts these two rows at the head
      // of their own page and excludes every newer row, whoever wrote it. The
      // production keyset path is still what runs; only the window moves.
      const feed = await repository.findPublishedFeedPosts({
        filterBand: 'cold_wet',
        limit: 50,
        mode: 'cold_wet',
        cursor: {
          publishedAt: new Date(FIXTURE_PUBLISHED_AT.getTime() + 1).toISOString(),
          id: live.id,
          mode: 'cold_wet',
          band: 'cold_wet',
        },
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
        publishedAt: FIXTURE_PUBLISHED_AT,
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
        publishedAt: FIXTURE_PUBLISHED_AT,
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
        publishedAt: FIXTURE_PUBLISHED_AT,
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

  describe('consent revocation and post hiding commit together', () => {
    /*
     * `guardian.service.ts` moves a teen's published posts to
     * `consent_suspended` INSIDE the transaction that revokes the consent, and
     * its comment says so: "hidden in the same transaction that revokes the
     * consent." That co-transaction is the entire claim. Either both land or
     * neither does, because the two halves failing apart are both wrong in a way
     * a user notices -- consent revoked with the post still public, or a post
     * hidden on a revocation that never committed and which the guardian would
     * therefore have to perform again.
     *
     * `guardian.service.spec.ts` cannot see this. Its `$transaction` is a mock
     * that invokes the callback, so it proves the call was made inside something
     * called a transaction, not that the two writes share a fate. Only a real
     * PostgreSQL transaction that actually rolls back can show that, which is
     * what this does: the work runs on a real `tx`, then the transaction throws
     * before commit.
     *
     * The mutation this is built to catch: change that `tx.lookbookPost` to
     * `this.prisma.lookbookPost`. It is a one-word diff, it reads as harmless,
     * every unit test stays green, and the hide then commits on its own
     * connection and survives the rollback.
     */
    async function seedConsentedTeenWithPublishedPost(
      storage: InMemoryCommunityStorage
    ): Promise<{ guardianId: string; teenId: string; postIdValue: string }> {
      const guardianId = await createUser('guardian')
      const teenId = await createUser('teen')

      await prisma.guardianConsent.create({
        data: {
          guardian_id: guardianId,
          teen_id: teenId,
          status: 'granted',
          consent_level: 'full_access',
          revoked_at: null,
        },
      })

      const post = await createPost(storage, {
        id: postId('consent-tx'),
        userId: teenId,
        status: 'published',
        publishedAt: FIXTURE_PUBLISHED_AT,
      })

      return { guardianId, teenId, postIdValue: post.id }
    }

    /**
     * A `GuardianService` whose `$transaction` runs the real thing, reads the
     * two rows back THROUGH THE SAME `tx` while it is still open, and then
     * throws so PostgreSQL genuinely rolls the whole thing back.
     *
     * Observing from inside is what makes one test do the work of two. A
     * rollback assertion on its own is satisfied perfectly by a service that
     * never wrote the hide at all, so the in-transaction reading is the half
     * that says the write HAPPENS, and the post-rollback reading is the half
     * that says it is BOUND to the transaction. Splitting them into two tests
     * would need the second one to commit, and a committed revocation writes an
     * immutable `AuditLog` row that teardown is forbidden to delete and that
     * pins its user row forever.
     *
     * The throw is deliberately not a serialization failure: `revokeConsent`
     * retries those three times, and a retryable error would run the body
     * repeatedly and muddy what the assertions read.
     */
    function serviceThatRollsBack(observed: {
      postStatus?: string
      consentStatus?: string
    }): GuardianService {
      const rollingBack = new Proxy(prisma, {
        get(target, property, receiver) {
          if (property === '$transaction') {
            return (callback: (tx: PrismaClient) => Promise<unknown>) =>
              target.$transaction(async (tx) => {
                await callback(tx as unknown as PrismaClient)

                const post = await (tx as unknown as PrismaClient).lookbookPost.findFirst(
                  { where: { id: { startsWith: `${namespace}-consent-tx` } } }
                )
                const consent = await (
                  tx as unknown as PrismaClient
                ).guardianConsent.findFirst({
                  where: { teen: { email: { startsWith: namespace } } },
                })
                observed.postStatus = post?.status
                observed.consentStatus = consent?.status

                throw new Error('forced rollback after the transaction body ran')
              })
          }
          return Reflect.get(target, property, receiver) as unknown
        },
      })

      return new GuardianService(
        { capture: vi.fn() } as never,
        rollingBack,
        { invalidateConsentState: vi.fn().mockResolvedValue(undefined) } as never,
        { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
      )
    }

    it('6.1-INT-090 hides a teen post inside the revoking transaction, and not outside it', async (context) => {
      if (!requireSchema(context)) return

      const storage = new InMemoryCommunityStorage()
      const { guardianId, teenId, postIdValue } =
        await seedConsentedTeenWithPublishedPost(storage)
      const observed: { postStatus?: string; consentStatus?: string } = {}

      await expect(
        serviceThatRollsBack(observed).revokeConsent(guardianId, teenId)
      ).rejects.toThrow('forced rollback')

      // INSIDE: both writes happened, on the same transaction, before the throw.
      // If this is still `published` the service never wrote the hide and the
      // rollback assertion below would pass for the wrong reason.
      expect(observed.postStatus).toBe('consent_suspended')
      expect(observed.consentStatus).toBe('revoked')

      // OUTSIDE: neither survived. A `consent_suspended` here means the hide
      // committed on its own connection, so a teen's content is hidden on the
      // strength of a revocation the database never accepted, and the guardian
      // would have to perform the revocation again to make the record agree.
      const post = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postIdValue },
      })
      expect(post.status).toBe('published')

      const consent = await prisma.guardianConsent.findFirstOrThrow({
        where: { guardian_id: guardianId, teen_id: teenId },
      })
      expect(consent.status).toBe('granted')
      expect(consent.revoked_at).toBeNull()
    })
  })
})
