// Story 5.5: premium 7-day outfit planner.
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { buildClaims, scenarioTest, useRlsDatabase, withRole } from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

  scenarioTest(
    '5.5-DB-001 lets the owner read and update their own planner day plan',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const own = await client.query(
            'SELECT "id", "locale", "dependency_fingerprint" FROM public."PlannerDayPlan" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(own.rows).toEqual([
            {
              id: seeded.plannerDayPlanId,
              locale: 'en-US',
              dependency_fingerprint: 'fingerprint-owner',
            },
          ])

          const updated = await client.query(
            `UPDATE public."PlannerDayPlan"
               SET "reshuffle_count" = "reshuffle_count" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "reshuffle_count"`,
            [seeded.plannerDayPlanId]
          )
          expect(updated.rows).toEqual([{ reshuffle_count: 1 }])
        }
      )
    }
  )

  scenarioTest(
    '5.5-DB-002 lets the owner insert and delete their own rows through the authenticated role',
    async ({ scenario: seeded }) => {
      // The positive half of the INSERT policy. Every seed insert in this file
      // goes through the superuser admin pool, which bypasses RLS entirely, so
      // without this the WITH CHECK clause was only ever proven able to REFUSE
      // a row -- a policy of `WITH CHECK (false)` would have passed the whole
      // matrix while making the feature's first write impossible.
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const deleted = await client.query(
            'DELETE FROM public."PlannerDayPlan" WHERE "id" = $1 RETURNING "id"',
            [seeded.plannerDayPlanId]
          )
          expect(deleted.rows).toEqual([{ id: seeded.plannerDayPlanId }])

          const inserted = await client.query(
            `INSERT INTO public."PlannerDayPlan"
              ("id", "user_id", "location_id", "plan_date", "locale",
               "dependency_fingerprint", "plan_payload", "updated_at")
             VALUES ($1, $2, $3, CURRENT_DATE, 'en-US', 'fingerprint-reinsert', '{}'::jsonb, NOW())
             RETURNING "id", "locale"`,
            [seeded.plannerDayPlanId, seeded.teenId, seeded.savedLocationId]
          )
          expect(inserted.rows).toEqual([
            { id: seeded.plannerDayPlanId, locale: 'en-US' },
          ])
        }
      )
    }
  )

  scenarioTest(
    '5.5-DB-003 denies BOTH guardian levels access to the planner day plan',
    async ({ scenario: seeded }) => {
      // Deliberate break from guardian-shared: a planner day is a personal,
      // derived recommendation cache row, not something a guardian has a
      // mandate to read or write (same reasoning as PaletteProfile).
      for (const guardianEmail of [
        seeded.guardianReadOnlyEmail,
        seeded.guardianFullAccessEmail,
      ]) {
        await withRole(
          'authenticated',
          buildClaims(guardianEmail, 'guardian'),
          async (client) => {
            const rows = await client.query(
              'SELECT "id" FROM public."PlannerDayPlan" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(rows.rows).toHaveLength(0)

            const attemptedUpdate = await client.query(
              `UPDATE public."PlannerDayPlan"
                 SET "reshuffle_count" = "reshuffle_count" + 1, "updated_at" = NOW()
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
    '5.5-DB-004 denies unrelated authenticated users and the anon role',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          const rows = await client.query(
            'SELECT "id" FROM public."PlannerDayPlan" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(rows.rows).toHaveLength(0)

          // The unrelated user still sees their own row, so this proves the
          // policy is scoping rather than denying everything outright.
          const own = await client.query(
            'SELECT "id" FROM public."PlannerDayPlan" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )
          expect(own.rows).toEqual([{ id: seeded.otherPlannerDayPlanId }])
        }
      )

      // Each rejecting query gets its own transaction: Postgres aborts the
      // whole transaction after the first error, so a second query in the
      // same `withRole` block would fail with 25P02 (transaction aborted)
      // rather than exercise RLS again.
      await withRole('anon', null, async (client) => {
        await expect(
          client.query('SELECT "id" FROM public."PlannerDayPlan" WHERE "user_id" = $1', [
            seeded.teenId,
          ])
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    '5.5-DB-005 grants an admin actor access to the planner day plan',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const rows = await client.query(
            'SELECT "id" FROM public."PlannerDayPlan" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(rows.rows).toEqual([{ id: seeded.plannerDayPlanId }])
        }
      )
    }
  )

  scenarioTest(
    '5.5-DB-006 denies a spoofed user_metadata role escalation',
    async ({ scenario: seeded }) => {
      const spoofedClaims = {
        sub: randomUUID(),
        email: seeded.otherTeenEmail,
        email_verified: true,
        role: 'authenticated',
        app_metadata: { role: 'teen' },
        user_metadata: { role: 'admin' },
      }

      await withRole('authenticated', spoofedClaims, async (client) => {
        const rows = await client.query(
          'SELECT "id" FROM public."PlannerDayPlan" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(rows.rows).toHaveLength(0)
      })
    }
  )

  scenarioTest(
    '5.5-DB-007 denies an unverified email claim',
    async ({ scenario: seeded }) => {
      const unverifiedClaims = {
        sub: randomUUID(),
        email: seeded.teenEmail,
        email_verified: false,
        role: 'authenticated',
        app_metadata: { role: 'teen' },
      }

      await withRole('authenticated', unverifiedClaims, async (client) => {
        const rows = await client.query(
          'SELECT "id" FROM public."PlannerDayPlan" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(rows.rows).toHaveLength(0)
      })
    }
  )

  scenarioTest(
    '5.5-DB-008 denies inserting a planner day plan for another user',
    async ({ scenario: seeded }) => {
      // The INSERT policy's WITH CHECK is the one half of the matrix an
      // owner-only read test cannot reach: without it, any authenticated caller
      // could mint a row keyed to somebody else's user_id. RLS's WITH CHECK is
      // evaluated before the FK constraint trigger, so this rejects with
      // 42501 even though (savedLocationId, outsiderGuardianId) is not a real
      // SavedLocation pair.
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."PlannerDayPlan"
                ("id", "user_id", "location_id", "plan_date", "locale",
                 "dependency_fingerprint", "plan_payload", "updated_at")
               VALUES ($1, $2, $3, CURRENT_DATE, 'en-US', 'forged', '{}'::jsonb, NOW())`,
              [
                `forged-planner-day-plan-${randomUUID()}`,
                seeded.outsiderGuardianId,
                seeded.savedLocationId,
              ]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )
})
