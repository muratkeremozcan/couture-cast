// Learning path Step 38: Community feed by climate band.
//
// Story 6.1: the two community write paths whose correctness is a CONCURRENCY
// property, exercised against real PostgreSQL with real parallel transactions.
//
// Neither of these can be proven anywhere else. `community.repository.spec.ts`
// mocks Prisma, so its "cap at ten" test is really a test of a counter; the cap
// only means something when two transactions race, and a mock has no
// transactions to race. The rolling 24-hour window is likewise not expressible
// as a database constraint -- a `(user_id, window_start)` unique key caps a
// FIXED bucket and would let twenty submissions through around a boundary,
// which is the exact scenario the spec's rate-limit matrix row names -- so the
// atomicity lives in `pg_advisory_xact_lock` inside `publishWithinQuota`, and
// this file is the only place that lock is actually put under load.
//
// That has a consequence worth stating before anyone debugs a red run here: a
// failure of the parallel test is an API defect, not flake. It must not be
// retried, serialised, or given a bigger timeout. If the eleventh submission
// gets through, the lock is missing or the count moved outside it.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import {
  CommunityRepository,
  SUBMISSION_WINDOW_HOURS,
} from '../src/modules/community/community.repository.js'
import {
  DAILY_REPORT_CAP,
  REPORT_SLA_HOURS,
} from '../src/modules/community/community.service.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const repository = new CommunityRepository(prisma)

/** The cap the spec fixes at ten accepted submissions per rolling 24 hours. */
const CAP = 10

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "LookbookPost" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "CommunityPostReport" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "CommunityModerationOutbox" LIMIT 1`
    schemaReady = true
  } catch (error) {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[community-submission-limits] Skipped: could not query the Story 6.1 community schema. ' +
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

const namespace = `community-limits-${randomUUID().slice(0, 8)}`

async function createUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${namespace}-${label}-${randomUUID().slice(0, 8)}@synthetic.test` },
  })
  return user.id
}

/**
 * A draft the author may still publish. `publishWithinQuota` only moves rows
 * that are exactly `draft`, so every fixture here starts there with no
 * publication or submission clock set.
 */
async function createDraft(userId: string): Promise<string> {
  const fixture = createLookbookPost({
    id: `draft-${randomUUID()}`,
    userId,
    status: 'draft',
    publishedAt: null,
    submittedAt: null,
    altTextConfirmedAt: null,
  })
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(fixture),
  })
  return post.id
}

/**
 * A submission already counted against the window. `submitted_at` is what the
 * cap counts, deliberately not `created_at`: a replayed allocate reuses the same
 * row, and charging a retry against the cap would be a bug the fixture must not
 * paper over.
 */
async function createAcceptedSubmission(
  userId: string,
  submittedAt: Date
): Promise<void> {
  const fixture = createLookbookPost({
    id: `accepted-${randomUUID()}`,
    userId,
    status: 'pending_review',
    publishedAt: null,
    submittedAt,
    createdAt: submittedAt,
    updatedAt: submittedAt,
  })
  await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
}

async function publishAPublishedPost(userId: string): Promise<string> {
  const publishedAt = new Date()
  const fixture = createLookbookPost({
    id: `published-${randomUUID()}`,
    userId,
    status: 'published',
    publishedAt,
    submittedAt: publishedAt,
  })
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(fixture),
  })
  return post.id
}

const PUBLISH_DATA = {
  altText: 'Layered outfit photographed against a plain wall',
  caption: null,
  climateBand: 'temperate_dry' as const,
  locale: 'en-US',
  challengeId: null,
}

beforeAll(async () => {
  await probeSchema()
})

