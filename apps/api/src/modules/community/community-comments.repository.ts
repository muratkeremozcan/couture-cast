import { assertCommunityReadEligibility } from './community-access.service.js'
import type { CommunityAuthorizationBudget } from './community-availability.js'
import {
  guardCommunityPost,
  assertCommunitySubjectAvailable,
} from './community-privacy.js'
import { sharedCommunityReportRetryAfter } from './community-report-limit.js'
// Story 6.4 owner: member/post serialized threads and synchronous moderation intake.
import { createHash, randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClient, Prisma, type CommunityComment as CommentRow } from '@prisma/client'
import {
  communityCommentsCursorSchema,
  type CommunityCommentsCursor,
  type CommunityCommentsPage,
  type CommunityComment,
  type CommunityCommentSubmission,
  type CreateCommunityCommentInput,
  type CommunityPlatform,
  type CommunityReportReason,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE,
  COMMUNITY_COMMENT_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_COMMENT_SELF_REPORT_MESSAGE,
  COMMUNITY_COMMENT_SUBMISSION_RATE_LIMITED_MESSAGE,
  COMMUNITY_REPORT_RATE_LIMITED_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
} from '@couture/api-client/contracts/http'
import {
  PUBLICLY_VISIBLE_POST_WHERE,
  isPubliclyVisiblePost,
} from './community.repository.js'
import { CommunityRateLimitException } from './community-rate-limit.exception.js'
import { communitySubjectToken, isCommunityCanaryUser } from './community-analytics.js'
import { generateCommunityAuthorAlias } from './community-alias.js'

type Tx = Prisma.TransactionClient
export type CommentEligibility = (tx: Tx, participation: boolean) => Promise<void>
const DAY_MS = 86_400_000
const publicStates = [
  'published',
  'author_deleted',
  'consent_suspended',
  'erased',
] as const

export function commentSubmission(row: CommentRow): CommunityCommentSubmission {
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    status: row.status,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    publicationSequence: row.publication_sequence,
  }
}

export function encodeCommentCursor(value: CommunityCommentsCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function decodeCommentCursor(
  cursor: string,
  postId: string,
  parentId: string | null
): CommunityCommentsCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    const parsed = communityCommentsCursorSchema.parse(value)
    if (parsed.postId !== postId || parsed.parentId !== parentId) throw new Error('scope')
    return parsed
  } catch {
    throw new BadRequestException(COMMUNITY_CURSOR_INVALID_MESSAGE)
  }
}

export async function commentAnalytics(
  tx: Tx,
  userId: string,
  event: string,
  platform: string,
  self: boolean,
  reply: boolean
): Promise<void> {
  if (isCommunityCanaryUser(userId)) return
  const actor = communitySubjectToken(userId)
  const subject = await tx.communityCommentAnalyticsSubject.upsert({
    where: { user_id: userId },
    update: {},
    create: { user_id: userId, actor },
  })
  await tx.communityCommentAnalyticsOutbox.create({
    data: {
      id: randomUUID(),
      actor: subject.actor,
      event_type: event,
      payload: { platform, isSelf: self, isReply: reply },
    },
  })
}

