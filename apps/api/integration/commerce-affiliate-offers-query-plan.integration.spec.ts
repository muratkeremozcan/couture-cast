// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { CommerceRepository } from '../src/modules/commerce/commerce.repository.js'
import type { AdvisorSlot, SkinUndertone } from '@couture/api-client/contracts/http'

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
 * The advisor lookup's own index, PARTIAL on `advisor_slot IS NOT NULL`.
 *
 * The partial predicate is what keeps this index and the garment one above from
 * being structurally tied on a garment-only query -- the ambiguity that
 * regressed `5.1-PLAN-03` when the advisor index was first added. `5.4-DB-041`
 * pins the predicate itself in `packages/db`; what is proven here is that the
 * planner actually descends it for the advisor predicate at volume.
 */
const ADVISOR_LOOKUP_INDEX =
  'AffiliateOffer_status_locale_region_advisor_slot_priority_idx'

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

  /**
   * The advisor twin of `captureOfferLookup`, over `findBestAdvisorOffer`.
   *
   * Separate rather than parameterised because the two repository methods take
   * different arguments and the point of capturing at all is that the SQL under
   * `EXPLAIN` is the one the application emits. A shared wrapper that took a
   * thunk would read better and prove exactly as much, but the two call sites
   * are three lines each and the duplication keeps the arguments visible next
   * to the plan they produce.
   */
  async function captureAdvisorLookup(
    slot: AdvisorSlot,
    undertone: SkinUndertone,
    region: string
  ): Promise<{ statement: CapturedStatement; matched: boolean }> {
    captured.length = 0
    const arrived = new Promise<CapturedStatement>((resolve) => {
      resolveCapture = resolve
    })

    const match = await repository.findBestAdvisorOffer(slot, undertone, region)

    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('The advisor lookup emitted no query event to explain')),
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

    /*
     * THE ADVISOR COHORT, and why the garment rows above cannot stand in for it.
     *
     * `findBestAdvisorOffer` runs a structurally identical lookup against this
     * same table, but its predicate is `advisor_slot = $n` and every volume row
     * above carries `garment_category` instead -- the CHECK constraint
     * `num_nonnulls(garment_category, advisor_slot) = 1` makes a row that
     * satisfies both unrepresentable. So without these rows there is no advisor
     * data at volume for a plan to be honest about: the advisor index would be
     * empty, the planner would pick it trivially, and the assertion would pass
     * for the wrong reason.
     *
     * Same size as the garment cohort, same inactive partner, and spread across
     * the same reserved `Z**` region block. The advisor index is PARTIAL on
     * `advisor_slot IS NOT NULL`, so these are the only rows in it; the garment
     * index gains 4,000 entries at NULL `garment_category`, which sort together
     * and never sit between a `garment_category = 'top'` seek and its target.
     */
    const advisorSlots = ['foundation', 'blush', 'jewelry', 'bag', 'eyewear'] as const
    const undertones = [null, 'warm', 'cool', 'neutral', 'olive'] as const

    const advisorRows = Array.from({ length: SEED_COUNT }, (_, index) => ({
      partner_id: bulkPartnerId,
      advisor_slot: advisorSlots[index % advisorSlots.length]!,
      advisor_undertone: undertones[index % undertones.length],
      locale_region: `Z${String(index % 36).padStart(2, '0')}`.slice(0, 3),
      title: `Advisor plan offer ${index}`,
      deep_link_template: 'https://partner.couturecast.test/shop?cc={clickToken}',
      priority: index % 50,
      status: index % 5 === 0 ? ('inactive' as const) : ('active' as const),
      effective_from: new Date('2020-01-01T00:00:00.000Z'),
      effective_to: null,
    }))

    /*
     * Guaranteed advisor matches, under the ACTIVE partner and in `targetRegion`.
     * Both undertone forms are seeded because the lookup's `ORDER BY
     * (advisor_undertone IS NULL) ASC` exists to prefer the specific row over the
     * catch-all, and a fixture carrying only one of them would let that clause
     * rot unnoticed.
     */
    const advisorMatches = advisorSlots.flatMap((slot, position) =>
      ([null, 'warm'] as const).map((undertone, variant) => ({
        partner_id: matchPartnerId,
        advisor_slot: slot,
        advisor_undertone: undertone,
        locale_region: targetRegion,
        title: `Advisor plan match ${slot}-${undertone ?? 'any'}`,
        deep_link_template: 'https://partner.couturecast.test/shop?cc={clickToken}',
        priority: 10 + position * 2 + variant,
        status: 'active' as const,
        effective_from: new Date('2020-01-01T00:00:00.000Z'),
        effective_to: null,
      }))
    )

    // RECLAIM BEFORE SEEDING, or 5.1-PLAN-05 fails on a developer's machine.
    //
    // Every prior run of this file inserted its rows and deleted them again in
    // `afterAll`, and a plain delete leaves dead tuples behind. Insert into a
    // table carrying them and the fixture lands on fresh pages past the dead
    // ones instead of reusing them, so the same rows spread across more of the
    // file and an index scan over them reads proportionally more buffers.
    // Measured on a local database seeded many times: 65 buffers against
    // 5.1-PLAN-05's cap of 40, on a query that had not regressed at all. CI never
    // saw it, because `pr-checks.yml` gives each run a fresh PostgreSQL container
    // where the table has no history.
    //
    // `FULL` rather than plain `VACUUM` on purpose: plain VACUUM marks the space
    // reusable but does not return trailing pages, and it is the physical extent
    // this file measures against (`relpages`, read from `pg_class` below). The
    // lock it takes is exclusive, which is affordable here and nowhere near a
    // production path.
    await prisma.$executeRawUnsafe('VACUUM (FULL) "AffiliateOffer"')

    await prisma.affiliateOffer.createMany({
      data: [...rows, ...guaranteedMatches, ...advisorRows, ...advisorMatches],
    })

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
    // A regex rather than toContain: this fragment carries single quotes, and
    // prettier and the `quotes` rule disagree about how to spell a string
    // literal that does.
    expect(statement.sql).toMatch(/now\(\) AT TIME ZONE 'UTC'/)
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

  /*
   * -----------------------------------------------------------------------
   * Story 5.4: the same evidence for the advisor lookup.
   *
   * `findBestAdvisorOffer` was added to this table by story 5.4 and inherited
   * none of the proof above, because every volume row this suite seeded carried
   * `garment_category` and the CHECK constraint makes a row that satisfies both
   * predicates unrepresentable. The advisor cohort seeded in `beforeAll` closes
   * that: 4,000 advisor rows under the inactive partner, ten selectable ones
   * under the active partner in `targetRegion`.
   *
   * The claims mirror 5.1-PLAN-02/-04/-05/-06 one for one, deliberately. The
   * advisor lookup is on the palette surface rather than the ritual hot path, so
   * the latency argument is weaker; the argument that survives is the same one
   * -- a catalog an operator grows by hand degrades a sequential scan linearly,
   * and the plan is the property that holds while a threshold does not.
   * -----------------------------------------------------------------------
   */

  it('5.4-PLAN-01 serves the advisor lookup from the partial advisor index, unaided', async (context) => {
    if (!requireSchema(context)) return

    const { statement, matched } = await captureAdvisorLookup(
      'foundation',
      'warm',
      targetRegion
    )
    const plan = await explainCaptured(statement)

    expect(matched, 'the fixture must contain a matching advisor offer').toBe(true)
    // Unaided: `enable_seqscan` is left on, so the planner is choosing the index
    // on merit at this volume rather than merely being capable of using it.
    expect(plan, `plan was:\n${plan}`).toContain(ADVISOR_LOOKUP_INDEX)
    expect(plan, 'the catalog must not be read end to end').not.toMatch(
      /Seq Scan on "?AffiliateOffer"?/
    )
    /*
     * And `advisor_slot` is IN the index condition, not left to a heap filter.
     * Mere presence of the index name is the weak claim: both indexes lead with
     * `(status, locale_region)`, so an index scan that pushed only those two
     * columns down and re-checked the slot on every heap row would still name
     * this index while reading the whole region. The seek being three columns
     * deep is what the partial index actually buys.
     */
    expect(plan, `plan was:\n${plan}`).toMatch(
      new RegExp(
        `Bitmap Index Scan on "${ADVISOR_LOOKUP_INDEX}"[\\s\\S]*?Index Cond:[^\\n]*advisor_slot`
      )
    )
    /*
     * THE GARMENT INDEX LEGITIMATELY APPEARS HERE, and this test deliberately
     * does not forbid it. The predicate is `locale_region = $3 OR locale_region
     * = '*'`, which the planner splits into a BitmapOr; the `'*'` branch carries
     * no `advisor_slot` in its condition, so both indexes serve it equally and
     * either may be picked. That is a choice between two index scans, not the
     * table scan these assertions exist to rule out, and this fixture holds no
     * `'*'` rows to separate them -- deliberately, because a `'*'` row matches
     * every request region and would become a candidate offer in the sibling
     * suites. An assertion that the garment index is absent would therefore be
     * pinning an artefact of the fixture rather than a property of the query.
     */
  })

  it('5.4-PLAN-02 explains the advisor query the repository actually runs', async (context) => {
    if (!requireSchema(context)) return

    // Guards the premise of the three assertions around it, the way 5.1-PLAN-04
    // does for the garment ones. If the repository stops emitting the partner
    // join, the undertone catch-all or the publication window, the plans would
    // still pass while proving something about a query nobody runs.
    const { statement } = await captureAdvisorLookup('foundation', 'warm', targetRegion)

    expect(statement.sql).toContain('"CommercePartner"')
    expect(statement.sql).toContain('p."status" = \'active\'::"CommercePartnerStatus"')
    expect(statement.sql).toContain('o."advisor_undertone" IS NULL')
    expect(statement.sql).toContain('o."locale_region" = $3 OR o."locale_region" = \'*\'')
    expect(statement.sql).toMatch(/now\(\) AT TIME ZONE 'UTC'/)
    expect(statement.params).toEqual(['foundation', 'warm', targetRegion])
  })

  it('5.4-PLAN-03 reads far fewer buffers than the table occupies', async (context) => {
    if (!requireSchema(context)) return

    // The durable statement of "this does not scan the catalog", independent of
    // which index the planner names.
    const { statement } = await captureAdvisorLookup('blush', 'cool', targetRegion)
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
    // A buffer count was actually read, so neither bound below can hold
    // trivially against a plan that reports no counters at all.
    expect(buffers, `no buffer counters found in plan:\n${plan}`).toBeGreaterThan(0)
    expect(buffers, `plan was:\n${plan}`).toBeLessThan(totalPages)
    // The absolute cap as well as the relative one: `relpages` counts the
    // physical file, so a table left bloated by an earlier run would satisfy the
    // relative bound on its own.
    expect(buffers, `plan was:\n${plan}`).toBeLessThanOrEqual(40)
  })

  it('5.4-PLAN-04 proves the advisor assertions can actually fail', async (context) => {
    if (!requireSchema(context)) return

    // The falsifiability guard, mirroring 5.1-PLAN-06. Forcing the planner off
    // every index form must trip the very regex the tests above rely on;
    // otherwise a green run proves the detection works, not the index.
    const { statement } = await captureAdvisorLookup('foundation', 'warm', targetRegion)
    const forcedPlan = await explainWithoutIndexes(statement)
    const indexedPlan = await explainCaptured(statement)

    expect(forcedPlan, `forced plan was:\n${forcedPlan}`).toMatch(
      /Seq Scan on "?AffiliateOffer"?/
    )
    expect(forcedPlan).not.toContain(ADVISOR_LOOKUP_INDEX)
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
