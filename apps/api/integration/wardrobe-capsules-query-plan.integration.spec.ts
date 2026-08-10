import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'

/**
 * Query-plan evidence for the capsule read paths.
 *
 * The story's capacity contract requires the intended indexes to be used and
 * forbids a query per capsule or per garment. A latency threshold alone cannot
 * prove that: a fast sequential scan over a small dev dataset passes while the
 * same query collapses at the 1,000-capsule profile. These assertions read the
 * plan directly, so they fail on the shape of the query rather than its timing.
 *
 * Set `CAPSULE_PLAN_SEED_COUNT` to seed a larger set locally. CI seeds the
 * representative owner through the performance fixtures.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

/**
 * Schema availability is probed inside `beforeAll` rather than at module scope:
 * these specs compile as CommonJS, where top-level await is not permitted.
 * Every test guards on the result, so an unmigrated database skips cleanly
 * instead of failing with an unrelated column error.
 */
let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    /*
     * Table availability only. A missing *index* must stay an assertion
     * failure: 4.3-PLAN-01 exists precisely to catch a regressed migration, so
     * folding an index check in here would skip the suite in the one case it
     * is meant to report. The original probe also queried pg_indexes, but a
     * missing index returns zero rows without throwing, so that query never
     * affected the outcome.
     */
    await prisma.$queryRaw`SELECT 1 FROM "OutfitCapsule" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[wardrobe-capsules-query-plan] Skipped: PostgreSQL is missing the Story 4.3 schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
    )
  }
}

/** Returns false and marks the test skipped when the schema is absent. */
function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

type PlanRow = { 'QUERY PLAN': string }

async function explain(sql: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<PlanRow[]>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`
  )
  return rows.map((row) => row['QUERY PLAN']).join('\n')
}

/**
 * Explains with sequential scans disabled.
 *
 * On a small table the planner correctly prefers a sequential scan regardless of
 * which indexes exist, so asserting index usage at low volume is inherently
 * flaky. Disabling seqscan forces the planner to reveal which index it *can*
 * use for the predicate, which is the durable property: that the right index
 * exists and covers the query shape. Absolute latency at the 1,000-capsule
 * profile is enforced separately by the k6 thresholds.
 */
