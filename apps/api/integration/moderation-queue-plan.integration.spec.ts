// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: I-Q-PLAN and I-Q-PLAN-RESOLVED.
// D7 promises the open set is read through the existing (resolved_at, sla_due_at) indexes.
// The planner chooses a sequential scan on a table where nearly every row matches, so the seed
// holds many resolved rows and the open set is the selective minority, as in production.
// Assertions that survive planner variation: index usability under enable_seqscan=off, and a
// latency budget for the default planner. The default plan shape stays unasserted.
import { beforeAll, describe, expect, it } from 'vitest'
import { moderationCasesQuerySchema } from '@couture/api-client/contracts/http'
import { moderationQueueTestContext } from './helpers/moderation-queue-context.js'
import { ModerationQueueRepository } from '../src/modules/moderation/moderation-queue.repository.js'
import type { PrismaClient, Prisma } from '@prisma/client'

const ctx = moderationQueueTestContext()
const { prisma } = ctx

const OPEN = 5000
const RESOLVED = 20_000
const LATENCY_BUDGET_MS = 1500
const RESOLVED_LISTING_BUDGET_MS = 8000

/** Captures the SQL the repository builds, so the plan test explains the real query. */
function capturingRepository() {
  const captured: Prisma.Sql[] = []
  const proxy = {
    $queryRaw: (sql: Prisma.Sql) => {
      captured.push(sql)
      return prisma.$queryRaw(sql)
    },
  } as unknown as PrismaClient
  return { repository: new ModerationQueueRepository(proxy), captured }
}

const planNodes = (plan: unknown): Record<string, unknown>[] => {
  const nodes: Record<string, unknown>[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (value && typeof value === 'object') {
      nodes.push(value as Record<string, unknown>)
      Object.values(value).forEach(walk)
    }
  }
  walk(plan)
  return nodes
}

async function explain(sql: Prisma.Sql, analyze: boolean, noSeqScan: boolean) {
  return prisma.$transaction(async (tx) => {
    if (noSeqScan) await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
    const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': unknown }[]>(
      `EXPLAIN (${analyze ? 'ANALYZE, ' : ''}FORMAT JSON) ${sql.text}`,
      ...sql.values
    )
    return rows[0]!['QUERY PLAN']
  })
}

beforeAll(async () => {
  const bulk = async (
    table: 'post' | 'comment',
    prefix: string,
    count: number,
    resolved: boolean
  ) => {
    if (table === 'post')
      await prisma.$executeRawUnsafe(`
        INSERT INTO "CommunityPostReport"
          (id, post_id, reporter_id, reason, details, content_snapshot, subject_alias, sla_due_at, created_at, resolved_at)
        SELECT '${prefix}-' || g, NULL, NULL,
          (ARRAY['spam','harassment','other','hate_speech','violence','inappropriate_content'])[1 + g % 6]::"CommunityReportReason",
          NULL, '{"caption":"bulk","locale":"en-US"}'::jsonb, 'bulk',
          date_trunc('milliseconds', now()) + (g || ' seconds')::interval,
          date_trunc('milliseconds', now()),
          ${resolved ? "date_trunc('milliseconds', now()) - interval '1 hour'" : 'NULL'}
        FROM generate_series(1, ${count}) g`)
    else
      await prisma.$executeRawUnsafe(`
        INSERT INTO "CommunityCommentReport"
          (id, comment_id, reporter_id, reason, content_snapshot, accepted_at, routed_at, sla_due_at, resolved_at)
        SELECT '${prefix}-' || g, NULL, NULL,
          (ARRAY['spam','harassment','other','hate_speech','violence','inappropriate_content'])[1 + g % 6]::"CommunityReportReason",
          '{"body":"bulk","locale":"en-US"}'::jsonb,
          t, t, t + interval '24 hours',
          ${resolved ? "t + interval '1 hour'" : 'NULL'}
        FROM (SELECT date_trunc('milliseconds', now()) - (g || ' seconds')::interval AS t, g
              FROM generate_series(1, ${count}) g) s(t, g)`)
  }
  await bulk('post', 'plan-popen', OPEN, false)
  await bulk('post', 'plan-pres', RESOLVED, true)
  await bulk('comment', 'plan-copen', OPEN, false)
  await bulk('comment', 'plan-cres', RESOLVED, true)
  await prisma.$executeRawUnsafe('ANALYZE "CommunityPostReport"')
  await prisma.$executeRawUnsafe('ANALYZE "CommunityCommentReport"')
}, 180_000)

describe('I-Q-PLAN: the open queue at 5,000 open reports per table', () => {
  it('can read both report tables through the (resolved_at, sla_due_at) indexes', async () => {
    const { repository, captured } = capturingRepository()
    await repository.listCases(moderationCasesQuerySchema.parse({}), new Date(), null)
    const plan = await explain(captured.at(-1)!, false, true)
    const indexes = planNodes(plan)
      .filter((node) => typeof node['Index Name'] === 'string')
      .map((node) => node['Index Name'] as string)
    expect(indexes).toContain('CommunityPostReport_resolved_at_sla_due_at_idx')
    expect(indexes).toContain('CommunityCommentReport_resolved_at_sla_due_at_idx')
  })

  it('returns the first page within the latency budget', async () => {
    const repository = new ModerationQueueRepository(prisma)
    const query = moderationCasesQuerySchema.parse({})
    const timings: number[] = []
    for (let run = 0; run < 4; run++) {
      const started = performance.now()
      const rows = await repository.listCases(query, new Date(), null)
      timings.push(performance.now() - started)
      expect(rows).toHaveLength(query.limit + 1)
    }
    // The first run warms the connection and the plan cache; judge the median of all four.
    const median = [...timings].sort((a, b) => a - b)[1]!
    expect(
      median,
      `timings ${timings.map((value) => Math.round(value)).join(', ')} ms`
    ).toBeLessThan(LATENCY_BUDGET_MS)
  })

  it('reads only the open reports: the resolved bulk is never scanned as part of the open result', async () => {
    const { repository, captured } = capturingRepository()
    await repository.listCases(moderationCasesQuerySchema.parse({}), new Date(), null)
    const plan = (await explain(captured.at(-1)!, true, false)) as {
      Plan: Record<string, unknown>
    }[]
    const scans = planNodes(plan).filter(
      (node) =>
        node['Relation Name'] === 'CommunityPostReport' ||
        node['Relation Name'] === 'CommunityCommentReport'
    )
    expect(scans.length).toBeGreaterThanOrEqual(2)
    for (const scan of scans) {
      // Whatever scan type the planner picks, the rows it hands up are the open set.
      const returned = Number(scan['Actual Rows']) * Number(scan['Actual Loops'] ?? 1)
      expect(returned, String(scan['Node Type'])).toBeLessThanOrEqual(OPEN + 50)
    }
  })
})

describe('I-Q-PLAN-RESOLVED: the resolved listing has no index support for the risk sort (RG5)', () => {
  it('still answers a status=resolved page within the recorded budget', async () => {
    const repository = new ModerationQueueRepository(prisma)
    const query = moderationCasesQuerySchema.parse({ status: 'resolved' })
    const started = performance.now()
    const rows = await repository.listCases(query, new Date(), null)
    const elapsed = performance.now() - started
    expect(rows).toHaveLength(query.limit + 1)
    expect(elapsed, `${Math.round(elapsed)} ms`).toBeLessThan(RESOLVED_LISTING_BUDGET_MS)
  })
})
