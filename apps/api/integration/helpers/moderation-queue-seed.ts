// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: one seed for the moderator queue, shared by the integration specs.
// Every id carries the run id because AuditLog is immutable and its user_id is a RESTRICT
// foreign key, so moderators and their audit rows are never deleted. Unique ids keep runs apart.
import { randomUUID } from 'node:crypto'
import type { CommunityReportReason, PrismaClient } from '@prisma/client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { buildCommunityContentSnapshot } from '../../src/modules/community/community-audit-snapshot.js'

export const SEED_MINUTE_MS = 60_000
export const SEED_HOUR_MS = 60 * SEED_MINUTE_MS
export const SEED_DAY_MS = 24 * SEED_HOUR_MS

export const newRunId = () => randomUUID().replaceAll('-', '').slice(0, 12)

export async function seedMember(
  prisma: PrismaClient,
  runId: string,
  label: string,
  options: { alias?: boolean } = {}
) {
  const user = await persistUser(prisma, createUser())
  const alias = `${runId}-${label}`
  if (options.alias !== false) {
    await prisma.communityAlias.create({ data: { user_id: user.id, alias } })
  }
  return { id: user.id, alias }
}

export async function seedPost(
  prisma: PrismaClient,
  params: {
    runId: string
    label: string
    authorId: string
    caption?: string | null
    altText?: string | null
    locale?: string | null
    status?: 'published' | 'flagged' | 'withdrawn'
    moderationReason?: string | null
    moderationEngineVersion?: string | null
    anonymizedAt?: Date | null
    objectsPurgedAt?: Date | null
    noImage?: boolean
    now: Date
  }
) {
  const id = `${params.runId}-post-${params.label}`
  const fixture = createLookbookPost(
    {
      id,
      userId: params.authorId,
      status: params.status ?? 'published',
      caption: params.caption === undefined ? `Caption ${params.label}` : params.caption,
      altText: params.altText === undefined ? `Alt ${params.label}` : params.altText,
      locale: params.locale === undefined ? 'en-US' : params.locale,
      moderationReason: params.moderationReason ?? null,
      moderationEngineVersion: params.moderationEngineVersion ?? null,
      anonymizedAt: params.anonymizedAt ?? null,
      objectsPurgedAt: params.objectsPurgedAt ?? null,
      ...(params.noImage ? { imageObjectPath: null } : {}),
      publishedAt: params.status === 'flagged' ? null : params.now,
    },
    { now: params.now }
  )
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(fixture),
  })
  return post
}

export async function seedPostReport(
  prisma: PrismaClient,
  params: {
    runId: string
    label: string
    postId: string | null
    reporterId: string | null
    reason: CommunityReportReason
    createdAt: Date
    dueAt: Date
    resolvedAt?: Date | null
    details?: string | null
    snapshot?: Record<string, unknown> | null
    subjectAlias?: string | null
    imageObjectPath?: string | null
  }
) {
  return prisma.communityPostReport.create({
    data: {
      id: `${params.runId}-prep-${params.label}`,
      post_id: params.postId,
      reporter_id: params.reporterId,
      reason: params.reason,
      details: params.details ?? null,
      content_snapshot:
        params.snapshot === null
          ? undefined
          : ((params.snapshot ??
              buildCommunityContentSnapshot(
                {
                  caption: `Snapshot caption ${params.label}`,
                  alt_text: `Snapshot alt ${params.label}`,
                  locale: 'en-US',
                  climate_band: 'temperate_dry',
                },
                params.createdAt
              )) as never),
      subject_alias: params.subjectAlias ?? null,
      image_object_path: params.imageObjectPath ?? null,
      sla_due_at: params.dueAt,
      created_at: params.createdAt,
      resolved_at: params.resolvedAt ?? null,
    },
  })
}

let commentSequence = 0