async function explainIndexPreference(sql: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
    const rows = await tx.$queryRawUnsafe<PlanRow[]>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`
    )
    return rows.map((row) => row['QUERY PLAN']).join('\n')
  })
}

describe('4.3 capsule query plans', () => {
  const namespace = `plan-${randomUUID().slice(0, 8)}`
  let ownerUserId: string

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    const user = await prisma.user.create({
      data: { email: `${namespace}@synthetic.test` },
    })
    ownerUserId = user.id

    const seedCount = Number(process.env.CAPSULE_PLAN_SEED_COUNT ?? '400')
    for (let index = 0; index < seedCount; index += 1) {
      await prisma.outfitCapsule.create({
        data: {
          user_id: ownerUserId,
          name: `Plan capsule ${index}`,
          description: index % 3 === 0 ? `Description ${index}` : null,
          occasions: index % 2 === 0 ? ['work'] : ['casual', 'travel'],
          is_favorite: index % 5 === 0,
          revision: 1,
        },
      })
    }

    // Plans on a tiny table always choose a sequential scan; make the stats real.
    await prisma.$executeRawUnsafe('ANALYZE "OutfitCapsule"')
  })

  afterAll(async () => {
    if (!schemaReady) {
      await prisma.$disconnect()
      return
    }

    await prisma.outfitCapsuleGarment.deleteMany({ where: { user_id: ownerUserId } })
    await prisma.outfitCapsule.deleteMany({ where: { user_id: ownerUserId } })
    await prisma.userProfile.deleteMany({ where: { user_id: ownerUserId } })
    await prisma.user.deleteMany({ where: { email: { contains: namespace } } })
    await prisma.$disconnect()
  })

  /** The indexes the migration creates must actually exist. */
  it('4.3-PLAN-01 creates every index the read paths depend on', async (context) => {
    if (!requireSchema(context)) return

    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'OutfitCapsule'
    `
    const names = rows.map((row) => row.indexname)

    expect(names).toContain('OutfitCapsule_user_id_is_favorite_updated_at_id_idx')
    expect(names).toContain('OutfitCapsule_name_trgm_idx')
    expect(names).toContain('OutfitCapsule_description_trgm_idx')
    expect(names).toContain('OutfitCapsule_occasions_idx')
  })

  it('4.3-PLAN-02 orders the owner listing without a sort of the whole table', async (context) => {
    if (!requireSchema(context)) return

    const plan = await explainIndexPreference(
      `SELECT * FROM "OutfitCapsule" WHERE user_id = '${ownerUserId}'
       ORDER BY is_favorite DESC, updated_at DESC, id ASC LIMIT 20`
    )

    expect(plan).toMatch(/Index (Only )?Scan|Bitmap/)
    expect(plan, 'owner listing must not read the whole table').not.toMatch(
      /Seq Scan on "?OutfitCapsule"?/
    )
  })

  /**
   * Keyword search compiles to a leading-wildcard ILIKE, which only a trigram
   * index can serve; a btree on `name` silently degrades to a full scan.
   *
   * The predicate is explained in isolation. With an owner filter present the
   * planner reasonably reaches for the highly selective `user_id` index and
   * filters text afterwards, which would hide whether the trigram index exists
   * at all. Isolating the text predicate asserts the property that matters:
   * the index is present and covers this query shape.
   */
  it('4.3-PLAN-03 serves keyword search from the trigram indexes', async (context) => {
    if (!requireSchema(context)) return

    const plan = await explainIndexPreference(
      `SELECT * FROM "OutfitCapsule"
       WHERE name ILIKE '%capsule%' OR description ILIKE '%capsule%'
       LIMIT 20`
    )

    expect(plan).toMatch(/trgm_idx/)
  })

  /** Same isolation rationale: prove the GIN index serves array containment. */
  it('4.3-PLAN-04 serves occasion filtering from the GIN index', async (context) => {
    if (!requireSchema(context)) return

    const plan = await explainIndexPreference(
      `SELECT * FROM "OutfitCapsule"
       WHERE occasions @> ARRAY['work']::"CapsuleOccasion"[]
       LIMIT 20`
    )

    expect(plan).toMatch(/OutfitCapsule_occasions_idx/)
  })

  it('4.3-PLAN-05 filters favorites through the composite listing index', async (context) => {
    if (!requireSchema(context)) return

    const plan = await explainIndexPreference(
      `SELECT * FROM "OutfitCapsule"
       WHERE user_id = '${ownerUserId}' AND is_favorite = true
       ORDER BY updated_at DESC, id ASC LIMIT 20`
    )

    expect(plan).not.toMatch(/Seq Scan on "?OutfitCapsule"?/)
  })

  /**
   * Garment and comfort filters join through `OutfitCapsuleGarment`. The plan
   * must resolve them as a set operation, never as a per-capsule lookup.
   */
  it('4.3-PLAN-06 resolves garment filtering without a per-capsule subquery', async (context) => {
    if (!requireSchema(context)) return

    const plan = await explain(
      `SELECT c.* FROM "OutfitCapsule" c
       WHERE c.user_id = '${ownerUserId}'
         AND EXISTS (
           SELECT 1 FROM "OutfitCapsuleGarment" g
           WHERE g.capsule_id = c.id AND g.user_id = c.user_id
         )
       LIMIT 20`
    )

    expect(plan).toMatch(/Join|Nested Loop|Hash|Merge/)
    expect(plan, 'garment filter must not re-plan per row').not.toMatch(/SubPlan \d+/)
  })
})
