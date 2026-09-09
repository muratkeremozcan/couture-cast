// Story 6.1 Task 4: BullMQ processor for automated community content moderation.
// Implements ADR-013 transactional content screening, publishing, flagging,
// SLA alert recording, and retry exhaustion handling.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { PrismaClient, type ClimateBand, type LookbookPost } from '@prisma/client'
import {
  TelemetryService,
  type TelemetryPropertiesMap,
} from '../telemetry/telemetry.service.js'
import {
  SupabaseCommunityStorageAdapter,
  type CommunityStorage,
} from './community-storage.adapter.js'
import {
  type CommunityModerationEngine,
  type CommunityModerationResult,
  DefaultCommunityModerationEngine,
} from './community-moderation.engine.js'
import {
  COMMUNITY_MODERATION_LOG_EVENTS,
  createOpenTelemetryCommunityModerationMeter,
  createSafeCommunityModerationMeter,
  type CommunityModerationMeter,
  type ModerationOutcome,
} from './community-moderation.telemetry.js'
import { type CommunityModerationJob } from './community-moderation.queue.js'
import { communitySubjectToken, postDedupeKey } from './community-analytics.js'
import { buildCommunityContentSnapshot } from './community-audit-snapshot.js'
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

/**
 * Which BullMQ attempt is executing, so a metric and an evidence line can tell a
 * first try from the last one. Optional because the processor is also driven
 * directly by the integration suite, where there is no BullMQ job to ask.
 */
export interface CommunityModerationAttemptContext {
  attempt: number
  maxAttempts: number
}

/**
 * The identity persisted on the post and its moderation event: which text
 * engine ran and which image engine ran.
 *
 * NO SEPARATE POLICY SEGMENT, deliberately. Each half already names the policy:
 * `deriveScreeningIdentity` builds the policy version and the first twelve
 * characters of its hash into the text version, and the image screener's
 * `composeEngineVersion` builds the same hash beside the verified model digest.
 * Appending `image.policyVersion` here would state the same fact a third time.
 * That field stays on the result for the bounded evaluation payload and the
 * operational metrics, where it is read as data rather than composed into an
 * identity.
 *
 * A fixture keeps its `-fixture` marker because the screener that produced the
 * verdict put it there, which is what makes a persisted
 * `moderation_engine_version` answer "was this really screened".
 */