export async function seedComment(
  prisma: PrismaClient,
  params: {
    runId: string
    label: string
    postId: string
    authorId: string
    status?: 'published' | 'held_for_review' | 'blocked' | 'author_deleted'
    body?: string
    locale?: string
    parentId?: string | null
    screeningReason?: string | null
    now: Date
  }
) {
  const status = params.status ?? 'published'
  const published = status === 'published' || status === 'author_deleted'
  const sequence = published ? ++commentSequence : null
  return prisma.communityComment.create({
    data: {
      id: `${params.runId}-cmt-${params.label}`,
      post_id: params.postId,
      user_id: params.authorId,
      parent_id: params.parentId ?? null,
      body:
        status === 'author_deleted' ? null : (params.body ?? `Comment ${params.label}`),
      locale: params.locale ?? 'en-US',
      status,
      publication_sequence: sequence,
      published_at: published ? params.now : null,
      platform: 'web',
      screening_reason: params.screeningReason ?? null,
    },
  })
}

export async function seedCommentReport(
  prisma: PrismaClient,
  params: {
    runId: string
    label: string
    commentId: string | null
    reporterId: string | null
    authorId?: string | null
    reason: CommunityReportReason
    acceptedAt: Date
    resolvedAt?: Date | null
    snapshot?: Record<string, unknown> | null
    routedDelayMs?: number
  }
) {
  return prisma.communityCommentReport.create({
    data: {
      id: `${params.runId}-crep-${params.label}`,
      comment_id: params.commentId,
      comment_author_id: params.authorId ?? null,
      reporter_id: params.reporterId,
      reason: params.reason,
      content_snapshot: (params.snapshot === undefined
        ? { body: `Snapshot body ${params.label}`, locale: 'en-US' }
        : params.snapshot) as never,
      accepted_at: params.acceptedAt,
      routed_at: new Date(params.acceptedAt.getTime() + (params.routedDelayMs ?? 0)),
      sla_due_at: new Date(params.acceptedAt.getTime() + SEED_DAY_MS),
      resolved_at: params.resolvedAt ?? null,
      audit: {
        create: {
          action: 'reported',
          reason: params.reason,
          occurred_at: params.acceptedAt,
        },
      },
    },
  })
}

export type SeededCaseExpectation = {
  caseId: string
  source: 'post' | 'comment'
  risk: 'low' | 'medium' | 'high'
  riskRank: 0 | 1 | 2
  slaState: 'breached' | 'at_risk' | 'on_track' | 'resolved'
  dueAt: Date
  reportCount: number
  /** `null` for a case with no locale; the filter value for it is `unknown`. */
  locale: string | null
  status: 'open' | 'resolved'
}

/**
 * The named scenario set. Sort order for the open set is F, B, A, D, C, G, E:
 * high (F breached, B at 3 h, A at 10 h), medium (D at 2 h, C at 5 h), low (G at 4 h, E at 20 h).
 * H is resolved; K (flagged, unreported) and L (held, unreported) are never queue items (D2).
 */