@Injectable()
export class CommunityCommentsRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}
  assertReadEligibility(member: string, budget: CommunityAuthorizationBudget) {
    return assertCommunityReadEligibility(this.prisma, member, budget)
  }

  async withThread<T>(
    userId: string,
    postId: string,
    eligible: CommentEligibility,
    work: (
      tx: Tx,
      post: { user_id: string; comment_publication_sequence: number }
    ) => Promise<T>,
    readOnly = false,
    privacyMutation = false
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        if (privacyMutation) await guardCommunityPost(tx, postId)
        if (readOnly) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('community_member:' || ${userId}))`
          await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${postId} FOR SHARE`
        } else {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${userId}))`
          await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${postId} FOR UPDATE`
        }
        const post = await tx.lookbookPost.findFirst({
          where: { id: postId, ...PUBLICLY_VISIBLE_POST_WHERE },
        })
        if (!post || !isPubliclyVisiblePost(post))
          throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
        await assertCommunitySubjectAvailable(tx, userId)
        await eligible(tx, false)
        return work(tx, post)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    )
  }

  async list(params: {
    userId: string
    postId: string
    parentId: string | null
    cursor?: string
    limit: number
    eligible: CommentEligibility
  }): Promise<CommunityCommentsPage> {
    const { postId, parentId, userId, limit } = params
    const cursor = params.cursor
      ? decodeCommentCursor(params.cursor, postId, parentId)
      : undefined
    return this.withThread(
      userId,
      postId,
      params.eligible,
      async (tx, post) => {
        if (parentId) await this.visibleComment(tx, postId, parentId, true)
        const snapshot = cursor?.snapshot ?? post.comment_publication_sequence
        if (snapshot > post.comment_publication_sequence)
          throw new BadRequestException(COMMUNITY_CURSOR_INVALID_MESSAGE)
        const rows = await tx.communityComment.findMany({
          where: {
            post_id: postId,
            parent_id: parentId,
            status: { in: [...publicStates] },
            publication_sequence: { gt: cursor?.after ?? 0, lte: snapshot },
          },
          orderBy: { publication_sequence: 'asc' },
          take: limit + 1,
        })
        const page = rows.slice(0, limit)
        const authors = [
          ...new Set(page.flatMap((row) => (row.user_id ? [row.user_id] : []))),
        ]
        const roots = page.filter((row) => row.parent_id === null).map((row) => row.id)
        const [aliasRows, counts] = await Promise.all([
          tx.communityAlias.findMany({
            where: { user_id: { in: authors } },
            select: { user_id: true, alias: true },
          }),
          tx.communityComment.groupBy({
            by: ['parent_id'],
            where: {
              post_id: postId,
              parent_id: { in: roots },
              publication_sequence: { lte: snapshot },
              status: { in: [...publicStates] },
            },
            _count: { _all: true },
          }),
        ])
        const aliases = new Map(aliasRows.map((row) => [row.user_id, row.alias]))
        const replyCounts = new Map(counts.map((row) => [row.parent_id, row._count._all]))
        const items: CommunityComment[] = page.map((row) => {
          const unavailable = row.status !== 'published' || !row.user_id
          return {
            id: row.id,
            postId,
            parentId: row.parent_id,
            body: unavailable ? null : row.body,
            author: unavailable ? null : (aliases.get(row.user_id!) ?? null),
            isOwn: row.user_id === userId,
            unavailable,
            publicationSequence: row.publication_sequence!,
            publishedAt: row.published_at!.toISOString(),
            replyCount: replyCounts.get(row.id) ?? 0,
          }
        })
        const last = items.at(-1)
        return {
          items,
          snapshot,
          hasNewer: post.comment_publication_sequence > snapshot,
          nextCursor:
            rows.length > limit && last
              ? encodeCommentCursor({
                  kind: parentId ? 'replies' : 'roots',
                  postId,
                  parentId,
                  snapshot,
                  after: last.publicationSequence,
                })
              : null,
        }
      },
      true
    )
  }

  async submissions(params: {
    userId: string
    postId: string
    cursor?: string
    limit: number
    eligible: CommentEligibility
  }) {
    let after: { created_at: Date; id: string } | undefined
    if (params.cursor) {
      try {
        const raw: unknown = JSON.parse(
          Buffer.from(params.cursor, 'base64url').toString('utf8')
        )
        if (
          typeof raw !== 'object' ||
          !raw ||
          !('postId' in raw) ||
          raw.postId !== params.postId ||
          !('userId' in raw) ||
          raw.userId !== communitySubjectToken(params.userId) ||
          !('id' in raw) ||
          typeof raw.id !== 'string' ||
          !('createdAt' in raw) ||
          typeof raw.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(raw.createdAt))
        )
          throw new Error('cursor')
        after = { id: raw.id, created_at: new Date(raw.createdAt) }
      } catch {
        throw new BadRequestException(COMMUNITY_CURSOR_INVALID_MESSAGE)
      }
    }
    return this.withThread(
      params.userId,
      params.postId,
      params.eligible,
      async (tx) => {
        const rows = await tx.communityComment.findMany({
          where: {
            user_id: params.userId,
            post_id: params.postId,
            ...(after
              ? {
                  OR: [
                    { created_at: { lt: after.created_at } },
                    { created_at: after.created_at, id: { lt: after.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: params.limit + 1,
        })
        const page = rows.slice(0, params.limit)
        const last = page.at(-1)
        return {
          items: page.map(commentSubmission),
          nextCursor:
            rows.length > params.limit && last
              ? Buffer.from(
                  JSON.stringify({
                    postId: params.postId,
                    userId: communitySubjectToken(params.userId),
                    id: last.id,
                    createdAt: last.created_at.toISOString(),
                  })
                ).toString('base64url')
              : null,
        }
      },
      true
    )
  }

  async create(params: {
    userId: string
    postId: string
    input: CreateCommunityCommentInput
    platform: CommunityPlatform
    eligible: CommentEligibility
  }): Promise<CommunityCommentSubmission> {
    const { userId, postId, input, platform } = params
    const hash = createHash('sha256')
      .update(JSON.stringify([postId, input.parentId, input.body, input.locale]))
      .digest('hex')
    return this.withThread(userId, postId, params.eligible, async (tx, post) => {
      const receipt = await tx.communityCommentReceipt.findUnique({
        where: {
          user_id_mutation_id: { user_id: userId, mutation_id: input.mutationId },
        },
        include: { comment: true },
      })
      if (receipt) {
        if (receipt.payload_hash !== hash)
          throw new ConflictException(COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE)
        return commentSubmission(receipt.comment)
      }
      await params.eligible(tx, true)
      if (input.parentId) {
        const parent = await this.visibleComment(tx, postId, input.parentId, true)
        if (parent.status !== 'published')
          throw new BadRequestException('Reply target is unavailable.')
      }
      const now = new Date()
      const recent = await tx.communityComment.findMany({
        where: { user_id: userId, created_at: { gt: new Date(now.getTime() - DAY_MS) } },
        orderBy: { created_at: 'asc' },
        select: { created_at: true },
      })
      const minute = recent.filter(
        (row) => row.created_at.getTime() > now.getTime() - 60_000
      )
      const exceeded =
        minute.length >= 60
          ? { rows: minute, window: 60_000 }
          : recent.length >= 200
            ? { rows: recent, window: DAY_MS }
            : null
      if (exceeded)
        throw new CommunityRateLimitException(
          COMMUNITY_COMMENT_SUBMISSION_RATE_LIMITED_MESSAGE,
          Math.max(
            1,
            Math.ceil(
              ((exceeded.rows[0]?.created_at.getTime() ?? now.getTime()) +
                exceeded.window -
                now.getTime()) /
                1000
            )
          )
        )
      await tx.communityAlias.upsert({
        where: { user_id: userId },
        update: {},
        create: { user_id: userId, alias: generateCommunityAuthorAlias() },
      })
      const row = await tx.communityComment.create({
        data: {
          post_id: postId,
          user_id: userId,
          parent_id: input.parentId,
          body: input.body,
          locale: input.locale,
          platform,
          receipt: {
            create: {
              user_id: userId,
              mutation_id: input.mutationId,
              payload_hash: hash,
            },
          },
          screening_outbox: { create: {} },
        },
      })
      await commentAnalytics(
        tx,
        userId,
        'community_comment_submitted',
        platform,
        userId === post.user_id,
        input.parentId !== null
      )
      return commentSubmission(row)
    })
  }

  async delete(params: {
    userId: string
    postId: string
    commentId: string
    platform: CommunityPlatform
    eligible: CommentEligibility
  }): Promise<CommunityCommentSubmission> {
    return this.withThread(
      params.userId,
      params.postId,
      params.eligible,
      async (tx, post) => {
        const row = await tx.communityComment.findFirst({
          where: { id: params.commentId, post_id: params.postId },
        })
        if (!row) throw new NotFoundException('Comment not found.')
        if (row.user_id !== params.userId)
          throw new ForbiddenException('Only the author can delete a comment.')
        if (row.status === 'author_deleted') return commentSubmission(row)
        const deleted = await tx.communityComment.update({
          where: { id: row.id },
          data: { status: 'author_deleted', body: null, screening_reason: null },
        })
        await tx.communityCommentScreeningOutbox.deleteMany({
          where: { comment_id: row.id },
        })
        await commentAnalytics(
          tx,
          params.userId,
          'community_comment_deleted',
          params.platform,
          post.user_id === params.userId,
          row.parent_id !== null
        )
        return commentSubmission(deleted)
      },
      false,
      true
    )
  }

  async report(params: {
    userId: string
    postId: string
    commentId: string
    reason: CommunityReportReason
    platform: CommunityPlatform
    eligible: CommentEligibility
  }) {
    // Share the reporter lock and quota with post reports. Acquire it before post locks.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${params.userId}))`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_report:' || ${params.userId}))`
        await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${params.postId} FOR UPDATE`
        const post = await tx.lookbookPost.findFirst({
          where: { id: params.postId, ...PUBLICLY_VISIBLE_POST_WHERE },
        })
        if (!post) throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
        await params.eligible(tx, false)
        const row = await this.visibleComment(tx, params.postId, params.commentId)
        if (row.user_id === params.userId)
          throw new ForbiddenException(COMMUNITY_COMMENT_SELF_REPORT_MESSAGE)
        const existing = await tx.communityCommentReport.findUnique({
          where: {
            comment_id_reporter_id: {
              comment_id: row.id,
              reporter_id: params.userId,
            },
          },
        })
        if (existing) {
          if (existing.reason !== params.reason)
            throw new ConflictException(COMMUNITY_COMMENT_REPORT_REASON_CHANGED_MESSAGE)
          return this.reportResult(existing)
        }
        const now = new Date()
        const retryAfterSeconds = await sharedCommunityReportRetryAfter(
          tx,
          params.userId,
          50,
          now
        )
        if (retryAfterSeconds !== null)
          throw new CommunityRateLimitException(
            COMMUNITY_REPORT_RATE_LIMITED_MESSAGE,
            retryAfterSeconds
          )
        const report = await tx.communityCommentReport.create({
          data: {
            comment_id: row.id,
            reporter_id: params.userId,
            reason: params.reason,
            content_snapshot:
              row.status === 'published'
                ? { body: row.body, locale: row.locale }
                : { unavailable: true },
            accepted_at: now,
            routed_at: now,
            sla_due_at: new Date(now.getTime() + DAY_MS),
            audit: {
              create: { action: 'reported', reason: params.reason, occurred_at: now },
            },
          },
        })
        await commentAnalytics(
          tx,
          params.userId,
          'community_comment_reported',
          params.platform,
          false,
          row.parent_id !== null
        )
        return this.reportResult(report)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    )
  }

  private reportResult(row: { accepted_at: Date; routed_at: Date; sla_due_at: Date }) {
    return {
      reported: true as const,
      acceptedAt: row.accepted_at.toISOString(),
      routedAt: row.routed_at.toISOString(),
      reviewDueAt: row.sla_due_at.toISOString(),
    }
  }

  private async visibleComment(
    tx: Tx,
    postId: string,
    id: string,
    root = false
  ): Promise<CommentRow> {
    const row = await tx.communityComment.findFirst({
      where: {
        id,
        post_id: postId,
        status: { in: [...publicStates] },
        publication_sequence: { not: null },
        ...(root ? { parent_id: null } : {}),
      },
    })
    if (!row) throw new BadRequestException('Comment target is unavailable.')
    return row
  }
}