export function buildModerationEngineVersion(result: CommunityModerationResult): string {
  return `${result.engineVersions.text};${result.engineVersions.image}`
}

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
  private readonly meter: CommunityModerationMeter

  constructor(
    @Inject(PrismaClient)
    private readonly prisma: PrismaClient,
    @Inject(SupabaseCommunityStorageAdapter)
    private readonly storage: CommunityStorage,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
    @Optional()
    engine?: CommunityModerationEngine,
    @Optional()
    meter?: CommunityModerationMeter
  ) {
    this.moderationEngine = engine ?? new DefaultCommunityModerationEngine()
    // Wrapped even when one is injected. A metrics fault after a post has
    // already published would otherwise escape into the worker's catch, count
    // as a failed attempt and burn a BullMQ retry on work that is finished.
    this.meter = createSafeCommunityModerationMeter(
      meter ?? createOpenTelemetryCommunityModerationMeter()
    )
  }

  async process(
    jobData: CommunityModerationJob,
    context?: CommunityModerationAttemptContext
  ): Promise<void> {
    const attempt = context?.attempt ?? 1
    try {
      await this.screenPost(jobData, context, attempt)
    } catch (error) {
      // Every throw out of this processor is an attempt BullMQ will either
      // retry or exhaust, and AC 5 wants those counted separately from the
      // post's final state. One place to count them means a new throw site
      // cannot forget.
      this.meter.recordAttemptFailure('error', attempt)
      throw error
    }
  }

  private async screenPost(
    jobData: CommunityModerationJob,
    context: CommunityModerationAttemptContext | undefined,
    attempt: number
  ): Promise<void> {
    const { postId, platform } = jobData
    const startedAt = Date.now()

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
        await this.markFailed(post.id, error.code, context)
        this.meter.recordScreening(
          'review',
          'review_failed',
          Date.now() - startedAt,
          attempt
        )
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

    const engineVersion = buildModerationEngineVersion(screeningResult)
    const outcome: ModerationOutcome =
      screeningResult.outcome === 'passed' ? 'published' : 'flagged'

    if (screeningResult.outcome === 'passed') {
      await this.publishPost({
        postId: post.id,
        userId: post.user_id,
        climateBand: post.climate_band,
        challengeId: post.challenge_id,
        engineVersion,
        platform,
        post,
      })
    } else {
      await this.flagPost(post.id, post.user_id, screeningResult, engineVersion, post)
    }

    // Disposition, duration and attempt only. No post id, no author, no object
    // path, no caption: these are attributes on a time series, and every one of
    // them would be both a privacy leak and unbounded cardinality.
    this.meter.recordScreening(
      screeningResult.image.disposition ??
        (screeningResult.image.passed ? 'pass' : 'review'),
      outcome,
      Date.now() - startedAt,
      attempt
    )
    this.logger.debug(
      {
        event: COMMUNITY_MODERATION_LOG_EVENTS.screeningCompleted,
        postId: post.id,
        outcome,
        disposition: screeningResult.image.disposition ?? null,
        engineVersion,
        attempt,
        maxAttempts: context?.maxAttempts ?? null,
        durationMs: Date.now() - startedAt,
      },
      'Community screening attempt completed'
    )
  }

  private async emit<
    T extends 'community_post_published' | 'community_challenge_participated',
  >(
    userId: string,
    eventType: T,
    postId: string,
    // Typed FROM the telemetry map rather than hand-declared. The hand-written
    // shape here silently omitted `challengeId` when the participation event
    // gained it, and until the event schemas gained `.strict()` an extra or
    // missing key would have been stripped at the boundary rather than
    // reported. Deriving the type means a field added to an event is a compile
    // error at this call site instead of an emission that is quietly wrong.
    properties: TelemetryPropertiesMap[T]
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
    post: LookbookPost
  }): Promise<void> {
    const { postId, userId, climateBand, challengeId, engineVersion, platform, post } =
      params
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
        // A PASSING VERDICT USED TO WRITE NO AUDIT ROW AT ALL. Only `flagPost`
        // and `recordReport` created `ModerationEvent`s, so the moderation trail
        // recorded refusals and nothing else: there was no way to answer "was
        // this post ever screened, by what, and when" for anything that
        // published, which is every post a reader can actually see. The row
        // carries the engine version so a later model regression can be scoped
        // to exactly the posts the bad version cleared.
        // NO `subject_alias` HERE, DELIBERATELY. The report path denormalizes the
        // author's pseudonym because a report is about someone's conduct and has
        // to stay attributable once erasure nulls `post_id`. A machine verdict is
        // about the CONTENT, and nothing queries these rows by author, so
        // resolving an alias would mean injecting the repository into the worker
        // composition to mint a pseudonym no reader ever asks for.
        await tx.moderationEvent.create({
          data: {
            post_id: postId,
            action: 'screening_passed',
            reason: engineVersion,
            image_object_path: post.image_object_path,
            content_snapshot: buildCommunityContentSnapshot(post, publishedAt),
            created_at: publishedAt,
          },
        })

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
      // published participants no matter how many posts one author submits. The
      // author is the HMAC token, never the raw id: this event is pseudonymous
      // and `dedupe_key` travels to the sink as a plain property, so a raw id
      // would put the pseudonym and the identity beside each other on one row.
      await this.emit(userId, 'community_challenge_participated', postId, {
        platform: platform ?? 'web',
        dedupeKey: postDedupeKey(
          `${challengeId}:${communitySubjectToken(userId)}`,
          'community_challenge_participated'
        ),
        // The challenge as a first-class dimension. It used to be legible only
        // inside the dedupe key, which is opaque to the sink by design and free
        // to change shape -- and the key's shape has just changed, so without
        // this field the beta gate would have lost the ability to attribute
        // participation to a challenge at all.
        challengeId,
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
    engineVersion: string,
    post: LookbookPost
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
          image_object_path: post.image_object_path,
          content_snapshot: buildCommunityContentSnapshot(post, flaggedAt),
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
  async markFailed(
    postId: string,
    reason: string,
    context?: CommunityModerationAttemptContext
  ): Promise<void> {
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
        attempt: context?.attempt ?? null,
        maxAttempts: context?.maxAttempts ?? null,
      },
      'Post moderation retry attempts exhausted; status transitioned to review_failed'
    )
  }
}
