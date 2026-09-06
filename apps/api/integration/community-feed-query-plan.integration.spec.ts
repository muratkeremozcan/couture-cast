// Learning path Step 38: Community feed by climate band.
// Story 6.1: Community feed by climate band query plan integration tests.
//
// EVERY PLAN ASSERTION BELOW RUNS AGAINST SQL PRISMA ACTUALLY EMITTED, captured
// from the client's `query` event while `CommunityRepository.findPublishedFeedPosts`
// runs, rather than against SQL hand-written in this file.
//
// That distinction is the whole value of the suite. The earlier version
// EXPLAINed `AND (published_at, id) < ($3, $4)`, a row-comparison, while the
// repository issues `published_at < $3 OR (published_at = $4 AND id < $5)` plus
// a `published_at IS NOT NULL` predicate the hand-written SQL did not carry. So
// the suite proved that a query nobody runs uses the index: if
// `findPublishedFeedPosts` changed shape tomorrow and fell to a sequential scan,
// every assertion here stayed green. Capturing the emitted text means a change
// to the repository is a change to what this file EXPLAINs.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import type { FindFeedPostsParams } from '../src/modules/community/community.repository.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

// Both indexes moved from `created_at` to `published_at DESC, id DESC` with the
// public cursor. Ordering the feed on creation time inserted a post that cleared
// moderation late BEHIND a cursor the reader had already consumed, so it was
// never seen at all.
const GLOBAL_FEED_INDEX = 'LookbookPost_status_published_at_id_idx'
const BAND_FEED_INDEX = 'LookbookPost_climate_band_status_published_at_id_idx'

const SEED_COUNT = Number(process.env.COMMUNITY_PLAN_SEED_COUNT ?? '2000')

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "LookbookPost" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    console.warn(
      '[community-feed-query-plan] Skipped: PostgreSQL is missing the Story 6.1 community schema. ' +
        'Run npm run db:migrate to execute this suite.'
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

type PlanRow = { 'QUERY PLAN': string }

type CapturedQuery = { sql: string; params: unknown[] }

/**
 * Runs `findPublishedFeedPosts` and returns the SELECT the Prisma client put on
 * the wire, with its bind parameters.
 *
 * A separate client is used because query-event logging has to be configured at
 * construction, and the shared `prisma` above is the one every other statement
 * in this file goes through. `params` arrives as a JSON string; timestamps come
 * back in Postgres' own `YYYY-MM-DD HH:MM:SS.mmm UTC` text form, which is
 * converted back to a Date so the re-bind is typed the same way the original
 * was rather than relying on an implicit text cast.
 */
async function captureFeedQuery(params: FindFeedPostsParams): Promise<CapturedQuery> {
  const logged = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: [{ emit: 'event', level: 'query' }],
  })

  const captured: { query: string; params: string }[] = []
  const emitter = logged as unknown as {
    $on: (
      event: 'query',
      callback: (payload: { query: string; params: string }) => void
    ) => void
  }
  emitter.$on('query', (payload) => captured.push(payload))

  try {
    await new CommunityRepository(logged).findPublishedFeedPosts(params)
    // The event is emitted asynchronously after the call resolves.
    await new Promise((resolve) => setTimeout(resolve, 200))
  } finally {
    await logged.$disconnect()
  }

  const feedQuery = captured.find(
    (entry) => entry.query.includes('"LookbookPost"') && entry.query.startsWith('SELECT')
  )
  if (!feedQuery) {
    throw new Error(
      `No LookbookPost SELECT was captured. Statements seen: ${captured
        .map((entry) => entry.query.slice(0, 60))
        .join(' | ')}`
    )
  }

  const parsed: unknown[] = JSON.parse(feedQuery.params) as unknown[]
  const bound = parsed.map((value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)? UTC$/.test(value)
      ? new Date(value.replace(' UTC', 'Z').replace(' ', 'T'))
      : value
  )

  return { sql: feedQuery.query, params: bound }
}

async function explain(sql: string, ...params: unknown[]): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<PlanRow[]>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
    ...params
  )
  return rows.map((row) => row['QUERY PLAN']).join('\n')
}

async function explainWithoutIndexes(sql: string, ...params: unknown[]): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_indexscan = off')
    await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off')
    await tx.$executeRawUnsafe('SET LOCAL enable_indexonlyscan = off')
    const rows = await tx.$queryRawUnsafe<PlanRow[]>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
      ...params
    )
    return rows.map((row) => row['QUERY PLAN']).join('\n')
  })
}

