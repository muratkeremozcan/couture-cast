import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { assertCommunityDatabaseAccess } from './community-access.service.js'
import { guardCommunityPost } from './community-privacy.js'
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  Prisma,
  PrismaClient,
  type CommunityComment,
  type LookbookPost,
} from '@prisma/client'
import { MODERATION_OPERATOR_TAKEDOWN_REASON } from '@couture/api-client/contracts/http'
import { buildCommunityContentSnapshot } from './community-audit-snapshot.js'
import { commentAnalytics } from './community-comments.repository.js'
import { recordCommunityEngagement } from './community-engagement-intent.js'
import { isPubliclyVisiblePost } from './community.repository.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import { postgresError } from '../../prisma/postgres-error.js'

/** A moderation record could not be written, so the decision cannot be attributed. */
export class ModerationRecordWriteError extends Error {
  constructor(cause: unknown) {
    super('A moderation record could not be written.', { cause })
    this.name = 'ModerationRecordWriteError'
  }
}

/**
 * Writes one attributed record. A failure rolls the transaction back and reads as one closed
 * error, except a unique violation and a retryable lock failure, which their callers handle.
 */
export async function writeModerationRecord<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    const prisma = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : ''
    const sql = postgresError(error)?.code ?? ''
    if (['P2002', 'P2034'].includes(prisma) || ['40001', '40P01', '55P03'].includes(sql))
      throw error
    throw new ModerationRecordWriteError(error)
  }
}

/** Who decided, in their words, at the one time of the decision. */
export interface OperatorEffect {
  operatorId: string
  reason: string
  at: Date
}

/**
 * The operator half of moderation: resolving a report, releasing a post the
 * screener flagged, and taking down a post that is live.
 *
 * NONE OF THIS EXISTED. `ModerationService.recordAction` emitted an analytics
 * event and changed no row; `CommunityPostReport.resolved_at` had zero
 * production writers, so its index served a query nothing ran and the 24-hour
 * `sla_due_at` was never read against anything; and the only writer of
 * `status: 'published'` was the screening processor. A flagged post could
 * therefore never be released and a reported published post could never be
 * taken down. Combined with fail-closed screening — no ADR-013 model in this
 * repository, so every post terminates at `flagged` — production shipped a feed
 * that could only ever be empty, with no operator path out of it.
 *
 * This is the minimum that makes the loop operable, not a moderation console.
 * Each action writes its own `ModerationEvent` naming the operator, because an
 * action against a safety verdict that cannot be attributed is worth less than
 * one that can.
 *
 * Story 6.10 added the reads and Story 6.11 routes the writes: `POST /api/v1/moderation/cases/:caseId/decisions`
 * composes the transaction-scoped `apply*` and `resolveOpen*` methods below inside one decision
 * transaction, and writes the attributed `ModerationDecision` beside them. The three standalone
 * methods remain for controlled operator scripts and test helpers. They write no decision row.
 */
@Injectable()
export class CommunityModerationActionsService {
  private readonly logger = new Logger(CommunityModerationActionsService.name)

  constructor(
    @Inject(PrismaClient)
    private readonly prisma: PrismaClient,
    @Inject(FeatureFlagsService)
    private readonly flags: Pick<FeatureFlagsService, 'getFeatureFlag'>
  ) {}

