// Story 6.1 maintenance owner: own the expiry and retention sweeps in `apps/api/src/modules/community/community-maintenance.service.ts` and their schedule in `community-maintenance.scheduler.ts`
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { returnBanHoldsToScreening } from './community-ban-holds.js'
import { eraseCommunityComments } from './community-comments.privacy.js'
import {
  assertReportedCasesUnchanged,
  lockReportedCases,
  lockCommunitySanctions,
  memberIdentityRemains,
  removeMemberFromModerationRecords,
} from './community-erasure.js'
import {
  communityPrivacyTransaction,
  guardCommunityPost,
  guardCommunitySubject,
} from './community-privacy.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import {
  SupabaseCommunityStorageAdapter,
  type CommunityStorage,
} from './community-storage.adapter.js'
import { COMMUNITY_MODERATION_QUEUE } from './community-moderation.queue.js'

/**
 * How long a post may sit in `pending_review` before the sweep calls it stalled.
 *
 * The worker only reaches `markFailed` from its own catch block, so a job that
 * hangs — a download that never resolves, a process killed mid-screening, a job
 * lost from Redis — leaves the post in `pending_review` forever with no author
 * recovery state and no operator signal. Fifteen minutes is three dispatch
 * cycles plus the moderation queue's five-minute alert SLA.
 */
export const STALE_PENDING_REVIEW_MINUTES = 15
/** The reason the stale-review sweep persists on a post it fails. */
export const MODERATION_STALLED_REASON = 'moderation_stalled'

/**
 * The deadline the spec puts on erasure: "deletion completes within 72 hours".
 * A request still unpurged past this is an operator problem, not a queue delay.
 */
export const ERASURE_DEADLINE_HOURS = 72

/**
 * How long erasure keeps deleting after a request. Storage refuses a write that starts more than
 * 2 hours later (`COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS`), and no measured limit proves when a write
 * already running ends, so this runs as far as the 72-hour deadline allows and leaves 2 hours for a
 * failed final delete to retry. It runs from the request, so a late first delete never pushes it out.
 */
export const COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS = 70 * 60 * 60 * 1000

/** How often a row inside the window has its object deleted again. The sweep runs far more often. */
const ERASURE_REPEAT_DELETE_MS = 15 * 60 * 1000

const MAX_SWEEP_BATCH = 200

/**
 * The sweep's clock at a later moment, to the whole minute. Deletes run one at a time, so a slow one
 * must not backdate the attempts after it to when the sweep began. Whole minutes keep a batch's first
 * minute on the cron's tick: a stamp seconds past the tick, from a slow batch or a job that starts a
 * little late, would miss the next pass by those seconds and wait a whole extra cycle. So a repeat can
 * run up to a minute under the pace.
 */
function sweepClock(now: Date): () => Date {
  const startedAt = Date.now()
  return () => {
    const settled = now.getTime() + Date.now() - startedAt
    return new Date(settled - (settled % 60_000))
  }
}

/** The delete pace, shared with the erasure queue: an abandoned draft's retry waits for it too. */
const deleteIsDue = (now: Date): Prisma.LookbookPostWhereInput => ({
  OR: [
    { image_delete_attempted_at: null },
    {
      image_delete_attempted_at: {
        lte: new Date(now.getTime() - ERASURE_REPEAT_DELETE_MS),
      },
    },
  ],
})

const OPEN_ERASURE = {
  erasure_requested_at: { not: null },
  objects_purged_at: null,
} satisfies Prisma.LookbookPostWhereInput

interface ErasureWork {
  id: string
  status: string
  image_object_path: string | null
  anonymized_at: Date | null
  erasure_requested_at: Date | null
}

export interface CommunityStaleReviewSweepResult {
  stalled: number
}

export interface CommunityUploadExpirySweepResult {
  objectsDeleted: number
  draftsDeleted: number
}

export interface CommunityBanExpirySweepResult {
  subjects: number
  posts: number
  comments: number
}

export interface CommunityErasureSweepResult {
  hidden: number
  anonymized: number
  objectsPurged: number
  overdue: number
  /** Story 6.13: account erasure requests finished by this pass. */
  requestsCompleted: number
  /** Story 6.13: account erasure requests still open past the 72-hour deadline. */
  requestsOverdue: number
}