describe('6.1 community feed query plans', () => {
  const namespace = `plan-${randomUUID().slice(0, 8)}`
  let authorUserId: string
  let cursorSeedDate: Date
  let cursorSeedId: string

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    const user = await prisma.user.create({
      data: { email: `${namespace}@synthetic.test` },
    })
    authorUserId = user.id

    const bands = [
      'cold_wet',
      'cold_dry',
      'temperate_wet',
      'temperate_dry',
      'warm_wet',
      'warm_dry',
    ] as const

    const statuses = [
      'published',
      'published',
      'published',
      'pending_review',
      'flagged',
      'draft',
    ] as const

    const baseTime = Date.now() - SEED_COUNT * 60000

    // Routed through the shared factory rather than a hand-rolled literal, so
    // the fixture tracks the schema: a column added to LookbookPost shows up
    // here without anyone remembering to edit this file.
    const rows = Array.from({ length: SEED_COUNT }, (_, index) => {
      const timestamp = new Date(baseTime + index * 60000)
      const status = statuses[index % statuses.length]!
      return buildLookbookPostCreateInput(
        createLookbookPost({
          userId: authorUserId,
          climateBand: bands[index % bands.length]!,
          status,
          caption: `Feed plan post ${index}`,
          createdAt: timestamp,
          updatedAt: timestamp,
          submittedAt: timestamp,
          // The database rejects a `published` row with a NULL `published_at`,
          // and the feed keyset is built on it.
          publishedAt: status === 'published' ? timestamp : null,
          idempotencyKey: `${namespace}-${index}`,
        })
      )
    })

    // The cursor keys on `published_at`, so the seed row has to be one that has
    // one: the status cycle deliberately mixes in author-only states, and those
    // rows carry a NULL there by the database's own CHECK constraint.
    const midpoint = Math.floor(SEED_COUNT / 2)
    const sampleRow =
      rows.slice(midpoint).find((row) => row.published_at !== null) ??
      rows.find((row) => row.published_at !== null)!
    cursorSeedDate = sampleRow.published_at as Date
    cursorSeedId = sampleRow.id as string

    await prisma.lookbookPost.createMany({
      data: rows,
    })

    await prisma.$executeRawUnsafe('ANALYZE "LookbookPost"')
  })

  afterAll(async () => {
    if (!schemaReady) {
      await prisma.$disconnect()
      return
    }

    await prisma.lookbookPost.deleteMany({ where: { user_id: authorUserId } })
    await prisma.userProfile.deleteMany({ where: { user_id: authorUserId } })
    await prisma.user.deleteMany({ where: { id: authorUserId } })
    await prisma.$executeRawUnsafe('ANALYZE "LookbookPost"')
    await prisma.$disconnect()
  })

  /*
   * 6.1-PLAN-01 (both index names exist in pg_indexes) was DELETED as subsumed.
   * PLAN-02 and PLAN-03 below name the same two indexes INSIDE a real plan, so
   * an index that vanished would fail them first and with a better message. A
   * catalogue lookup that passes while the planner ignores the index is the
   * weaker of the two claims.
   */

  it('6.1-PLAN-02 serves the global published feed from the composite index', async (context) => {
    if (!requireSchema(context)) return

    const { sql, params } = await captureFeedQuery({ limit: 20, mode: 'all' })

    // The predicate the repository adds and the old hand-written SQL omitted.
    // Asserting on the captured text keeps this file honest about what it is
    // explaining.
    /*
     * ONE ANCHORED PREDICATE, not two detached substrings. `published_at` appears
     * in the SELECT list and the ORDER BY of every query this file explains, and
     * `IS NOT NULL` appears in any query carrying any such predicate on any
     * column, so the pair was satisfied by SQL that had lost the
     * `published_at IS NOT NULL` predicate entirely — which is the predicate this
     * file was rewritten to guard.
     */
    expect(sql).toMatch(/"?published_at"?\s+IS\s+NOT\s+NULL/i)

    const plan = await explain(sql, ...params)
    expect(plan, `plan was:\n${plan}`).toContain(GLOBAL_FEED_INDEX)
    expect(plan, 'global feed query must not scan table end to end').not.toMatch(
      /Seq Scan on "?LookbookPost"?/
    )
  })

  it('6.1-PLAN-03 serves the band-filtered published feed from the composite index', async (context) => {
    if (!requireSchema(context)) return

    const { sql, params } = await captureFeedQuery({
      filterBand: 'temperate_dry',
      limit: 20,
      mode: 'temperate_dry',
    })

    const plan = await explain(sql, ...params)
    expect(plan, `plan was:\n${plan}`).toContain(BAND_FEED_INDEX)
    expect(plan, 'band-filtered feed query must not scan table end to end').not.toMatch(
      /Seq Scan on "?LookbookPost"?/
    )
  })

  it('6.1-PLAN-04 serves the keyset-paginated page from the composite index', async (context) => {
    if (!requireSchema(context)) return

    const { sql, params } = await captureFeedQuery({
      filterBand: 'temperate_dry',
      cursor: {
        publishedAt: cursorSeedDate.toISOString(),
        id: cursorSeedId,
        mode: 'temperate_dry',
        band: 'temperate_dry',
      },
      limit: 20,
      mode: 'temperate_dry',
    })

    // Prisma expresses the keyset as an OR of two predicates, not as the
    // row-comparison `(published_at, id) < ($3, $4)` this file used to explain.
    // Pinning the shape here means a rewrite of the cursor condition shows up as
    // a failure in this test rather than silently leaving it explaining SQL the
    // application no longer issues.
    //
    // THE TWO FORMS DO NOT PLAN THE SAME WAY, measured on 2000 seeded rows:
    //
    //   row-comparison  Index Scan using ..._climate_band_status_published_at_id_idx
    //                   Index Cond: ... AND (ROW(published_at, id) < ROW($3, $4))
    //                   no Sort node, 5 shared buffers
    //
    //   OR form         BitmapOr of TWO bitmap index scans (band index + global
    //                   index) -> Bitmap Heap Scan with Recheck -> Sort
    //                   Sort Key: published_at DESC, id DESC, 8 shared buffers
    //
    // Both use the band index and neither scans the table, which is what this
    // test asserts and both satisfy. The difference is that the row-comparison
    // seeks once and the index supplies the ordering, while the OR form
    // materialises the matched set and sorts it, so its cost tracks the size of
    // that set rather than staying bounded by LIMIT. At this fixture size both
    // execute in about 0.03ms, so this is a scaling observation and not a
    // present-day latency problem.
    //
    // Changing it means a raw keyset query in `community.repository.ts`, which
    // this suite does not own. Recorded here so the choice is visible rather
    // than rediscovered.
    expect(sql).toMatch(/published_at"? < \$\d/)
    expect(sql).toMatch(/OR .*published_at"? = \$\d/s)
    expect(sql).not.toContain('(published_at, id) <')

    const plan = await explain(sql, ...params)
    expect(plan, `plan was:\n${plan}`).toContain(BAND_FEED_INDEX)
    expect(plan).not.toMatch(/Seq Scan on "?LookbookPost"?/)
  })

  it('6.1-PLAN-06 proves the captured-SQL assertions can fail with index scans disabled', async (context) => {
    if (!requireSchema(context)) return

    // The same falsifiability proof 6.1-PLAN-05 makes, applied to the query the
    // application actually issues. PLAN-05 is kept unchanged because it is the
    // model this is copied from; without this sibling, the estate's best test
    // would be guarding a string in a spec file rather than production SQL.
    const { sql, params } = await captureFeedQuery({
      filterBand: 'temperate_dry',
      limit: 20,
      mode: 'temperate_dry',
    })

    const forcedPlan = await explainWithoutIndexes(sql, ...params)
    const indexedPlan = await explain(sql, ...params)

    expect(forcedPlan, `forced plan was:\n${forcedPlan}`).toMatch(
      /Seq Scan on "?LookbookPost"?/
    )
    expect(forcedPlan).not.toContain(BAND_FEED_INDEX)
    expect(indexedPlan).toContain(BAND_FEED_INDEX)
  })

  it('6.1-PLAN-05 proves index assertions can fail when index scans are disabled', async (context) => {
    if (!requireSchema(context)) return

    const sql =
      'SELECT * FROM "LookbookPost" WHERE climate_band = $1::"ClimateBand" AND status = $2::"CommunityPostStatus" ORDER BY published_at DESC, id DESC LIMIT 20'
    const forcedPlan = await explainWithoutIndexes(sql, 'temperate_dry', 'published')
    const indexedPlan = await explain(sql, 'temperate_dry', 'published')

    expect(forcedPlan, `forced plan was:\n${forcedPlan}`).toMatch(
      /Seq Scan on "?LookbookPost"?/
    )
    expect(forcedPlan).not.toContain(BAND_FEED_INDEX)
    expect(indexedPlan).toContain(BAND_FEED_INDEX)
  })
})
