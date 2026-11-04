// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: I-Q-INTAKE-5MIN and I-Q-CONCURRENCY.
// A member files a report through the real report routes and a moderator reads the queue.
// No row is inserted by hand except the one routed-delay edge case.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
} from '@couture/api-client/contracts/http'
import { persistCommentFixture } from './helpers/community-comments-context.js'
import { moderationQueueTestContext } from './helpers/moderation-queue-context.js'
import { newRunId, seedComment, seedMember } from './helpers/moderation-queue-seed.js'

const ctx = moderationQueueTestContext()
const { prisma, clock } = ctx
const runId = newRunId()
const FIVE_MINUTES_MS = 5 * 60 * 1000

let boot: Awaited<ReturnType<typeof ctx.bootApp>>
let moderatorId: string
let moderator: ReturnType<typeof boot.as>

type Items = ReturnType<typeof moderationCasesResponseSchema.parse>['data']['items']
/** Every open case, walked page by page: other tests in this file add cases too. */
async function openCases(): Promise<Items> {
  const items: Items = []
  let cursor: string | null = null
  do {
    const page: ReturnType<typeof moderationCasesResponseSchema.parse>['data'] =
      moderationCasesResponseSchema.parse(
        (
          await moderator
            .get(`/api/v1/moderation/cases?limit=50${cursor ? `&cursor=${cursor}` : ''}`)
            .expect(200)
        ).body
      ).data
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

beforeAll(async () => {
  clock.real()
  moderatorId = (await seedMember(prisma, runId, 'moderator', { alias: false })).id
  boot = await ctx.bootApp({ withReportRoutes: true })
  moderator = boot.as('moderator', moderatorId)
}, 120_000)

describe('I-Q-INTAKE-5MIN: an accepted report is visible in the queue', () => {
  it('shows a post report and a comment report on the next read, well inside five minutes', async () => {
    const { user: author, post } = await persistCommentFixture(prisma, 'adult')
    const reporter = await persistCommentFixture(prisma, 'adult')

    // Prime the queue first, so a cache that fills on the first read would hide what follows.
    const primed = await openCases()
    expect(primed.map((item) => item.caseId)).not.toContain(`post.${post.id}`)
    await moderator.get('/api/v1/moderation/cases').expect(200)

    const acceptedAt = Date.now()
    await boot
      .as('guardian', reporter.user.id)
      .post(`/api/v1/community/posts/${post.id}/report`)
      .send({ reason: 'harassment', details: 'filed through the real route' })
      .expect(200)

    const afterPost = await openCases()
    const postCase = afterPost.find((item) => item.caseId === `post.${post.id}`)
    expect(postCase, 'post case missing from the next queue read').toBeDefined()
    expect(postCase).toMatchObject({ source: 'post', status: 'open', reportCount: 1 })
    expect(Date.now() - Date.parse(postCase!.acceptedAt)).toBeLessThan(FIVE_MINUTES_MS)
    expect(Date.parse(postCase!.acceptedAt)).toBeGreaterThanOrEqual(acceptedAt - 2000)

    const comment = await seedComment(prisma, {
      runId,
      label: 'intake',
      postId: post.id,
      authorId: author.id,
      now: new Date(),
    })
    const response = await boot
      .as('guardian', reporter.user.id)
      .post(`/api/v1/community/posts/${post.id}/comments/${comment.id}/report`)
      .send({ reason: 'spam' })
      .expect(200)
    expect((response.body as { data: unknown }).data).toMatchObject({ reported: true })

    const afterComment = await openCases()
    const commentCase = afterComment.find(
      (item) => item.caseId === `comment.${comment.id}`
    )
    expect(commentCase).toMatchObject({
      source: 'comment',
      status: 'open',
      reportCount: 1,
    })
    expect(Date.now() - Date.parse(commentCase!.acceptedAt)).toBeLessThan(FIVE_MINUTES_MS)
    // Both stay in the same read: nothing the earlier read produced is replayed from a cache.
    expect(afterComment.map((item) => item.caseId)).toEqual(
      expect.arrayContaining([`post.${post.id}`, `comment.${comment.id}`])
    )
  })

  it('shows a second report on an old post as a higher count on the same case', async () => {
    const { post } = await persistCommentFixture(prisma, 'adult')
    const first = await persistCommentFixture(prisma, 'adult')
    const second = await persistCommentFixture(prisma, 'adult')
    await boot
      .as('guardian', first.user.id)
      .post(`/api/v1/community/posts/${post.id}/report`)
      .send({ reason: 'spam' })
      .expect(200)
    expect(
      (await openCases()).find((item) => item.caseId === `post.${post.id}`)?.reportCount
    ).toBe(1)

    await boot
      .as('guardian', second.user.id)
      .post(`/api/v1/community/posts/${post.id}/report`)
      .send({ reason: 'violence' })
      .expect(200)
    const grouped = (await openCases()).filter(
      (item) => item.caseId === `post.${post.id}`
    )
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({
      reportCount: 2,
      reasons: ['spam', 'violence'],
      risk: 'high',
    })
  })

  it('still shows the case 299 seconds after acceptance, with no time-to-live in the read path', async () => {
    const { post } = await persistCommentFixture(prisma, 'adult')
    const reporter = await persistCommentFixture(prisma, 'adult')
    await boot
      .as('guardian', reporter.user.id)
      .post(`/api/v1/community/posts/${post.id}/report`)
      .send({ reason: 'other' })
      .expect(200)
    const report = await prisma.communityPostReport.findFirstOrThrow({
      where: { post_id: post.id },
    })
    clock.at(new Date(report.created_at.getTime() + 299_000))
    try {
      const items = await openCases()
      expect(items.map((item) => item.caseId)).toContain(`post.${post.id}`)
    } finally {
      clock.real()
    }
  })

  it('shows a comment report whose routing was delayed by the full five minutes', async () => {
    const { user: author, post } = await persistCommentFixture(prisma, 'adult')
    const reporter = await seedMember(prisma, `${runId}d`, 'reporter')
    const comment = await seedComment(prisma, {
      runId: `${runId}d`,
      label: 'delay',
      postId: post.id,
      authorId: author.id,
      now: new Date(),
    })
    const acceptedAt = new Date()
    await prisma.communityCommentReport.create({
      data: {
        id: `${runId}-delay-report`,
        comment_id: comment.id,
        reporter_id: reporter.id,
        reason: 'spam',
        content_snapshot: { body: 'delayed', locale: 'en-US' },
        accepted_at: acceptedAt,
        routed_at: new Date(acceptedAt.getTime() + FIVE_MINUTES_MS),
        sla_due_at: new Date(acceptedAt.getTime() + 24 * 3_600_000),
      },
    })
    expect((await openCases()).map((item) => item.caseId)).toContain(
      `comment.${comment.id}`
    )
  })

  it('opens the filed case with the reporter alias and the live post state', async () => {
    const { post } = await persistCommentFixture(prisma, 'adult')
    const reporter = await persistCommentFixture(prisma, 'adult')
    await boot
      .as('guardian', reporter.user.id)
      .post(`/api/v1/community/posts/${post.id}/report`)
      .send({ reason: 'inappropriate_content', details: 'details typed by the reporter' })
      .expect(200)
    const detail = moderationCaseDetailResponseSchema.parse(
      (await moderator.get(`/api/v1/moderation/cases/post.${post.id}`).expect(200)).body
    ).data
    expect(detail).toMatchObject({
      status: 'open',
      target: { state: 'live', status: 'published' },
      reportCount: 1,
    })
    expect(detail.reporters[0]).toMatchObject({
      reason: 'inappropriate_content',
      details: 'details typed by the reporter',
    })
    expect(detail.snapshot.available).toBe(true)
    // The reported event the report route writes is not repeated as a prior action.
    expect(detail.priorActions.map((action) => action.action)).not.toContain('reported')
  })
})

describe('I-Q-CONCURRENCY: reads beside live intake', () => {
  it('serves 20 queue reads and 20 detail reads while ten reports arrive, with one audit row per detail read', async () => {
    const targets = await Promise.all(
      Array.from({ length: 10 }, () => persistCommentFixture(prisma, 'adult'))
    )
    const reporters = await Promise.all(
      Array.from({ length: 10 }, () => persistCommentFixture(prisma, 'adult'))
    )
    const seedPostId = targets[0]!.post.id
    await boot
      .as('guardian', reporters[0]!.user.id)
      .post(`/api/v1/community/posts/${seedPostId}/report`)
      .send({ reason: 'spam' })
      .expect(200)

    const auditBefore = await prisma.auditLog.count({
      where: { user_id: moderatorId, event_type: 'moderation_case_viewed' },
    })
    const results = await Promise.all([
      ...targets.map((target, index) =>
        boot
          .as('guardian', reporters[index]!.user.id)
          .post(`/api/v1/community/posts/${target.post.id}/report`)
          .send({ reason: 'harassment' })
      ),
      ...Array.from({ length: 20 }, () =>
        moderator.get('/api/v1/moderation/cases?limit=50')
      ),
      ...Array.from({ length: 20 }, () =>
        moderator.get(`/api/v1/moderation/cases/post.${seedPostId}`)
      ),
    ])
    const statuses = results.map((response) => response.status)
    // Reporter 0 re-reports the seeded post with another reason: that one answers 409, the rest 200.
    expect(statuses.filter((status) => status >= 500)).toEqual([])
    expect(statuses.slice(10).every((status) => status === 200)).toBe(true)
    expect(
      await prisma.auditLog.count({
        where: { user_id: moderatorId, event_type: 'moderation_case_viewed' },
      })
    ).toBe(auditBefore + 20)

    const cases = (await openCases()).map((item) => item.caseId)
    for (const target of targets.slice(1))
      expect(cases).toContain(`post.${target.post.id}`)
  }, 60_000)
})
