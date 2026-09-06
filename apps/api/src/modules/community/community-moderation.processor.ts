// Story 6.1 Task 4: BullMQ processor for automated community content moderation.
// Implements ADR-013 transactional content screening, publishing, flagging,
// SLA alert recording, and retry exhaustion handling.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { PrismaClient, type ClimateBand } from '@prisma/client'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import {
  SupabaseCommunityStorageAdapter,
  type CommunityStorage,
} from './community-storage.adapter.js'
import {
  type CommunityModerationEngine,
  type CommunityModerationResult,
  DefaultCommunityModerationEngine,
} from './community-moderation.engine.js'
import { type CommunityModerationJob } from './community-moderation.queue.js'
import { postDedupeKey } from './community-analytics.js'
import {
  CommunityImageValidationError,
  verifyAndNormalizeCommunityImage,
  type CommunityMimeType,
} from './community-image-validation.js'

/**
 * Hard ceilings on the two external calls a screening job makes. Without them a hung
 * download or a wedged model leaves the job running forever: BullMQ never fails
 * it, so the worker's catch never runs, `markFailed` never fires, and the post
 * sits in `pending_review` with no author recovery state. The maintenance sweep
 * is the second line of defence; these are the first.
 */
export const MODERATION_DOWNLOAD_TIMEOUT_MS = 20_000
export const MODERATION_SCREENING_TIMEOUT_MS = 30_000

/** Minutes an operator has to see a flagged post, per the moderation SLA. */
const FLAGGED_ALERT_SLA_MINUTES = 5
const FLAGGED_REVIEW_SLA_HOURS = 24

export async function withModerationTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

@Injectable()
export class CommunityModerationProcessor {
  private readonly logger = new Logger(CommunityModerationProcessor.name)
  private readonly moderationEngine: CommunityModerationEngine

  constructor(
    @Inject(PrismaClient)
    private readonly prisma: PrismaClient,
    @Inject(SupabaseCommunityStorageAdapter)
    private readonly storage: CommunityStorage,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
    @Optional()
    engine?: CommunityModerationEngine
  ) {
    this.moderationEngine = engine ?? new DefaultCommunityModerationEngine()
  }

  async process(jobData: CommunityModerationJob): Promise<void> {
    const { postId, platform } = jobData

    const post = await this.prisma.lookbookPost.findUnique({
      where: { id: postId },
    })

    if (!post) {
      this.logger.warn({ postId }, 'LookbookPost not found for moderation')
      return
    }

    if (post.status !== 'pending_review') {
      this.logger.debug(
        { postId: post.id, status: post.status },
        'LookbookPost is not in pending_review status; skipping moderation'
      )
      return
    }

    if (!post.image_object_path) {
      throw new Error(`LookbookPost ${post.id} missing image_object_path`)
    }

    // Transient errors propagate so BullMQ retries; a hang becomes an error
    // rather than an indefinite wait.
    const rawBytes = await withModerationTimeout(
      this.storage.download(post.image_object_path),
      MODERATION_DOWNLOAD_TIMEOUT_MS,
      'community image download'
    )

    // Verify what was actually uploaded against what the client declared, then
    // orient/decode/re-encode before anything screens or publishes it. A failure
    // here is the author's to fix, not a moderation verdict, so it terminates at
    // `review_failed` rather than `flagged`.
    let imageBuffer: Buffer
    try {
      const normalized = await withModerationTimeout(
        this.normalizeUpload(post.id, post.image_object_path, rawBytes, {
          byteSize: post.image_byte_size,
          mimeType: post.image_content_type,
          sha256: post.image_checksum,
        }),
        MODERATION_SCREENING_TIMEOUT_MS,
        'community image verification'
      )
      imageBuffer = normalized
    } catch (error) {
      if (error instanceof CommunityImageValidationError) {
        await this.markFailed(post.id, error.code)
        return
      }
      throw error
    }

    const screeningResult = await withModerationTimeout(
      this.moderationEngine.moderatePost({
        caption: post.caption,
        altText: post.alt_text,
        locale: post.locale,
        imageBuffer,
      }),
      MODERATION_SCREENING_TIMEOUT_MS,
      'community content screening'
    )

    const engineVersion = `${screeningResult.engineVersions.text};${screeningResult.engineVersions.image}`

    if (screeningResult.outcome === 'passed') {
      await this.publishPost({
        postId: post.id,
        userId: post.user_id,
        climateBand: post.climate_band,
        challengeId: post.challenge_id,
        engineVersion,
        platform,
      })
      return
    }

    await this.flagPost(post.id, post.user_id, screeningResult, engineVersion)
  }

  private async emit<
    T extends 'community_post_published' | 'community_challenge_participated',
  >(
    userId: string,
    eventType: T,
    postId: string,
    properties: {
      platform: 'web' | 'mobile'
      dedupeKey: string
      climateBand: ClimateBand | null
    }
  ): Promise<void> {
    try {
      await this.telemetryService.captureEvent(userId, eventType, properties)
    } catch (err) {
      this.logger.warn({ error: err, postId, eventType }, 'Failed to emit telemetry')
    }
  }

