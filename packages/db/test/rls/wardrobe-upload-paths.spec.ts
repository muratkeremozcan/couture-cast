// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Production follow-up 2026-11-19 (review round 1, Codex 1). Garment, My Form and palette selfie
// rows hold the storage paths the API's service role reads, moves and deletes. Under the old
// own-row write policies a member could point their own row's path column at another member's
// object and steer a service-role storage call at it. Migration
// 20261119120000_revoke_member_wardrobe_upload_writes revokes every client write on the three
// tables; members keep reading their own rows.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect } from 'vitest'
import {
  adminPool,
  buildClaims,
  expectPermissionDenied,
  scenarioTest,
  useRlsDatabase,
  withRole,
} from './harness.js'

const pathColumns = [
  { table: 'GarmentItem', column: 'object_path', idKey: 'garmentId' },
  {
    table: 'SilhouetteProfile',
    column: 'my_form_object_path',
    idKey: 'silhouetteProfileId',
  },
  { table: 'PaletteProfile', column: 'selfie_object_path', idKey: 'paletteProfileId' },
] as const

describe.concurrent('member writes on wardrobe upload rows', () => {
  useRlsDatabase()

  for (const { table, column, idKey } of pathColumns) {
    scenarioTest(
      `the owner reads their own ${table} row and cannot write its ${column}`,
      async ({ scenario: seeded }) => {
        const rowId = seeded[idKey]
        const ownPath = `wardrobe/${seeded.teenId}/own-${randomUUID()}.jpg`
        const otherMembersPath = `wardrobe/${seeded.otherTeenId}/theirs-${randomUUID()}.jpg`

        const admin = await adminPool.connect()
        try {
          await admin.query(
            `UPDATE public."${table}" SET "${column}" = $1 WHERE "id" = $2`,
            [ownPath, rowId]
          )
        } finally {
          admin.release()
        }

        try {
          await withRole(
            'authenticated',
            buildClaims(seeded.teenEmail, 'teen'),
            async (client) => {
              const own = await client.query(
                `SELECT "${column}" AS path FROM public."${table}" WHERE "id" = $1`,
                [rowId]
              )
              expect(own.rows).toEqual([{ path: ownPath }])

              await expectPermissionDenied(
                client,
                `UPDATE public."${table}" SET "${column}" = $1 WHERE "id" = $2`,
                [otherMembersPath, rowId]
              )
              await expectPermissionDenied(
                client,
                `DELETE FROM public."${table}" WHERE "id" = $1`,
                [rowId]
              )
              await expectPermissionDenied(
                client,
                `INSERT INTO public."${table}" ("id", "user_id", "${column}", "updated_at")
                 VALUES ($1, $2, $3, NOW())`,
                [`member-insert-${randomUUID()}`, seeded.teenId, otherMembersPath]
              )
            }
          )

          // An admin claim reaches every row through the read policy, and still writes none.
          await withRole(
            'authenticated',
            buildClaims(`admin-${randomUUID()}@example.com`, 'admin'),
            async (client) => {
              await expectPermissionDenied(
                client,
                `UPDATE public."${table}" SET "${column}" = $1 WHERE "id" = $2`,
                [otherMembersPath, rowId]
              )
            }
          )

          await withRole('anon', null, async (client) => {
            await expectPermissionDenied(
              client,
              `UPDATE public."${table}" SET "${column}" = $1 WHERE "id" = $2`,
              [otherMembersPath, rowId]
            )
          })

          const check = await adminPool.connect()
          try {
            const stored = await check.query(
              `SELECT "${column}" AS path FROM public."${table}" WHERE "id" = $1`,
              [rowId]
            )
            expect(stored.rows).toEqual([{ path: ownPath }])
          } finally {
            check.release()
          }
        } finally {
          const reset = await adminPool.connect()
          try {
            await reset.query(
              `UPDATE public."${table}" SET "${column}" = NULL WHERE "id" = $1`,
              [rowId]
            )
          } finally {
            reset.release()
          }
        }
      }
    )
  }
  // Round 3 (Codex round 2 finding 4): staged uploads are bytes no one has verified, so only the
  // API's service role reads them. The policy lives on storage.objects, which this database has
  // only under a real Supabase, so the test runs the migration's own policy block against a stub
  // of the two storage pieces it uses, inside one transaction it rolls back.
  scenarioTest(
    'members, admins and moderators read wardrobe/ objects but no staging/ key',
    async ({ scenario: seeded }) => {
      const migration = readFileSync(
        path.resolve(
          __dirname,
          '../../prisma/migrations/20261119130000_wardrobe_staging_reads_and_deletion_outbox/migration.sql'
        ),
        'utf8'
      )
      const policyBlock = /DO \$storage_policy\$[\s\S]*?\$storage_policy\$;/.exec(
        migration
      )?.[0]
      expect(policyBlock, 'the migration storage policy block').toBeDefined()

      const finalKey = `wardrobe/${seeded.teenId}/${randomUUID()}.jpg`
      const stagingKey = `staging/${seeded.teenId}/garment/${randomUUID()}.png`
      const client = await adminPool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query<{ present: boolean }>(
          "SELECT to_regclass('storage.objects') IS NOT NULL AS present"
        )
        if (!existing.rows[0]?.present) {
          await client.query(`
            CREATE SCHEMA storage;
            CREATE TABLE storage.objects (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              bucket_id text,
              name text
            );
            -- Supabase's definition: every path segment but the last.
            CREATE FUNCTION storage.foldername(name text) RETURNS text[]
              LANGUAGE sql IMMUTABLE AS $fn$
                SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
              $fn$;
            ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
            GRANT USAGE ON SCHEMA storage TO authenticated;
            GRANT SELECT ON storage.objects TO authenticated;
            GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;
          `)
        }
        await client.query(policyBlock!)
        await client.query(
          `INSERT INTO storage.objects (bucket_id, name)
           VALUES ('wardrobe-images', $1), ('wardrobe-images', $2)`,
          [finalKey, stagingKey]
        )

        const readable = async (claims: Record<string, unknown>) => {
          await client.query('SAVEPOINT reader')
          try {
            await client.query('SET LOCAL ROLE authenticated')
            await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
              JSON.stringify(claims),
            ])
            const rows = await client.query<{ name: string }>(
              'SELECT name FROM storage.objects WHERE name = ANY($1::text[]) ORDER BY name',
              [[finalKey, stagingKey]]
            )
            return rows.rows.map((row) => row.name)
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT reader')
          }
        }

        expect(await readable(buildClaims(seeded.teenEmail, 'teen'))).toEqual([finalKey])
        expect(
          await readable(buildClaims(`admin-${randomUUID()}@example.com`, 'admin'))
        ).toEqual([finalKey])
        expect(
          await readable(
            buildClaims(`moderator-${randomUUID()}@example.com`, 'moderator')
          )
        ).toEqual([finalKey])
        expect(
          await readable(buildClaims(`other-${randomUUID()}@example.com`, 'teen'))
        ).toEqual([])
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
    }
  )
})
