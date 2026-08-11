import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { CommerceRepository } from '../src/modules/commerce/commerce.repository.js'

/**
 * Story 5.1 Task 9: query-plan evidence for the affiliate offer lookup.
 *
 * WHY A PLAN TEST AND NOT JUST A LATENCY THRESHOLD. Offer selection runs on
 * `GET /api/v1/ritual`, which is the hot path in this app and is fetched on
 * every mobile foreground. A sequential scan over a dev catalog of a dozen rows
 * is instant, so the k6 SLO would stay green while the same query degrades
 * linearly with the catalog an operator is expected to grow by hand. The plan is
 * the property that survives; the timing is not.
 *
 * WHY THE SQL IS CAPTURED RATHER THAN RESTATED. The statement explained below is
 * the one `CommerceRepository.findBestOffer` actually emits, lifted off Prisma's
 * query event and re-run under `EXPLAIN`. Copying the SQL into the test would
 * let the two drift the moment someone edits the repository, and a plan
 * assertion against a query the application no longer runs is worse than no
 * assertion, because it reads as evidence. This also means the test
 * automatically covers the predicate as it exists today, including the partner
 * status join and the `'*'` sentinel disjunction that integration added, rather
 * than the narrower predicate decision 4 describes.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** `log` is what makes the query event available; the default client emits nothing. */
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: [{ emit: 'event', level: 'query' }],
})

const OFFER_LOOKUP_INDEX =
  'AffiliateOffer_status_locale_region_garment_category_priori_idx'

/**
 * How many catalog rows this suite seeds, and why it is not a handful.
 *
 * PostgreSQL correctly prefers a sequential scan on a small table no matter how
 * good the index is, so an index assertion at low volume either fails for the
 * right reason or passes for the wrong one. At roughly 200 bytes per row this
 * table packs about 40 rows to an 8 KB page, so 4,000 rows is around 100 pages:
 * enough that a full scan is visibly more expensive than descending the index,
 * and small enough to seed in one `createMany` and delete in one statement.
 *
 * Override with `OFFER_PLAN_SEED_COUNT` to explore the crossover locally.
 */
