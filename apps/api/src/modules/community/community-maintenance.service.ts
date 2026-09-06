import { Inject, Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
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

/**
 * The deadline the spec puts on erasure: "deletion completes within 72 hours".
 * A request still unpurged past this is an operator problem, not a queue delay.
 */
export const ERASURE_DEADLINE_HOURS = 72

const MAX_SWEEP_BATCH = 200

export interface CommunityStaleReviewSweepResult {
  stalled: number
}

export interface CommunityUploadExpirySweepResult {
  objectsDeleted: number
  draftsDeleted: number
}

export interface CommunityErasureSweepResult {
  hidden: number
  anonymized: number
  objectsPurged: number
  overdue: number
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
   * Moves posts stuck in `pending_review` past the stall deadline to
   * `review_failed`, and records one durable operator row per post.
   *
   * The operator record is a `JobFailure` row on the moderation queue, which is
   * this repository's existing dead-letter surface: `AdminService.listFailedJobs`
   * lists it, `retryFailedJob` re-drives the exact screening job, and
   * `pruneFailedJobs` ages it out. Writing the alert anywhere else would invent a
   * second operator inbox for the same class of problem.
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
        where: { id: post.id, status: 'pending_review' },
        data: {
          status: 'review_failed',
          moderation_reason: 'moderation_stalled',
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
   * The moderation audit is deliberately left standing. `ModerationEvent` and
   * `CommunityPostReport` keep `subject_alias`, `content_snapshot` and
   * `image_object_path` with both foreign keys nulled, which is what "retain
   * anonymized moderation audit metadata" means: the fact survives, the person
   * does not.
   */
  async sweepErasureRequests(
    now: Date = new Date()
  ): Promise<CommunityErasureSweepResult> {
    const pending = await this.prisma.lookbookPost.findMany({
      where: {
        erasure_requested_at: { not: null },
        objects_purged_at: null,
      },
      orderBy: { erasure_requested_at: 'asc' },
      take: MAX_SWEEP_BATCH,
      select: {
        id: true,
        status: true,
        image_object_path: true,
        anonymized_at: true,
        erasure_requested_at: true,
      },
    })

    const result: CommunityErasureSweepResult = {
      hidden: 0,
      anonymized: 0,
      objectsPurged: 0,
      overdue: 0,
    }

    const deadlineMs = ERASURE_DEADLINE_HOURS * 60 * 60 * 1000

    for (const post of pending) {
      if (post.status !== 'withdrawn') {
        const hidden = await this.prisma.lookbookPost.updateMany({
          where: { id: post.id },
          data: { status: 'withdrawn' },
        })
        result.hidden += hidden.count
      }

      if (!post.anonymized_at) {
        await this.prisma.lookbookPost.update({
          where: { id: post.id },
          data: {
            caption: null,
            alt_text: null,
            locale: null,
            location_key: null,
            image_checksum: null,
            anonymized_at: now,
          },
        })
        result.anonymized += 1
      }

      if (post.image_object_path) {
        try {
          await this.storage.remove([post.image_object_path])
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
          if (
            post.erasure_requested_at &&
            now.getTime() - post.erasure_requested_at.getTime() > deadlineMs
          ) {
            result.overdue += 1
          }
          continue
        }
      }

      await this.prisma.lookbookPost.update({
        where: { id: post.id },
        data: { image_object_path: null, objects_purged_at: now },
      })
      result.objectsPurged += 1
    }

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

    return result
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
    const abandoned = await this.prisma.lookbookPost.findMany({
      where: {
        status: 'draft',
        upload_expires_at: { lt: now },
      },
      orderBy: { upload_expires_at: 'asc' },
      take: MAX_SWEEP_BATCH,
      select: { id: true, image_object_path: true },
    })

    if (abandoned.length === 0) {
      return { objectsDeleted: 0, draftsDeleted: 0 }
    }

    const objectPaths = abandoned
      .map((post) => post.image_object_path)
      .filter((path): path is string => Boolean(path))

    let objectsDeleted = 0
    if (objectPaths.length > 0) {
      try {
        await this.storage.remove(objectPaths)
        objectsDeleted = objectPaths.length
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
        return { objectsDeleted: 0, draftsDeleted: 0 }
      }
    }

    const deleted = await this.prisma.lookbookPost.deleteMany({
      where: {
        id: { in: abandoned.map((post) => post.id) },
        status: 'draft',
      },
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
