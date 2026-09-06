// Learning path Step 4: Environment setup and Supabase operations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-4-environment-setup-and-supabase-operations
// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
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
    'allows teens to read and update their own wardrobe-scoped rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const garmentRows = await client.query<{
            id: string
            category: string
          }>('SELECT "id", "category" FROM public."GarmentItem" WHERE "user_id" = $1', [
            seeded.teenId,
          ])

          expect(garmentRows.rows).toEqual([
            {
              id: seeded.garmentId,
              category: 'top',
            },
          ])

          await client.query(
            'UPDATE public."GarmentItem" SET "category" = $1, "updated_at" = NOW() WHERE "id" = $2',
            ['outerwear', seeded.garmentId]
          )

          const updatedProfile = await client.query<{
            display_name: string
          }>('SELECT "display_name" FROM public."UserProfile" WHERE "user_id" = $1', [
            seeded.teenId,
          ])

          expect(updatedProfile.rows[0]?.display_name).toBe('Teen Wardrobe Owner')

          const savedLocationRows = await client.query<{
            id: string
            label: string
          }>('SELECT "id", "label" FROM public."SavedLocation" WHERE "user_id" = $1', [
            seeded.teenId,
          ])

          expect(savedLocationRows.rows).toEqual([
            {
              id: seeded.savedLocationId,
              label: 'Home',
            },
          ])

          const updateLocationResult = await client.query(
            `UPDATE public."SavedLocation"
           SET "label" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "label"`,
            ['Office', seeded.savedLocationId]
          )

          expect(updateLocationResult.rows).toEqual([{ label: 'Office' }])
        }
      )
    }
  )

  scenarioTest(
    'lets linked guardians read teen wardrobe data but blocks read-only mutations',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const garmentRows = await client.query<{
            id: string
          }>('SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1', [
            seeded.teenId,
          ])

          expect(garmentRows.rows).toHaveLength(1)

          const consentRows = await client.query<{
            teen_id: string
          }>('SELECT "teen_id" FROM public."GuardianConsent" WHERE "guardian_id" = $1', [
            seeded.guardianReadOnlyId,
          ])

          expect(consentRows.rows).toEqual([{ teen_id: seeded.teenId }])

          const updateResult = await client.query(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "id"`,
            ['outerwear', seeded.garmentId]
          )

          expect(updateResult.rowCount).toBe(0)
        }
      )
    }
  )

  scenarioTest(
    'grants wardrobe access from a single active guardian consent row',
    async ({ scenario: seeded }) => {
      const client = await adminPool.connect()

      try {
        await client.query('DELETE FROM public."GuardianConsent" WHERE "id" = $1', [
          seeded.consentFullId,
        ])
      } finally {
        client.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const teenGarments = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(teenGarments.rows).toEqual([{ id: seeded.garmentId }])
        }
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const guardianGarments = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(guardianGarments.rows).toEqual([{ id: seeded.garmentId }])
        }
      )
    }
  )

  scenarioTest(
    'lets full-access guardians mutate linked teen wardrobe rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const updateResult = await client.query<{
            category: string
          }>(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
            ['outerwear', seeded.garmentId]
          )

          expect(updateResult.rows).toEqual([{ category: 'outerwear' }])

          const insertResult = await client.query<{
            id: string
          }>(
            `INSERT INTO public."OutfitRecommendation"
            ("id", "user_id", "scenario", "updated_at")
           VALUES ($1, $2, $3, NOW())
           RETURNING "id"`,
            [`guardian-created-outfit-${randomUUID()}`, seeded.teenId, 'school-run']
          )

          expect(insertResult.rows).toHaveLength(1)
        }
      )
    }
  )

  scenarioTest(
    'keeps remaining guardian wardrobe access after one guardian revokes consent',
    async ({ scenario: seeded }) => {
      const adminClient = await adminPool.connect()

      try {
        await adminClient.query(
          `UPDATE public."GuardianConsent"
         SET "revoked_at" = NOW(), "status" = 'revoked'
         WHERE "id" = $1`,
          [seeded.consentReadOnlyId]
        )
      } finally {
        adminClient.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const revokedGuardianRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(revokedGuardianRows.rows).toHaveLength(0)
        }
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const remainingGuardianRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(remainingGuardianRows.rows).toEqual([{ id: seeded.garmentId }])

          const updateResult = await client.query(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
            ['bottom', seeded.garmentId]
          )

          expect(updateResult.rows).toEqual([{ category: 'bottom' }])
        }
      )
    }
  )

  scenarioTest(
    'keeps lookbook posts out of reach of the owner and of a full-access guardian alike',
    async ({ scenario: seeded }) => {
      // This test used to assert that the owner could read their own posts and
      // that a guardian could not. Story 6.1 made LookbookPost API-only -- RLS
      // on, zero policies, zero grants -- so the owner is refused too, and
      // guardian consent grants nothing here because there is no policy for it
      // to satisfy. Full reasoning is on `workerOnlyTables` in harness.ts.
      //
      // The owner-facing half of this matrix lives in community-posts.spec.ts;
      // what this file still owns is the guardian actor, which that file has no
      // fixtures for.
      for (const email of [seeded.teenEmail, seeded.guardianFullAccessEmail]) {
        await withRole('authenticated', buildClaims(email, 'guardian'), async (client) =>
          expect(
            client.query('SELECT "id" FROM public."LookbookPost" WHERE "user_id" = $1', [
              seeded.teenId,
            ])
          ).rejects.toMatchObject({ code: '42501' })
        )
      }

      // EngagementEvent went the same way in the same story, and for a sharper
      // reason: its required `post_id` foreign key made owner-scoped INSERT
      // rights a post-existence oracle against posts the client cannot read.
      // The guardian is still denied it, so this test's original intent holds;
      // what changed is the mechanism, from an empty result to a refusal.
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) =>
          expect(
            client.query(
              'SELECT "id" FROM public."EngagementEvent" WHERE "user_id" = $1',
              [seeded.teenId]
            )
          ).rejects.toMatchObject({ code: '42501' })
      )
    }
  )

  scenarioTest(
    'keeps saved locations self-scoped for guardians while allowing admin access',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const teenLocations = await client.query(
            'SELECT "id" FROM public."SavedLocation" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(teenLocations.rows).toHaveLength(0)
        }
      )

      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const teenLocations = await client.query(
            'SELECT "id" FROM public."SavedLocation" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(teenLocations.rows).toEqual([{ id: seeded.savedLocationId }])
        }
      )
    }
  )
})
