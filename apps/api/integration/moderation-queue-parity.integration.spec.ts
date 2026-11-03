// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: I-Q-RISK-PARITY. The SQL rank of the queue, the TypeScript risk of the
// detail and the shared `deriveCaseRisk` agree on every combination (D5).
import { describe, expect, it, beforeAll } from 'vitest'
import {
  communityReportReasonSchema,
  deriveCaseRisk,
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
  type CommunityReportReason,
} from '@couture/api-client/contracts/http'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { moderationQueueTestContext } from './helpers/moderation-queue-context.js'
import {
  SEED_HOUR_MS,
  newRunId,
  seedComment,
  seedMember,
} from './helpers/moderation-queue-seed.js'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const ctx = moderationQueueTestContext()
const { prisma, clock } = ctx
const runId = newRunId()
const REASONS = communityReportReasonSchema.options

const subsets = <T>(items: readonly T[]): T[][] =>
  Array.from({ length: 2 ** items.length - 1 }, (_, mask) =>
    items.filter((_item, index) => ((mask + 1) >> index) & 1)
  )

type Combo = {
  key: string
  source: 'post' | 'comment'
  reasons: CommunityReportReason[]
  finding: boolean
  reporters: number
  caseId: string
}
const combos: Combo[] = []
let moderatorId: string
let boot: Awaited<ReturnType<typeof ctx.bootApp>>

beforeAll(async () => {
  clock.at(NOW)
  moderatorId = (await seedMember(prisma, runId, 'moderator', { alias: false })).id
  const author = await seedMember(prisma, runId, 'author')
  const pool = await Promise.all(
    Array.from({ length: 8 }, (_, n) => seedMember(prisma, runId, `rep${n}`))
  )
  const host = buildLookbookPostCreateInput(
    createLookbookPost({ id: `${runId}-host`, userId: author.id }, { now: NOW })
  )
  await prisma.lookbookPost.create({ data: host })

  const postRows: ReturnType<typeof buildLookbookPostCreateInput>[] = []
  const reportRows: {
    id: string
    post_id: string
    reporter_id: string
    reason: CommunityReportReason
    sla_due_at: Date
    created_at: Date
  }[] = []
  let serial = 0
  for (const reasons of subsets(REASONS)) {
    const k = reasons.length
    for (const finding of [false, true])
      for (const reporters of k < 3 ? [k, 3] : [k, k + 1]) {
        const id = `${runId}-pp${serial++}`
        postRows.push(
          buildLookbookPostCreateInput(
            createLookbookPost(
              {
                id,
                userId: author.id,
                moderationReason: finding ? 'text_policy_match' : null,
                moderationEngineVersion: finding ? '1.2.0' : null,
              },
              { now: NOW }
            )
          )
        )
        for (let index = 0; index < reporters; index++)
          reportRows.push({
            id: `${id}-r${index}`,
            post_id: id,
            reporter_id: pool[index]!.id,
            reason: reasons[index % k]!,
            // A distinct due time per case keeps the queue order total.
            sla_due_at: new Date(NOW.getTime() + (8 + serial / 100) * SEED_HOUR_MS),
            created_at: NOW,
          })
        combos.push({
          key: id,
          source: 'post',
          reasons,
          finding,
          reporters,
          caseId: `post.${id}`,
        })
      }
  }
  await prisma.lookbookPost.createMany({ data: postRows })
  await prisma.communityPostReport.createMany({ data: reportRows })

  for (const reasons of subsets(REASONS)) {
    for (const finding of [false, true]) {
      const label = `cc${serial++}`
      const comment = await seedComment(prisma, {
        runId,
        label,
        postId: host.id!,
        authorId: author.id,
        status: finding ? 'held_for_review' : 'published',
        now: NOW,
      })
      for (const [index, reason] of reasons.entries())
        await prisma.communityCommentReport.create({
          data: {
            id: `${runId}-${label}-r${index}`,
            comment_id: comment.id,
            reporter_id: pool[index]!.id,
            reason,
            content_snapshot: { body: 'b', locale: 'en-US' },
            accepted_at: new Date(NOW.getTime() - 16 * SEED_HOUR_MS),
            routed_at: new Date(NOW.getTime() - 16 * SEED_HOUR_MS),
            sla_due_at: new Date(NOW.getTime() + 8 * SEED_HOUR_MS),
          },
        })
      combos.push({
        key: label,
        source: 'comment',
        reasons,
        finding,
        reporters: reasons.length,
        caseId: `comment.${comment.id}`,
      })
    }
  }
  boot = await ctx.bootApp()
}, 300_000)

