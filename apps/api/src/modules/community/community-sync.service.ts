// Story 6.5 owner: captured heads before views, bounded two-lane scans and fresh visibility.
import { ConflictException, Inject, Injectable } from '@nestjs/common'
import {
  Prisma,
  PrismaClient,
  type CommunityStreamEvent as StoredEvent,
  type CommunityStreamHead,
  type ClimateBand,
} from '@prisma/client'
import {
  type CommunityFeedMode,
  type CommunityStreamEvent,
} from '@couture/api-client/contracts/http'
import { CommunityAccessService } from './community-access.service.js'
import { CommunityService } from './community.service.js'
import { CommunityStreamRepository } from './community-stream.repository.js'
import {
  decodeCommunityCursor,
  encodeCommunityCursor,
  type CommunityCursor,
} from './community-cursor.js'
import {
  CommunityAuthorizationBudget,
  communityDependency,
  CommunityUnavailableException,
} from './community-availability.js'
type Scope = { mode: CommunityFeedMode; band: ClimateBand | null }
import { PUBLICLY_VISIBLE_POST_WHERE } from './community.repository.js'
import { assertCommunitySubjectAvailable } from './community-privacy.js'

function commentRouting(comment: { id: string } | null, parentId: string | null) {
  return {
    ...(comment ? { commentId: comment.id } : {}),
    ...(parentId ? { parentId } : {}),
  }
}

function publicCommentMatches(
  comment:
    | {
        status: string
        parent_id: string | null
        post_id: string
        parent: { status: string; post_id: string } | null
      }
    | undefined,
  event: StoredEvent
) {
  return (
    comment?.status === 'published' &&
    comment.parent_id === event.parent_id &&
    (!comment.parent_id ||
      (comment.parent?.status === 'published' &&
        comment.parent.post_id === comment.post_id))
  )
}

