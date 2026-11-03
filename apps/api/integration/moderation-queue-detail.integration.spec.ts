// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: stored-data robustness of the case detail and the queue.
// I-Q-DETAIL extras: findings versus operator notes, prior actions, snapshot hostility, media
// reasons, comment context, oversized values. No stored value may turn a read into a 500.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
} from '@couture/api-client/contracts/http'
import { moderationQueueTestContext } from './helpers/moderation-queue-context.js'
import {
  SEED_HOUR_MS,
  newRunId,
  seedComment,
  seedCommentReport,
  seedMember,
  seedPost,
  seedPostReport,
} from './helpers/moderation-queue-seed.js'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const ctx = moderationQueueTestContext()
const { prisma, clock, storage } = ctx
const runId = newRunId()

let boot: Awaited<ReturnType<typeof ctx.bootApp>>
let moderator: ReturnType<typeof boot.as>
let moderatorId: string
let author: Awaited<ReturnType<typeof seedMember>>
let reporter: Awaited<ReturnType<typeof seedMember>>
let host: Awaited<ReturnType<typeof seedPost>>
const at = (hours: number) => new Date(NOW.getTime() + hours * SEED_HOUR_MS)

beforeAll(async () => {
  clock.at(NOW)
  moderatorId = (await seedMember(prisma, runId, 'moderator', { alias: false })).id
  author = await seedMember(prisma, runId, 'author')
  reporter = await seedMember(prisma, runId, 'reporter')
  host = await seedPost(prisma, { runId, label: 'host', authorId: author.id, now: NOW })
  boot = await ctx.bootApp()
  moderator = boot.as('moderator', moderatorId)
}, 120_000)

afterEach(() => {
  storage.signReadUrl.mockClear()
})

/** A reported post with the given overrides. Returns its case id and ids. */
async function reportedPost(
  label: string,
  options: {
    reason?: 'spam' | 'harassment' | 'hate_speech'
    post?: Partial<Parameters<typeof seedPost>[1]>
    report?: Partial<Parameters<typeof seedPostReport>[1]>
  } = {}
) {
  const post = await seedPost(prisma, {
    runId,
    label,
    authorId: author.id,
    now: NOW,
    ...options.post,
  })
  const report = await seedPostReport(prisma, {
    runId,
    label,
    postId: post.id,
    reporterId: reporter.id,
    reason: options.reason ?? 'spam',
    createdAt: NOW,
    dueAt: at(12),
    subjectAlias: author.alias,
    imageObjectPath: post.image_object_path,
    ...options.report,
  })
  return { post, report, caseId: `post.${post.id}` }
}

const detail = async (caseId: string) =>
  moderationCaseDetailResponseSchema.parse(
    (await moderator.get(`/api/v1/moderation/cases/${caseId}`).expect(200)).body
  ).data

