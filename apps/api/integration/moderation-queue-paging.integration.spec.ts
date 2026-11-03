// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: keyset stability, change between pages, resolution and erasure.
// I-Q-KEYSET-TIES, I-Q-PAGING-UNDER-CHANGE, I-Q-RESOLVED, I-Q-ERASURE-REKEY, I-Q-SQL-SAFETY.
// This file owns its database, so every walk below sees a closed set of cases.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { moderationCasesResponseSchema } from '@couture/api-client/contracts/http'
import { CommunityModerationActionsService } from '../src/modules/community/community-moderation.actions.js'
import { moderationQueueTestContext } from './helpers/moderation-queue-context.js'
import {
  SEED_HOUR_MS,
  newRunId,
  seedBulkOpenPosts,
  seedComment,
  seedCommentReport,
  seedMember,
  seedPost,
  seedPostReport,
} from './helpers/moderation-queue-seed.js'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const ctx = moderationQueueTestContext()
const { prisma, clock, flagValues } = ctx
const runId = newRunId()
let boot: Awaited<ReturnType<typeof ctx.bootApp>>
let moderator: ReturnType<typeof boot.as>
let moderatorId: string
let author: Awaited<ReturnType<typeof seedMember>>
const at = (hours: number) => new Date(NOW.getTime() + hours * SEED_HOUR_MS)

type Page = ReturnType<typeof moderationCasesResponseSchema.parse>['data']
const fetchPage = async (query: string): Promise<Page> =>
  moderationCasesResponseSchema.parse(
    (await moderator.get(`/api/v1/moderation/cases${query}`).expect(200)).body
  ).data

/** Walks every page and returns the case ids in the order they arrived. */
async function walk(
  query = '',
  limit = 25,
  between?: (pageNumber: number) => Promise<void>
) {
  const seen: string[] = []
  let cursor: string | null = null
  for (let pageNumber = 1; pageNumber < 500; pageNumber++) {
    const page: Page = await fetchPage(
      `?limit=${limit}${query}${cursor ? `&cursor=${cursor}` : ''}`
    )
    seen.push(...page.items.map((item) => item.caseId))
    cursor = page.nextCursor
    if (!cursor) return seen
    await between?.(pageNumber)
  }
  throw new Error('walk did not terminate')
}

beforeAll(async () => {
  clock.at(NOW)
  const mod = await seedMember(prisma, runId, 'moderator', { alias: false })
  moderatorId = mod.id
  author = await seedMember(prisma, runId, 'author')
  boot = await ctx.bootApp()
  moderator = boot.as('moderator', moderatorId)
}, 120_000)

afterEach(() => {
  clock.at(NOW)
  flagValues.clear()
})

/**
 * Closes every open report so each describe block starts from an empty open queue.
 * Comment audit rows are append-only, so nothing here deletes.
 */
async function clearQueue() {
  await prisma.communityCommentReport.updateMany({
    where: { resolved_at: null },
    data: { resolved_at: NOW },
  })
  await prisma.communityPostReport.updateMany({
    where: { resolved_at: null },
    data: { resolved_at: NOW },
  })
}