@Injectable()
export class CommunitySyncService {
  private assistance: Promise<number> | undefined
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(CommunityAccessService) private readonly access: CommunityAccessService,
    @Inject(CommunityService) private readonly community: CommunityService,
    @Inject(CommunityStreamRepository) private readonly streams: CommunityStreamRepository
  ) {}

  async events(member: string, mode: CommunityFeedMode, cursor?: string) {
    const budget = new CommunityAuthorizationBudget()
    return communityDependency(() =>
      budget.run(async () => {
        // Erasure is a primary-backed terminal denial, including when its cache row is gone.
        await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL statement_timeout = '${Math.min(500, budget.remaining())}ms'`
            )
            await assertCommunitySubjectAvailable(tx, member)
          },
          { timeout: budget.remaining(), maxWait: budget.remaining() }
        )
        let grant = await this.access.authorize(member, budget)
        const scope = await this.community.syncScope(member, mode)
        const decoded = cursor ? decodeCommunityCursor(cursor, member, scope.mode) : null
        if (decoded && decoded.band !== scope.band) this.resync()
        if (!this.assistance)
          this.assistance = Promise.resolve()
            .then(() => this.streams.assist())
            .catch(() => 0)
            .finally(() => {
              this.assistance = undefined
            })
        const captured = await this.prisma.$transaction(
          async (tx) => {
            const heads = await tx.communityStreamHead.findMany({
              where: { OR: [{ id: 'public' }, { owner_id: member }] },
            })
            const publicHead = heads.find((h) => h.id === 'public')
            const privateHead = heads.find((h) => h.owner_id === member)
            if (!privateHead) await assertCommunitySubjectAvailable(tx, member)
            if (!publicHead || !privateHead) throw new CommunityUnavailableException()
            const next: CommunityCursor = {
              version: 1,
              member,
              ...scope,
              public: {
                epoch: publicHead.epoch,
                position: publicHead.sequence.toString(),
              },
              private: {
                epoch: privateHead.epoch,
                position: privateHead.sequence.toString(),
              },
            }
            if (!decoded) return { next, events: [] as StoredEvent[], hasMore: false }
            this.validateHeads(decoded, publicHead, privateHead)
            const { events, hasMore } = await this.readLanes(
              tx,
              decoded,
              next,
              publicHead,
              privateHead
            )
            return { next, events, hasMore }
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
            timeout: budget.remaining(),
            maxWait: budget.remaining(),
          }
        )
        // A fresh primary visibility check happens after ending the captured snapshot.
        const events = await this.serializeEvents(captured.events, member, scope)
        grant = await this.access.authorize(member, budget)
        const fresh = await this.finalizeEvents(events, member, scope)
        budget.check(grant)
        return {
          events: fresh,
          nextCursor: encodeCommunityCursor(captured.next),
          hasMore: captured.hasMore,
          resyncRequired: fresh.some((e) => e.kind === 'resync'),
        }
      })
    )
  }

  private async finalizeEvents(
    events: CommunityStreamEvent[],
    member: string,
    scope: Scope
  ): Promise<CommunityStreamEvent[]> {
    const postIds = events.flatMap((event) => ('postId' in event ? [event.postId] : []))
    const visible = new Set(
      (
        await this.prisma.lookbookPost.findMany({
          where: {
            id: { in: postIds },
            ...PUBLICLY_VISIBLE_POST_WHERE,
            ...(scope.band ? { climate_band: scope.band } : {}),
          },
          select: { id: true },
        })
      ).map((post) => post.id)
    )
    const commentIds = events.flatMap((event) =>
      'commentId' in event && event.commentId ? [event.commentId] : []
    )
    const comments = await this.prisma.communityComment.findMany({
      where: { id: { in: commentIds } },
      select: {
        id: true,
        user_id: true,
        post_id: true,
        parent_id: true,
        status: true,
        parent: { select: { status: true } },
      },
    })
    return events.flatMap((event): CommunityStreamEvent[] => {
      if (event.kind === 'resync') return [event]
      const comment =
        'commentId' in event
          ? comments.find(
              (row) => row.id === event.commentId && row.post_id === event.postId
            )
          : undefined
      if (event.kind === 'comment.status')
        return comment?.user_id === member ? [event] : []
      if (!visible.has(event.postId))
        return [{ version: 1, kind: 'resync', resyncRequired: true }]
      if (
        event.commentId &&
        (!comment ||
          comment.status !== 'published' ||
          (comment.parent_id && comment.parent?.status !== 'published'))
      )
        return [{ version: 1, kind: 'resync', resyncRequired: true }]
      return [event]
    })
  }

  private validateHeads(
    decoded: CommunityCursor,
    publicHead: CommunityStreamHead,
    privateHead: CommunityStreamHead
  ) {
    for (const [lane, head] of [
      ['public', publicHead],
      ['private', privateHead],
    ] as const) {
      if (
        decoded[lane].epoch !== head.epoch ||
        BigInt(decoded[lane].position) < head.retention_floor ||
        BigInt(decoded[lane].position) > head.sequence
      )
        this.resync()
    }
  }
  private async readLanes(
    tx: Prisma.TransactionClient,
    decoded: CommunityCursor,
    next: CommunityCursor,
    publicHead: CommunityStreamHead,
    privateHead: CommunityStreamHead
  ) {
    const events: StoredEvent[] = []
    let hasMore = false
    for (const [lane, head] of [
      ['public', publicHead],
      ['private', privateHead],
    ] as const) {
      const rows = await tx.communityStreamEvent.findMany({
        where: {
          stream_id: head.id,
          sequence: { gt: BigInt(decoded[lane].position), lte: head.sequence },
        },
        orderBy: { sequence: 'asc' },
        take: 100,
      })
      const last = rows.at(-1)
      const remains = rows.length === 100 && last && last.sequence < head.sequence
      next[lane].position = (remains && last ? last.sequence : head.sequence).toString()
      hasMore ||= Boolean(remains)
      events.push(...rows)
    }
    return { events, hasMore }
  }
  private async serializeEvents(
    rows: StoredEvent[],
    member: string,
    scope: Scope
  ): Promise<CommunityStreamEvent[]> {
    const posts = await this.prisma.lookbookPost.findMany({
      where: {
        id: { in: rows.flatMap((row) => (row.post_id ? [row.post_id] : [])) },
        ...PUBLICLY_VISIBLE_POST_WHERE,
      },
      select: { id: true, climate_band: true },
    })
    const comments = await this.prisma.communityComment.findMany({
      where: {
        id: { in: rows.flatMap((row) => (row.comment_id ? [row.comment_id] : [])) },
      },
      select: {
        id: true,
        user_id: true,
        post_id: true,
        parent_id: true,
        status: true,
        parent: { select: { status: true, post_id: true } },
      },
    })
    return rows.flatMap((event): CommunityStreamEvent[] => {
      const comment = comments.find(
        (row) => row.id === event.comment_id && row.post_id === event.post_id
      )
      if (event.kind === 'comment.status')
        return comment?.user_id === member
          ? [
              {
                version: 1,
                kind: 'comment.status',
                postId: comment.post_id,
                commentId: comment.id,
                privateRevision: event.revision.toString(),
              },
            ]
          : []
      const post = posts.find((row) => row.id === event.post_id)
      const commentVisible = publicCommentMatches(comment, event)
      if (!post || event.kind === 'resync' || (event.comment_id && !commentVisible))
        return [{ version: 1, kind: 'resync', resyncRequired: true }]
      if (scope.band && scope.band !== post.climate_band) return []
      if (
        event.kind === 'post.published' ||
        event.kind === 'reactions.changed' ||
        event.kind === 'comment.published'
      )
        return [
          {
            version: 1,
            kind: event.kind,
            postId: post.id,
            communityRevision: event.revision.toString(),
            ...commentRouting(comment ?? null, event.parent_id),
          },
        ]
      return []
    })
  }

  private resync(): never {
    throw new ConflictException({
      statusCode: 409,
      code: 'resync_required',
      message: 'Community resynchronization required.',
    })
  }
}