describe('findings versus operator notes (D5)', () => {
  it('reads a takedown reason as an operator note with no risk bump', async () => {
    const note = 'Violates community guidelines section 4.'
    const { caseId, post } = await reportedPost('takedown', {
      post: {
        status: 'flagged',
        moderationReason: note,
        moderationEngineVersion: '1.2.0',
      },
    })
    await prisma.moderationEvent.create({
      data: {
        post_id: post.id,
        reviewed_by_id: moderatorId,
        action: 'taken_down_by_operator',
        reason: note,
        created_at: at(-1),
      },
    })
    const data = await detail(caseId)
    expect(data.findings).toEqual({
      codes: [],
      categories: [],
      engineVersion: '1.2.0',
      operatorNote: note,
    })
    expect(data.risk).toBe('low')
    expect(data.priorActions).toEqual([
      expect.objectContaining({
        actorKind: 'operator',
        action: 'taken_down_by_operator',
        reason: note,
      }),
    ])
  })

  it('treats a reason that mixes known and unknown codes as an operator note', async () => {
    const { caseId } = await reportedPost('mixed', {
      post: {
        moderationReason: 'text_policy_match, mystery_code',
        moderationEngineVersion: '1.0.0',
      },
    })
    const data = await detail(caseId)
    expect(data.findings).toMatchObject({
      codes: [],
      operatorNote: 'text_policy_match, mystery_code',
    })
    expect(data.risk).toBe('low')
  })

  it('reads the fallback code and several codes as machine findings that raise the risk', async () => {
    const fallback = await detail(
      (
        await reportedPost('fallback', {
          post: {
            moderationReason: 'flagged_by_screening',
            moderationEngineVersion: '1.0.0',
          },
        })
      ).caseId
    )
    expect(fallback.findings).toMatchObject({
      codes: ['flagged_by_screening'],
      categories: ['incomplete'],
    })
    expect(fallback.risk).toBe('medium')

    const several = await detail(
      (
        await reportedPost('several', {
          post: {
            moderationReason: 'text_policy_match, unsafe_class',
            moderationEngineVersion: '1.0.0',
          },
        })
      ).caseId
    )
    expect(several.findings?.codes).toEqual(['text_policy_match', 'unsafe_class'])
    expect(several.findings?.categories).toEqual(
      expect.arrayContaining(['language', 'photo'])
    )
    expect(several.risk).toBe('medium')
  })

  it('keeps the finding and its bump on a post an operator released (RG3) and lists both actions', async () => {
    const { caseId, post } = await reportedPost('released', {
      post: { moderationReason: 'text_policy_match', moderationEngineVersion: '1.2.0' },
    })
    await prisma.moderationEvent.createMany({
      data: [
        {
          post_id: post.id,
          action: 'flagged',
          reason: 'text_policy_match',
          created_at: at(-3),
        },
        {
          post_id: post.id,
          action: 'released_by_operator',
          reason: 'looks fine',
          reviewed_by_id: moderatorId,
          overridden_engine_version: '1.2.0',
          created_at: at(-2),
        },
      ],
    })
    const data = await detail(caseId)
    expect(data.risk).toBe('medium')
    expect(data.priorActions.map((action) => [action.actorKind, action.action])).toEqual([
      ['screening', 'flagged'],
      ['operator', 'released_by_operator'],
    ])
  })

  it('reads a comment held for review as a finding', async () => {
    const comment = await seedComment(prisma, {
      runId,
      label: 'held',
      postId: host.id,
      authorId: author.id,
      status: 'held_for_review',
      screeningReason: 'text_policy_match',
      now: NOW,
    })
    await seedCommentReport(prisma, {
      runId,
      label: 'held',
      commentId: comment.id,
      reporterId: reporter.id,
      reason: 'spam',
      acceptedAt: at(-12),
      snapshot: { unavailable: true },
    })
    const data = await detail(`comment.${comment.id}`)
    expect(data.risk).toBe('medium')
    expect(data.findings).toMatchObject({ categories: ['language'] })
    expect(data.snapshot.available).toBe(false)
    expect(data.target.status).toBe('held_for_review')
  })
})

describe('prior actions', () => {
  it('maps unknown and null actions, clamps long values, and omits the reported duplicates', async () => {
    const { caseId, post } = await reportedPost('events')
    await prisma.moderationEvent.createMany({
      data: [
        {
          post_id: post.id,
          action: 'reported',
          reason: 'spam',
          flagged_by_id: reporter.id,
          created_at: at(-5),
        },
        { post_id: post.id, action: null, reason: null, created_at: at(-4) },
        {
          post_id: post.id,
          action: 'a'.repeat(200),
          reason: 'r'.repeat(6000),
          reviewed_by_id: moderatorId,
          created_at: at(-3),
        },
        {
          post_id: post.id,
          action: 'future_action_6_11',
          reason: 'x',
          flagged_by_id: reporter.id,
          created_at: at(-2),
        },
      ],
    })
    const data = await detail(caseId)
    expect(data.priorActions.map((action) => action.action)).not.toContain('reported')
    expect(data.priorActions).toHaveLength(3)
    expect(data.priorActions[0]).toMatchObject({
      action: 'unknown',
      actorKind: 'screening',
      reason: null,
    })
    expect(data.priorActions[1]!.action.length).toBeLessThanOrEqual(64)
    expect(data.priorActions[1]!.reason!.length).toBeLessThanOrEqual(2000)
    expect(data.priorActions[1]!.actorKind).toBe('operator')
    expect(data.priorActions[2]).toMatchObject({
      action: 'future_action_6_11',
      actorKind: 'reporter',
    })
    // No operator or reporter id leaves the API.
    expect(JSON.stringify(data)).not.toContain(moderatorId)
    expect(JSON.stringify(data)).not.toContain(reporter.id)
  })

  it('lists comment audit rows after the reported duplicate is left out', async () => {
    const comment = await seedComment(prisma, {
      runId,
      label: 'audited',
      postId: host.id,
      authorId: author.id,
      now: NOW,
    })
    const report = await seedCommentReport(prisma, {
      runId,
      label: 'audited',
      commentId: comment.id,
      reporterId: reporter.id,
      reason: 'harassment',
      acceptedAt: at(-6),
    })
    await prisma.communityCommentAudit.create({
      data: {
        report_id: report.id,
        action: 'resolved',
        reason: 'unfounded',
        occurred_at: at(-1),
      },
    })
    const data = await detail(`comment.${comment.id}`)
    expect(data.priorActions.map((action) => action.action)).toEqual(['resolved'])
  })
})