export async function seedModerationQueue(
  prisma: PrismaClient,
  params: { runId?: string; now: Date }
) {
  const runId = params.runId ?? newRunId()
  const { now } = params
  const at = (hours: number) => new Date(now.getTime() + hours * SEED_HOUR_MS)
  const ago = (minutes: number) => new Date(now.getTime() - minutes * SEED_MINUTE_MS)

  const moderator = await seedMember(prisma, runId, 'moderator', { alias: false })
  const author = await seedMember(prisma, runId, 'author')
  const reporters = await Promise.all(
    [1, 2, 3, 4].map((n) => seedMember(prisma, runId, `reporter${n}`))
  )
  const [r1, r2, r3, r4] = reporters as [
    (typeof reporters)[number],
    (typeof reporters)[number],
    (typeof reporters)[number],
    (typeof reporters)[number],
  ]
  const bareReporter = await seedMember(prisma, runId, 'bare', { alias: false })

  const postA = await seedPost(prisma, { runId, label: 'A', authorId: author.id, now })
  await seedPostReport(prisma, {
    runId,
    label: 'A',
    postId: postA.id,
    reporterId: r1.id,
    reason: 'hate_speech',
    createdAt: ago(30),
    dueAt: at(10),
    subjectAlias: author.alias,
    imageObjectPath: postA.image_object_path,
    details: 'Reporter note for A',
  })

  const postB = await seedPost(prisma, {
    runId,
    label: 'B',
    authorId: author.id,
    locale: 'es-419',
    now,
  })
  const bReasons = ['harassment', 'spam', 'other'] as const
  for (const [index, reporter] of [r1, r2, r3].entries()) {
    await seedPostReport(prisma, {
      runId,
      label: `B${index}`,
      postId: postB.id,
      reporterId: reporter.id,
      reason: bReasons[index]!,
      createdAt: ago(60 - index),
      dueAt: at(3 + index),
      subjectAlias: author.alias,
      imageObjectPath: postB.image_object_path,
      snapshot: {
        caption: 'Caption B',
        altText: 'Alt B',
        locale: 'es-419',
        climateBand: 'temperate_dry',
        capturedAt: ago(60).toISOString(),
      },
    })
  }

  const postC = await seedPost(prisma, {
    runId,
    label: 'C',
    authorId: author.id,
    moderationReason: 'text_policy_match',
    moderationEngineVersion: '1.2.0',
    now,
  })
  await seedPostReport(prisma, {
    runId,
    label: 'C',
    postId: postC.id,
    reporterId: r4.id,
    reason: 'spam',
    createdAt: ago(10),
    dueAt: at(5),
    subjectAlias: author.alias,
    imageObjectPath: postC.image_object_path,
  })

  const postE = await seedPost(prisma, {
    runId,
    label: 'E',
    authorId: author.id,
    locale: 'fr-FR',
    now,
  })
  await seedPostReport(prisma, {
    runId,
    label: 'E',
    postId: postE.id,
    reporterId: bareReporter.id,
    reason: 'spam',
    createdAt: ago(5),
    dueAt: at(20),
    subjectAlias: author.alias,
    imageObjectPath: postE.image_object_path,
    snapshot: {
      caption: 'Caption E',
      altText: 'Alt E',
      locale: 'fr-FR',
      climateBand: 'temperate_dry',
      capturedAt: ago(5).toISOString(),
    },
  })

  const commentHost = await seedPost(prisma, {
    runId,
    label: 'host',
    authorId: author.id,
    now,
  })
  const commentD = await seedComment(prisma, {
    runId,
    label: 'D',
    postId: commentHost.id,
    authorId: author.id,
    locale: 'es-419',
    now,
  })
  const commentReportD = await seedCommentReport(prisma, {
    runId,
    label: 'D',
    commentId: commentD.id,
    reporterId: r2.id,
    reason: 'harassment',
    acceptedAt: at(2 - 24),
    snapshot: { body: 'Snapshot body D', locale: 'es-419' },
  })

  const orphanPostReport = await seedPostReport(prisma, {
    runId,
    label: 'F',
    postId: null,
    reporterId: null,
    reason: 'violence',
    createdAt: ago(25 * 60),
    dueAt: at(-1),
    subjectAlias: author.alias,
    imageObjectPath: `community/${runId}-erased/gone.jpg`,
    snapshot: {
      caption: 'Caption F',
      altText: 'Alt F',
      locale: 'de-DE',
      climateBand: 'temperate_dry',
      capturedAt: ago(25 * 60).toISOString(),
    },
  })

  const orphanCommentReport = await seedCommentReport(prisma, {
    runId,
    label: 'G',
    commentId: null,
    reporterId: r3.id,
    reason: 'other',
    acceptedAt: at(4 - 24),
    snapshot: { unavailable: true },
  })

  const postH = await seedPost(prisma, { runId, label: 'H', authorId: author.id, now })
  await seedPostReport(prisma, {
    runId,
    label: 'H',
    postId: postH.id,
    reporterId: r1.id,
    reason: 'spam',
    createdAt: ago(300),
    dueAt: at(1),
    resolvedAt: ago(120),
    subjectAlias: author.alias,
  })

  const postK = await seedPost(prisma, {
    runId,
    label: 'K',
    authorId: author.id,
    status: 'flagged',
    moderationReason: 'text_policy_match',
    moderationEngineVersion: '1.2.0',
    now,
  })
  const commentL = await seedComment(prisma, {
    runId,
    label: 'L',
    postId: commentHost.id,
    authorId: author.id,
    status: 'held_for_review',
    now,
  })

  const expectations: Record<string, SeededCaseExpectation> = {
    A: {
      caseId: `post.${postA.id}`,
      source: 'post',
      risk: 'high',
      riskRank: 2,
      slaState: 'on_track',
      dueAt: at(10),
      reportCount: 1,
      locale: 'en-US',
      status: 'open',
    },
    B: {
      caseId: `post.${postB.id}`,
      source: 'post',
      risk: 'high',
      riskRank: 2,
      slaState: 'at_risk',
      dueAt: at(3),
      reportCount: 3,
      locale: 'es-419',
      status: 'open',
    },
    C: {
      caseId: `post.${postC.id}`,
      source: 'post',
      risk: 'medium',
      riskRank: 1,
      slaState: 'at_risk',
      dueAt: at(5),
      reportCount: 1,
      locale: 'en-US',
      status: 'open',
    },
    D: {
      caseId: `comment.${commentD.id}`,
      source: 'comment',
      risk: 'medium',
      riskRank: 1,
      slaState: 'at_risk',
      dueAt: at(2),
      reportCount: 1,
      locale: 'es-419',
      status: 'open',
    },
    E: {
      caseId: `post.${postE.id}`,
      source: 'post',
      risk: 'low',
      riskRank: 0,
      slaState: 'on_track',
      dueAt: at(20),
      reportCount: 1,
      locale: 'fr-FR',
      status: 'open',
    },
    F: {
      caseId: `orphan-post.${orphanPostReport.id}`,
      source: 'post',
      risk: 'high',
      riskRank: 2,
      slaState: 'breached',
      dueAt: at(-1),
      reportCount: 1,
      locale: 'de-DE',
      status: 'open',
    },
    G: {
      caseId: `orphan-comment.${orphanCommentReport.id}`,
      source: 'comment',
      risk: 'low',
      riskRank: 0,
      slaState: 'at_risk',
      dueAt: at(4),
      reportCount: 1,
      locale: null,
      status: 'open',
    },
    H: {
      caseId: `post.${postH.id}`,
      source: 'post',
      risk: 'low',
      riskRank: 0,
      slaState: 'resolved',
      dueAt: at(1),
      reportCount: 1,
      locale: 'en-US',
      status: 'resolved',
    },
  }

  return {
    runId,
    now,
    moderator,
    author,
    reporters: { r1, r2, r3, r4, bare: bareReporter },
    posts: {
      A: postA,
      B: postB,
      C: postC,
      E: postE,
      H: postH,
      K: postK,
      host: commentHost,
    },
    comments: { D: commentD, L: commentL },
    reports: { commentReportD, orphanPostReport, orphanCommentReport },
    expectations,
    /** Open cases in the order the queue must return them. */
    openOrder: ['F', 'B', 'A', 'D', 'C', 'G', 'E'] as const,
    /** Case ids that must never appear: flagged without a report, held without a report. */
    neverQueued: [`post.${postK.id}`, `comment.${commentL.id}`],
  }
}