/**
 * The periodic community sweeps. Each one exists because a state transition in
 * this module can otherwise stop halfway and stay that way silently.
 */
@Injectable()
export class CommunityMaintenanceService {
  private readonly logger = createBaseLogger().child({ feature: 'community-maintenance' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(SupabaseCommunityStorageAdapter)
    private readonly storage: CommunityStorage
  ) {}

  /**
   * Returns what ended bans held to screening (Story 6.11, CR-2): a temporary ban that expired, or
   * an overturn whose access check refused at the time. A ban ends by the clock with no request to
   * hang off, so only a sweep can reach it. A member with an active ban stays out
   * until that ban ends, when every older marker releases with it. One transaction per subject, so
   * one bad subject cannot block the rest, and a failure still fails the job so an operator sees it.
   */
  async sweepExpiredBanHolds(
    now: Date = new Date()
  ): Promise<CommunityBanExpirySweepResult> {
    const subjects = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT s.user_id
      FROM "CommunitySanction" s
      WHERE s.holds_released_at IS NULL
        AND (s.expires_at <= ${now} OR s.lifted_at IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM "CommunitySanction" a
          WHERE a.user_id = s.user_id
            AND a.lifted_at IS NULL
            AND (a.expires_at IS NULL OR a.expires_at > ${now})
        )
      GROUP BY s.user_id
      ORDER BY MIN(s.expires_at)
      LIMIT ${MAX_SWEEP_BATCH}
    `
    const result: CommunityBanExpirySweepResult = { subjects: 0, posts: 0, comments: 0 }
    let failed = 0
    for (const { user_id: subjectId } of subjects) {
      try {
        const moved = await communityPrivacyTransaction(this.prisma, (tx) =>
          this.releaseSubjectBanHolds(tx, subjectId, now)
        )
        if (moved.posts + moved.comments > 0) result.subjects += 1
        result.posts += moved.posts
        result.comments += moved.comments
      } catch (error) {
        failed += 1
        this.logger.error(
          {
            event: 'community_ban_expiry_release_failed',
            error: error instanceof Error ? error.name : 'unknown',
          },
          'Ban hold release failed for one subject'
        )
      }
    }
    if (failed > 0) throw new Error(`Ban hold release failed for ${failed} subject(s)`)
    return result
  }

  private async releaseSubjectBanHolds(
    tx: Prisma.TransactionClient,
    subjectId: string,
    now: Date
  ): Promise<{ posts: number; comments: number }> {
    // The same lock a new ban takes, so a ban and this release cannot interleave.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_sanction:' || ${subjectId}))`
    await guardCommunitySubject(tx, subjectId)
    const active = await tx.communitySanction.findFirst({
      where: {
        user_id: subjectId,
        lifted_at: null,
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
      },
      select: { id: true },
    })
    if (active) return { posts: 0, comments: 0 }
    const ended = await tx.communitySanction.findMany({
      where: {
        user_id: subjectId,
        holds_released_at: null,
        OR: [{ expires_at: { lte: now } }, { lifted_at: { not: null } }],
      },
      select: { id: true },
    })
    const ids = ended.map((sanction) => sanction.id)
    if (ids.length === 0) return { posts: 0, comments: 0 }
    const moved = await returnBanHoldsToScreening(tx, subjectId, ids, now)
    await tx.communitySanction.updateMany({
      where: { id: { in: ids } },
      data: { holds_released_at: now },
    })
    return moved
  }

  /**
   * Moves posts stuck in `pending_review` past the stall deadline to
   * `review_failed`, and records one durable operator row per post.
   *
   * The operator record is a `JobFailure` row on the moderation queue, which is
   * this repository's existing dead-letter surface: `AdminService.listFailedJobs`
   * lists it and `pruneFailedJobs` ages it out. Writing the alert anywhere else
   * would invent a second operator inbox for the same class of problem.
   * `retryFailedJob` does not re-screen the post: the post is `review_failed` by
   * then, and the processor skips any post not in `pending_review` (Story 6.2b
   * review, RF14; recorded in deferred work).
   */
  async sweepStalePendingReview(
    now: Date = new Date()
  ): Promise<CommunityStaleReviewSweepResult> {
    const deadline = new Date(now.getTime() - STALE_PENDING_REVIEW_MINUTES * 60 * 1000)

    const stalled = await this.prisma.lookbookPost.findMany({
      where: { status: 'pending_review', updated_at: { lt: deadline } },
      orderBy: { updated_at: 'asc' },
      take: MAX_SWEEP_BATCH,
      select: { id: true, image_object_path: true, updated_at: true },
    })

    let transitioned = 0
    for (const post of stalled) {
      const updated = await this.prisma.lookbookPost.updateMany({
        // On the selected clock too: recovery can return this post to `pending_review` after the
        // select above, and its fresh clock is what says that work has not stalled.
        where: { id: post.id, status: 'pending_review', updated_at: post.updated_at },
        data: {
          status: 'review_failed',
          moderation_reason: MODERATION_STALLED_REASON,
        },
      })
      if (updated.count !== 1) {
        continue
      }
      transitioned += 1

      await this.recordStallAlert(post.id, post.updated_at)
    }

    if (transitioned > 0) {
      this.logger.warn(
        {
          event: 'community_moderation_stalled',
          count: transitioned,
          stallMinutes: STALE_PENDING_REVIEW_MINUTES,
        },
        'Community posts stalled in pending_review were moved to review_failed'
      )
    }

    return { stalled: transitioned }
  }

  private async recordStallAlert(postId: string, pendingSince: Date): Promise<void> {
    await this.prisma.jobFailure
      .create({
        data: {
          queue_name: COMMUNITY_MODERATION_QUEUE,
          job_id: `stalled__${postId}`,
          job_data: { postId, uploadSessionId: postId },
          error_message: `Moderation stalled in pending_review since ${pendingSince.toISOString()}`,
          attempts: 0,
        },
      })
      .catch((error: unknown) => {
        this.logger.error(
          {
            postId,
            event: 'community_moderation_stall_alert_failed',
            error: error instanceof Error ? error.message : 'unknown error',
          },
          'Failed to record stalled moderation alert'
        )
      })
  }

  /**
   * Completes account erasure for community content within the 72-hour window.
   *
   * The order is the story's, not an implementation convenience: HIDE the post
   * before touching its object, because a signed URL already handed out keeps
   * working until it expires and the row is what the feed and the single-post
   * endpoint consult. Anonymization and object purge each get their own
   * timestamp so a sweep interrupted halfway re-drives only the step that did
   * not finish.
   *
   * The moderation audit is deliberately left standing: the fact survives, the
   * person does not. A post's own withdrawal keeps its evidence whole, because
   * retracting a reported post must not destroy it. Account erasure (Story 6.13)
   * goes further: the request transaction strips the user's words from the
   * snapshots, and `settleAccountErasures` here deletes the post rows once purged.
   *
   * A worker lost mid-upload can recreate the object after a delete, with no owner left to remove
   * it. So the row keeps its path and stays open until the late-write window has passed: the object
   * is deleted again on the way, and once more past the window before `objects_purged_at` is
   * stamped. Anonymization has already closed every read of that path.
   */
  async sweepErasureRequests(
    now: Date = new Date()
  ): Promise<CommunityErasureSweepResult> {
    const settledAt = sweepClock(now)
    const pending = await this.selectErasureWork(now)

    const result: CommunityErasureSweepResult = {
      hidden: 0,
      anonymized: 0,
      objectsPurged: 0,
      overdue: 0,
      requestsCompleted: 0,
      requestsOverdue: 0,
    }

    for (const post of pending) {
      const metadata = await this.eraseMetadata(post.id, now)
      if (!metadata) continue
      result.hidden += metadata.hidden
      result.anonymized += metadata.anonymized

      if (metadata.image_object_path) {
        try {
          await this.storage.remove([metadata.image_object_path])
        } catch (error: unknown) {
          // Leave `objects_purged_at` unset so the next sweep retries. Stamping
          // it here would record a deletion that never happened.
          this.logger.error(
            {
              event: 'community_erasure_object_delete_failed',
              postId: post.id,
              error: error instanceof Error ? error.message : 'unknown error',
            },
            'Failed to purge community object during erasure; will retry'
          )
          await this.recordDeleteAttempts([post.id], settledAt())
          continue
        }
        await this.recordDeleteAttempts([post.id], settledAt())
      }

      if (
        metadata.image_object_path &&
        post.erasure_requested_at &&
        now.getTime() <
          post.erasure_requested_at.getTime() + COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS
      )
        continue

      const purged = await communityPrivacyTransaction(this.prisma, async (tx) => {
        await guardCommunityPost(tx, post.id)
        return tx.lookbookPost.updateMany({
          where: {
            id: post.id,
            image_object_path: metadata.image_object_path,
            erasure_requested_at: { not: null },
            objects_purged_at: null,
          },
          data: { image_object_path: null, objects_purged_at: now },
        })
      })
      result.objectsPurged += purged.count
    }

    // Over every open row, because a row this pass never selected is overdue too.
    result.overdue = await this.prisma.lookbookPost.count({
      where: {
        ...OPEN_ERASURE,
        erasure_requested_at: {
          lt: new Date(now.getTime() - ERASURE_DEADLINE_HOURS * 60 * 60 * 1000),
        },
      },
    })
    if (result.overdue > 0) {
      this.logger.error(
        {
          event: 'community_erasure_overdue',
          count: result.overdue,
          deadlineHours: ERASURE_DEADLINE_HOURS,
        },
        'Community erasure requests passed their 72-hour deadline'
      )
    }

    await this.settleAccountErasures(now, result)
    return result
  }

  /**
   * Story 6.13. For each open account erasure: repair anything that committed around the request, and
   * once every post of the member is purged, delete those rows and stamp `completed_at`. Deleting them is
   * what ends the link from a case key to the member: `LookbookPost.user_id` cannot be null, and the
   * foreign keys null `post_id` everywhere, which re-keys the case to `orphan-post`.
   */
  private async settleAccountErasures(
    now: Date,
    result: CommunityErasureSweepResult
  ): Promise<void> {
    // Every open request on every pass, paged, so a request that cannot finish yet never starves a newer one.
    let after: string | undefined
    for (;;) {
      const open = await this.prisma.moderationErasureRequest.findMany({
        where: { completed_at: null, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: MAX_SWEEP_BATCH,
        select: { id: true, member_id: true },
      })
      for (const request of open) {
        try {
          if (await this.settleAccountErasure(request.id, request.member_id, now))
            result.requestsCompleted += 1
        } catch (error) {
          // The next pass retries, and one member's failure must not stop the others.
          this.logger.error(
            {
              event: 'moderation_erasure_settle_failed',
              prismaCode: (error as { code?: unknown } | null)?.code ?? null,
            },
            'Failed to settle an account erasure; will retry'
          )
        }
      }
      if (open.length < MAX_SWEEP_BATCH) break
      after = open[open.length - 1]?.id
    }

    result.requestsOverdue = await this.prisma.moderationErasureRequest.count({
      where: {
        completed_at: null,
        requested_at: {
          lt: new Date(now.getTime() - ERASURE_DEADLINE_HOURS * 60 * 60 * 1000),
        },
      },
    })
    if (result.requestsOverdue > 0)
      this.logger.error(
        {
          event: 'moderation_erasure_overdue',
          count: result.requestsOverdue,
          deadlineHours: ERASURE_DEADLINE_HOURS,
        },
        'Account erasure requests passed their 72-hour deadline'
      )
  }

  private async settleAccountErasure(
    requestId: string,
    member: string | null,
    now: Date
  ): Promise<boolean> {
    // The `User` row went, and its foreign keys already removed everything this would.
    if (member) {
      if (await memberIdentityRemains(this.prisma, member))
        await communityPrivacyTransaction(this.prisma, async (tx) => {
          const lockedCases = await lockReportedCases(tx, member)
          await lockCommunitySanctions(tx, null, member)
          await guardCommunitySubject(tx, member)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${member}))`
          await assertReportedCasesUnchanged(tx, member, lockedCases)
          await removeMemberFromModerationRecords(tx, member)
          await eraseCommunityComments(tx, member)
        })

      const unpurged = await this.prisma.lookbookPost.count({
        where: { user_id: member, objects_purged_at: null },
      })
      if (unpurged > 0) return false

      for (;;) {
        const deleted = await communityPrivacyTransaction(this.prisma, async (tx) => {
          await guardCommunitySubject(tx, member)
          const posts = await tx.lookbookPost.findMany({
            where: { user_id: member, objects_purged_at: { not: null } },
            orderBy: { id: 'asc' },
            take: MAX_SWEEP_BATCH,
            select: { id: true },
          })
          const ids = posts.map((post) => post.id)
          await tx.communityPostReport.updateMany({
            where: { post_id: { in: ids } },
            data: { image_object_path: null },
          })
          await tx.moderationEvent.updateMany({
            where: { post_id: { in: ids } },
            data: { image_object_path: null },
          })
          await tx.lookbookPost.deleteMany({ where: { id: { in: ids } } })
          return ids.length
        })
        if (deleted < MAX_SWEEP_BATCH) break
      }
    }

    const { count } = await this.prisma.moderationErasureRequest.updateMany({
      where: { id: requestId, completed_at: null },
      data: { completed_at: now },
    })
    return count > 0
  }

  /**
   * One queue, earliest due first, so waiting work ages past whatever arrives later and nothing starves
   * behind a stream of new requests. A new request is due at its request time. After an attempt the
   * next delete is due at the pace, and no later than the end of the window for the final one.
   */
  private selectErasureWork(now: Date) {
    const pace = Prisma.sql`(${ERASURE_REPEAT_DELETE_MS}::double precision * interval '1 millisecond')`
    const windowEnd = Prisma.sql`(erasure_requested_at + ${COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS}::double precision * interval '1 millisecond')`
    return this.prisma.$queryRaw<ErasureWork[]>(Prisma.sql`
      SELECT id, status::text AS status, image_object_path, anonymized_at, erasure_requested_at
      FROM (
        SELECT *, CASE
          WHEN image_delete_attempted_at IS NULL THEN erasure_requested_at
          WHEN image_delete_attempted_at >= ${windowEnd} THEN image_delete_attempted_at + ${pace}
          ELSE LEAST(image_delete_attempted_at + ${pace}, ${windowEnd})
        END AS due_at
        FROM "LookbookPost"
        WHERE erasure_requested_at IS NOT NULL AND objects_purged_at IS NULL
      ) AS open_erasure
      WHERE due_at <= ${now.toISOString()}::timestamp
      ORDER BY due_at, id
      LIMIT ${MAX_SWEEP_BATCH}`)
  }

  /**
   * After the delete settles, so a crash before it leaves the row due and a failure paces its retry.
   * Forward only: a slower sweep finishing last must not make a newer attempt look old.
   */
  private recordDeleteAttempts(ids: string[], at: Date) {
    if (ids.length === 0) return
    return communityPrivacyTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT community_privacy_guards(ARRAY[]::text[],ARRAY[${Prisma.join(ids)}]::text[],true)`
      )
      await tx.lookbookPost.updateMany({
        where: {
          id: { in: ids },
          OR: [
            { image_delete_attempted_at: null },
            { image_delete_attempted_at: { lt: at } },
          ],
        },
        data: { image_delete_attempted_at: at },
      })
    })
  }