describe('I-Q-KEYSET-TIES: equal rank and due, distinct keys', () => {
  it('walks 60+ tied cases of all four key kinds with no duplicate and no skip at any page size', async () => {
    await clearQueue()
    const reporter = await seedMember(prisma, `${runId}k`, 'reporter')
    const tieDue = at(8)
    const created = tieDue.getTime() - 24 * SEED_HOUR_MS
    const keys = await seedBulkOpenPosts(prisma, {
      runId: `${runId}k`,
      count: 40,
      authorId: author.id,
      reporterId: reporter.id,
      reason: 'spam',
      createdAt: new Date(created),
      dueAt: tieDue,
    })
    // Comment cases: the DB pins sla_due_at = accepted_at + 24 h, so accept 24 h before the tie.
    const host = await seedPost(prisma, {
      runId: `${runId}k`,
      label: 'host',
      authorId: author.id,
      now: NOW,
    })
    for (let index = 0; index < 8; index++) {
      const comment = await seedComment(prisma, {
        runId: `${runId}k`,
        label: `c${index}`,
        postId: host.id,
        authorId: author.id,
        now: NOW,
      })
      await seedCommentReport(prisma, {
        runId: `${runId}k`,
        label: `c${index}`,
        commentId: comment.id,
        reporterId: reporter.id,
        reason: 'spam',
        acceptedAt: new Date(created),
      })
      keys.push(`comment.${comment.id}`)
    }
    for (let index = 0; index < 6; index++) {
      const report = await seedPostReport(prisma, {
        runId: `${runId}k`,
        label: `op${index}`,
        postId: null,
        reporterId: null,
        reason: 'spam',
        createdAt: new Date(created),
        dueAt: tieDue,
      })
      keys.push(`orphan-post.${report.id}`)
      const orphanComment = await seedCommentReport(prisma, {
        runId: `${runId}k`,
        label: `oc${index}`,
        commentId: null,
        reporterId: null,
        reason: 'spam',
        acceptedAt: new Date(created),
      })
      keys.push(`orphan-comment.${orphanComment.id}`)
    }
    expect(keys.length).toBe(60)

    // Byte order of the key is the contract: ASCII code-point order equals COLLATE "C".
    const expected = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const limit of [1, 7, 25, 50]) {
      const seen = await walk('', limit)
      expect(new Set(seen).size, `limit ${limit}: duplicates`).toBe(seen.length)
      expect(seen, `limit ${limit}`).toEqual(expected)
    }
  }, 120_000)

  it('crosses rank and due boundaries mid-tie without dropping a row', async () => {
    await clearQueue()
    const reporter = await seedMember(prisma, `${runId}m`, 'reporter')
    const rows: { key: string; rank: number; due: number }[] = []
    for (const [rank, reason] of [
      [2, 'hate_speech'],
      [1, 'harassment'],
      [0, 'spam'],
    ] as const)
      for (const dueHours of [2, 3])
        for (let index = 0; index < 5; index++) {
          const post = await seedPost(prisma, {
            runId: `${runId}m`,
            label: `r${rank}d${dueHours}n${index}`,
            authorId: author.id,
            now: NOW,
          })
          await seedPostReport(prisma, {
            runId: `${runId}m`,
            label: `r${rank}d${dueHours}n${index}`,
            postId: post.id,
            reporterId: reporter.id,
            reason,
            createdAt: NOW,
            dueAt: at(dueHours),
          })
          rows.push({ key: `post.${post.id}`, rank, due: dueHours })
        }
    const expected = [...rows]
      .sort(
        (a, b) =>
          b.rank - a.rank || a.due - b.due || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      )
      .map((row) => row.key)
    for (const limit of [1, 4, 5, 6, 11, 30])
      expect(await walk('', limit), `limit ${limit}`).toEqual(expected)
  }, 120_000)

  it('rejects a cursor minted under other filters', async () => {
    const first = await fetchPage('?limit=2&risk=high')
    expect(first.nextCursor).toEqual(expect.any(String))
    const response = await moderator
      .get(`/api/v1/moderation/cases?limit=2&risk=low&cursor=${first.nextCursor}`)
      .expect(400)
    expect(response.body).toMatchObject({ statusCode: 400, code: 'invalid_cursor' })
    const sameFilters = await fetchPage(`?limit=2&risk=high&cursor=${first.nextCursor}`)
    expect(sameFilters.items.length).toBeGreaterThan(0)
  })
})

