// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Story 5.4: color palette & beauty/accessory advisor.
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { buildClaims, scenarioTest, useRlsDatabase, withRole } from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

  scenarioTest(
    '5.4-DB-001 lets the owner read and update their own palette profile and recommendation state',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const ownProfile = await client.query(
            'SELECT "id", "undertone", "status" FROM public."PaletteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(ownProfile.rows).toEqual([
            { id: seeded.paletteProfileId, undertone: 'warm', status: 'ready' },
          ])

          const ownRecommendations = await client.query(
            'SELECT "id", "action" FROM public."AdvisorRecommendationState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(ownRecommendations.rows).toEqual([
            { id: seeded.advisorRecommendationStateId, action: 'saved' },
          ])

          const updated = await client.query(
            `UPDATE public."PaletteProfile"
               SET "consent_revoked_at" = NOW(), "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "consent_revoked_at" IS NOT NULL AS revoked`,
            [seeded.paletteProfileId]
          )
          expect(updated.rows).toEqual([{ revoked: true }])

          const updatedRecommendation = await client.query(
            `UPDATE public."AdvisorRecommendationState"
               SET "action" = 'dismissed', "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "action"`,
            [seeded.advisorRecommendationStateId]
          )
          expect(updatedRecommendation.rows).toEqual([{ action: 'dismissed' }])
        }
      )
    }
  )

  scenarioTest(
    '5.4-DB-002 lets the owner insert and delete their own rows through the authenticated role',
    async ({ scenario: seeded }) => {
      // The positive half of the INSERT policy. Every seed insert in this file
      // goes through the superuser admin pool, which bypasses RLS entirely, so
      // without this the WITH CHECK clause was only ever proven able to REFUSE
      // a row — a policy of `WITH CHECK (false)` would have passed the whole
      // matrix while making the feature's first write impossible.
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const deletedProfile = await client.query(
            'DELETE FROM public."PaletteProfile" WHERE "id" = $1 RETURNING "id"',
            [seeded.paletteProfileId]
          )
          expect(deletedProfile.rows).toEqual([{ id: seeded.paletteProfileId }])

          const insertedProfile = await client.query(
            `INSERT INTO public."PaletteProfile"
              ("id", "user_id", "consent_granted_at", "source", "undertone", "updated_at")
             VALUES ($1, $2, NOW(), 'wardrobe', 'warm', NOW())
             RETURNING "id", "undertone"`,
            [seeded.paletteProfileId, seeded.teenId]
          )
          expect(insertedProfile.rows).toEqual([
            { id: seeded.paletteProfileId, undertone: 'warm' },
          ])

          const deletedRecommendation = await client.query(
            'DELETE FROM public."AdvisorRecommendationState" WHERE "id" = $1 RETURNING "id"',
            [seeded.advisorRecommendationStateId]
          )
          expect(deletedRecommendation.rows).toEqual([
            { id: seeded.advisorRecommendationStateId },
          ])

          const insertedRecommendation = await client.query(
            `INSERT INTO public."AdvisorRecommendationState"
              ("id", "user_id", "slot", "item_key", "action", "updated_at")
             VALUES ($1, $2, 'foundation', 'advisor:foundation:warm', 'saved', NOW())
             RETURNING "id", "action"`,
            [seeded.advisorRecommendationStateId, seeded.teenId]
          )
          expect(insertedRecommendation.rows).toEqual([
            { id: seeded.advisorRecommendationStateId, action: 'saved' },
          ])
        }
      )
    }
  )

  scenarioTest(
    '5.4-DB-003 denies BOTH guardian levels access to the palette profile and recommendation state',
    async ({ scenario: seeded }) => {
      // Deliberate break from guardian-shared: guardian consent gates whether an
      // under-16 account may upload at all (unchanged WardrobeUploadGuard);
      // exposing the derived body characteristic itself to a guardian is a
      // different mandate no planning document grants (open question 1).
      for (const guardianEmail of [
        seeded.guardianReadOnlyEmail,
        seeded.guardianFullAccessEmail,
      ]) {
        await withRole(
          'authenticated',
          buildClaims(guardianEmail, 'guardian'),
          async (client) => {
            const profiles = await client.query(
              'SELECT "id" FROM public."PaletteProfile" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(profiles.rows).toHaveLength(0)

            const recommendations = await client.query(
              'SELECT "id" FROM public."AdvisorRecommendationState" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(recommendations.rows).toHaveLength(0)

            const attemptedUpdate = await client.query(
              `UPDATE public."PaletteProfile"
                 SET "consent_revoked_at" = NOW(), "updated_at" = NOW()
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
    '5.4-DB-004 denies unrelated authenticated users and the anon role',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          const profiles = await client.query(
            'SELECT "id" FROM public."PaletteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(profiles.rows).toHaveLength(0)

          // The unrelated user still sees their own row, so this proves the
          // policy is scoping rather than denying everything outright.
          const own = await client.query(
            'SELECT "id" FROM public."PaletteProfile" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )
          expect(own.rows).toEqual([{ id: seeded.otherPaletteProfileId }])
        }
      )

      // Each rejecting query gets its own transaction: Postgres aborts the
      // whole transaction after the first error, so a second query in the
      // same `withRole` block would fail with 25P02 (transaction aborted)
      // rather than exercise RLS again.
      await withRole('anon', null, async (client) => {
        await expect(
          client.query('SELECT "id" FROM public."PaletteProfile" WHERE "user_id" = $1', [
            seeded.teenId,
          ])
        ).rejects.toMatchObject({ code: '42501' })
      })

      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."AdvisorRecommendationState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    '5.4-DB-005 grants an admin actor access to the palette profile and recommendation state',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const profiles = await client.query(
            'SELECT "id" FROM public."PaletteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(profiles.rows).toEqual([{ id: seeded.paletteProfileId }])

          const recommendations = await client.query(
            'SELECT "id" FROM public."AdvisorRecommendationState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(recommendations.rows).toEqual([
            { id: seeded.advisorRecommendationStateId },
          ])
        }
      )
    }
  )

  scenarioTest(
    '5.4-DB-006 denies a spoofed user_metadata role escalation on the palette profile',
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
        const profiles = await client.query(
          'SELECT "id" FROM public."PaletteProfile" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(profiles.rows).toHaveLength(0)
      })
    }
  )

  scenarioTest(
    '5.4-DB-007 denies an unverified email claim access to the palette profile',
    async ({ scenario: seeded }) => {
      const unverifiedClaims = {
        sub: randomUUID(),
        email: seeded.teenEmail,
        email_verified: false,
        role: 'authenticated',
        app_metadata: { role: 'teen' },
      }

      await withRole('authenticated', unverifiedClaims, async (client) => {
        const profiles = await client.query(
          'SELECT "id" FROM public."PaletteProfile" WHERE "user_id" = $1',
          [seeded.teenId]
        )
        expect(profiles.rows).toHaveLength(0)
      })
    }
  )

  scenarioTest(
    '5.4-DB-008 denies inserting a palette profile or recommendation state for another user',
    async ({ scenario: seeded }) => {
      // The INSERT policy's WITH CHECK is the one half of the matrix an
      // owner-only read test cannot reach: without it, any authenticated caller
      // could mint a row keyed to somebody else's user_id. The target is the
      // outsider guardian precisely because they have no row yet, so a
      // rejection can only come from RLS and never from the unique index.
      // Each rejecting insert gets its own transaction, for the same reason
      // the anon-role assertions above do.
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."PaletteProfile"
                ("id", "user_id", "consent_granted_at", "source", "undertone", "updated_at")
               VALUES ($1, $2, NOW(), 'wardrobe', 'warm', NOW())`,
              [`forged-palette-${randomUUID()}`, seeded.outsiderGuardianId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."AdvisorRecommendationState"
                ("id", "user_id", "slot", "item_key", "action", "updated_at")
               VALUES ($1, $2, 'foundation', 'advisor:foundation:warm', 'saved', NOW())`,
              [`forged-recommendation-${randomUUID()}`, seeded.outsiderGuardianId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )
})