export type SeededQueue = Awaited<ReturnType<typeof seedModerationQueue>>

/** Bulk open cases for ties and plan tests: identical rank and due, distinct keys. */
export async function seedBulkOpenPosts(
  prisma: PrismaClient,
  params: {
    runId: string
    count: number
    authorId: string
    reporterId: string
    reason: CommunityReportReason
    createdAt: Date
    dueAt: Date
  }
) {
  const { runId, count, authorId, reporterId, reason, createdAt, dueAt } = params
  const posts = Array.from({ length: count }, (_, index) => {
    const id = `${runId}-bulk-${String(index).padStart(5, '0')}`
    return buildLookbookPostCreateInput(
      createLookbookPost({ id, userId: authorId }, { now: createdAt })
    )
  })
  await prisma.lookbookPost.createMany({ data: posts })
  await prisma.communityPostReport.createMany({
    data: posts.map((post, index) => ({
      id: `${runId}-bulkrep-${String(index).padStart(5, '0')}`,
      post_id: post.id as string,
      reporter_id: reporterId,
      reason,
      content_snapshot: buildCommunityContentSnapshot(
        { caption: 'Bulk', alt_text: 'Bulk', locale: 'en-US', climate_band: null },
        createdAt
      ) as never,
      subject_alias: 'bulk',
      sla_due_at: dueAt,
      created_at: createdAt,
    })),
  })
  return posts.map((post) => `post.${post.id as string}`)
}