describe('I-Q-PAGING-UNDER-CHANGE', () => {
  it('shows every unchanged case exactly once while others resolve, rise and drop between pages', async () => {
    await clearQueue()
    const reporter = await seedMember(prisma, `${runId}p`, 'reporter')
    const extra = await seedMember(prisma, `${runId}p`, 'extra')
    const make = async (
      label: string,
      reason: 'spam' | 'harassment',
      dueHours: number,
      finding = false
    ) => {
      const post = await seedPost(prisma, {
        runId: `${runId}p`,
        label,
        authorId: author.id,
        moderationReason: finding ? 'text_policy_match' : null,
        moderationEngineVersion: finding ? '1.2.0' : null,
        now: NOW,
      })
      const report = await seedPostReport(prisma, {
        runId: `${runId}p`,
        label,
        postId: post.id,
        reporterId: reporter.id,
        reason,
        createdAt: NOW,
        dueAt: at(dueHours),
      })
      return { postId: post.id, reportId: report.id, key: `post.${post.id}` }
    }
    const f0 = await make('f0', 'spam', 1, true) // rank 1 through a finding
    const h1 = await make('h1', 'harassment', 2) // rank 1
    const steady = await Promise.all(
      [3, 4, 5, 6, 7, 8, 9, 10].map((hours, index) => make(`s${index}`, 'spam', hours))
    )
    const [s2, s3, s5] = [steady[2]!, steady[3]!, steady[5]!]

    const seen = await walk('', 2, async (pageNumber) => {
      if (pageNumber !== 1) return
      // f0 sat on page 1 and loses its finding: rank 1 to 0, so it falls behind the cursor.
      await prisma.lookbookPost.update({
        where: { id: f0.postId },
        data: { moderation_reason: null },
      })
      // s3 is resolved by someone else.
      await prisma.communityPostReport.update({
        where: { id: s3.reportId },
        data: { resolved_at: NOW },
      })
      // s5 gains a hate_speech report: rank 2, so it jumps ahead of the cursor.
      await prisma.communityPostReport.create({
        data: {
          id: `${runId}p-late`,
          post_id: s5.postId,
          reporter_id: extra.id,
          reason: 'hate_speech',
          sla_due_at: at(11),
          created_at: NOW,
        },
      })
    })

    const count = (key: string) => seen.filter((entry) => entry === key).length
    // Unchanged rows appear exactly once.
    for (const row of [
      h1,
      ...steady.filter((row) => row !== s2 && row !== s3 && row !== s5),
    ])
      expect(count(row.key), row.key).toBe(1)
    expect(count(s2.key)).toBe(1)
    // A resolved row never appears after it resolved.
    expect(count(s3.key)).toBe(0)
    // Changed rows may appear zero times or once more, never more.
    expect(count(f0.key)).toBeGreaterThanOrEqual(1)
    expect(count(f0.key)).toBeLessThanOrEqual(2)
    expect(count(s5.key)).toBeLessThanOrEqual(1)
  }, 120_000)
})

describe('I-Q-RESOLVED: real resolution through the operator service', () => {
  it('keeps a case open until its last report resolves, then moves it to the resolved view', async () => {
    await clearQueue()
    const actions = new CommunityModerationActionsService(prisma, ctx.flags as never)
    const post = await seedPost(prisma, {
      runId: `${runId}r`,
      label: 'p',
      authorId: author.id,
      now: NOW,
    })
    const reporters = await Promise.all(
      [1, 2, 3].map((n) => seedMember(prisma, `${runId}r`, `rep${n}`))
    )
    const reasons = ['spam', 'harassment', 'other'] as const
    const reports: Awaited<ReturnType<typeof seedPostReport>>[] = []
    for (const [index, reporter] of reporters.entries())
      reports.push(
        await seedPostReport(prisma, {
          runId: `${runId}r`,
          label: `p${index}`,
          postId: post.id,
          reporterId: reporter.id,
          reason: reasons[index]!,
          createdAt: NOW,
          dueAt: at(2 + index),
          subjectAlias: author.alias,
        })
      )
    const caseId = `post.${post.id}`

    await actions.resolveReport({
      reportId: reports[0]!.id,
      operatorId: moderatorId,
      resolution: 'unfounded',
    })
    await actions.resolveReport({
      reportId: reports[1]!.id,
      operatorId: moderatorId,
      resolution: 'unfounded',
    })
    // Two of three resolved: the case stays open, built from the one open report.
    let open = await fetchPage('')
    expect(open.items).toHaveLength(1)
    expect(open.items[0]).toMatchObject({
      caseId,
      status: 'open',
      reportCount: 1,
      reasons: ['other'],
      slaDueAt: at(4).toISOString(),
    })
    const resolvedView = async (query = '') =>
      (await fetchPage(`?status=resolved${query}`)).items.filter(
        (item) => item.caseId === caseId
      )
    expect(await resolvedView()).toHaveLength(0)

    await actions.resolveReport({
      reportId: reports[2]!.id,
      operatorId: moderatorId,
      resolution: 'x'.repeat(5000),
    })
    open = await fetchPage('')
    expect(open.items).toHaveLength(0)
    const resolved = await resolvedView()
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({
      caseId,
      status: 'resolved',
      slaState: 'resolved',
      reportCount: 3,
    })
    expect(await resolvedView('&sla=resolved')).toHaveLength(1)
    expect(await resolvedView('&sla=breached')).toHaveLength(0)

    // The detail of a resolved case reads every report and the operator history.
    const detail = (await moderator.get(`/api/v1/moderation/cases/${caseId}`).expect(200))
      .body as {
      data: {
        status: string
        slaState: string
        reporters: { resolved: boolean }[]
        priorActions: { actorKind: string; action: string; reason: string | null }[]
      }
    }
    expect(detail.data).toMatchObject({ status: 'resolved', slaState: 'resolved' })
    expect(detail.data.reporters).toHaveLength(3)
    expect(detail.data.reporters.every((entry) => entry.resolved)).toBe(true)
    const resolutions = detail.data.priorActions.filter(
      (entry) => entry.action === 'report_resolved'
    )
    expect(resolutions).toHaveLength(3)
    expect(resolutions.every((entry) => entry.actorKind === 'operator')).toBe(true)
    // A 5,000-character operator reason is clamped, never a 500.
    expect(
      Math.max(...resolutions.map((entry) => entry.reason?.length ?? 0))
    ).toBeLessThanOrEqual(2000)
  })
})

