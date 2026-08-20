// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
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
    '4.3-DB-003 lets the capsule owner read and mutate both capsule tables',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toEqual([{ id: seeded.capsuleId }])

          const joins = await client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
          expect(joins.rows).toEqual([{ id: seeded.capsuleGarmentId }])

          const renamed = await client.query(
            `UPDATE public."OutfitCapsule"
             SET "name" = $1, "updated_at" = NOW()
             WHERE "id" = $2
             RETURNING "name"`,
            ['Owner renamed capsule', seeded.capsuleId]
          )
          expect(renamed.rows).toEqual([{ name: 'Owner renamed capsule' }])

          // Delete then reinsert the join so the assertion needs no second garment.
          const removedJoin = await client.query(
            'DELETE FROM public."OutfitCapsuleGarment" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleGarmentId]
          )
          expect(removedJoin.rows).toEqual([{ id: seeded.capsuleGarmentId }])

          const reinsertedJoin = await client.query(
            `INSERT INTO public."OutfitCapsuleGarment"
              ("id", "user_id", "capsule_id", "garment_id", "garment_order")
             VALUES ($1, $2, $3, $4, 0)
             RETURNING "id"`,
            [seeded.capsuleGarmentId, seeded.teenId, seeded.capsuleId, seeded.garmentId]
          )
          expect(reinsertedJoin.rows).toEqual([{ id: seeded.capsuleGarmentId }])

          const insertedCapsule = await client.query(
            `INSERT INTO public."OutfitCapsule"
              ("id", "user_id", "name", "occasions", "updated_at")
             VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], NOW())
             RETURNING "id"`,
            [`owner-capsule-${randomUUID()}`, seeded.teenId, 'Owner created', ['work']]
          )
          expect(insertedCapsule.rows).toHaveLength(1)

          const deletedCapsule = await client.query(
            'DELETE FROM public."OutfitCapsule" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleId]
          )
          expect(deletedCapsule.rows).toEqual([{ id: seeded.capsuleId }])
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 gives read-only guardians capsule reads without any capsule write',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toEqual([{ id: seeded.capsuleId }])

          const joins = await client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
          expect(joins.rows).toEqual([{ id: seeded.capsuleGarmentId }])

          // UPDATE and DELETE are filtered to zero visible rows.
          const blockedUpdate = await client.query(
            `UPDATE public."OutfitCapsule"
             SET "name" = $1, "updated_at" = NOW()
             WHERE "id" = $2
             RETURNING "id"`,
            ['Blocked rename', seeded.capsuleId]
          )
          expect(blockedUpdate.rows).toHaveLength(0)

          const blockedDelete = await client.query(
            'DELETE FROM public."OutfitCapsule" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleId]
          )
          expect(blockedDelete.rows).toHaveLength(0)

          const blockedJoinUpdate = await client.query(
            `UPDATE public."OutfitCapsuleGarment"
             SET "garment_order" = 1
             WHERE "id" = $1
             RETURNING "id"`,
            [seeded.capsuleGarmentId]
          )
          expect(blockedJoinUpdate.rows).toHaveLength(0)

          const blockedJoinDelete = await client.query(
            'DELETE FROM public."OutfitCapsuleGarment" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleGarmentId]
          )
          expect(blockedJoinDelete.rows).toHaveLength(0)
        }
      )

      // INSERT is refused by the WITH CHECK clause rather than filtered, and a
      // refused statement aborts its transaction, so it needs its own session.
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianReadOnlyEmail, 'guardian'),
        async (client) => {
          await expect(
            client.query(
              `INSERT INTO public."OutfitCapsule"
                ("id", "user_id", "name", "occasions", "updated_at")
               VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], NOW())`,
              [
                `read-only-capsule-${randomUUID()}`,
                seeded.teenId,
                'Blocked capsule',
                ['work'],
              ]
            )
          ).rejects.toMatchObject({ code: '42501' })
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 lets full-access guardians mutate linked teen capsules and joins',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.guardianFullAccessEmail, 'guardian'),
        async (client) => {
          const renamed = await client.query(
            `UPDATE public."OutfitCapsule"
             SET "name" = $1, "revision" = "revision" + 1, "updated_at" = NOW()
             WHERE "id" = $2
             RETURNING "name", "revision"`,
            ['Guardian renamed capsule', seeded.capsuleId]
          )
          expect(renamed.rows).toEqual([
            { name: 'Guardian renamed capsule', revision: 1 },
          ])

          const insertedCapsule = await client.query(
            `INSERT INTO public."OutfitCapsule"
              ("id", "user_id", "name", "occasions", "updated_at")
             VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], NOW())
             RETURNING "id"`,
            [
              `guardian-capsule-${randomUUID()}`,
              seeded.teenId,
              'Guardian created',
              ['casual'],
            ]
          )
          expect(insertedCapsule.rows).toHaveLength(1)

          const reorderedJoin = await client.query(
            `UPDATE public."OutfitCapsuleGarment"
             SET "garment_order" = 1
             WHERE "id" = $1
             RETURNING "garment_order"`,
            [seeded.capsuleGarmentId]
          )
          expect(reorderedJoin.rows).toEqual([{ garment_order: 1 }])

          const deletedJoin = await client.query(
            'DELETE FROM public."OutfitCapsuleGarment" WHERE "id" = $1 RETURNING "id"',
            [seeded.capsuleGarmentId]
          )
          expect(deletedJoin.rows).toEqual([{ id: seeded.capsuleGarmentId }])
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 grants admins capsule reads across both tables',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toEqual([{ id: seeded.capsuleId }])

          const joins = await client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
          expect(joins.rows).toEqual([{ id: seeded.capsuleGarmentId }])
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 blocks capsule access after a guardian consent is revoked',
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
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toHaveLength(0)

          const joins = await client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
          expect(joins.rows).toHaveLength(0)

          const blockedUpdate = await client.query(
            `UPDATE public."OutfitCapsule"
             SET "name" = $1, "updated_at" = NOW()
             WHERE "id" = $2
             RETURNING "id"`,
            ['Revoked rename', seeded.capsuleId]
          )
          expect(blockedUpdate.rows).toHaveLength(0)
        }
      )
    }
  )

  scenarioTest(
    '4.3-DB-003 blocks unrelated, unverified, spoofed, and anonymous capsule access',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.outsiderGuardianEmail, 'guardian'),
        async (client) => {
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toHaveLength(0)
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
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toHaveLength(0)
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
          const capsules = await client.query(
            'SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1',
            [seeded.teenId]
          )
          expect(capsules.rows).toHaveLength(0)
        }
      )

      // The anon role lacks table grants, so each refusal aborts its own
      // transaction and every table needs a separate session.
      await withRole('anon', null, async (client) => {
        await expect(
          client.query('SELECT "id" FROM public."OutfitCapsule" WHERE "user_id" = $1', [
            seeded.teenId,
          ])
        ).rejects.toMatchObject({ code: '42501' })
      })

      await withRole('anon', null, async (client) => {
        await expect(
          client.query(
            'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
            [seeded.capsuleId]
          )
        ).rejects.toMatchObject({ code: '42501' })
      })
    }
  )
})
