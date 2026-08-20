// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
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
    '4.4-DB-003 lets the onboarding-state and silhouette-profile owner read, mutate, delete, and reinsert both rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id", "current_step" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toEqual([
            { id: seeded.onboardingStateId, current_step: 'silhouette' },
          ])

          const silhouette = await client.query(
            'SELECT "id", "height_slider" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toEqual([
            { id: seeded.silhouetteProfileId, height_slider: 50 },
          ])

          const advanced = await client.query(
            `UPDATE public."WardrobeOnboardingState"
             SET "current_step" = 'complete', "status" = 'completed', "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "current_step", "revision"`,
            [seeded.onboardingStateId]
          )
          expect(advanced.rows).toEqual([{ current_step: 'complete', revision: 1 }])

          const slid = await client.query(
            `UPDATE public."SilhouetteProfile"
             SET "height_slider" = 70, "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "height_slider", "revision"`,
            [seeded.silhouetteProfileId]
          )
          expect(slid.rows).toEqual([{ height_slider: 70, revision: 1 }])

          // The declared INSERT/DELETE policies are exercised here too, not
          // just SELECT/UPDATE, since a singleton one-row-per-user table
          // never naturally hits INSERT once the fixture seeds a row.
          const deletedOnboarding = await client.query(
            'DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1 RETURNING "id"',
            [seeded.onboardingStateId]
          )
          expect(deletedOnboarding.rows).toEqual([{ id: seeded.onboardingStateId }])

          const reinsertedOnboarding = await client.query(
            `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())
             RETURNING "id"`,
            [`owner-onboarding-${randomUUID()}`, seeded.teenId]
          )
          expect(reinsertedOnboarding.rows).toHaveLength(1)

          const deletedSilhouette = await client.query(
            'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1 RETURNING "id"',
            [seeded.silhouetteProfileId]
          )
          expect(deletedSilhouette.rows).toEqual([{ id: seeded.silhouetteProfileId }])

          const reinsertedSilhouette = await client.query(
            `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())
             RETURNING "id"`,
            [`owner-silhouette-${randomUUID()}`, seeded.teenId]
          )
          expect(reinsertedSilhouette.rows).toHaveLength(1)
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 gives read-only guardians reads without any onboarding or silhouette write',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toEqual([{ id: seeded.onboardingStateId }])

          const silhouette = await client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toEqual([{ id: seeded.silhouetteProfileId }])

          const blockedOnboardingUpdate = await client.query(
            `UPDATE public."WardrobeOnboardingState"
             SET "current_step" = 'complete', "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "id"`,
            [seeded.onboardingStateId]
          )
          expect(blockedOnboardingUpdate.rows).toHaveLength(0)

          const blockedSilhouetteUpdate = await client.query(
            `UPDATE public."SilhouetteProfile"
             SET "height_slider" = 90, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "id"`,
            [seeded.silhouetteProfileId]
          )
          expect(blockedSilhouetteUpdate.rows).toHaveLength(0)

          // DELETE is filtered to zero visible rows, same as UPDATE.
          const blockedOnboardingDelete = await client.query(
            'DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1 RETURNING "id"',
            [seeded.onboardingStateId]
          )
          expect(blockedOnboardingDelete.rows).toHaveLength(0)

          const blockedSilhouetteDelete = await client.query(
            'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1 RETURNING "id"',
            [seeded.silhouetteProfileId]
          )
          expect(blockedSilhouetteDelete.rows).toHaveLength(0)
        }
      )

      // INSERT is refused by the WITH CHECK clause rather than filtered, and a
      // refused statement aborts its transaction, so it needs its own
      // session. The pre-seeded row is removed first so the failure is
      // unambiguously the RLS check rather than the one-row-per-user unique
      // constraint.
      const adminClient = await adminPool.connect()
      try {
        await adminClient.query(
          'DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1',
          [seeded.onboardingStateId]
        )
        await adminClient.query(
          'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1',
          [seeded.silhouetteProfileId]
        )
      } finally {
        adminClient.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
               VALUES ($1, $2, NOW())`,
              [`blocked-onboarding-${randomUUID()}`, seeded.teenId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
               VALUES ($1, $2, NOW())`,
              [`blocked-silhouette-${randomUUID()}`, seeded.teenId]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 lets full-access guardians mutate, delete, and recreate linked teen onboarding and silhouette rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const advanced = await client.query(
            `UPDATE public."WardrobeOnboardingState"
             SET "current_step" = 'complete', "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "current_step"`,
            [seeded.onboardingStateId]
          )
          expect(advanced.rows).toEqual([{ current_step: 'complete' }])

          const slid = await client.query(
            `UPDATE public."SilhouetteProfile"
             SET "build_slider" = 20, "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "build_slider"`,
            [seeded.silhouetteProfileId]
          )
          expect(slid.rows).toEqual([{ build_slider: 20 }])

          // Decision 10 grants a full-access guardian raw DB-level write
          // capability over both tables (an accepted asymmetry with the
          // app routes, which stay self-scoped) — prove DELETE and INSERT
          // on behalf of the linked teen, not only UPDATE.
          const deletedOnboarding = await client.query(
            'DELETE FROM public."WardrobeOnboardingState" WHERE "id" = $1 RETURNING "id"',
            [seeded.onboardingStateId]
          )
          expect(deletedOnboarding.rows).toEqual([{ id: seeded.onboardingStateId }])

          const reinsertedOnboarding = await client.query(
            `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())
             RETURNING "id"`,
            [`guardian-onboarding-${randomUUID()}`, seeded.teenId]
          )
          expect(reinsertedOnboarding.rows).toHaveLength(1)

          const deletedSilhouette = await client.query(
            'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1 RETURNING "id"',
            [seeded.silhouetteProfileId]
          )
          expect(deletedSilhouette.rows).toEqual([{ id: seeded.silhouetteProfileId }])

          const reinsertedSilhouette = await client.query(
            `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
             VALUES ($1, $2, NOW())
             RETURNING "id"`,
            [`guardian-silhouette-${randomUUID()}`, seeded.teenId]
          )
          expect(reinsertedSilhouette.rows).toHaveLength(1)
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 grants admins onboarding and silhouette reads',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toEqual([{ id: seeded.onboardingStateId }])

          const silhouette = await client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toEqual([{ id: seeded.silhouetteProfileId }])
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 blocks onboarding and silhouette access after a guardian consent is revoked',
    async ({ scenario: seeded }) => {
      const adminClient = await adminPool.connect()

      try {
        await adminClient.query(
          `UPDATE public."GuardianConsent"
           SET "revoked_at" = NOW(), "status" = 'revoked'
           WHERE "id" = $1`,
          [seeded.consentFullId]
        )
      } finally {
        adminClient.release()
      }

      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toHaveLength(0)

          const silhouette = await client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toHaveLength(0)

          const blockedUpdate = await client.query(
            `UPDATE public."WardrobeOnboardingState"
             SET "current_step" = 'complete', "updated_at" = NOW()
             WHERE "id" = $1
             RETURNING "id"`,
            [seeded.onboardingStateId]
          )
          expect(blockedUpdate.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    '4.4-DB-003 blocks onboarding and silhouette access while a guardian consent is still pending',
    async ({ scenario: seeded }) => {
      const pendingConsentId = `consent-pending-${randomUUID()}`
      const adminClient = await adminPool.connect()

      try {
        await adminClient.query(
          `INSERT INTO public."GuardianConsent"
            ("id", "guardian_id", "teen_id", "consent_level", "status", "ip_address")
           VALUES ($1, $2, $3, 'full_access', 'pending', '127.0.0.1')`,
          [pendingConsentId, seeded.outsiderGuardianId, seeded.teenId]
        )
      } finally {
        adminClient.release()
      }

      try {
        await withRole(
          'authenticated',
          buildClaims(seeded.outsiderGuardianEmail, 'guardian'),
          async (client) => {
            const onboarding = await client.query(
              'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(onboarding.rows).toHaveLength(0)

            const silhouette = await client.query(
              'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
              [seeded.teenId]
            )
            expect(silhouette.rows).toHaveLength(0)
          }
        )
      } finally {
        const cleanupClient = await adminPool.connect()
        try {
          await cleanupClient.query(
            'DELETE FROM public."GuardianConsent" WHERE "id" = $1',
            [pendingConsentId]
          )
        } finally {
          cleanupClient.release()
        }
      }
    }
  )

  scenarioTest(
    '4.4-DB-003 blocks unrelated, unverified, spoofed, and anonymous onboarding/silhouette access',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.outsiderGuardianEmail, 'guardian'),
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toHaveLength(0)
        }
      )

      // An unverified email claim must never resolve to the teen identity.
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: seeded.teenEmail,
          email_verified: false,
          role: 'authenticated',
          app_metadata: { role: 'guardian' },
        },
        async (client) => {
          const silhouette = await client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(silhouette.rows).toHaveLength(0)
        }
      )

      // Elevated role claims in user_metadata are attacker-controlled.
      await withRole(
        'authenticated',
        {
          sub: randomUUID(),
          email: `spoofed-${randomUUID()}@example.com`,
          email_verified: true,
          role: 'authenticated',
          user_metadata: { role: 'admin', email: seeded.teenEmail },
        },
        async (client) => {
          const onboarding = await client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(onboarding.rows).toHaveLength(0)
        }
      )

      // The anon role lacks table grants, so each refusal aborts its own
      // transaction and every table needs a separate session.
      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })

      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )

  scenarioTest(
    '4.4-DB-003 denies the Postgres service_role table access, matching GarmentItem',
    async ({ scenario: seeded }) => {
      // Guardian-shared tables are only granted to `authenticated`
      // (the guardianSharedTables convention in ./harness.ts);
      // service_role has BYPASSRLS but no table grant here, so a backend
      // process must act through an `authenticated` session with an
      // elevated app-role claim, never the raw Postgres service role.
      await withRole('service_role', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })

      await withRole('service_role', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
            [seeded.teenId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )
})