afterAll(async () => {
  if (schemaReady) {
    // Reverse dependency order. ModerationEvent and CommunityPostReport hold
    // ON DELETE SET NULL keys onto the post, so deleting the post first would
    // orphan them rather than remove them.
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

describe('6.1 community submission and report limits', () => {
  describe('rolling 24-hour submission cap', () => {
    it('6.1-INT-010 accepts the tenth submission and rate limits the eleventh', async (context) => {
      if (!requireSchema(context)) return

      const userId = await createUser('cap')
      for (let index = 0; index < CAP - 1; index += 1) {
        await createAcceptedSubmission(userId, new Date())
      }

      const tenth = await repository.publishWithinQuota({
        userId,
        postId: await createDraft(userId),
        cap: CAP,
        data: PUBLISH_DATA,
      })
      expect(tenth.kind).toBe('published')

      const eleventh = await repository.publishWithinQuota({
        userId,
        postId: await createDraft(userId),
        cap: CAP,
        data: PUBLISH_DATA,
      })
      expect(eleventh.kind).toBe('rate_limited')
      if (eleventh.kind === 'rate_limited') {
        // The caller turns this into the 429's Retry-After, so it has to be a
        // real remaining-window figure rather than a constant.
        expect(eleventh.retryAfterSeconds).toBeGreaterThan(0)
        expect(eleventh.retryAfterSeconds).toBeLessThanOrEqual(
          SUBMISSION_WINDOW_HOURS * 60 * 60
        )
      }
    })

    it('6.1-INT-011 admits exactly ten of twelve genuinely parallel submissions', async (context) => {
      if (!requireSchema(context)) return

      // THE test this file exists for. Twelve transactions race the same user's
      // quota at once; the count-then-update is only atomic because
      // `publishWithinQuota` takes `pg_advisory_xact_lock` on the user first.
      // Without it every transaction reads the same pre-insert count and all
      // twelve are admitted.
      const userId = await createUser('parallel')
      const drafts = await Promise.all(
        Array.from({ length: 12 }, () => createDraft(userId))
      )

      const results = await Promise.all(
        drafts.map((postId) =>
          repository.publishWithinQuota({ userId, postId, cap: CAP, data: PUBLISH_DATA })
        )
      )

      const published = results.filter((result) => result.kind === 'published')
      const rateLimited = results.filter((result) => result.kind === 'rate_limited')

      expect(published).toHaveLength(CAP)
      expect(rateLimited).toHaveLength(2)

      // And the database agrees with the return values, which is the half a
      // unit test cannot check: exactly ten rows actually left `draft`.
      const accepted = await prisma.lookbookPost.count({
        where: { user_id: userId, submitted_at: { not: null } },
      })
      expect(accepted).toBe(CAP)
    })

    it('6.1-INT-019 counts only the in-window half when twelve race across the boundary', async (context) => {
      if (!requireSchema(context)) return

      // The matrix row is "parallel submissions around the rolling 24-hour
      // boundary", and it is two properties at once. 6.1-INT-011 races entirely
      // inside the window; 6.1-INT-012 straddles the boundary sequentially.
      // Neither covers the combination, which is where a real cap fails: the
      // window edge is evaluated independently inside each locked transaction,
      // so a fixed-bucket implementation, or one that computed `windowStart`
      // once outside the lock, admits the wrong number here and nowhere else.
      const userId = await createUser('boundary')
      const windowMs = SUBMISSION_WINDOW_HOURS * 60 * 60 * 1000

      // Five inside the window by a minute, five outside it by a minute.
      for (let index = 0; index < 5; index += 1) {
        await createAcceptedSubmission(userId, new Date(Date.now() - windowMs + 60_000))
        await createAcceptedSubmission(userId, new Date(Date.now() - windowMs - 60_000))
      }

      const drafts = await Promise.all(
        Array.from({ length: 12 }, () => createDraft(userId))
      )
      const results = await Promise.all(
        drafts.map((postId) =>
          repository.publishWithinQuota({ userId, postId, cap: CAP, data: PUBLISH_DATA })
        )
      )

      // Five of the ten pre-existing submissions count, so five slots remain.
      const published = results.filter((result) => result.kind === 'published')
      const rateLimited = results.filter((result) => result.kind === 'rate_limited')
      expect(published).toHaveLength(5)
      expect(rateLimited).toHaveLength(7)

      const inWindow = await prisma.lookbookPost.count({
        where: {
          user_id: userId,
          submitted_at: { gt: new Date(Date.now() - windowMs) },
        },
      })
      expect(inWindow).toBe(CAP)
    })

    it('6.1-INT-012 ignores submissions that fell out of the rolling window', async (context) => {
      if (!requireSchema(context)) return

      // A fixed-bucket quota table would have counted these; a rolling window
      // must not. Twenty-five hours ago is outside `(now-24h, now]`.
      const userId = await createUser('window')
      const outside = new Date(
        Date.now() - (SUBMISSION_WINDOW_HOURS + 1) * 60 * 60 * 1000
      )
      for (let index = 0; index < CAP; index += 1) {
        await createAcceptedSubmission(userId, outside)
      }

      const result = await repository.publishWithinQuota({
        userId,
        postId: await createDraft(userId),
        cap: CAP,
        data: PUBLISH_DATA,
      })

      expect(result.kind).toBe('published')
    })

    it('6.1-INT-013 writes the moderation outbox row in the same transaction as the publish', async (context) => {
      if (!requireSchema(context)) return

      // The transactional outbox: the row that tells the worker to screen this
      // post is written by the same transaction that moves the post out of
      // `draft`. If it were a second write, a crash between them would leave a
      // post stuck in `pending_review` that nothing is ever going to screen.
      const userId = await createUser('outbox')
      const postId = await createDraft(userId)

      const result = await repository.publishWithinQuota({
        userId,
        postId,
        cap: CAP,
        data: PUBLISH_DATA,
      })
      expect(result.kind).toBe('published')

      const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      expect(post.status).toBe('pending_review')
      expect(post.submitted_at).not.toBeNull()
      // Confirmation is stamped by the same statement, so a published row can
      // never carry unconfirmed alt text.
      expect(post.alt_text_confirmed_at).not.toBeNull()
      expect(post.alt_text).toBe(PUBLISH_DATA.altText)

      const outbox = await prisma.communityModerationOutbox.findUnique({
        where: { post_id: postId },
      })
      expect(outbox).not.toBeNull()
      expect(outbox?.dispatched_at).toBeNull()
    })

    it('6.1-INT-014 refuses to publish a row that is no longer a draft', async (context) => {
      if (!requireSchema(context)) return

      const userId = await createUser('not-draft')
      const postId = await publishAPublishedPost(userId)

      const result = await repository.publishWithinQuota({
        userId,
        postId,
        cap: CAP,
        data: PUBLISH_DATA,
      })

      expect(result.kind).toBe('not_draft')
    })
  })

  describe('report insert from a visible row', () => {
    const reportParams = (postId: string, reporterId: string, reason = 'harassment') => ({
      postId,
      reporterId,
      reason: reason as 'harassment' | 'spam',
      abuseLimit: DAILY_REPORT_CAP,
      slaHours: REPORT_SLA_HOURS,
      subjectAlias: 'Style Explorer ABCD1234',
    })

    it('6.1-INT-015 creates exactly one row when two identical reports race', async (context) => {
      if (!requireSchema(context)) return

      // The matrix's "duplicate request" case, run as an actual race rather than
      // sequentially. `recordReport` locks the reporter and then takes
      // `SELECT ... FOR UPDATE` on the post, so one call creates and the other
      // observes the existing row; the UNIQUE (post_id, reporter_id) index is
      // the backstop if both somehow reach the insert.
      const authorId = await createUser('report-author')
      const reporterId = await createUser('reporter')
      const postId = await publishAPublishedPost(authorId)

      const [first, second] = await Promise.all([
        repository.recordReport(reportParams(postId, reporterId)),
        repository.recordReport(reportParams(postId, reporterId)),
      ])

      const kinds = [first.kind, second.kind].sort()
      expect(kinds).toEqual(['created', 'replayed'])

      const rows = await prisma.communityPostReport.count({
        where: { post_id: postId, reporter_id: reporterId },
      })
      expect(rows).toBe(1)
    })

    it('6.1-INT-016 persists the snapshot and the SLA clock on the created report', async (context) => {
      if (!requireSchema(context)) return

      const authorId = await createUser('report-sla-author')
      const reporterId = await createUser('report-sla-reporter')
      const postId = await publishAPublishedPost(authorId)
      const before = Date.now()

      const result = await repository.recordReport(reportParams(postId, reporterId))
      expect(result.kind).toBe('created')

      const report = await prisma.communityPostReport.findFirstOrThrow({
        where: { post_id: postId, reporter_id: reporterId },
      })
      // The alias and the object path are what keep this row actionable after
      // the author erases their account and `post_id` becomes NULL.
      expect(report.subject_alias).toBe('Style Explorer ABCD1234')
      expect(report.sla_due_at.getTime()).toBeGreaterThanOrEqual(
        before + REPORT_SLA_HOURS * 60 * 60 * 1000 - 5_000
      )
      expect(report.resolved_at).toBeNull()

      // An append-only moderation entry accompanies it. The UNIQUE that used to
      // sit on ModerationEvent capped this at one row per actor per post.
      const events = await prisma.moderationEvent.count({
        where: { post_id: postId, flagged_by_id: reporterId },
      })
      expect(events).toBe(1)
    })

    it('6.1-INT-017 rejects a second report that changes the reason', async (context) => {
      if (!requireSchema(context)) return

      const authorId = await createUser('reason-author')
      const reporterId = await createUser('reason-reporter')
      const postId = await publishAPublishedPost(authorId)

      await repository.recordReport(reportParams(postId, reporterId, 'harassment'))
      const changed = await repository.recordReport(
        reportParams(postId, reporterId, 'spam')
      )

      expect(changed.kind).toBe('reason_changed')
      if (changed.kind === 'reason_changed') {
        expect(changed.existingReason).toBe('harassment')
      }
    })

    it('6.1-INT-018 refuses a self-report and an invisible post', async (context) => {
      if (!requireSchema(context)) return

      const authorId = await createUser('self-report')
      const publishedId = await publishAPublishedPost(authorId)
      const selfReport = await repository.recordReport(
        reportParams(publishedId, authorId)
      )
      expect(selfReport.kind).toBe('self_report')

      // A draft is not visible, so there is nothing to report. The visibility
      // check reads the row FOR UPDATE inside the transaction rather than
      // trusting a value the caller passed in, which is what closes the
      // matrix's "visibility race" case.
      const otherAuthorId = await createUser('invisible-author')
      const reporterId = await createUser('invisible-reporter')
      const draftId = await createDraft(otherAuthorId)
      const invisible = await repository.recordReport(reportParams(draftId, reporterId))
      expect(invisible.kind).toBe('post_not_visible')
    })
  })
})