describe('hostile and malformed stored values never fail a read', () => {
  it('reads a malformed snapshot as unavailable and never returns unknown keys', async () => {
    for (const [label, snapshot] of [
      ['snapstring', 'oops'],
      ['snaparray', ['caption']],
      ['snapempty', {}],
      ['snapnum', 7],
      ['snapnull', null],
    ] as const) {
      const { caseId } = await reportedPost(label, {
        report: { snapshot: snapshot as never },
      })
      const data = await detail(caseId)
      expect(data.snapshot.available, label).toBe(false)
    }
    const { caseId } = await reportedPost('snapleak', {
      report: {
        snapshot: {
          caption: 'visible',
          user_id: 'leaked-user-id',
          email: 'leak@example.test',
          secretKey: 'leaked-secret',
          nested: { deep: 'leaked-deep' },
        } as never,
      },
    })
    const response = await moderator.get(`/api/v1/moderation/cases/${caseId}`).expect(200)
    const body = response.body as { data: { snapshot: { caption: string } } }
    expect(body.data.snapshot.caption).toBe('visible')
    expect(response.text).not.toMatch(/leaked|leak@/)
  })

  it('returns hostile text verbatim as data, for the console to render inert', async () => {
    const hostile = [
      '<script>alert(1)</script>',
      '[click](javascript:alert(1))',
      '‮evil‬',
      'zero​width',
      'x'.repeat(500),
      'line1\nline2',
    ]
    const { caseId } = await reportedPost('hostile', {
      report: {
        details: hostile.join('\n'),
        snapshot: {
          caption: hostile[0],
          altText: hostile[2],
          capturedAt: NOW.toISOString(),
        },
      },
    })
    const data = await detail(caseId)
    expect(data.snapshot.caption).toBe(hostile[0])
    expect(data.snapshot.altText).toBe(hostile[2])
    expect(data.reporters[0]!.details).toBe(hostile.join('\n').slice(0, 500))
  })

  it('keeps the whole queue readable with an oversized locale and a hostile excerpt in it', async () => {
    await reportedPost('biglocale', {
      report: { snapshot: { caption: 'e'.repeat(1000), locale: 'x'.repeat(100) } },
    })
    const items: ReturnType<typeof moderationCasesResponseSchema.parse>['data']['items'] =
      []
    let cursor: string | null = null
    do {
      const page: ReturnType<typeof moderationCasesResponseSchema.parse>['data'] =
        moderationCasesResponseSchema.parse(
          (
            await moderator
              .get(
                `/api/v1/moderation/cases?limit=50${cursor ? `&cursor=${cursor}` : ''}`
              )
              .expect(200)
          ).body
        ).data
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)
    const big = items.find((item) => item.caseId.includes('biglocale'))!
    expect(big.locale).toBeNull()
    expect(big.excerpt!.length).toBeLessThanOrEqual(280)
  })

  it('reads a subject with no alias and no report alias as unknown', async () => {
    const stranger = await seedMember(prisma, `${runId}s`, 'stranger', { alias: false })
    const post = await seedPost(prisma, {
      runId,
      label: 'noalias',
      authorId: stranger.id,
      now: NOW,
    })
    await seedPostReport(prisma, {
      runId,
      label: 'noalias',
      postId: post.id,
      reporterId: reporter.id,
      reason: 'spam',
      createdAt: NOW,
      dueAt: at(12),
      subjectAlias: null,
    })
    expect((await detail(`post.${post.id}`)).subject).toEqual({
      state: 'unknown',
      alias: null,
    })
  })
})

