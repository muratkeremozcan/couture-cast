import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaClient, type LookbookPost } from '@prisma/client'
import { buildCommunityContentSnapshot } from './community-audit-snapshot.js'

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
 * NOTHING ROUTES TO ANY OF THIS YET, AND THAT IS A REAL LIMITATION. There is no
 * HTTP path, no contract entry and no operator surface: until Story 6.5 lands
 * the moderation queue and SLA tracking, a flagged post can only be released,
 * and a published one only taken down, by calling these methods directly from a
 * script or a REPL against the production database. Anyone operating this
 * feature before 6.5 should know that up front.
 *
 * The endpoint was left out deliberately rather than forgotten. Story 6.5 owns
 * the operator contract, and inventing an admin API here would be committing 6.5
 * to a shape drawn without its requirements.
 */
@Injectable()
export class CommunityModerationActionsService {
  private readonly logger = new Logger(CommunityModerationActionsService.name)

  constructor(
    @Inject(PrismaClient)
    private readonly prisma: PrismaClient
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
    const releasedAt = new Date()

    return this.prisma.$transaction(async (tx) => {
      const post = await this.lockPost(tx, postId)

      if (post.status !== 'flagged') {
        return { released: false }
      }

      await tx.lookbookPost.update({
        where: { id: postId },
        data: {
          status: 'published',
          // `??` rather than an assignment: a post that was published, taken
          // down, and then released keeps its original publication time, so it
          // returns to where it was in the feed instead of jumping to the top of
          // it. Feed ordering is `published_at, id` DESC.
          published_at: post.published_at ?? releasedAt,
          // `moderation_reason` and `moderation_engine_version` are left exactly
          // as the screener wrote them. See the method comment.
        },
      })

      await tx.moderationEvent.create({
        data: {
          post_id: postId,
          reviewed_by_id: operatorId,
          action: 'released_by_operator',
          // The operator's own words, and NULL when they give none, rather than
          // a sentence assembled around a machine value.
          reason: reason.trim() || null,
          overridden_engine_version: post.moderation_engine_version,
          image_object_path: post.image_object_path,
          content_snapshot: buildCommunityContentSnapshot(post, releasedAt),
          created_at: releasedAt,
        },
      })

      this.logger.warn(
        {
          event: 'community_moderation_operator_release',
          postId,
          operatorId,
          overriddenEngineVersion: post.moderation_engine_version,
        },
        'Operator released a post the automated screener had flagged'
      )

      return { released: true }
    })
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
    const takenDownAt = new Date()

    return this.prisma.$transaction(async (tx) => {
      const post = await this.lockPost(tx, postId)

      if (post.status !== 'published') {
        return { takenDown: false }
      }

      await tx.lookbookPost.update({
        where: { id: postId },
        data: {
          status: 'flagged',
          moderation_reason: reason,
        },
      })

      await tx.moderationEvent.create({
        data: {
          post_id: postId,
          reviewed_by_id: operatorId,
          action: 'taken_down_by_operator',
          reason,
          image_object_path: post.image_object_path,
          content_snapshot: buildCommunityContentSnapshot(post, takenDownAt),
          created_at: takenDownAt,
        },
      })

      this.logger.warn(
        {
          event: 'community_moderation_operator_takedown',
          postId,
          operatorId,
        },
        'Operator took down a published post'
      )

      return { takenDown: true }
    })
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

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.communityPostReport.updateMany({
        where: { id: reportId, resolved_at: null },
        data: { resolved_at: resolvedAt },
      })

      if (updated.count !== 1) {
        return { resolved: false }
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

      this.logger.log(
        {
          event: 'community_moderation_report_resolved',
          reportId,
          operatorId,
          slaDueAt: report.sla_due_at.toISOString(),
          resolvedAt: resolvedAt.toISOString(),
          withinSla: resolvedAt <= report.sla_due_at,
        },
        'Operator resolved a community post report'
      )

      return { resolved: true }
    })
  }

  /**
   * Locks the post row for the duration of the transaction.
   *
   * Both post actions read a status and then write one conditioned on it, so
   * without the lock two operators acting at once could each read `flagged` and
   * both write an audit row for a release that only happened once.
   */
  private async lockPost(
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
