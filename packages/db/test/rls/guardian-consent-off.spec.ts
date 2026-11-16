// Guardian consent is off (owner ruling 2026-11-16; migration 20261116130000_guardian_consent_off_rls).
// A granted GuardianConsent row stays for audit and grants nothing at the row-level policies
// either: a read-only or full-access guardian of the seeded teen reads none of the teen's
// guardian-shared rows and writes none, exactly like the outsider guardian. Independent review
// of PR 244 (H-1) found these policies still honoured the row after the API stopped doing so.
//
// The granted-access cases this replaces (4.3-DB-003 and 4.4-DB-003 guardian reads and writes,
// and the guardian-wardrobe grant cases) come back with the helper body in the PR that turns
// consent on again; see the re-enable checklist in cc617-google-sign-in-test-design.md.
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import {
  adminPool,
  buildClaims,
  guardianSharedTables,
  scenarioTest,
  useRlsDatabase,
  withRole,
} from './harness.js'

const actors = [
  ['read-only', 'guardianReadOnlyEmail'],
  ['full-access', 'guardianFullAccessEmail'],
] as const

describe.concurrent('guardian consent off: a granted row grants nothing', () => {
  useRlsDatabase()

  for (const [level, emailKey] of actors) {
    scenarioTest(
      `a ${level} guardian with a granted row reads none of the teen's shared rows`,
      async ({ scenario: seeded }) => {
        const admin = await adminPool.connect()
        const present = new Map<string, number>()
        try {
          for (const table of guardianSharedTables) {
            const rows = await admin.query<{ count: string }>(
              `SELECT count(*) FROM public."${table}" WHERE "user_id" = $1`,
              [seeded.teenId]
            )
            present.set(table, Number(rows.rows[0]!.count))
          }
          const granted = await admin.query<{ count: string }>(
            `SELECT count(*) FROM public."GuardianConsent"
             WHERE "teen_id" = $1 AND "status" = 'granted' AND "revoked_at" IS NULL`,
            [seeded.teenId]
          )
          // The rows the old policies honoured are still there, for audit.
          expect(Number(granted.rows[0]!.count)).toBe(2)
        } finally {
          admin.release()
        }

        await withRole(
          'authenticated',
          buildClaims(seeded[emailKey], 'guardian'),
          async (client) => {
            for (const table of guardianSharedTables) {
              // The seed holds teen rows in every table, so an empty read is the policy's doing.
              expect(present.get(table), `${table} seeded`).toBeGreaterThan(0)
              const visible = await client.query(
                `SELECT 1 FROM public."${table}" WHERE "user_id" = $1`,
                [seeded.teenId]
              )
              expect(visible.rows, table).toEqual([])
            }
          }
        )
      }
    )

    scenarioTest(
      `a ${level} guardian with a granted row changes none of the teen's shared rows`,
      async ({ scenario: seeded }) => {
        await withRole(
          'authenticated',
          buildClaims(seeded[emailKey], 'guardian'),
          async (client) => {
            const updated = await client.query(
              `UPDATE public."GarmentItem" SET "category" = 'outerwear', "updated_at" = NOW()
             WHERE "id" = $1 RETURNING "id"`,
              [seeded.garmentId]
            )
            expect(updated.rows).toEqual([])
            const renamed = await client.query(
              `UPDATE public."OutfitCapsule" SET "name" = 'Guardian rename', "updated_at" = NOW()
             WHERE "id" = $1 RETURNING "id"`,
              [seeded.capsuleId]
            )
            expect(renamed.rows).toEqual([])
            const deletedJoin = await client.query(
              'DELETE FROM public."OutfitCapsuleGarment" WHERE "id" = $1 RETURNING "id"',
              [seeded.capsuleGarmentId]
            )
            expect(deletedJoin.rows).toEqual([])
            const deletedSilhouette = await client.query(
              'DELETE FROM public."SilhouetteProfile" WHERE "id" = $1 RETURNING "id"',
              [seeded.silhouetteProfileId]
            )
            expect(deletedSilhouette.rows).toEqual([])
          }
        )

        // A refused INSERT aborts its transaction, so it runs in its own session.
        await withRole(
          'authenticated',
          buildClaims(seeded[emailKey], 'guardian'),
          async (client) => {
            await expect(
              client.query(
                `INSERT INTO public."OutfitRecommendation" ("id", "user_id", "scenario", "updated_at")
               VALUES ($1, $2, 'school-run', NOW())`,
                [`guardian-off-outfit-${randomUUID()}`, seeded.teenId]
              )
            ).rejects.toMatchObject({ code: '42501' })
          }
        )

        const admin = await adminPool.connect()
        try {
          const garment = await admin.query<{ category: string }>(
            'SELECT "category" FROM public."GarmentItem" WHERE "id" = $1',
            [seeded.garmentId]
          )
          expect(garment.rows).toEqual([{ category: 'top' }])
        } finally {
          admin.release()
        }
      }
    )
  }

  scenarioTest(
    'the teen still reads and writes their own shared rows',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) => {
          for (const table of guardianSharedTables) {
            const own = await client.query(
              `SELECT 1 FROM public."${table}" WHERE "user_id" = $1`,
              [seeded.teenId]
            )
            expect(own.rows.length, table).toBeGreaterThan(0)
          }
          const updated = await client.query(
            `UPDATE public."GarmentItem" SET "category" = 'outerwear', "updated_at" = NOW()
         WHERE "id" = $1 RETURNING "category"`,
            [seeded.garmentId]
          )
          expect(updated.rows).toEqual([{ category: 'outerwear' }])
        }
      )
    }
  )
})
