// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

/**
 * Story 5.1 Task 1: the commerce schema, exercised against a real PostgreSQL
 * connection rather than by reading migration.sql as text.
 *
 * A substring check over the migration file passes whether or not the DDL was
 * ever applied and whether or not the constraint actually behaves. Every
 * assertion below therefore inserts real rows and asserts on the error the
 * database raises, or on catalog metadata the database reports.
 *
 * These constraints are the story's last line of defence in two places that
 * matter. `webhook_secret_ref` bounds a `process.env[<database value>]` read
 * that is otherwise unbounded, and the dedupe index is the only thing standing
 * between two concurrent taps and two billable click rows.
 */

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const adminPool = new Pool({ connectionString: databaseUrl, max: 4 })

/** Runs `body` inside a transaction that always rolls back, so tests stay isolated. */
const inRolledBackTransaction = async <T>(
  body: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await adminPool.connect()

  try {
    await client.query('BEGIN')
    return await body(client)
  } finally {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failures so the pooled client is still released.
    }
    client.release()
  }
}

type CommerceFixture = {
  userId: string
  otherUserId: string
  partnerId: string
  offerId: string
  wildcardOfferId: string
}

const VALID_SECRET_REF = 'COMMERCE_PARTNER_FIXTURE_WEBHOOK_SECRET'
const VALID_DEEP_LINK = 'https://partner.couturecast.test/shop?cc={clickToken}'

const seedCommerceGraph = async (client: PoolClient): Promise<CommerceFixture> => {
  const suffix = randomUUID()
  const fixture: CommerceFixture = {
    userId: `commerce-owner-${suffix}`,
    otherUserId: `commerce-other-${suffix}`,
    partnerId: `partner-${suffix}`,
    offerId: `offer-${suffix}`,
    wildcardOfferId: `offer-wildcard-${suffix}`,
  }

  for (const [id, email] of [
    [fixture.userId, `commerce-owner-${suffix}@example.com`],
    [fixture.otherUserId, `commerce-other-${suffix}@example.com`],
  ]) {
    await client.query(
      'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
      [id, email]
    )
  }

  await client.query(
    `INSERT INTO public."CommercePartner"
      ("id", "slug", "display_name", "allowed_host", "status", "webhook_secret_ref", "updated_at")
     VALUES ($1, $2, 'Fixture Partner', 'partner.couturecast.test', 'active', $3, NOW())`,
    [fixture.partnerId, `fixture-${suffix}`, VALID_SECRET_REF]
  )

  await client.query(
    `INSERT INTO public."AffiliateOffer"
      ("id", "partner_id", "garment_category", "comfort_range", "locale_region",
       "title", "deep_link_template", "priority", "status", "effective_from", "updated_at")
     VALUES ($1, $2, 'top', 'mild', 'US', 'Exact match offer', $3, 5, 'active',
             NOW() - INTERVAL '1 day', NOW())`,
    [fixture.offerId, fixture.partnerId, VALID_DEEP_LINK]
  )

  await client.query(
    `INSERT INTO public."AffiliateOffer"
      ("id", "partner_id", "garment_category", "comfort_range", "locale_region",
       "title", "deep_link_template", "priority", "status", "effective_from", "updated_at")
     VALUES ($1, $2, 'top', NULL, '*', 'Wildcard offer', $3, 99, 'active',
             NOW() - INTERVAL '1 day', NOW())`,
    [fixture.wildcardOfferId, fixture.partnerId, VALID_DEEP_LINK]
  )

  return fixture
}

const insertClick = (
  client: PoolClient,
  fixture: CommerceFixture,
  overrides: {
    id?: string
    token?: string
    userId?: string
    offerId?: string
    recommendationId?: string
    localeRegion?: string
    createdAt?: string
  } = {}
) =>
  client.query<{ id: string }>(
    `INSERT INTO public."AffiliateClick"
      ("id", "token", "user_id", "offer_id", "partner_id", "recommendation_id",
       "scenario", "surface", "locale_region", "created_at")
     VALUES ($1, $2, $3, $4, $5, $6, 'school', 'mobile_hero', $7, COALESCE($8::timestamp, NOW()))
     RETURNING "id"`,
    [
      overrides.id ?? `click-${randomUUID()}`,
      overrides.token ?? `token-${randomUUID()}`,
      overrides.userId ?? fixture.userId,
      overrides.offerId ?? fixture.offerId,
      fixture.partnerId,
      overrides.recommendationId ?? 'recommendation-fixed',
      overrides.localeRegion ?? 'US',
      overrides.createdAt ?? null,
    ]
  )

