import { recordCommunityEngagement } from './community-engagement-intent.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import {
  withModerationTimeout,
  MODERATION_SCREENING_TIMEOUT_MS,
} from './community-moderation.processor.js'
// Story 6.4 owner: worker-only text screening with guarded publication.
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { CommunityModerationEngine } from './community-moderation.engine.js'
import { assertCommunityDatabaseAccess } from './community-access.service.js'
import { PUBLICLY_VISIBLE_POST_WHERE } from './community.repository.js'
import { commentAnalytics } from './community-comments.repository.js'

export class CommunityCommentsProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: CommunityModerationEngine,
    private readonly flags?: Pick<FeatureFlagsService, 'getFeatureFlag'>
  ) {}

  async process(commentId: string, generation?: number): Promise<void> {
    const input = await this.prisma.communityComment.findUnique({
      where: { id: commentId },
    })
    if (generation !== undefined) {
      const outbox = await this.prisma.communityCommentScreeningOutbox.findUnique({
        where: { comment_id: commentId },
      })
      if (!outbox || outbox.generation !== generation) return
    }
    if (!input || input.status !== 'pending_screening' || !input.body || !input.user_id)
      return
    if (!(await this.rolloutAllows(input.user_id))) {
      await this.defer(commentId, generation)
      return
    }
    const result = await withModerationTimeout(
      this.engine.screenText({
        text: input.body,
        field: 'caption',
        locale: input.locale,
      }),
      MODERATION_SCREENING_TIMEOUT_MS,
      'Community comment screening'
    )
    // A second per-author evaluation after screening keeps a newly observed freeze pending.
    if (!(await this.rolloutAllows(input.user_id))) {
      await this.defer(commentId, generation)
      return
    }
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${input.user_id}))`
        await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${input.post_id} FOR UPDATE`
        const [owned] = await tx.$queryRaw<
          { generation: number }[]
        >`SELECT generation FROM "CommunityCommentScreeningOutbox" WHERE comment_id=${commentId} FOR UPDATE`
        if (generation !== undefined && owned?.generation !== generation) return
        const current = await tx.communityComment.findUnique({ where: { id: commentId } })
        if (
          !current ||
          current.status !== 'pending_screening' ||
          current.user_id !== input.user_id
        )
          return
        const post = await tx.lookbookPost.findFirst({
          where: { id: input.post_id, ...PUBLICLY_VISIBLE_POST_WHERE },
        })
        let eligible = !!post
        try {
          await assertCommunityDatabaseAccess(tx, input.user_id!)
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error
          eligible = false
        }
        if (input.parent_id) {
          const root = await tx.communityComment.findFirst({
            where: {
              id: input.parent_id,
              post_id: input.post_id,
              parent_id: null,
              status: 'published',
            },
          })
          eligible = eligible && !!root
        }
        if (!eligible) {
          await tx.communityComment.update({
            where: { id: commentId },
            data: { status: 'consent_suspended', body: null },
          })
          return
        }
        if (result.disposition !== 'pass' || !result.passed) {
          const state = result.disposition === 'block' ? 'blocked' : 'held_for_review'
          await tx.communityComment.update({
            where: { id: commentId },
            data: {
              status: state,
              screening_reason: result.reasons.join(','),
              screening_version: result.engineVersion,
            },
          })
          await this.intake(tx, commentId, state, result.reasons.join(','))
          return
        }
        const updatedPost = await tx.lookbookPost.update({
          where: { id: input.post_id },
          data: { comment_publication_sequence: { increment: 1 } },
        })
        await tx.communityComment.update({
          where: { id: commentId },
          data: {
            status: 'published',
            published_at: new Date(),
            publication_sequence: updatedPost.comment_publication_sequence,
            screening_reason: null,
            screening_version: result.engineVersion,
          },
        })
        await commentAnalytics(
          tx,
          input.user_id!,
          'community_comment_published',
          input.platform,
          input.user_id === post?.user_id,
          input.parent_id !== null
        )
        await recordCommunityEngagement(tx, {
          actor: input.user_id!,
          post: input.post_id,
          comment: commentId,
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    )
  }

  async markFailed(commentId: string, stale = false, generation?: number): Promise<void> {
    const row = await this.prisma.communityComment.findUnique({
      where: { id: commentId },
    })
    if (!row?.user_id) return
    if (!(await this.rolloutAllows(row.user_id))) {
      await this.defer(commentId, generation)
      return
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${row.user_id}))`
      await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${row.post_id} FOR UPDATE`
      const [owned] = await tx.$queryRaw<
        { generation: number; updated_at: Date }[]
      >`SELECT generation,updated_at FROM "CommunityCommentScreeningOutbox" WHERE comment_id=${commentId} FOR UPDATE`
      if (generation !== undefined && owned?.generation !== generation) return
      if (stale && owned && owned.updated_at.getTime() > Date.now() - 15 * 60_000) return
      const updated = await tx.communityComment.updateMany({
        where: { id: commentId, status: 'pending_screening' },
        data: {
          status: 'screening_failed',
          screening_reason: 'screening_unavailable',
        },
      })
      if (updated.count)
        await this.intake(tx, commentId, 'screening_failed', 'screening_unavailable')
    })
  }

  private async rolloutAllows(userId: string): Promise<boolean> {
    // Missing authority stays fail-closed; the injected service owns remote/fallback policy.
    if (!this.flags) return false
    try {
      const [read, write] = await Promise.all([
        this.flags.getFeatureFlag('community_read_enabled', userId),
        this.flags.getFeatureFlag('community_write_enabled', userId),
      ])
      return Boolean(read && write)
    } catch (error) {
      if (error instanceof ServiceUnavailableException) return false
      throw error
    }
  }

  private async defer(commentId: string, generation?: number): Promise<void> {
    await this.prisma.communityCommentScreeningOutbox.updateMany({
      where: {
        comment_id: commentId,
        ...(generation === undefined ? {} : { generation }),
        comment: { status: 'pending_screening' },
      },
      data: { generation: { increment: 1 }, dispatched_at: null },
    })
  }

  private async intake(
    tx: Prisma.TransactionClient,
    commentId: string,
    action: string,
    reason: string
  ): Promise<void> {
    const now = new Date()
    await tx.communityCommentReport.create({
      data: {
        comment_id: commentId,
        reason: 'inappropriate_content',
        accepted_at: now,
        routed_at: now,
        sla_due_at: new Date(now.getTime() + 86_400_000),
        audit: { create: { action, reason, occurred_at: now } },
      },
    })
  }
}