  /**
   * Publishes a post the automated screener flagged, on a human's authority.
   *
   * THE VERDICT IS OVERRIDDEN, NEVER RE-RUN. Re-screening on release would turn
   * a human decision into a machine verdict in the record: the row would end up
   * saying the model passed content it had in fact refused. With the real
   * ADR-013 model absent it would also simply re-flag everything, so the release
   * path would not work at all.
   *
   * The engine version that produced the refusal is preserved in two places, on
   * purpose. `LookbookPost.moderation_engine_version` is deliberately NOT
   * cleared, so the post itself still records which version screened it, and the
   * audit row carries the same value in its own `overridden_engine_version`
   * column. Anyone reading either one can tell an override from a pass.
   *
   * The column is structured rather than formatted into `reason`, which stays
   * the operator's own words and nothing else. Concatenating a machine value
   * into that free-text field is the pattern this story already removed once,
   * when reporter text was being folded into it.
   */
  async releaseFlaggedPost(params: {
    postId: string
    operatorId: string
    reason: string
  }): Promise<{ released: boolean }> {
    const { postId, operatorId, reason } = params
    const source = await this.prisma.lookbookPost.findUnique({ where: { id: postId } })
    if (!source) throw new NotFoundException('COMMUNITY_POST_NOT_FOUND')
    if (!(await this.flags.getFeatureFlag('community_write_enabled', source.user_id)))
      throw new ServiceUnavailableException('Community publication is unavailable.')
    const releasedAt = new Date()

    // Logged after commit, so a re-run transaction logs the release once.
    const outcome = await interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${source.user_id}))`
      const post = await this.lockPost(tx, postId)

      if (
        post.status !== 'flagged' ||
        post.user_id !== source.user_id ||
        post.erasure_requested_at ||
        post.anonymized_at
      ) {
        return { released: false as const }
      }

      try {
        await assertCommunityDatabaseAccess(tx, post.user_id)
      } catch (error) {
        if (error instanceof ForbiddenException) return { released: false as const }
        throw error
      }

      await this.applyPostRelease(tx, post, { operatorId, reason, at: releasedAt })

      return { released: true as const, engineVersion: post.moderation_engine_version }
    })
    if (outcome.released)
      this.logger.warn(
        {
          event: 'community_moderation_operator_release',
          postId,
          operatorId,
          overriddenEngineVersion: outcome.engineVersion,
        },
        'Operator released a post the automated screener had flagged'
      )
    return { released: outcome.released }
  }

  /**
   * Removes a live post from the feed on a human's authority.
   *
   * The post lands in `flagged`, which is the status the feed filters already
   * treat as "not visible, held for moderation", so no reader-side change is
   * needed for a takedown to take effect. `withdrawn` would be wrong: that is
   * the author's own retraction and it starts the 72-hour erasure clock, which
   * would destroy the evidence a takedown exists to preserve.
   */
  async takeDownPublishedPost(params: {
    postId: string
    operatorId: string
    reason: string
  }): Promise<{ takenDown: boolean }> {
    const { postId, operatorId, reason } = params
    const source = await this.prisma.lookbookPost.findUnique({ where: { id: postId } })
    if (!source) throw new NotFoundException('COMMUNITY_POST_NOT_FOUND')
    const takenDownAt = new Date()

    // Logged after commit, so a re-run transaction logs the takedown once.
    const outcome = await interactiveTransaction(this.prisma, async (tx) => {
      await guardCommunityPost(tx, postId)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${source.user_id}))`
      const post = await this.lockPost(tx, postId)

      if (post.status !== 'published' || post.user_id !== source.user_id) {
        return { takenDown: false }
      }

      await this.applyPostTakedown(tx, post, { operatorId, reason, at: takenDownAt })

      return { takenDown: true }
    })
    if (outcome.takenDown)
      this.logger.warn(
        {
          event: 'community_moderation_operator_takedown',
          postId,
          operatorId,
        },
        'Operator took down a published post'
      )
    return outcome
  }

  /**
   * Closes a report.
   *
   * `resolved_at` is the column the 24-hour `sla_due_at` is measured against and
   * it had no writer at all, so every report was permanently open and the
   * `(resolved_at, sla_due_at)` index served nothing. Resolution is recorded
   * separately from any action taken on the post: an operator can resolve a
   * report as unfounded without touching the post, and can take a post down
   * without every report about it closing.
   *
   * Already-resolved reports return `false` rather than re-stamping, so the
   * recorded resolution time stays the first one and a retry cannot make a late
   * resolution look punctual.
   */
  async resolveReport(params: {
    reportId: string
    operatorId: string
    resolution: string
  }): Promise<{ resolved: boolean }> {
    const { reportId, operatorId, resolution } = params
    const resolvedAt = new Date()

    // Logged after commit, so a re-run transaction logs the resolution once.
    const outcome = await interactiveTransaction(this.prisma, async (tx) => {
      const updated = await tx.communityPostReport.updateMany({
        where: { id: reportId, resolved_at: null },
        data: { resolved_at: resolvedAt },
      })

      if (updated.count !== 1) {
        return { resolved: false as const }
      }

      const report = await tx.communityPostReport.findUniqueOrThrow({
        where: { id: reportId },
      })

      await tx.moderationEvent.create({
        data: {
          // Null once erasure has orphaned the report, which is exactly why the
          // alias, snapshot and object path are copied across.
          post_id: report.post_id,
          reviewed_by_id: operatorId,
          action: 'report_resolved',
          reason: resolution,
          subject_alias: report.subject_alias,
          image_object_path: report.image_object_path,
          content_snapshot: report.content_snapshot ?? undefined,
          created_at: resolvedAt,
        },
      })

      return { resolved: true as const, slaDueAt: report.sla_due_at }
    })
    if (outcome.resolved)
      this.logger.log(
        {
          event: 'community_moderation_report_resolved',
          reportId,
          operatorId,
          slaDueAt: outcome.slaDueAt.toISOString(),
          resolvedAt: resolvedAt.toISOString(),
          withinSla: resolvedAt <= outcome.slaDueAt,
        },
        'Operator resolved a community post report'
      )
    return { resolved: outcome.resolved }
  }

  /** Publishes a flagged post. The caller holds the locks and has checked eligibility. */
  async applyPostRelease(
    tx: Prisma.TransactionClient,
    post: LookbookPost,
    { operatorId, reason, at }: OperatorEffect
  ): Promise<void> {
    await tx.lookbookPost.update({
      where: { id: post.id },
      data: {
        status: 'published',
        // `??` rather than an assignment: a post that was published, taken
        // down, and then released keeps its original publication time, so it
        // returns to where it was in the feed instead of jumping to the top of
        // it. Feed ordering is `published_at, id` DESC.
        published_at: post.published_at ?? at,
        // `moderation_reason` and `moderation_engine_version` are left exactly
        // as the screener wrote them. See `releaseFlaggedPost`.
      },
    })

    await writeModerationRecord(() =>
      tx.moderationEvent.create({
        data: {
          post_id: post.id,
          reviewed_by_id: operatorId,
          action: 'released_by_operator',
          // The operator's own words, and NULL when they give none, rather than
          // a sentence assembled around a machine value.
          reason: reason.trim() || null,
          overridden_engine_version: post.moderation_engine_version,
          image_object_path: post.image_object_path,
          content_snapshot: buildCommunityContentSnapshot(post, at),
          created_at: at,
        },
      })
    )
  }

  /** Hides a published post as `flagged`. See `takeDownPublishedPost` for why that status. */
  async applyPostTakedown(
    tx: Prisma.TransactionClient,
    post: LookbookPost,
    { operatorId, reason, at }: OperatorEffect
  ): Promise<void> {
    await tx.lookbookPost.update({
      where: { id: post.id },
      data: { status: 'flagged', moderation_reason: reason },
    })

    await writeModerationRecord(() =>
      tx.moderationEvent.create({
        data: {
          post_id: post.id,
          reviewed_by_id: operatorId,
          action: 'taken_down_by_operator',
          reason,
          image_object_path: post.image_object_path,
          content_snapshot: buildCommunityContentSnapshot(post, at),
          created_at: at,
        },
      })
    )
  }

  /**
   * True when a held comment could publish now: its post is public and, for a reply, its root is
   * published. The rule the screening processor applies at publication.
   */
  async commentCanPublish(
    tx: Prisma.TransactionClient,
    comment: Pick<CommunityComment, 'post_id' | 'parent_id'>
  ): Promise<boolean> {
    const post = await tx.lookbookPost.findUnique({ where: { id: comment.post_id } })
    if (!post || !isPubliclyVisiblePost(post)) return false
    if (!comment.parent_id) return true
    const root = await tx.communityComment.findFirst({
      where: {
        id: comment.parent_id,
        post_id: comment.post_id,
        parent_id: null,
        status: 'published',
      },
      select: { id: true },
    })
    return root !== null
  }

  /**
   * Publishes a held comment.
   *
   * A comment published before keeps its sequence, so it returns to its place in the thread.
   * Engagement and analytics have no dedupe for a second publication, so only a first one
   * records them.
   */
  async applyCommentRelease(
    tx: Prisma.TransactionClient,
    comment: CommunityComment,
    { at }: Pick<OperatorEffect, 'at'>
  ): Promise<void> {
    const firstPublication = comment.publication_sequence === null
    let sequence = comment.publication_sequence
    let postAuthor: string | null = null
    if (firstPublication) {
      const post = await tx.lookbookPost.update({
        where: { id: comment.post_id },
        data: { comment_publication_sequence: { increment: 1 } },
      })
      sequence = post.comment_publication_sequence
      postAuthor = post.user_id
    }
    await tx.communityComment.update({
      where: { id: comment.id },
      data: {
        status: 'published',
        published_at: comment.published_at ?? at,
        publication_sequence: sequence,
        screening_reason: null,
      },
    })
    if (firstPublication && comment.user_id) {
      await commentAnalytics(
        tx,
        comment.user_id,
        'community_comment_published',
        comment.platform,
        comment.user_id === postAuthor,
        comment.parent_id !== null
      )
      await recordCommunityEngagement(tx, {
        actor: comment.user_id,
        post: comment.post_id,
        comment: comment.id,
      })
    }
  }

  /**
   * Hides a published comment as `blocked`. The body stays as evidence and the operator's words
   * stay on the decision, so the stored reason is one closed value that reads as no finding.
   */
  async applyCommentTakedown(
    tx: Prisma.TransactionClient,
    comment: Pick<CommunityComment, 'id'>
  ): Promise<void> {
    await tx.communityComment.update({
      where: { id: comment.id },
      data: {
        status: 'blocked',
        screening_reason: MODERATION_OPERATOR_TAKEDOWN_REASON,
      },
    })
  }

  /**
   * Stamps every still-open post report among `reportIds` with one time and records each one.
   * The null predicate keeps a stamped `resolved_at` where it is, so a later decision cannot make
   * a late resolution look punctual.
   */
  async resolveOpenPostReports(
    tx: Prisma.TransactionClient,
    reportIds: readonly string[],
    { operatorId, reason, at }: OperatorEffect
  ): Promise<number> {
    const open = await tx.communityPostReport.findMany({
      where: { id: { in: [...reportIds] }, resolved_at: null },
    })
    if (open.length === 0) return 0
    await tx.communityPostReport.updateMany({
      where: { id: { in: open.map((report) => report.id) }, resolved_at: null },
      data: { resolved_at: at },
    })
    await writeModerationRecord(() =>
      tx.moderationEvent.createMany({
        data: open.map((report) => ({
          post_id: report.post_id,
          reviewed_by_id: operatorId,
          action: 'report_resolved',
          reason,
          subject_alias: report.subject_alias,
          image_object_path: report.image_object_path,
          content_snapshot: (report.content_snapshot ??
            undefined) as Prisma.InputJsonValue,
          created_at: at,
        })),
      })
    )
    return open.length
  }

  /** The comment form of `resolveOpenPostReports`, with one audit row per stamped report. */
  async resolveOpenCommentReports(
    tx: Prisma.TransactionClient,
    reportIds: readonly string[],
    { reason, at }: Pick<OperatorEffect, 'reason' | 'at'>
  ): Promise<number> {
    const open = await tx.communityCommentReport.findMany({
      where: { id: { in: [...reportIds] }, resolved_at: null },
      select: { id: true },
    })
    if (open.length === 0) return 0
    await tx.communityCommentReport.updateMany({
      where: { id: { in: open.map((report) => report.id) }, resolved_at: null },
      data: { resolved_at: at },
    })
    await writeModerationRecord(() =>
      tx.communityCommentAudit.createMany({
        data: open.map((report) => ({
          report_id: report.id,
          action: 'report_resolved',
          reason,
          occurred_at: at,
        })),
      })
    )
    return open.length
  }

  /**
   * Locks the post row for the duration of the transaction.
   *
   * Both post actions read a status and then write one conditioned on it, so
   * without the lock two operators acting at once could each read `flagged` and
   * both write an audit row for a release that only happened once.
   */
  async lockPost(
    tx: Pick<PrismaClient, '$queryRaw' | 'lookbookPost'>,
    postId: string
  ): Promise<LookbookPost> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LookbookPost" WHERE id = ${postId} FOR UPDATE
    `
    if (locked.length === 0) {
      throw new NotFoundException('COMMUNITY_POST_NOT_FOUND')
    }
    return tx.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
  }
}