describe('I-Q-ERASURE-REKEY: erasing the target is the one documented re-key', () => {
  it('splits a grouped case into orphan cases, 404s the old id, and keeps an earlier cursor usable', async () => {
    await clearQueue()
    const post = await seedPost(prisma, {
      runId: `${runId}e`,
      label: 'p',
      authorId: author.id,
      now: NOW,
    })
    const others = await Promise.all(
      [1, 2].map((n) =>
        seedPost(prisma, {
          runId: `${runId}e`,
          label: `o${n}`,
          authorId: author.id,
          now: NOW,
        })
      )
    )
    const reporters = await Promise.all(
      [1, 2].map((n) => seedMember(prisma, `${runId}e`, `rep${n}`))
    )
    for (const [index, reporter] of reporters.entries())
      await seedPostReport(prisma, {
        runId: `${runId}e`,
        label: `g${index}`,
        postId: post.id,
        reporterId: reporter.id,
        reason: 'violence',
        createdAt: NOW,
        dueAt: at(1 + index),
        subjectAlias: author.alias,
      })
    for (const [index, other] of others.entries())
      await seedPostReport(prisma, {
        runId: `${runId}e`,
        label: `x${index}`,
        postId: other.id,
        reporterId: reporters[0]!.id,
        reason: 'spam',
        createdAt: NOW,
        dueAt: at(10 + index),
      })

    const before = await fetchPage('?limit=1')
    expect(before.items[0]).toMatchObject({ caseId: `post.${post.id}`, reportCount: 2 })
    const cursor = before.nextCursor!

    // Author erasure deletes the post row; both reports keep their snapshot and lose post_id.
    await prisma.lookbookPost.delete({ where: { id: post.id } })

    await moderator.get(`/api/v1/moderation/cases/post.${post.id}`).expect(404)
    const after = await walk('', 25)
    const orphans = after.filter((id) => id.startsWith('orphan-post.'))
    expect(orphans).toHaveLength(2)
    expect(after).not.toContain(`post.${post.id}`)
    for (const id of orphans) {
      const detail = (await moderator.get(`/api/v1/moderation/cases/${id}`).expect(200))
        .body as {
        data: {
          target: { state: string }
          media: { reason?: string }
          reportCount: number
        }
      }
      expect(detail.data).toMatchObject({
        target: { state: 'erased' },
        media: { reason: 'target_erased' },
        reportCount: 1,
      })
    }
    // A cursor minted before the erasure still decodes and the walk completes.
    const resumed = await fetchPage(`?limit=1&cursor=${cursor}`)
    expect(resumed.items.length).toBeGreaterThan(0)
  })
})

describe('I-Q-SQL-SAFETY', () => {
  it('turns hostile filters and ids into 400 or 404 and leaves the tables alone', async () => {
    const reportsBefore = await prisma.communityPostReport.count()
    const hostile = [
      '\'; DROP TABLE "CommunityPostReport"; --',
      '" OR 1=1 --',
      '%',
      'a\u0000b',
      'x'.repeat(5000),
      "\\'",
    ]
    for (const value of hostile) {
      const query = encodeURIComponent(value)
      for (const key of [
        'locale',
        'source',
        'risk',
        'sla',
        'status',
        'cursor',
        'limit',
      ]) {
        const response = await moderator.get(`/api/v1/moderation/cases?${key}=${query}`)
        expect([400], `${key}=${value.slice(0, 20)}`).toContain(response.status)
      }
      const detail = await moderator.get(`/api/v1/moderation/cases/${query}`)
      expect(detail.status).toBe(404)
    }
    expect(await prisma.communityPostReport.count()).toBe(reportsBefore)
    // The queue still answers after the hostile calls.
    await moderator.get('/api/v1/moderation/cases').expect(200)
  })
})