const insertConversion = (
  client: PoolClient,
  fixture: CommerceFixture,
  overrides: {
    externalEventId?: string
    affiliateClickId?: string | null
    orderValueMinorUnits?: number
    currency?: string
  } = {}
) =>
  client.query<{ id: string }>(
    `INSERT INTO public."AffiliateConversion"
      ("id", "partner_id", "external_event_id", "affiliate_click_id", "status",
       "order_value_minor_units", "currency", "occurred_at")
     VALUES ($1, $2, $3, $4, 'confirmed', $5, $6, NOW())
     RETURNING "id"`,
    [
      `conversion-${randomUUID()}`,
      fixture.partnerId,
      overrides.externalEventId ?? `event-${randomUUID()}`,
      overrides.affiliateClickId === undefined ? null : overrides.affiliateClickId,
      overrides.orderValueMinorUnits ?? 12900,
      overrides.currency ?? 'USD',
    ]
  )

describe('commerce affiliate schema and migration', () => {
  beforeAll(async () => {
    const client = await adminPool.connect()

    try {
      await client.query('SELECT 1 FROM public."CommercePartner" LIMIT 1')
    } catch (error) {
      throw new Error(
        'Commerce schema tests require a migrated target database. Run `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` before running this suite.',
        { cause: error }
      )
    } finally {
      client.release()
    }
  })

  afterAll(async () => {
    await adminPool.end()
  })

  it('5.1-DB-010 applies column defaults for status, opt-in, priority, and receipt time', async () => {
    await inRolledBackTransaction(async (client) => {
      const suffix = randomUUID()

      // Both catalog statuses default to `inactive`. An operator inserting a row
      // by hand must have to say "publish this" explicitly; a catalog that goes
      // live the moment a row lands is one typo away from an undisclosed
      // affiliate link.
      await client.query(
        `INSERT INTO public."CommercePartner"
          ("id", "slug", "display_name", "allowed_host", "webhook_secret_ref", "updated_at")
         VALUES ($1, $2, 'Defaults Partner', 'partner.couturecast.test', $3, NOW())`,
        [`partner-${suffix}`, `defaults-${suffix}`, VALID_SECRET_REF]
      )

      const partner = await client.query<{ status: string }>(
        'SELECT "status" FROM public."CommercePartner" WHERE "id" = $1',
        [`partner-${suffix}`]
      )
      expect(partner.rows).toEqual([{ status: 'inactive' }])

      await client.query(
        `INSERT INTO public."AffiliateOffer"
          ("id", "partner_id", "garment_category", "locale_region", "title",
           "deep_link_template", "effective_from", "updated_at")
         VALUES ($1, $2, 'top', '*', 'Defaults Offer', $3, NOW(), NOW())`,
        [`offer-${suffix}`, `partner-${suffix}`, VALID_DEEP_LINK]
      )

      const offer = await client.query<{
        status: string
        priority: number
        comfort_range: string | null
        effective_to: Date | null
      }>(
        `SELECT "status", "priority", "comfort_range", "effective_to"
         FROM public."AffiliateOffer" WHERE "id" = $1`,
        [`offer-${suffix}`]
      )
      expect(offer.rows).toEqual([
        { status: 'inactive', priority: 0, comfort_range: null, effective_to: null },
      ])

      await client.query(
        'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
        [`user-${suffix}`, `defaults-${suffix}@example.com`]
      )

      // The opt-out defaults to enabled: epic AC 3 says "opt-out toggle", and a
      // missing row is treated as consent, so the default must agree.
      await client.query(
        `INSERT INTO public."CommercePreference" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`preference-${suffix}`, `user-${suffix}`]
      )

      const preference = await client.query<{ affiliate_ctas_enabled: boolean }>(
        'SELECT "affiliate_ctas_enabled" FROM public."CommercePreference" WHERE "id" = $1',
        [`preference-${suffix}`]
      )
      expect(preference.rows).toEqual([{ affiliate_ctas_enabled: true }])
    })
  })

  it('5.1-DB-011 constrains webhook_secret_ref to the closed environment-variable name shape', async () => {
    // This is the sharpest constraint in the story. Resolving a partner secret
    // means `process.env[<value from this column>]`; without the constraint that
    // is a read of ANY environment variable in the process, chosen by whoever
    // can write a catalog row.
    const rejected = [
      'DATABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'commerce_partner_lowercase_webhook_secret',
      'COMMERCE_PARTNER__WEBHOOK_SECRET',
      'COMMERCE_PARTNER_SAMPLE_WEBHOOK_SECRET_SUFFIX',
      'PREFIX_COMMERCE_PARTNER_SAMPLE_WEBHOOK_SECRET',
      'COMMERCE_PARTNER_HAS-A-DASH_WEBHOOK_SECRET',
      '',
    ]

    for (const secretRef of rejected) {
      await inRolledBackTransaction(async (client) => {
        await expect(
          client.query(
            `INSERT INTO public."CommercePartner"
              ("id", "slug", "display_name", "allowed_host", "webhook_secret_ref", "updated_at")
             VALUES ($1, $2, 'Rejected Partner', 'partner.couturecast.test', $3, NOW())`,
            [`partner-${randomUUID()}`, `rejected-${randomUUID()}`, secretRef]
          )
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'CommercePartner_webhook_secret_ref_check',
        })
      })
    }

    await inRolledBackTransaction(async (client) => {
      const accepted = await client.query(
        `INSERT INTO public."CommercePartner"
          ("id", "slug", "display_name", "allowed_host", "webhook_secret_ref", "updated_at")
         VALUES ($1, $2, 'Accepted Partner', 'partner.couturecast.test', $3, NOW())
         RETURNING "id"`,
        [
          `partner-${randomUUID()}`,
          `accepted-${randomUUID()}`,
          'COMMERCE_PARTNER_SAMPLE_PARTNER_WEBHOOK_SECRET',
        ]
      )
      expect(accepted.rows).toHaveLength(1)
    })
  })

  it('5.1-DB-012 constrains locale_region to a region subtag or the global sentinel', async () => {
    const rejectedRegions = ['us', 'USA1', 'U', 'en-US', '**', 'U S']

    for (const localeRegion of rejectedRegions) {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommerceGraph(client)

        await expect(
          client.query(
            `INSERT INTO public."AffiliateOffer"
              ("id", "partner_id", "garment_category", "locale_region", "title",
               "deep_link_template", "effective_from", "updated_at")
             VALUES ($1, $2, 'top', $3, 'Bad region', $4, NOW(), NOW())`,
            [`offer-${randomUUID()}`, fixture.partnerId, localeRegion, VALID_DEEP_LINK]
          )
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'AffiliateOffer_locale_region_check',
        })
      })
    }

    // '*' publishes globally, 'US' is a country subtag, and '419' is a UN M.49
    // macro-region reached through the es-419 locale. All three are legal.
    for (const localeRegion of ['*', 'US', 'CA', '419']) {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommerceGraph(client)

        const accepted = await client.query(
          `INSERT INTO public."AffiliateOffer"
            ("id", "partner_id", "garment_category", "locale_region", "title",
             "deep_link_template", "effective_from", "updated_at")
           VALUES ($1, $2, 'top', $3, 'Good region', $4, NOW(), NOW())
           RETURNING "id"`,
          [`offer-${randomUUID()}`, fixture.partnerId, localeRegion, VALID_DEEP_LINK]
        )
        expect(accepted.rows).toHaveLength(1)
      })
    }

    // The same domain applies to the click row's derived region.
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)

      await expect(
        insertClick(client, fixture, { localeRegion: 'us' })
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'AffiliateClick_locale_region_check',
      })
    })
  })

  it('5.1-DB-013 rejects negative money and non-ISO-4217 currency codes', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)

      await expect(
        insertConversion(client, fixture, { orderValueMinorUnits: -1 })
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'AffiliateConversion_order_value_minor_units_check',
      })
    })

    // Zero is legal: a reversed conversion or a fully discounted order is a real
    // commercial fact, and rejecting it would drop the event entirely.
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)

      const zeroValue = await insertConversion(client, fixture, {
        orderValueMinorUnits: 0,
      })
      expect(zeroValue.rows).toHaveLength(1)
    })

    for (const currency of ['usd', 'US', 'USDD', 'US1', '']) {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommerceGraph(client)

        await expect(
          insertConversion(client, fixture, { currency })
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'AffiliateConversion_currency_check',
        })
      })
    }
  })

  it('5.1-DB-014 enforces one click token and one conversion per partner event', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)
      const sharedToken = `token-${randomUUID()}`

      await insertClick(client, fixture, { token: sharedToken })

      await expect(
        insertClick(client, fixture, {
          token: sharedToken,
          recommendationId: 'recommendation-other',
        })
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'AffiliateClick_token_key',
      })
    })

    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)
      const sharedEventId = `event-${randomUUID()}`

      await insertConversion(client, fixture, { externalEventId: sharedEventId })

      // Append-only idempotency: a replayed partner event must collide here so
      // the service can return 200 while writing nothing.
      await expect(
        insertConversion(client, fixture, { externalEventId: sharedEventId })
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'AffiliateConversion_partner_id_external_event_id_key',
      })
    })
  })

  it('5.1-DB-015 blocks a concurrent duplicate click through the minute-bucket unique index', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)
      const createdAt = '2026-08-11T10:00:30.000Z'

      await insertClick(client, fixture, {
        recommendationId: 'recommendation-race',
        createdAt,
      })

      // Same user, offer, and recommendation inside the same minute bucket. This
      // is the shape two concurrent taps take, and exactly one must survive.
      await expect(
        insertClick(client, fixture, {
          recommendationId: 'recommendation-race',
          createdAt: '2026-08-11T10:00:45.000Z',
        })
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'AffiliateClick_dedupe_minute_key',
      })
    })

    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)

      // A different minute bucket is NOT blocked by the index. The 60-second
      // product rule is the service's job; this index only makes the concurrent
      // case impossible. Asserting the gap here keeps the two rules from being
      // confused for one another later.
      await insertClick(client, fixture, {
        recommendationId: 'recommendation-gap',
        createdAt: '2026-08-11T10:00:59.000Z',
      })

      const nextBucket = await insertClick(client, fixture, {
        recommendationId: 'recommendation-gap',
        createdAt: '2026-08-11T10:01:01.000Z',
      })
      expect(nextBucket.rows).toHaveLength(1)
    })

    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)

      // A different recommendation in the same minute is a distinct impression
      // and must mint its own click.
      await insertClick(client, fixture, {
        recommendationId: 'recommendation-a',
        createdAt: '2026-08-11T10:00:30.000Z',
      })

      const otherRecommendation = await insertClick(client, fixture, {
        recommendationId: 'recommendation-b',
        createdAt: '2026-08-11T10:00:31.000Z',
      })
      expect(otherRecommendation.rows).toHaveLength(1)
    })
  })

  it('5.1-DB-016 cascades clicks from user deletion while conversions survive unattributed', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)

      const click = await insertClick(client, fixture)
      const clickId = click.rows[0]?.id
      expect(clickId).toBeDefined()

      const conversion = await insertConversion(client, fixture, {
        affiliateClickId: clickId,
      })
      const conversionId = conversion.rows[0]?.id

      await client.query(
        `INSERT INTO public."CommercePreference" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`preference-${randomUUID()}`, fixture.userId]
      )

      await client.query('DELETE FROM public."User" WHERE "id" = $1', [fixture.userId])

      // Personal link destroyed...
      const remainingClicks = await client.query(
        'SELECT "id" FROM public."AffiliateClick" WHERE "user_id" = $1',
        [fixture.userId]
      )
      expect(remainingClicks.rows).toHaveLength(0)

      const remainingPreferences = await client.query(
        'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
        [fixture.userId]
      )
      expect(remainingPreferences.rows).toHaveLength(0)

      // ...financial fact preserved, now unattributed.
      const survivingConversion = await client.query<{
        id: string
        affiliate_click_id: string | null
      }>(
        'SELECT "id", "affiliate_click_id" FROM public."AffiliateConversion" WHERE "id" = $1',
        [conversionId]
      )
      expect(survivingConversion.rows).toEqual([
        { id: conversionId, affiliate_click_id: null },
      ])
    })
  })

  it('5.1-DB-017 refuses to delete catalog rows that clicks still reference', async () => {
    // RESTRICT rather than CASCADE: deleting an offer that has been clicked would
    // silently erase the attribution trail behind real commercial records.
    // Each violation gets its own transaction: PostgreSQL aborts the whole
    // transaction on a constraint error, so a second query in the same one would
    // report 25P02 (in_failed_sql_transaction) and prove nothing.
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)
      await insertClick(client, fixture)

      await expect(
        client.query('DELETE FROM public."AffiliateOffer" WHERE "id" = $1', [
          fixture.offerId,
        ])
      ).rejects.toMatchObject({ code: '23503' })
    })

    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)
      await insertClick(client, fixture)

      await expect(
        client.query('DELETE FROM public."CommercePartner" WHERE "id" = $1', [
          fixture.partnerId,
        ])
      ).rejects.toMatchObject({ code: '23503' })
    })
  })

  it('5.1-DB-018 keeps one commerce preference row per user', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCommerceGraph(client)

      await client.query(
        `INSERT INTO public."CommercePreference" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`preference-${randomUUID()}`, fixture.userId]
      )

      await expect(
        client.query(
          `INSERT INTO public."CommercePreference" ("id", "user_id", "updated_at")
           VALUES ($1, $2, NOW())`,
          [`preference-${randomUUID()}`, fixture.userId]
        )
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'CommercePreference_user_id_key',
      })
    })
  })

  it('5.1-DB-019 installs the offer lookup and retention indexes the query plans depend on', async () => {
    const client = await adminPool.connect()

    try {
      const indexes = await client.query<{ indexname: string }>(
        `SELECT "indexname" FROM pg_indexes
         WHERE "schemaname" = 'public'
           AND "tablename" IN ('CommercePartner', 'AffiliateOffer', 'CommercePreference',
                               'AffiliateClick', 'AffiliateConversion')`
      )
      const names = indexes.rows.map((row) => row.indexname)

      expect(names).toEqual(
        expect.arrayContaining([
          'CommercePartner_slug_key',
          // Offer selection filters on status, region, and category and orders by
          // priority. Without this index the eligibility query sequential-scans
          // the catalog on every ritual request.
          'AffiliateOffer_status_locale_region_garment_category_priori_idx',
          'CommercePreference_user_id_key',
          'AffiliateClick_token_key',
          // The commerce pruner sweeps by age; the dedupe read filters by owner,
          // offer, and recommendation.
          'AffiliateClick_created_at_idx',
          'AffiliateClick_user_id_offer_id_recommendation_id_created_a_idx',
          'AffiliateClick_dedupe_minute_key',
          'AffiliateConversion_partner_id_external_event_id_key',
          'AffiliateConversion_received_at_idx',
        ])
      )
    } finally {
      client.release()
    }
  })

  it('5.1-DB-020 enables RLS everywhere and grants clients only the two owner-scoped tables', async () => {
    const client = await adminPool.connect()

    try {
      const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT "relname", "relrowsecurity" FROM pg_class
         WHERE "relname" IN ('CommercePartner', 'AffiliateOffer', 'CommercePreference',
                             'AffiliateClick', 'AffiliateConversion')
         ORDER BY "relname"`
      )
      expect(rls.rows).toEqual([
        { relname: 'AffiliateClick', relrowsecurity: true },
        { relname: 'AffiliateConversion', relrowsecurity: true },
        { relname: 'AffiliateOffer', relrowsecurity: true },
        { relname: 'CommercePartner', relrowsecurity: true },
        { relname: 'CommercePreference', relrowsecurity: true },
      ])

      const policies = await client.query<{ tablename: string; cmd: string }>(
        `SELECT "tablename", "cmd" FROM pg_policies
         WHERE "tablename" IN ('CommercePreference', 'AffiliateClick')`
      )
      for (const table of ['CommercePreference', 'AffiliateClick']) {
        const commands = policies.rows
          .filter((row) => row.tablename === table)
          .map((row) => row.cmd)
          .sort()
        expect(commands).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      }

      const grants = await client.query<{ table_name: string; privilege_type: string }>(
        `SELECT "table_name", "privilege_type" FROM information_schema.role_table_grants
         WHERE "table_schema" = 'public'
           AND "table_name" IN ('CommercePartner', 'AffiliateOffer', 'CommercePreference',
                                'AffiliateClick', 'AffiliateConversion')
           AND "grantee" IN ('authenticated', 'anon')`
      )

      for (const table of ['CommercePreference', 'AffiliateClick']) {
        const privileges = grants.rows
          .filter((row) => row.table_name === table)
          .map((row) => row.privilege_type)
          .sort()
        expect(privileges).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      }

      // The catalog and the conversion ledger are granted nothing at all.
      const catalogGrants = grants.rows.filter((row) =>
        ['CommercePartner', 'AffiliateOffer', 'AffiliateConversion'].includes(
          row.table_name
        )
      )
      expect(catalogGrants).toEqual([])
    } finally {
      client.release()
    }
  })
})