  /**
   * Verifies the stored declaration against the bytes, re-encodes them, writes
   * the normalized object back over the original, and persists the checksum,
   * byte size and MIME that describe what is actually stored.
   */
  private async normalizeUpload(
    postId: string,
    objectPath: string,
    rawBytes: Buffer,
    declared: {
      byteSize: number | null
      mimeType: string | null
      sha256: string | null
    }
  ): Promise<Buffer> {
    if (!declared.byteSize || !declared.mimeType || !declared.sha256) {
      throw new CommunityImageValidationError('IMAGE_DECLARATION_MISSING')
    }

    const normalized = await verifyAndNormalizeCommunityImage(rawBytes, {
      byteSize: declared.byteSize,
      mimeType: declared.mimeType as CommunityMimeType,
      sha256: declared.sha256,
    })

    if (normalized.sha256 !== declared.sha256) {
      await this.storage.upload(objectPath, normalized.bytes, normalized.mimeType)
      await this.prisma.lookbookPost.update({
        where: { id: postId },
        data: {
          image_checksum: normalized.sha256,
          image_byte_size: normalized.byteSize,
          image_content_type: normalized.mimeType,
        },
      })
    }

    return normalized.bytes
  }

  private async publishPost(params: {
    postId: string
    userId: string
    climateBand: ClimateBand | null
    challengeId: string | null
    engineVersion: string
    platform: 'web' | 'mobile' | undefined
  }): Promise<void> {
    const { postId, userId, climateBand, challengeId, engineVersion, platform } = params
    const publishedAt = new Date()
    const updated = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.lookbookPost.updateMany({
        where: { id: postId, status: 'pending_review' },
        data: {
          status: 'published',
          published_at: publishedAt,
          moderation_reason: null,
          moderation_engine_version: engineVersion,
        },
      })

      if (updateResult.count === 1) {
        await tx.communityModerationOutbox.updateMany({
          where: { post_id: postId },
          data: { dispatched_at: publishedAt },
        })
      }
      return updateResult.count === 1
    })

    if (!updated) {
      return
    }

    // This runs inside a BullMQ job that retries, so both events carry a
    // deterministic dedupe key derived from the post. A redelivery that
    // double-counted a publication would corrupt the beta gate's own inputs.
    await this.emit(userId, 'community_post_published', postId, {
      platform: platform ?? 'web',
      dedupeKey: postDedupeKey(postId, 'community_post_published'),
      climateBand,
    })

    if (challengeId) {
      // Keyed on the challenge and the author, so the sink counts unique
      // published participants no matter how many posts one author submits.
      await this.emit(userId, 'community_challenge_participated', postId, {
        platform: platform ?? 'web',
        dedupeKey: postDedupeKey(
          `${challengeId}:${userId}`,
          'community_challenge_participated'
        ),
        climateBand,
      })
    }

    this.logger.log(
      { postId, publishedAt },
      'LookbookPost passed content screening and was published'
    )
  }

  private async flagPost(
    postId: string,
    userId: string,
    screeningResult: CommunityModerationResult,
    engineVersion: string
  ): Promise<void> {
    const reason = screeningResult.reasons.join(', ') || 'flagged_by_screening'
    const flaggedAt = new Date()

    await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.lookbookPost.updateMany({
        where: { id: postId, status: 'pending_review' },
        data: {
          status: 'flagged',
          moderation_reason: reason,
          moderation_engine_version: engineVersion,
        },
      })

      if (updateResult.count !== 1) {
        return
      }

      await tx.moderationEvent.create({
        data: {
          post_id: postId,
          action: 'flagged',
          reason,
          created_at: flaggedAt,
        },
      })

      // The outbox row is stamped on EVERY terminal branch, not only the
      // published one. Leaving it unstamped here meant the outbox dispatcher
      // re-enqueued every flagged post forever, because `dispatched_at IS NULL`
      // is the dispatcher's only claim predicate.
      await tx.communityModerationOutbox.updateMany({
        where: { post_id: postId },
        data: { dispatched_at: flaggedAt },
      })
    })

    this.logger.warn(
      {
        event: 'community_moderation_flagged_sla_alert',
        postId,
        userId,
        reasons: screeningResult.reasons,
        reason,
        textVerdict: {
          passed: screeningResult.text.passed,
          reasons: screeningResult.text.reasons,
          engineVersion: screeningResult.text.engineVersion,
        },
        imageVerdict: {
          passed: screeningResult.image.passed,
          reasons: screeningResult.image.reasons,
          engineVersion: screeningResult.image.engineVersion,
          score: screeningResult.image.score,
        },
        flaggedAt: flaggedAt.toISOString(),
        slaTargetMinutes: FLAGGED_ALERT_SLA_MINUTES,
        slaReviewDeadlineHours: FLAGGED_REVIEW_SLA_HOURS,
      },
      'Post flagged by automated content screening; moderation queue 5-minute SLA alert recorded'
    )
  }

  /**
   * If retry attempts are exhausted, transitions status to review_failed with
   * reason. The outbox row is stamped here too, for the same reason it is
   * stamped on the flagged branch.
   */
  async markFailed(postId: string, reason: string): Promise<void> {
    const failedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.lookbookPost.updateMany({
        where: { id: postId, status: 'pending_review' },
        data: {
          status: 'review_failed',
          moderation_reason: reason,
        },
      })

      if (updateResult.count !== 1) {
        return
      }

      await tx.communityModerationOutbox.updateMany({
        where: { post_id: postId },
        data: { dispatched_at: failedAt },
      })
    })

    this.logger.error(
      {
        event: 'community_moderation_review_failed',
        postId,
        reason,
      },
      'Post moderation retry attempts exhausted; status transitioned to review_failed'
    )
  }
}
