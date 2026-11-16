// Learning path Step 4: Environment setup and Supabase operations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-4-environment-setup-and-supabase-operations
// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { buildClaims, scenarioTest, useRlsDatabase, withRole } from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

  // Guardian consent is off (owner ruling 2026-11-16): the guardian grant cases that stood here
  // moved to guardian-consent-off.spec.ts, which proves a granted row gives no read or write.
  // They return with private.has_active_guardian_consent when consent is turned back on.

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
