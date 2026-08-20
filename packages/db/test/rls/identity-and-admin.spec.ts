// Learning path Step 4: Environment setup and Supabase operations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-4-environment-setup-and-supabase-operations
// The negative half of the guardian model: every way a caller might try to become
// someone else. Spoofed claims, unverified email, revoked consent, direct helper
// invocation, and the one legitimate cross-account actor, the admin.
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
    'denies teens from reading another teen wardrobe',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (guardedClient) => {
          const otherTeenRows = await guardedClient.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )

          expect(otherTeenRows.rows).toHaveLength(0)

          const otherSavedLocationRows = await guardedClient.query(
            'SELECT "id" FROM public."SavedLocation" WHERE "user_id" = $1',
            [seeded.otherTeenId]
          )

          expect(otherSavedLocationRows.rows).toHaveLength(0)

          const otherSavedLocationUpdate = await guardedClient.query(
            `UPDATE public."SavedLocation"
           SET "label" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "id"`,
            ['Blocked update', seeded.otherSavedLocationId]
          )

          expect(otherSavedLocationUpdate.rows).toHaveLength(0)

          const otherSavedLocationDelete = await guardedClient.query(
            'DELETE FROM public."SavedLocation" WHERE "id" = $1 RETURNING "id"',
            [seeded.otherSavedLocationId]
          )

          expect(otherSavedLocationDelete.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    'does not trust unverified email claims for cross-account access',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: seeded.teenEmail,
          email_verified: false,
          role: 'authenticated',
          app_metadata: {
            role: 'guardian',
          },
        },
        async (client) => {
          const garmentRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    'denies unrelated guardians and anonymous actors from teen wardrobe data',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.outsiderGuardianEmail, 'guardian'),
        async (client) => {
          const garmentRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(0)
        }
      )

      await withRole('anon', null, async (client) => {
        await expect(
          client.query('SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1', [
            seeded.teenId,
          ])
        ).rejects.toMatchObject({
          code: '42501',
        })
      })
    }
  )

  scenarioTest(
    'does not grant access from user_metadata identity or role claims',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: seeded.outsiderGuardianEmail,
          email_verified: true,
          role: 'authenticated',
          app_metadata: {
            role: 'guardian',
          },
          user_metadata: {
            app_user_id: seeded.teenId,
            app_role: 'admin',
            role: 'admin',
          },
        },
        async (client) => {
          const garmentRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    'blocks teen self access after the last guardian consent is revoked',
    async ({ scenario: seeded }) => {
      const client = await adminPool.connect()

      try {
        await client.query('BEGIN')
        await client.query(
          `UPDATE public."GuardianConsent"
         SET "revoked_at" = NOW(), "status" = 'revoked'
         WHERE "teen_id" = $1`,
          [seeded.teenId]
        )
        await client.query(
          `UPDATE public."UserProfile"
         SET "preferences" = $2::jsonb, "updated_at" = NOW()
         WHERE "user_id" = $1`,
          [
            seeded.teenId,
            JSON.stringify({
              compliance: {
                accountStatus: 'pending_guardian_consent',
                guardianConsentRequired: true,
              },
            }),
          ]
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (guardedClient) => {
          const garmentRows = await guardedClient.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(0)

          const updateResult = await guardedClient.query(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "id"`,
            ['accessory', seeded.garmentId]
          )

          expect(updateResult.rowCount).toBe(0)
        }
      )
    }
  )

  scenarioTest(
    'does not allow authenticated callers to execute the guardian-consent helper directly',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          await expect(
            client.query('SELECT private.user_requires_guardian_consent($1)', [
              seeded.teenId,
            ])
          ).rejects.toMatchObject({
            code: '42501',
          })
        }
      )
    }
  )

  scenarioTest(
    'allows admin claims to inspect and update teen wardrobe rows without service role bypass',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const garmentRows = await client.query(
            'SELECT "id" FROM public."GarmentItem" WHERE "user_id" = $1',
            [seeded.teenId]
          )

          expect(garmentRows.rows).toHaveLength(1)

          const updateResult = await client.query(
            `UPDATE public."GarmentItem"
           SET "category" = $1, "updated_at" = NOW()
           WHERE "id" = $2
           RETURNING "category"`,
            ['accessory', seeded.garmentId]
          )

          expect(updateResult.rows).toEqual([{ category: 'accessory' }])
        }
      )
    }
  )
})
