// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  adminPool,
  buildClaims,
  scenarioTest,
  useRlsDatabase,
  withRole,
} from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

  scenarioTest(
    '5.1-DB-001 lets the owner read, update, and delete their own commerce preference',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const ownRows = await client.query(
            'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(ownRows.rows).toEqual([{ id: seeded.commercePreferenceId }])

          const updated = await client.query(
            `UPDATE public."CommercePreference"
               SET "affiliate_ctas_enabled" = FALSE, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "affiliate_ctas_enabled"`,
            [seeded.commercePreferenceId]
          )
          expect(updated.rows).toEqual([{ affiliate_ctas_enabled: false }])

          const deleted = await client.query(
            'DELETE FROM public."CommercePreference" WHERE "id" = $1',
            [seeded.commercePreferenceId]
          )
          expect(deleted.rowCount).toBe(1)
        }
      )
    }
  )

  scenarioTest(
    '5.1-DB-002 denies BOTH guardian levels access to commerce preference and click rows',
    async ({ scenario: seeded }) => {
      // The point of the test. Every other wardrobe-adjacent table in this
      // schema is guardian-shared, so "guardians can see it" is the default
      // assumption a reader brings. Story 5.1 deliberately breaks that: a
      // purchase-intent trail is not something this story has a mandate to
      // expose, so read-only AND full-access consent both resolve to nothing.
      for (const guardianEmail of [
        seeded.guardianReadOnlyEmail,
        seeded.guardianFullAccessEmail,
      ]) {
        await withRole(
          'authenticated',
          buildClaims(guardianEmail, 'guardian'),
          async (client) => {
            const preferences = await client.query(
              'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(preferences.rows).toHaveLength(0)

            const clicks = await client.query(
              'SELECT "id" FROM public."AffiliateClick" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(clicks.rows).toHaveLength(0)

            // A guardian must not be able to write one either. RLS makes this a
            // zero-row UPDATE rather than an error, which is why the assertion
            // is on rowCount and not on a rejection.
            const attemptedUpdate = await client.query(
              `UPDATE public."CommercePreference"
                 SET "affiliate_ctas_enabled" = FALSE, "updated_at" = NOW()
               WHERE "user_id" = $1`,
              [seeded.teenId]
            )
            expect(attemptedUpdate.rowCount).toBe(0)
          }
        )
      }
    }
  )

  scenarioTest(
    '5.1-DB-003 denies unrelated authenticated users and the anon role',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          const preferences = await client.query(
            'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(preferences.rows).toHaveLength(0)

          const clicks = await client.query(
            'SELECT "id" FROM public."AffiliateClick" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(clicks.rows).toHaveLength(0)
        }
      )

      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    '5.1-DB-004 grants an admin actor access to commerce rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const preferences = await client.query(
            'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(preferences.rows).toEqual([{ id: seeded.commercePreferenceId }])

          const clicks = await client.query(
            'SELECT "id" FROM public."AffiliateClick" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(clicks.rows).toEqual([{ id: seeded.affiliateClickId }])
        }
      )
    }
  )

  scenarioTest(
    '5.1-DB-005 denies a spoofed user_metadata role escalation on commerce rows',
    async ({ scenario: seeded }) => {
      // app_metadata is server-controlled; user_metadata is user-writable. A
      // claim set that puts "admin" only in user_metadata must not be honoured,
      // or the owner-only guarantee above is worth nothing.
      const spoofedClaims = {
        sub: randomUUID(),
        email: seeded.otherTeenEmail,
        email_verified: true,
        role: 'authenticated',
        app_metadata: { role: 'teen' },
        user_metadata: { role: 'admin' },
      }

      await withRole('authenticated', spoofedClaims, async (client) => {
        const preferences = await client.query(
          'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(preferences.rows).toHaveLength(0)
      })
    }
  )

  scenarioTest(
    '5.1-DB-006 denies an unverified email claim access to commerce rows',
    async ({ scenario: seeded }) => {
      const unverifiedClaims = {
        sub: randomUUID(),
        email: seeded.teenEmail,
        email_verified: false,
        role: 'authenticated',
        app_metadata: { role: 'teen' },
      }

      await withRole('authenticated', unverifiedClaims, async (client) => {
        const preferences = await client.query(
          'SELECT "id" FROM public."CommercePreference" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(preferences.rows).toHaveLength(0)
      })
    }
  )

  it('keeps the commerce catalog and conversion ledger unreachable by clients', async () => {
    // CommercePartner, AffiliateOffer, and AffiliateConversion carry no user_id
    // at all, so there is nothing for a row-level policy to key on. They are
    // instead protected by having no policies and no grants: the catalog is
    // operator-managed and conversions are written only by the
    // machine-to-machine webhook, so no client should ever reach either.
    //
    // Story 5.2 adds the billing tables to the same worker-only posture. These
    // DO carry user_id, but the owner must still be denied: entitlement rows
    // are privilege-bearing (a forgeable row is free Premium) and billing
    // events are financial records, so all access flows through the API.
    const privateTables = [
      'CommercePartner',
      'AffiliateOffer',
      'AffiliateConversion',
      'PremiumEntitlement',
      'BillingEvent',
      'BillingCustomer',
    ] as const
    const client = await adminPool.connect()

    try {
      const rlsState = await client.query<{
        table_name: string
        rls_enabled: boolean
      }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
         FROM pg_class AS c
         INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1::text[])`,
        [privateTables]
      )

      expect(rlsState.rows).toHaveLength(privateTables.length)
      expect(rlsState.rows.every((row) => row.rls_enabled)).toBe(true)

      const policies = await client.query(
        `SELECT policyname
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1::text[])`,
        [privateTables]
      )
      expect(policies.rows).toEqual([])

      const clientGrants = await client.query(
        `SELECT grantee, table_name, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
           AND grantee = ANY($2::text[])`,
        [privateTables, ['anon', 'authenticated']]
      )
      expect(clientGrants.rows).toEqual([])
    } finally {
      client.release()
    }
  })

  scenarioTest(
    '5.1-DB-007 rejects a direct authenticated read of the catalog and conversions',
    async ({ scenario: seeded }) => {
      // The grant check above proves the permission state; this proves the
      // observable behaviour, which is what an attacker would actually hit.
      for (const table of ['CommercePartner', 'AffiliateOffer', 'AffiliateConversion']) {
        await withRole(
          'authenticated',
          buildClaims(seeded.teenEmail, 'teen'),
          async (client) => {
            await expect(
              client.query(`SELECT "id" FROM public."${table}" LIMIT 1`)
            ).rejects.toMatchObject({ code: '42501' })
          }
        )
      }
    }
  )
})