const SEED_COUNT = Number(process.env.OFFER_PLAN_SEED_COUNT ?? '4000')

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    // Table availability only. A MISSING INDEX must stay an assertion failure:
    // 5.1-PLAN-01 exists precisely to catch a regressed migration, so folding an
    // index check in here would skip the suite in the one case it must report.
    await prisma.$queryRaw`SELECT 1 FROM "AffiliateOffer" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "CommercePartner" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[commerce-affiliate-offers-query-plan] Skipped: PostgreSQL is missing the Story 5.1 commerce schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
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

type CapturedStatement = { sql: string; params: unknown[] }

describe('5.1 affiliate offer query plans', () => {
  const namespace = `offer-plan-${randomUUID().slice(0, 6)}`
  /** Owns the 4,000 volume rows. Deliberately INACTIVE; see `beforeAll`. */
  let bulkPartnerId: string
  /** Owns the handful of rows the lookup is expected to actually match. */
  let matchPartnerId: string
  let repository: CommerceRepository
  const captured: CapturedStatement[] = []
  /** Armed by `captureOfferLookup`, settled by the Prisma query handler. */
  let resolveCapture: ((statement: CapturedStatement) => void) | undefined

  /**
   * A region no other suite queries for, so this file's rows can never be
   * selected by a concurrent one.
   *
   * `ZZ8` satisfies the `locale_region` check constraint (`'*'`, or two to three
   * of `[A-Z0-9]`) and sits outside every real subtag the repo uses (`US`, `CA`,
   * `FR`, `419`). An earlier version of this file generated region codes
   * arithmetically across the whole alphabet, which swept through real subtags
   * and made ten tests in the offers and clicks suites fail whenever this one
   * ran beside them.
   *
   * Nothing here is ever published at `'*'`: that sentinel matches EVERY request
   * region, so 4,000 rows carrying it would become candidate offers everywhere.
   */
  const targetRegion = 'ZZ8'

  /**
   * Explains the statement the repository emitted, with its own bind parameters.
   * `EXPLAIN` accepts parameters positionally the same way the original did.
   */
  async function explainCaptured(statement: CapturedStatement): Promise<string> {
    const rows = await prisma.$queryRawUnsafe<PlanRow[]>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${statement.sql}`,
      ...statement.params
    )
    return rows.map((row) => row['QUERY PLAN']).join('\n')
  }

  /**
   * Explains with index access disabled, which is how this file proves its own
   * assertions are not vacuous: the forced plan must trip the very regex the
   * index tests rely on.
   */
  async function explainWithoutIndexes(statement: CapturedStatement): Promise<string> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_indexscan = off')
      await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off')
      await tx.$executeRawUnsafe('SET LOCAL enable_indexonlyscan = off')
      const rows = await tx.$queryRawUnsafe<PlanRow[]>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${statement.sql}`,
        ...statement.params
      )
      return rows.map((row) => row['QUERY PLAN']).join('\n')
    })
  }

  /**
   * Runs the real repository call and returns the statement it produced.
   *
   * Prisma emits the query event asynchronously, after the awaited call has
   * already resolved, so the statement has to be waited for. That wait is
   * EVENT-DRIVEN rather than a poll: `pendingCapture` is armed before the call
   * and settled by the `$on('query')` handler. An earlier version spun on
   * `while (!captured.length) await sleep(10)`, which is a timing-dependent wait
   * and the kind of thing that passes on a quiet machine and fails on a loaded
   * one. The timeout below is a failure guard, not the mechanism.
   */
  async function captureOfferLookup(
    slots: readonly {
      category: 'top' | 'bottom' | 'shoes'
      comfortRange: 'cold' | null
    }[],
    region: string
  ): Promise<{ statement: CapturedStatement; matched: boolean }> {
    captured.length = 0
    const arrived = new Promise<CapturedStatement>((resolve) => {
      resolveCapture = resolve
    })

    const match = await repository.findBestOffer(slots, region)

    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('The offer lookup emitted no query event to explain')),
        5000
      )
    })

    try {
      const statement = await Promise.race([arrived, timedOut])
      return { statement, matched: match !== null }
    } finally {
      clearTimeout(timer)
      resolveCapture = undefined
    }
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return

    prisma.$on('query', (event) => {
      if (!event.query.includes('"AffiliateOffer"')) return
      const statement = {
        sql: event.query,
        params: JSON.parse(event.params) as unknown[],
      }
      captured.push(statement)
      // Settles the promise `captureOfferLookup` armed, so the wait is driven by
      // the event rather than by elapsed time.
      resolveCapture?.(statement)
    })

    repository = new CommerceRepository(prisma)

    /*
     * TWO PARTNERS, AND THE STATUS DIFFERENCE IS THE ISOLATION MECHANISM.
     *
     * The offer query joins `CommercePartner` and requires `p.status = 'active'`,
     * so an offer under an INACTIVE partner can never be selected by anyone. That
     * is what makes 4,000 rows safe to park in a database three other sessions
     * are using: they give the planner real volume to cost against while being
     * structurally unselectable, whatever region or category they carry.
     *
     * Only the six guaranteed-match rows sit under an active partner, and those
     * are pinned to `targetRegion`.
     */
    const bulkPartner = await prisma.commercePartner.create({
      data: {
        slug: `${namespace}-bulk`,
        display_name: 'Offer Plan Volume Partner',
        allowed_host: 'partner.couturecast.test',
        status: 'inactive',
        webhook_secret_ref: 'COMMERCE_PARTNER_OFFER_PLAN_BULK_WEBHOOK_SECRET',
      },
    })
    bulkPartnerId = bulkPartner.id

    const matchPartner = await prisma.commercePartner.create({
      data: {
        slug: `${namespace}-match`,
        display_name: 'Offer Plan Partner',
        allowed_host: 'partner.couturecast.test',
        status: 'active',
        webhook_secret_ref: 'COMMERCE_PARTNER_OFFER_PLAN_WEBHOOK_SECRET',
      },
    })
    matchPartnerId = matchPartner.id

    const categories = ['top', 'bottom', 'shoes', 'dress', 'outerwear'] as const
    const comfortRanges = [null, 'cold', 'mild', 'warm'] as const

    /*
     * Volume rows. Regions are numbered inside a reserved `Z**` block rather than
     * generated across the whole alphabet: an earlier version swept through real
     * subtags like `419` and broke ten tests in sibling suites. Spreading across
     * many distinct regions is what keeps the target predicate selective, so the
     * planner is choosing the index on merit rather than because everything
     * matches.
     *
     * One in five is inactive at the offer level too, which is roughly what a
     * hand-managed catalog looks like after a few campaigns end.
     */
    const rows = Array.from({ length: SEED_COUNT }, (_, index) => ({
      partner_id: bulkPartnerId,
      garment_category: categories[index % categories.length]!,
      comfort_range: comfortRanges[index % comfortRanges.length]!,
      locale_region: `Z${String(index % 36).padStart(2, '0')}`.slice(0, 3),
      title: `Plan offer ${index}`,
      deep_link_template: 'https://partner.couturecast.test/shop?cc={clickToken}',
      priority: index % 50,
      status: index % 5 === 0 ? ('inactive' as const) : ('active' as const),
      effective_from: new Date('2020-01-01T00:00:00.000Z'),
      effective_to: null,
    }))

    /*
     * A handful of rows guaranteed to satisfy the query below, under the active
     * partner. Without these the lookup explains a plan that returns zero rows,
     * and "this did not scan the table" is trivially true when there was nothing
     * to find.
     */
    const guaranteedMatches = (['top', 'bottom', 'shoes'] as const).flatMap(
      (category, position) =>
        ([null, 'cold'] as const).map((comfortRange, variant) => ({
          partner_id: matchPartnerId,
          garment_category: category,
          comfort_range: comfortRange,
          locale_region: targetRegion,
          title: `Plan match ${category}-${comfortRange ?? 'wildcard'}`,
          deep_link_template: 'https://partner.couturecast.test/shop?cc={clickToken}',
          priority: 10 + position * 2 + variant,
          status: 'active' as const,
          effective_from: new Date('2020-01-01T00:00:00.000Z'),
          effective_to: null,
        }))
    )

    await prisma.affiliateOffer.createMany({ data: [...rows, ...guaranteedMatches] })

    // Without fresh statistics the planner costs this table at its default
    // estimate and the choice below would not reflect the seeded volume.
    await prisma.$executeRawUnsafe('ANALYZE "AffiliateOffer"')
  })

  afterAll(async () => {
    if (schemaReady) {
      // Scoped to this run's two partners. The seeded `sample-partner` catalog
      // that Playwright and Maestro depend on is never touched.
      const partnerIds = [bulkPartnerId, matchPartnerId]
      await prisma.affiliateOffer.deleteMany({
        where: { partner_id: { in: partnerIds } },
      })
      await prisma.commercePartner.deleteMany({ where: { id: { in: partnerIds } } })
      await prisma.$executeRawUnsafe('ANALYZE "AffiliateOffer"')
    }
    await prisma.$disconnect()
  })

  it('5.1-PLAN-01 creates the composite index the offer lookup depends on', async (context) => {
    if (!requireSchema(context)) return

    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'AffiliateOffer'
    `

    expect(rows.map((row) => row.indexname)).toContain(OFFER_LOOKUP_INDEX)
  })

  it('5.1-PLAN-02 serves the offer lookup from the composite index, unaided', async (context) => {
    if (!requireSchema(context)) return

    const { statement, matched } = await captureOfferLookup(
      [{ category: 'top', comfortRange: 'cold' }],
      targetRegion
    )
    const plan = await explainCaptured(statement)

    // The plan has to be over a query that finds something. A plan for a lookup
    // that matches nothing proves the predicate is cheap when empty, which is
    // not the claim.
    expect(matched, 'the fixture must contain a matching offer').toBe(true)
    // Unaided: `enable_seqscan` is left on, so this asserts the planner actually
    // PREFERS the index at this volume rather than merely being able to use it.
    expect(plan, `plan was:\n${plan}`).toContain(OFFER_LOOKUP_INDEX)
    expect(plan, 'the catalog must not be read end to end').not.toMatch(
      /Seq Scan on "?AffiliateOffer"?/
    )
  })

  it('5.1-PLAN-03 keeps using the index when several outfit slots widen the predicate', async (context) => {
    if (!requireSchema(context)) return

    // A real outfit contributes one slot per garment, so the category predicate
    // is a disjunction rather than the single equality 5.1-PLAN-02 explains. A
    // widening OR is exactly where a planner abandons an index for a full scan.
    const { statement, matched } = await captureOfferLookup(
      [
        { category: 'top', comfortRange: 'cold' },
        { category: 'bottom', comfortRange: null },
        { category: 'shoes', comfortRange: 'cold' },
      ],
      targetRegion
    )
    const plan = await explainCaptured(statement)

    expect(matched).toBe(true)
    expect(plan, `plan was:\n${plan}`).toContain(OFFER_LOOKUP_INDEX)
    expect(plan).not.toMatch(/Seq Scan on "?AffiliateOffer"?/)
  })

  it('5.1-PLAN-04 explains the query the repository actually runs', async (context) => {
    if (!requireSchema(context)) return

    // Guards the premise of this whole file. If the repository stops emitting
    // the partner-status join or the '*' sentinel branch, the plans above would
    // still pass while proving something about a query nobody runs.
    const { statement } = await captureOfferLookup(
      [{ category: 'top', comfortRange: 'cold' }],
      targetRegion
    )

    expect(statement.sql).toContain('"CommercePartner"')
    expect(statement.sql).toContain('p."status" = \'active\'::"CommercePartnerStatus"')
    expect(statement.sql).toContain('o."locale_region" = $1 OR o."locale_region" = \'*\'')
    expect(statement.sql).toContain("now() AT TIME ZONE 'UTC'")
    expect(statement.params).toEqual([targetRegion, 'top', 'cold'])
  })

  it('5.1-PLAN-05 reads far fewer buffers than the table occupies', async (context) => {
    if (!requireSchema(context)) return

    // The durable statement of "this does not scan the catalog", independent of
    // which index the planner names. A sequential scan has to touch every page.
    const { statement } = await captureOfferLookup(
      [{ category: 'top', comfortRange: 'cold' }],
      targetRegion
    )
    const plan = await explainCaptured(statement)

    const relationPages = await prisma.$queryRaw<{ pages: number }[]>`
      SELECT relpages::int AS pages FROM pg_class WHERE relname = 'AffiliateOffer'
    `
    const totalPages = relationPages[0]?.pages ?? 0
    const buffers = peakBuffers(plan)

    expect(
      totalPages,
      'the fixture must be large enough for this to mean anything'
    ).toBeGreaterThan(50)
    /*
     * A buffer count was actually read. Without this, a plan carrying no
     * `shared hit=` line at all -- BUFFERS dropped from the EXPLAIN options, or a
     * PostgreSQL release changing the wording -- yields 0 from `peakBuffers`, and
     * both bounds below hold trivially. The test would then be green having
     * measured nothing, which is the precise failure mode 5.1-PLAN-06 exists to
     * rule out, and it would be silly to reintroduce it one test later.
     */
    expect(buffers, `no buffer counters found in plan:\n${plan}`).toBeGreaterThan(0)
    expect(buffers, `plan was:\n${plan}`).toBeLessThan(totalPages)
    // An absolute cap as well as a relative one. `relpages` counts the physical
    // file, which stays large after rows are deleted without a VACUUM, so a
    // bloated table would make the relative bound above pass on its own.
    expect(buffers, `plan was:\n${plan}`).toBeLessThanOrEqual(40)
  })

  it('5.1-PLAN-06 proves these assertions can actually fail', async (context) => {
    if (!requireSchema(context)) return

    /*
     * The one test here that guards the other five.
     *
     * `relpages` is read from the physical file, so a table left bloated by an
     * earlier run reports as large even when it holds few live rows. That means
     * an index assertion could conceivably pass because of someone else's
     * leftovers rather than this fixture. Forcing the planner off every index
     * form and confirming the result trips the same regex proves the detection
     * works and that a real regression would be caught rather than shrugged off.
     */
    const { statement } = await captureOfferLookup(
      [{ category: 'top', comfortRange: 'cold' }],
      targetRegion
    )
    const forcedPlan = await explainWithoutIndexes(statement)
    const indexedPlan = await explainCaptured(statement)

    expect(forcedPlan, `forced plan was:\n${forcedPlan}`).toMatch(
      /Seq Scan on "?AffiliateOffer"?/
    )
    expect(forcedPlan).not.toContain(OFFER_LOOKUP_INDEX)
    // And the forced scan really is the expensive shape the index avoids. Both
    // plans are resolved above rather than inside the assertion, so the values
    // being compared are visible in the test body.
    expect(peakBuffers(forcedPlan)).toBeGreaterThan(peakBuffers(indexedPlan))
  })
})

/**
 * The largest `shared hit=/read=` figure the plan reports, which is the buffer
 * count for the whole query.
 *
 * Deliberately a maximum and not a sum: every node reports the buffers of its
 * own subtree, so a parent's number already includes its children's. Summing
 * them counts the same pages once per level of the tree and inflates a five-node
 * plan by roughly a factor of five.
 */
function peakBuffers(plan: string): number {
  return [...plan.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)].reduce(
    (max, match) => Math.max(max, Number(match[1] ?? 0) + Number(match[2] ?? 0)),
    0
  )
}