describe('I-Q-RISK-PARITY', () => {
  it('seeds every reason subset x finding x reporter bucket', () => {
    expect(combos.filter((entry) => entry.source === 'post')).toHaveLength(63 * 2 * 2)
    expect(combos.filter((entry) => entry.source === 'comment')).toHaveLength(63 * 2)
  })

  it('agrees between the SQL queue rank, the shared derivation and the detail view', async () => {
    const moderator = boot.as('moderator', moderatorId)
    const listed = new Map<string, string>()
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
      for (const item of page.items) listed.set(item.caseId, item.risk)
      cursor = page.nextCursor
    } while (cursor)
    expect(listed.size).toBe(combos.length)

    const mismatches: string[] = []
    for (const combo of combos) {
      const expected = deriveCaseRisk({
        reasons: combo.reasons,
        hasFinding: combo.finding,
        distinctOpenReporters: combo.reporters,
      })
      if (listed.get(combo.caseId) !== expected)
        mismatches.push(
          `queue ${combo.caseId} [${combo.reasons.join(',')}] finding=${combo.finding} reporters=${combo.reporters}: ${listed.get(combo.caseId)} != ${expected}`
        )
      const detail = moderationCaseDetailResponseSchema.parse(
        (await moderator.get(`/api/v1/moderation/cases/${combo.caseId}`).expect(200)).body
      ).data
      if (detail.risk !== expected)
        mismatches.push(`detail ${combo.caseId}: ${detail.risk} != ${expected}`)
    }
    expect(mismatches).toEqual([])
  }, 300_000)

  it('counts an erased reporter as one distinct reporter, matching the derivation', async () => {
    // Three reports on one post, two of them from erased reporters: three distinct people.
    const author = await seedMember(prisma, `${runId}x`, 'author')
    const post = await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ id: `${runId}-erased`, userId: author.id }, { now: NOW })
      ),
    })
    const live = await seedMember(prisma, `${runId}x`, 'live')
    for (const [index, reporterId] of [live.id, null, null].entries())
      await prisma.communityPostReport.create({
        data: {
          id: `${runId}-erased-r${index}`,
          post_id: post.id,
          reporter_id: reporterId,
          reason: 'spam',
          sla_due_at: new Date(NOW.getTime() + 9 * SEED_HOUR_MS),
          created_at: NOW,
        },
      })
    const moderator = boot.as('moderator', moderatorId)
    const caseId = `post.${post.id}`
    const detail = moderationCaseDetailResponseSchema.parse(
      (await moderator.get(`/api/v1/moderation/cases/${caseId}`).expect(200)).body
    ).data
    expect(detail.risk).toBe('medium')
    const queue = moderationCasesResponseSchema.parse(
      (await moderator.get('/api/v1/moderation/cases?risk=medium&limit=50').expect(200))
        .body
    ).data
    // The queue is large; walk until the case is found.
    let found = queue.items.find((item) => item.caseId === caseId)
    let cursor = queue.nextCursor
    while (!found && cursor) {
      const page = moderationCasesResponseSchema.parse(
        (
          await moderator
            .get(`/api/v1/moderation/cases?risk=medium&limit=50&cursor=${cursor}`)
            .expect(200)
        ).body
      ).data
      found = page.items.find((item) => item.caseId === caseId)
      cursor = page.nextCursor
    }
    expect(found?.risk).toBe('medium')
    expect(found?.reportCount).toBe(3)
  })
})