describe('media reasons (D8)', () => {
  const mediaOf = async (label: string, post: Partial<Parameters<typeof seedPost>[1]>) =>
    (await detail((await reportedPost(label, { post })).caseId)).media

  it('pins each closed reason', async () => {
    expect(
      await mediaOf('mAnon', { anonymizedAt: NOW, caption: null, altText: null })
    ).toEqual({
      state: 'unavailable',
      reason: 'anonymized',
    })
    expect(await mediaOf('mPurged', { objectsPurgedAt: NOW })).toEqual({
      state: 'unavailable',
      reason: 'purged',
    })
    expect(await mediaOf('mNone', { noImage: true })).toEqual({
      state: 'unavailable',
      reason: 'no_image',
    })
    expect(storage.signReadUrl).not.toHaveBeenCalled()
  })

  it('keeps the case readable when signing fails and leaks neither the path nor the error', async () => {
    storage.signReadUrl.mockRejectedValueOnce(
      new Error(
        'Object community/secret-path/abc.jpg not found in bucket community-images'
      )
    )
    const { caseId, post } = await reportedPost('mFail')
    const response = await moderator.get(`/api/v1/moderation/cases/${caseId}`).expect(200)
    const failed = response.body as {
      data: { media: unknown; snapshot: { available: boolean } }
    }
    expect(failed.data.media).toEqual({
      state: 'unavailable',
      reason: 'signing_failed',
    })
    expect(failed.data.snapshot.available).toBe(true)
    expect(response.text).not.toMatch(/secret-path|community-images|not found/)
    expect(response.text).not.toContain(post.image_object_path as string)
  })

  it('signs the live image for the 120-second window and no longer', async () => {
    const { caseId } = await reportedPost('mOk')
    const media = (await detail(caseId)).media
    expect(media.state).toBe('available')
    expect(storage.signReadUrl).toHaveBeenCalledWith(
      expect.stringContaining('community/'),
      120
    )
    if (media.state === 'available')
      expect(Date.parse(media.expiresAt) - NOW.getTime()).toBe(120_000)
  })
})

describe('comment context', () => {
  it('shows the parent body of a live reply and a deleted comment from its snapshot', async () => {
    const parent = await seedComment(prisma, {
      runId,
      label: 'parent',
      postId: host.id,
      authorId: author.id,
      body: 'the parent body',
      now: NOW,
    })
    const reply = await seedComment(prisma, {
      runId,
      label: 'reply',
      postId: host.id,
      authorId: author.id,
      parentId: parent.id,
      now: NOW,
    })
    await seedCommentReport(prisma, {
      runId,
      label: 'reply',
      commentId: reply.id,
      reporterId: reporter.id,
      reason: 'spam',
      acceptedAt: at(-3),
    })
    expect((await detail(`comment.${reply.id}`)).target.parentBody).toBe(
      'the parent body'
    )

    const deleted = await seedComment(prisma, {
      runId,
      label: 'deleted',
      postId: host.id,
      authorId: author.id,
      status: 'author_deleted',
      now: NOW,
    })
    await seedCommentReport(prisma, {
      runId,
      label: 'deleted',
      commentId: deleted.id,
      reporterId: reporter.id,
      reason: 'spam',
      acceptedAt: at(-3),
      snapshot: { body: 'what the reporter saw', locale: 'en-US' },
    })
    const data = await detail(`comment.${deleted.id}`)
    expect(data.target.status).toBe('author_deleted')
    expect(data.snapshot.body).toBe('what the reporter saw')
  })
})