  private eraseMetadata(id: string, now: Date) {
    return communityPrivacyTransaction(this.prisma, async (tx) => {
      await guardCommunityPost(tx, id)
      await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${id} FOR UPDATE`
      const post = await tx.lookbookPost.findFirst({
        where: { id, erasure_requested_at: { not: null }, objects_purged_at: null },
      })
      if (!post) return null
      const hidden = post.status === 'withdrawn' ? 0 : 1
      const anonymized = post.anonymized_at ? 0 : 1
      // Story 6.7b: erasure removes the post's sponsorship links with it. The
      // audit rows that recorded linking and ending them stay.
      await tx.communityPostSponsorship.deleteMany({ where: { post_id: id } })
      await tx.lookbookPost.update({
        where: { id },
        data: {
          status: 'withdrawn',
          ...(anonymized
            ? {
                caption: null,
                alt_text: null,
                locale: null,
                location_key: null,
                area_country: null,
                area_region: null,
                area_city: null,
                image_checksum: null,
                image_pending_checksum: null,
                image_pending_byte_size: null,
                anonymized_at: now,
              }
            : {}),
        },
      })
      return { hidden, anonymized, image_object_path: post.image_object_path }
    })
  }

  /**
   * Deletes the storage object and the draft row for allocations whose upload
   * window closed without a publish, which is the matrix's "expiry sweep deletes
   * abandoned objects".
   *
   * The draft row goes with the object rather than lingering: it holds an
   * idempotency key, and leaving it would make a retried allocate hand back a
   * session pointing at an object that no longer exists.
   */
  async sweepExpiredUploads(
    now: Date = new Date()
  ): Promise<CommunityUploadExpirySweepResult> {
    // The token handed to the client outlives this expiry, and a write landing after the row is gone
    // would leave an object nothing names. A replay moves the expiry, so this covers its token too.
    const deadline = new Date(now.getTime() - COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    const settledAt = sweepClock(now)
    const abandoned = await this.prisma.lookbookPost.findMany({
      where: {
        status: 'draft',
        upload_expires_at: { lt: deadline },
        ...deleteIsDue(now),
      },
      orderBy: { upload_expires_at: 'asc' },
      take: MAX_SWEEP_BATCH,
      select: { id: true, image_object_path: true },
    })

    if (abandoned.length === 0) {
      return { objectsDeleted: 0, draftsDeleted: 0 }
    }

    const candidateIds = abandoned.map((post) => post.id)
    const claimed = await communityPrivacyTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT community_privacy_guards(ARRAY[]::text[],ARRAY[${Prisma.join(candidateIds)}]::text[],true)`
      )
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "LookbookPost" WHERE id IN (${Prisma.join(candidateIds)}) ORDER BY id FOR UPDATE`
      )
      const rows = await tx.lookbookPost.findMany({
        where: {
          id: { in: candidateIds },
          status: 'draft',
          upload_expires_at: { lt: deadline },
          ...deleteIsDue(now),
        },
        select: { id: true, image_object_path: true },
      })
      // Reserve cleanup durably before storage I/O. Publication checks this fence under its post lock.
      await tx.lookbookPost.updateMany({
        where: { id: { in: rows.map((row) => row.id) }, erasure_requested_at: null },
        data: { erasure_requested_at: now },
      })
      return rows
    })
    if (!claimed.length) return { objectsDeleted: 0, draftsDeleted: 0 }

    const objectPaths = claimed
      .map((post) => post.image_object_path)
      .filter((path): path is string => Boolean(path))

    const attempted = claimed
      .filter((post) => Boolean(post.image_object_path))
      .map((post) => post.id)
    let objectsDeleted = 0
    if (objectPaths.length > 0) {
      try {
        await this.storage.remove(objectPaths)
        objectsDeleted = objectPaths.length
        await this.recordDeleteAttempts(attempted, settledAt())
      } catch (error: unknown) {
        // The rows stay so the next sweep retries the delete. Dropping them here
        // would orphan the objects permanently.
        this.logger.error(
          {
            event: 'community_upload_expiry_delete_failed',
            count: objectPaths.length,
            error: error instanceof Error ? error.message : 'unknown error',
          },
          'Failed to delete abandoned community upload objects; rows retained for retry'
        )
        await this.recordDeleteAttempts(attempted, settledAt())
        return { objectsDeleted: 0, draftsDeleted: 0 }
      }
    }

    const ids = claimed.map((post) => post.id)
    const deleted = await communityPrivacyTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT community_privacy_guards(ARRAY[]::text[],ARRAY[${Prisma.join(ids)}]::text[],true)`
      )
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "LookbookPost" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
      )
      return tx.lookbookPost.deleteMany({
        where: {
          id: { in: ids },
          status: 'draft',
          upload_expires_at: { lt: deadline },
          erasure_requested_at: { not: null },
        },
      })
    })

    this.logger.info(
      {
        event: 'community_upload_expiry_swept',
        objectsDeleted,
        draftsDeleted: deleted.count,
      },
      'Abandoned community uploads swept'
    )

    return { objectsDeleted, draftsDeleted: deleted.count }
  }
}
