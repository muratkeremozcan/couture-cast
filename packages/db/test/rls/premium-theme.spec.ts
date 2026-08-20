// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { buildClaims, scenarioTest, useRlsDatabase, withRole } from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

  scenarioTest(
    '5.3-DB-001 lets the owner read, update, and reset their own theme preference',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const ownRows = await client.query(
            'SELECT "id", "theme" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(ownRows.rows).toEqual([
            { id: seeded.premiumThemePreferenceId, theme: 'jewel_radiance' },
          ])

          const updated = await client.query(
            `UPDATE public."PremiumThemePreference"
               SET "theme" = 'winter_metallic', "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "theme"`,
            [seeded.premiumThemePreferenceId]
          )
          expect(updated.rows).toEqual([{ theme: 'winter_metallic' }])

          // Reset is an UPDATE to NULL, never a DELETE (Decision 8), so the
          // owner-only policy has to permit exactly this shape.
          const reset = await client.query(
            `UPDATE public."PremiumThemePreference"
               SET "theme" = NULL, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "theme"`,
            [seeded.premiumThemePreferenceId]
          )
          expect(reset.rows).toEqual([{ theme: null }])
        }
      )
    }
  )

  scenarioTest(
    '5.3-DB-008 lets the owner insert and delete their own row through the authenticated role',
    async ({ scenario: seeded }) => {
      // The positive half of the INSERT policy, which 5.3-DB-007 only covers from
      // the denial side. Every seed insert in this file goes through the superuser
      // admin pool, which bypasses RLS entirely, so without this the WITH CHECK
      // clause was only ever proven able to REFUSE a row — a policy of
      // `WITH CHECK (false)` would have passed the whole matrix while making the
      // feature's first write impossible for every user.
      //
      // DELETE gets the same treatment for the same reason, and it is deliberately
      // exercised even though the service never deletes (Decision 8 makes reset an
      // upsert to NULL). The grant and the policy exist because this table follows
      // the selfOnlyTables template verbatim; a granted verb nothing proves is a
      // verb nobody notices breaking. Row state is restored by re-inserting the
      // same id, the way the AlertRule owner-CRUD block above does it.
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const deleted = await client.query(
            'DELETE FROM public."PremiumThemePreference" WHERE "id" = $1 RETURNING "id"',
            [seeded.premiumThemePreferenceId]
          )
          expect(deleted.rows).toEqual([{ id: seeded.premiumThemePreferenceId }])

          const inserted = await client.query(
            `INSERT INTO public."PremiumThemePreference"
              ("id", "user_id", "theme", "updated_at")
             VALUES ($1, $2, 'jewel_radiance', NOW())
             RETURNING "id", "theme"`,
            [seeded.premiumThemePreferenceId, seeded.teenId]
          )
          expect(inserted.rows).toEqual([
            { id: seeded.premiumThemePreferenceId, theme: 'jewel_radiance' },
          ])

          // A NULL theme is the reset spelling, so the INSERT policy has to accept
          // it too — a first-ever write of `{ theme: null }` takes this exact path.
          const resetInsert = await client.query(
            `INSERT INTO public."PremiumThemePreference"
              ("id", "user_id", "theme", "updated_at")
             VALUES ($1, $2, NULL, NOW())
             ON CONFLICT ("user_id") DO UPDATE SET "theme" = NULL
             RETURNING "theme"`,
            [`self-insert-theme-${randomUUID()}`, seeded.teenId]
          )
          expect(resetInsert.rows).toEqual([{ theme: null }])

          // Not housekeeping: the scenario fixture seeds and tears down per
          // test, so no later test reads this row. This is the owner writing a
          // real palette back over the NULL the reset upsert just left, which is
          // the one UPDATE shape the block still has to prove the authenticated
          // role can perform on its own row.
          const restored = await client.query(
            `UPDATE public."PremiumThemePreference"
               SET "theme" = 'jewel_radiance', "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "theme"`,
            [seeded.premiumThemePreferenceId]
          )
          expect(restored.rows).toEqual([{ theme: 'jewel_radiance' }])
        }
      )
    }
  )

  scenarioTest(
    '5.3-DB-002 denies BOTH guardian levels access to the theme preference',
    async ({ scenario: seeded }) => {
      // Same deliberate break from the guardian-shared default that story 5.1
      // made for CommercePreference: read-only AND full-access consent both
      // resolve to nothing through private.can_manage_self_row.
      for (const guardianEmail of [
        seeded.guardianReadOnlyEmail,
        seeded.guardianFullAccessEmail,
      ]) {
        await withRole(
          'authenticated',
          buildClaims(guardianEmail, 'guardian'),
          async (client) => {
            const preferences = await client.query(
              'SELECT "id" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(preferences.rows).toHaveLength(0)

            // RLS makes a denied write a zero-row UPDATE rather than an error,
            // which is why this asserts on rowCount and not on a rejection.
            const attemptedUpdate = await client.query(
              `UPDATE public."PremiumThemePreference"
                 SET "theme" = 'autumn_umber', "updated_at" = NOW()
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
    '5.3-DB-003 denies unrelated authenticated users and the anon role',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          const preferences = await client.query(
            'SELECT "id" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(preferences.rows).toHaveLength(0)

          // The unrelated user still sees their own row, so this proves the
          // policy is scoping rather than denying everything outright.
          const own = await client.query(
            'SELECT "id" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )
          expect(own.rows).toEqual([{ id: seeded.otherPremiumThemePreferenceId }])
        }
      )

      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    '5.3-DB-004 grants an admin actor access to the theme preference',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const preferences = await client.query(
            'SELECT "id" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(preferences.rows).toEqual([{ id: seeded.premiumThemePreferenceId }])
        }
      )
    }
  )

  scenarioTest(
    '5.3-DB-005 denies a spoofed user_metadata role escalation on the theme preference',
    async ({ scenario: seeded }) => {
      // app_metadata is server-controlled; user_metadata is user-writable. A
      // claim set that puts "admin" only in user_metadata must not be honoured.
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
          'SELECT "id" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(preferences.rows).toHaveLength(0)
      })
    }
  )

  scenarioTest(
    '5.3-DB-006 denies an unverified email claim access to the theme preference',
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
          'SELECT "id" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(preferences.rows).toHaveLength(0)
      })
    }
  )

  scenarioTest(
    '5.3-DB-007 denies inserting a theme preference for another user',
    async ({ scenario: seeded }) => {
      // The INSERT policy's WITH CHECK is the one half of the matrix an
      // owner-only read test cannot reach: without it, any authenticated caller
      // could mint a row keyed to somebody else's user_id. The target is the
      // outsider guardian precisely because they have no row yet, so a
      // rejection can only come from RLS and never from the unique index.
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."PremiumThemePreference"
                ("id", "user_id", "theme", "updated_at")
               VALUES ($1, $2, 'autumn_umber', NOW())`,
              [`forged-theme-${randomUUID()}`, seeded.outsiderGuardianId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )
})
