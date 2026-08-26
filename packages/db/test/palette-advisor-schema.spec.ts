// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Story 5.4: color palette & beauty/accessory advisor.
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

/**
 * Story 5.4 Task 1: the palette advisor schema, exercised against a real
 * PostgreSQL connection rather than by reading migration.sql as text.
 *
 * The properties pinned here are the ones a service bug would silently erode:
 *
 *   * `PaletteProfile.user_id` is UNIQUE — one row per user, and revocation is
 *     an UPDATE to nulled scalars, never a DELETE (Decision 9).
 *   * `AdvisorRecommendationState` is unique on (user_id, slot, item_key) — one
 *     row per saved-or-dismissed suggestion.
 *   * Both FKs cascade on user delete — Decision 9 deletes AdvisorRecommendationState
 *     rows on erase, and PaletteProfile survives with nulled scalars via the
 *     service, but the row itself still leaves with the account if the account
 *     itself is deleted directly.
 *   * `AffiliateOffer` carries the `num_nonnulls(garment_category, advisor_slot) = 1`
 *     check constraint (Decision 7): every row is unambiguously a garment offer
 *     or an advisor offer, never both and never neither.
 *
 * Actor-matrix coverage for the two new tables lives in
 * `test/rls/palette-advisor.spec.ts`, which owns the selfOnlyTables category
 * they register in.
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

type PaletteFixture = {
  userId: string
  profileId: string
  recommendationId: string
}

const insertUser = async (client: PoolClient, id: string, email: string) => {
  await client.query(
    'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
    [id, email]
  )
}

const seedPaletteGraph = async (client: PoolClient): Promise<PaletteFixture> => {
  const suffix = randomUUID()
  const fixture: PaletteFixture = {
    userId: `palette-owner-${suffix}`,
    profileId: `palette-profile-${suffix}`,
    recommendationId: `palette-recommendation-${suffix}`,
  }

  await insertUser(client, fixture.userId, `palette-owner-${suffix}@example.com`)

  await client.query(
    `INSERT INTO public."PaletteProfile"
      ("id", "user_id", "consent_granted_at", "source", "undertone", "updated_at")
     VALUES ($1, $2, NOW(), 'wardrobe', 'warm', NOW())`,
    [fixture.profileId, fixture.userId]
  )

  await client.query(
    `INSERT INTO public."AdvisorRecommendationState"
      ("id", "user_id", "slot", "item_key", "action", "updated_at")
     VALUES ($1, $2, 'foundation', 'advisor:foundation:warm', 'saved', NOW())`,
    [fixture.recommendationId, fixture.userId]
  )

  return fixture
}

const seedCommercePartner = async (client: PoolClient): Promise<string> => {
  const partnerId = `commerce-partner-${randomUUID()}`
  await client.query(
    `INSERT INTO public."CommercePartner"
      ("id", "slug", "display_name", "allowed_host", "status", "webhook_secret_ref", "updated_at")
     VALUES ($1, $2, 'Schema Fixture Partner', 'partner.couturecast.test', 'active',
             'COMMERCE_PARTNER_SCHEMA_FIXTURE_WEBHOOK_SECRET', NOW())`,
    [partnerId, `schema-fixture-${randomUUID()}`]
  )
  return partnerId
}

afterAll(async () => {
  await adminPool.end()
})

describe('palette advisor schema', () => {
  describe('new enums', () => {
    it('5.4-DB-020 pins every new enum to exactly its shipped members', async () => {
      const client = await adminPool.connect()

      try {
        const result = await client.query<{ type_name: string; label: string }>(
          `SELECT t.typname AS type_name, e.enumlabel AS label
           FROM pg_enum AS e
           INNER JOIN pg_type AS t ON t.oid = e.enumtypid
           WHERE t.typname IN (
             'PaletteSource', 'SkinUndertone', 'SkinDepth', 'PaletteAnalysisStatus',
             'PaletteAnalysisFailureReason', 'AdvisorSlot', 'AdvisorAction'
           )
           ORDER BY t.typname, e.enumsortorder`
        )

        const byType = new Map<string, string[]>()
        for (const row of result.rows) {
          byType.set(row.type_name, [...(byType.get(row.type_name) ?? []), row.label])
        }

        expect(byType.get('PaletteSource')).toEqual(['selfie', 'wardrobe'])
        expect(byType.get('SkinUndertone')).toEqual(['warm', 'cool', 'neutral', 'olive'])
        expect(byType.get('SkinDepth')).toEqual([
          'fair',
          'light',
          'medium',
          'tan',
          'deep',
        ])
        expect(byType.get('PaletteAnalysisStatus')).toEqual([
          'pending_upload',
          'bytes_uploaded',
          'processing',
          'ready',
          'failed',
        ])
        expect(byType.get('PaletteAnalysisFailureReason')).toEqual([
          'no_face',
          'low_quality',
          'privacy_violation',
          'insufficient_wardrobe',
          'timeout',
          'storage_error',
        ])
        expect(byType.get('AdvisorSlot')).toEqual([
          'foundation',
          'blush',
          'jewelry',
          'bag',
          'eyewear',
        ])
        expect(byType.get('AdvisorAction')).toEqual(['saved', 'dismissed'])
      } finally {
        client.release()
      }
    })
  })

  describe('PaletteProfile: one row per user', () => {
    it('5.4-DB-021 rejects a second profile row for the same user', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPaletteGraph(client)

        await expect(
          client.query(
            `INSERT INTO public."PaletteProfile"
              ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())`,
            [`palette-dup-${randomUUID()}`, fixture.userId]
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })

    it('5.4-DB-022 accepts every scalar as NULL, matching a never-analyzed profile', async () => {
      await inRolledBackTransaction(async (client) => {
        const suffix = randomUUID()
        await insertUser(
          client,
          `palette-empty-${suffix}`,
          `palette-empty-${suffix}@example.com`
        )

        await client.query(
          `INSERT INTO public."PaletteProfile" ("id", "user_id", "updated_at")
           VALUES ($1, $2, NOW())`,
          [`palette-empty-profile-${suffix}`, `palette-empty-${suffix}`]
        )

        const stored = await client.query(
          `SELECT "consent_granted_at", "source", "undertone", "depth", "status"
           FROM public."PaletteProfile" WHERE "id" = $1`,
          [`palette-empty-profile-${suffix}`]
        )
        expect(stored.rows).toEqual([
          {
            consent_granted_at: null,
            source: null,
            undertone: null,
            depth: null,
            status: null,
          },
        ])
      })
    })
  })

  describe('AdvisorRecommendationState: one row per (user, slot, item)', () => {
    it('5.4-DB-023 rejects a duplicate (user_id, slot, item_key) row', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPaletteGraph(client)

        await expect(
          client.query(
            `INSERT INTO public."AdvisorRecommendationState"
              ("id", "user_id", "slot", "item_key", "action", "updated_at")
             VALUES ($1, $2, 'foundation', 'advisor:foundation:warm', 'dismissed', NOW())`,
            [`recommendation-dup-${randomUUID()}`, fixture.userId]
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })

    it('5.4-DB-024 allows the same item_key across two different slots for one user', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPaletteGraph(client)

        await client.query(
          `INSERT INTO public."AdvisorRecommendationState"
            ("id", "user_id", "slot", "item_key", "action", "updated_at")
           VALUES ($1, $2, 'blush', 'advisor:foundation:warm', 'dismissed', NOW())`,
          [`recommendation-other-slot-${randomUUID()}`, fixture.userId]
        )
      })
    })
  })

  describe('grants and policies', () => {
    for (const table of ['PaletteProfile', 'AdvisorRecommendationState'] as const) {
      it(`5.4-DB-025 grants authenticated exactly the four owner verbs on ${table}, and anon none`, async () => {
        await inRolledBackTransaction(async (client) => {
          const grants = await client.query<{
            grantee: string
            privilege_type: string
          }>(
            `SELECT "grantee", "privilege_type" FROM information_schema.role_table_grants
             WHERE "table_schema" = 'public'
               AND "table_name" = $1
               AND "grantee" IN ('authenticated', 'anon')`,
            [table]
          )

          const authenticated = grants.rows
            .filter((row) => row.grantee === 'authenticated')
            .map((row) => row.privilege_type)
            .sort()
          expect(authenticated).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
          expect(authenticated).toHaveLength(4)

          expect(grants.rows.filter((row) => row.grantee === 'anon')).toHaveLength(0)
        })
      })

      it(`5.4-DB-026 enables row level security and carries the four owner policies on ${table}`, async () => {
        await inRolledBackTransaction(async (client) => {
          const rls = await client.query<{ relrowsecurity: boolean }>(
            `SELECT "relrowsecurity" FROM pg_class
             WHERE "relnamespace" = 'public'::regnamespace
               AND "relname" = $1`,
            [table]
          )
          expect(rls.rows).toEqual([{ relrowsecurity: true }])

          const policies = await client.query<{ policyname: string; cmd: string }>(
            `SELECT "policyname", "cmd" FROM pg_policies
             WHERE "schemaname" = 'public'
               AND "tablename" = $1`,
            [table]
          )
          expect(policies.rows.map((row) => row.cmd).sort()).toEqual([
            'DELETE',
            'INSERT',
            'SELECT',
            'UPDATE',
          ])
          expect(policies.rows.map((row) => row.policyname).sort()).toEqual([
            'authenticated_delete_own_user_data',
            'authenticated_insert_own_user_data',
            'authenticated_read_own_user_data',
            'authenticated_update_own_user_data',
          ])
        })
      })
    }
  })

  describe('user erasure', () => {
    it('5.4-DB-027 cascades both tables away with the account', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPaletteGraph(client)

        await client.query('DELETE FROM public."User" WHERE "id" = $1', [fixture.userId])

        const remainingProfile = await client.query(
          'SELECT "id" FROM public."PaletteProfile" WHERE "id" = $1',
          [fixture.profileId]
        )
        expect(remainingProfile.rows).toHaveLength(0)

        const remainingRecommendation = await client.query(
          'SELECT "id" FROM public."AdvisorRecommendationState" WHERE "id" = $1',
          [fixture.recommendationId]
        )
        expect(remainingRecommendation.rows).toHaveLength(0)
      })
    })
  })

  /**
   * Decision 7: `AffiliateOffer` extends, not forks, to carry advisor rows.
   * The check constraint is what keeps a row from being both a garment offer
   * and an advisor offer, or neither.
   */
  describe('AffiliateOffer.garment_category XOR advisor_slot', () => {
    it('5.4-DB-028 rejects a row with neither garment_category nor advisor_slot set', async () => {
      await inRolledBackTransaction(async (client) => {
        const partnerId = await seedCommercePartner(client)

        await expect(
          client.query(
            `INSERT INTO public."AffiliateOffer"
              ("id", "partner_id", "locale_region", "title", "deep_link_template",
               "status", "effective_from", "updated_at")
             VALUES ($1, $2, '*', 'Neither Offer', 'https://partner.couturecast.test/shop?cc={clickToken}',
                     'active', NOW(), NOW())`,
            [`offer-neither-${randomUUID()}`, partnerId]
          )
        ).rejects.toMatchObject({ code: '23514' })
      })
    })

    it('5.4-DB-029 rejects a row with both garment_category and advisor_slot set', async () => {
      await inRolledBackTransaction(async (client) => {
        const partnerId = await seedCommercePartner(client)

        await expect(
          client.query(
            `INSERT INTO public."AffiliateOffer"
              ("id", "partner_id", "garment_category", "advisor_slot", "locale_region",
               "title", "deep_link_template", "status", "effective_from", "updated_at")
             VALUES ($1, $2, 'top', 'foundation', '*', 'Both Offer',
                     'https://partner.couturecast.test/shop?cc={clickToken}',
                     'active', NOW(), NOW())`,
            [`offer-both-${randomUUID()}`, partnerId]
          )
        ).rejects.toMatchObject({ code: '23514' })
      })
    })

    it('5.4-DB-030 accepts a garment-only row and an advisor-only row', async () => {
      await inRolledBackTransaction(async (client) => {
        const partnerId = await seedCommercePartner(client)

        await client.query(
          `INSERT INTO public."AffiliateOffer"
            ("id", "partner_id", "garment_category", "locale_region", "title",
             "deep_link_template", "status", "effective_from", "updated_at")
           VALUES ($1, $2, 'top', '*', 'Garment Offer',
                   'https://partner.couturecast.test/shop?cc={clickToken}',
                   'active', NOW(), NOW())`,
          [`offer-garment-${randomUUID()}`, partnerId]
        )

        await client.query(
          `INSERT INTO public."AffiliateOffer"
            ("id", "partner_id", "advisor_slot", "advisor_undertone", "locale_region",
             "title", "deep_link_template", "status", "effective_from", "updated_at")
           VALUES ($1, $2, 'foundation', 'warm', '*', 'Advisor Offer',
                   'https://partner.couturecast.test/shop?cc={clickToken}',
                   'active', NOW(), NOW())`,
          [`offer-advisor-${randomUUID()}`, partnerId]
        )
      })
    })
  })

  /**
   * Decision 7's advisor index, and specifically the half Prisma cannot
   * express.
   *
   * `schema.prisma` declares `@@index([status, locale_region, advisor_slot,
   * priority(sort: Desc)])`, and the hand-authored migration adds
   * `WHERE "advisor_slot" IS NOT NULL` to it. That predicate is not decoration:
   * without it this index and the garment index above are structurally tied on
   * a garment-only query, the planner may pick either, and
   * `commerce-affiliate-offers-query-plan.integration.spec.ts`'s `5.1-PLAN-03`
   * regressed on exactly that. Since the Prisma DSL cannot say `WHERE`, a
   * regenerated migration would silently drop it and reintroduce the
   * regression, so the predicate is asserted here rather than assumed.
   */
  describe('AffiliateOffer advisor index', () => {
    it('5.4-DB-041 keeps the advisor index PARTIAL on advisor_slot IS NOT NULL', async () => {
      await inRolledBackTransaction(async (client) => {
        const indexes = await client.query<{ indexname: string; indexdef: string }>(
          `SELECT "indexname", "indexdef" FROM pg_indexes
           WHERE "schemaname" = 'public' AND "tablename" = 'AffiliateOffer'
             AND "indexname" = $1`,
          ['AffiliateOffer_status_locale_region_advisor_slot_priority_idx']
        )

        expect(indexes.rows).toHaveLength(1)
        const definition = indexes.rows[0]?.indexdef ?? ''
        expect(definition).toMatch(/WHERE \("?advisor_slot"? IS NOT NULL\)/)
        expect(definition).toContain('priority')
      })
    })
  })
})
