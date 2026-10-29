// Story 6.5 owner: versioned snapshot projection and exact off-page thread locations.
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  Prisma,
  PrismaClient,
  type CommunityComment,
  type LookbookPost,
} from '@prisma/client'
import {
  type ResolveCommunityTargetsInput,
  type CommunityComment as PublicComment,
  resolvedCommunityTargetSchema,
} from '@couture/api-client/contracts/http'
import { CommunityAccessService } from './community-access.service.js'
import {
  CommunityRepository,
  PUBLICLY_VISIBLE_POST_WHERE,
} from './community.repository.js'
import { CommunityService } from './community.service.js'
import { encodeCommentCursor } from './community-comments.repository.js'

import {
  CommunityAuthorizationBudget,
  communityDependency,
} from './community-availability.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
const publicStatuses = [
  'published',
  'author_deleted',
  'consent_suspended',
  'erased',
] as const
@Injectable()
export class CommunityTargetsService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(CommunityAccessService) private readonly access: CommunityAccessService,
    @Inject(CommunityRepository) private readonly repository: CommunityRepository,
    @Inject(CommunityService) private readonly community: CommunityService
  ) {}

  async resolve(member: string, input: ResolveCommunityTargetsInput) {
    const budget = new CommunityAuthorizationBudget()
    return communityDependency(() =>
      budget.run(async () => {
        await this.access.authorize(member, budget)
        const objectPaths = new Map<string, string | null>()
        const targets = await this.resolveBatch(
          member,
          input.targets,
          budget,
          objectPaths
        )
        const grant = await this.access.authorize(member, budget)
        const fresh = await this.finalizeTargets(targets, objectPaths)
        budget.check(grant)
        return { targets: fresh }
      })
    )
  }

  private async finalizeTargets(
    targets: ReturnType<typeof resolvedCommunityTargetSchema.parse>[],
    objectPaths: Map<string, string | null>
  ) {
    const available = targets.filter((target) => target.status === 'available')
    if (!available.length) return targets
    const posts = await this.prisma.lookbookPost.findMany({
      where: {
        id: { in: available.map((target) => target.post.id) },
        ...PUBLICLY_VISIBLE_POST_WHERE,
      },
      select: { id: true, caption: true, alt_text: true, image_object_path: true },
    })
    const ids = available.flatMap((target) =>
      [target.comment?.id, target.parent?.id].filter((id): id is string => Boolean(id))
    )
    const comments = ids.length
      ? await this.prisma.communityComment.findMany({
          where: {
            id: { in: ids },
            status: 'published',
            OR: [{ parent_id: null }, { parent: { is: { status: 'published' } } }],
          },
          select: { id: true, post_id: true, parent_id: true, body: true },
        })
      : []
    return targets.map((target) => {
      if (target.status !== 'available') return target
      const post = posts.find(
        (post) =>
          post.id === target.post.id &&
          post.caption === target.post.caption &&
          post.alt_text === target.post.altText &&
          post.image_object_path === objectPaths.get(target.key)
      )
      if (!post) return { key: target.key, status: 'unavailable' as const }
      const visible = (comment: PublicComment | null) =>
        comment &&
        comments.some(
          (row) =>
            row.id === comment.id &&
            row.post_id === post.id &&
            row.parent_id === comment.parentId &&
            row.body === comment.body
        )
      const parent = visible(target.parent) ? target.parent : null
      const comment =
        visible(target.comment) && (!target.comment?.parentId || parent)
          ? target.comment
          : null
      return {
        ...target,
        comment,
        parent,
        pageCursor: comment ? target.pageCursor : null,
        parentPageCursor: parent ? target.parentPageCursor : null,
        threadPosition: comment ? target.threadPosition : null,
      }
    })
  }

  private async resolveBatch(
    member: string,
    targets: ResolveCommunityTargetsInput['targets'],
    budget: CommunityAuthorizationBudget,
    objectPaths: Map<string, string | null>,
    retry = false
  ): Promise<ReturnType<typeof resolvedCommunityTargetSchema.parse>[]> {
    const snapshot = await interactiveTransaction(
      this.prisma,
      (tx) => this.captureTargets(tx, member, targets),
      () => ({
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: budget.remaining(),
        maxWait: budget.remaining(),
      })
    )
    const projected = new Map(
      (
        await this.community.projectSnapshot(snapshot.posts, member, snapshot.summaries)
      ).map((post) => [post.id, post])
    )
    const fresh = await this.prisma.lookbookPost.findMany({
      where: {
        id: { in: snapshot.posts.map((post) => post.id) },
        ...PUBLICLY_VISIBLE_POST_WHERE,
      },
      select: { id: true, community_revision: true },
    })
    const revised = retry
      ? []
      : targets.filter((target) => {
          const post = snapshot.posts.find((post) => post.id === target.postId)
          const current = fresh.find((post) => post.id === target.postId)
          return post && current && post.community_revision !== current.community_revision
        })
    const replacements = new Map(
      (revised.length
        ? await this.resolveBatch(member, revised, budget, objectPaths, true)
        : []
      ).map((target) => [target.key, target])
    )
    return snapshot.targets.map((capture) => {
      const replacement = replacements.get(capture.target.key)
      if (replacement) return replacement
      const post = capture.post && projected.get(capture.post.id)
      if (!post || !capture.post || !fresh.some((row) => row.id === post.id))
        return { key: capture.target.key, status: 'unavailable' }
      objectPaths.set(capture.target.key, capture.post.image_object_path)
      return resolvedCommunityTargetSchema.parse({
        key: capture.target.key,
        status: 'available',
        communityRevision: capture.post.community_revision.toString(),
        post,
        comment: capture.comment,
        parent: capture.parent,
        pageCursor: capture.pageCursor,
        parentPageCursor: capture.parentPageCursor,
        threadPosition: capture.threadPosition,
      })
    })
  }

  private async captureTargets(
    tx: Prisma.TransactionClient,
    member: string,
    targets: ResolveCommunityTargetsInput['targets']
  ) {
    const posts = await tx.lookbookPost.findMany({
      where: {
        id: { in: targets.map((target) => target.postId) },
        ...PUBLICLY_VISIBLE_POST_WHERE,
      },
    })
    const summaries = await this.repository.reactionSummaries(
      posts.map((post) => post.id),
      member,
      tx
    )
    const comments = await tx.communityComment.findMany({
      where: {
        id: {
          in: targets.flatMap((target) => (target.commentId ? [target.commentId] : [])),
        },
        post_id: { in: posts.map((post) => post.id) },
        status: 'published',
      },
    })
    const parents = await tx.communityComment.findMany({
      where: {
        id: {
          in: [
            ...new Set([
              ...comments.flatMap((row) => (row.parent_id ? [row.parent_id] : [])),
              ...targets.flatMap((target) => (target.parentId ? [target.parentId] : [])),
            ]),
          ],
        },
        post_id: { in: posts.map((post) => post.id) },
        parent_id: null,
        status: 'published',
      },
    })
    const rows = [...comments, ...parents]
    const aliases = await tx.communityAlias.findMany({
      where: {
        user_id: { in: rows.flatMap((row) => (row.user_id ? [row.user_id] : [])) },
      },
    })
    const counts = await tx.communityComment.groupBy({
      by: ['parent_id'],
      where: {
        parent_id: { in: rows.map((row) => row.id) },
        status: { in: [...publicStatuses] },
      },
      _count: true,
    })
    const locations = await this.locations(tx, rows)
    const project = (row: CommunityComment | null): PublicComment | null =>
      row
        ? {
            id: row.id,
            postId: row.post_id,
            parentId: row.parent_id,
            body: row.body,
            author: aliases.find((alias) => alias.user_id === row.user_id)?.alias ?? null,
            isOwn: row.user_id === member,
            unavailable: false,
            publicationSequence: row.publication_sequence!,
            publishedAt: row.published_at!.toISOString(),
            replyCount: counts.find((count) => count.parent_id === row.id)?._count ?? 0,
          }
        : null
    const location = (row: CommunityComment | null, post: LookbookPost | undefined) => {
      if (!row || !post) return { cursor: null, position: null }
      const place = locations.find((place) => place.id === row.id)
      return {
        position: place?.position ?? 0,
        cursor: encodeCommentCursor({
          kind: row.parent_id ? 'replies' : 'roots',
          postId: post.id,
          parentId: row.parent_id,
          snapshot: post.comment_publication_sequence,
          after: place?.after ?? 0,
        }),
      }
    }
    return {
      posts,
      summaries,
      targets: targets.map((target) => {
        const post = posts.find((post) => post.id === target.postId)
        const raw =
          comments.find(
            (row) => row.id === target.commentId && row.post_id === post?.id
          ) ?? null
        if (raw && target.parentId && raw.parent_id !== target.parentId)
          throw new BadRequestException({
            statusCode: 400,
            code: 'invalid_request',
            message: 'Invalid target relationship.',
          })
        const parent =
          parents.find(
            (row) =>
              row.id === (raw?.parent_id ?? target.parentId) && row.post_id === post?.id
          ) ?? null
        const focus = raw && (!raw.parent_id || parent) ? raw : null
        const place = location(focus, post)
        return {
          target,
          post,
          comment: project(focus),
          parent: project(parent),
          pageCursor: place.cursor,
          parentPageCursor: location(parent, post).cursor,
          threadPosition: place.position,
        }
      }),
    }
  }

  private async locations(tx: Prisma.TransactionClient, rows: CommunityComment[]) {
    if (!rows.length) return []
    return tx.$queryRaw<{ id: string; position: number; after: number }[]>(Prisma.sql`
      SELECT focus.id, place.position, coalesce(boundary.publication_sequence,0)::int AS after
      FROM "CommunityComment" focus
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS position FROM "CommunityComment" older
        WHERE older.post_id=focus.post_id AND older.parent_id IS NOT DISTINCT FROM focus.parent_id
          AND older.status IN (${Prisma.join(publicStatuses.map((status) => Prisma.sql`${status}::"CommunityCommentStatus"`))}) AND older.publication_sequence<focus.publication_sequence
      ) place ON true
      LEFT JOIN LATERAL (
        SELECT older.publication_sequence FROM "CommunityComment" older
        WHERE older.post_id=focus.post_id AND older.parent_id IS NOT DISTINCT FROM focus.parent_id
          AND older.status IN (${Prisma.join(publicStatuses.map((status) => Prisma.sql`${status}::"CommunityCommentStatus"`))}) AND older.publication_sequence<focus.publication_sequence
        ORDER BY older.publication_sequence OFFSET greatest((place.position/20)*20-1,0) LIMIT 1
      ) boundary ON place.position>=20
      WHERE focus.id IN (${Prisma.join([...new Set(rows.map((row) => row.id))])})
    `)
  }
}
