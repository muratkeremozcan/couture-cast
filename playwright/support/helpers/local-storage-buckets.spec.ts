/**
 * Unit tests for `scripts/local-storage-buckets.mjs`: the bucket list read from
 * the Prisma migrations, the provisioning plan the shared
 * `.github/actions/start-local-supabase` step applies, and the preflight
 * `scripts/e2e-real-session/run.mjs` fails fast with.
 *
 * R63: the real-session lane migrates an isolated database with no Storage schema,
 * so the migrations' bucket inserts skipped and the seed met "Bucket not found"
 * after minutes of setup. Every key below is a dummy.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assertBucketsPresent,
  bucketDefinitionsFromMigrations,
  bucketDefinitionsFromSql,
  listWhenReady,
  localStorageApi,
  missingBuckets,
  planBuckets,
  type BucketDefinition,
} from '../../../scripts/local-storage-buckets.mjs'

const repoRoot = path.resolve(__dirname, '../../..')

/** The full-assignment upsert both bucket migrations use. */
const FULL_UPSERT = `ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types`

const insert = (
  id: string,
  isPublic = 'false',
  limit = '10485760',
  conflict = FULL_UPSERT,
  name = id
) => `
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    VALUES (
      '${id}',
      '${name}',
      ${isPublic},
      ${limit},
      ARRAY['image/jpeg', 'image/png']
    )
    ${conflict};
  END IF;
END
$storage$;`

const wardrobe: BucketDefinition = {
  id: 'wardrobe-images',
  name: 'wardrobe-images',
  public: false,
  file_size_limit: 10485760,
  allowed_mime_types: ['image/jpeg', 'image/png'],
}

describe('local Storage buckets', () => {
  it('R63-SB-01 reads every bucket the migrations define, including each one the seed uploads to', () => {
    const buckets = bucketDefinitionsFromMigrations()
    expect(buckets.map((bucket) => bucket.id).sort()).toEqual([
      'community-images',
      'wardrobe-images',
    ])
    // Today's settings, exactly as the two migrations leave them in PostgreSQL.
    const settings = (id: string) => ({
      id,
      name: id,
      public: false,
      file_size_limit: 10485760,
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
    })
    expect(buckets).toEqual([settings('wardrobe-images'), settings('community-images')])

    // The seed names its buckets in constants; each must be one the migrations define.
    const seeds = path.join(repoRoot, 'packages/db/prisma/seeds')
    const seeded = fs
      .readdirSync(seeds)
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) => [
        ...fs
          .readFileSync(path.join(seeds, file), 'utf8')
          .matchAll(/const \w*BUCKET\w* = '([^']+)'/g),
      ])
      .map((match) => match[1])
    expect(seeded.length).toBeGreaterThan(0)
    for (const bucket of seeded)
      expect(buckets.map((entry) => entry.id)).toContain(bucket)
  })

  it('R63-SB-02 parses one upsert and applies a later one the way PostgreSQL does', () => {
    expect(bucketDefinitionsFromSql(insert('wardrobe-images'))).toEqual([wardrobe])
    // Every assigned column takes the later value; the unassigned name keeps the first.
    expect(
      bucketDefinitionsFromSql(
        `${insert('a')}\n${insert('a', 'true', 'NULL', FULL_UPSERT, 'renamed')}`
      )
    ).toEqual([
      {
        id: 'a',
        name: 'a',
        public: true,
        file_size_limit: null,
        allowed_mime_types: ['image/jpeg', 'image/png'],
      },
    ])
    expect(
      bucketDefinitionsFromSql(
        `${insert('a')}\n${insert('a', 'false', '5', `${FULL_UPSERT}, name = EXCLUDED.name`, 'renamed')}`
      )
    ).toMatchObject([{ id: 'a', name: 'renamed', file_size_limit: 5 }])
  })

  it('R69-SB-01 rejects a partial DO UPDATE, naming the migration', () => {
    expect(() =>
      bucketDefinitionsFromSql(
        `${insert('a')}\n${insert('a', 'true', 'NULL', 'ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public')}`,
        '20990101000000_partial_bucket_update'
      )
    ).toThrow(
      /^20990101000000_partial_bucket_update: a storage\.buckets insert leaves file_size_limit unassigned on conflict/
    )
  })

  it('R69-SB-02 rejects DO NOTHING, naming the migration', () => {
    expect(() =>
      bucketDefinitionsFromSql(
        insert('a', 'false', '10485760', 'ON CONFLICT (id) DO NOTHING'),
        '20990101000000_bucket_do_nothing'
      )
    ).toThrow(
      /^20990101000000_bucket_do_nothing: a storage\.buckets insert has an unsupported conflict action/
    )
    expect(() =>
      bucketDefinitionsFromSql(
        insert('a', 'false', '10485760', 'ON CONFLICT DO NOTHING'),
        'm2'
      )
    ).toThrow(/^m2: .*unsupported conflict action/)
  })

  it('R69-SB-03 rejects a WHERE-conditioned update, naming the migration', () => {
    expect(() =>
      bucketDefinitionsFromSql(
        insert(
          'a',
          'false',
          '10485760',
          `${FULL_UPSERT}\n    WHERE EXCLUDED.public = false`
        ),
        '20990101000000_bucket_conditional_update'
      )
    ).toThrow(
      /^20990101000000_bucket_conditional_update: a storage\.buckets insert has a WHERE condition/
    )
  })

  it('R69-SB-04 rejects every other upsert form it cannot apply exactly', () => {
    const reject = (conflict: string) => () =>
      bucketDefinitionsFromSql(insert('a', 'false', '10485760', conflict), 'm3')
    // A plain insert, a computed or cross-column value, a column twice.
    expect(reject('')).toThrow(/^m3: .*has no ON CONFLICT action/)
    expect(
      reject(
        'ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types'
      )
    ).toThrow(/^m3: .*assigns public = true on conflict/)
    expect(
      reject(
        'ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.public, allowed_mime_types = EXCLUDED.allowed_mime_types'
      )
    ).toThrow(/^m3: .*assigns file_size_limit = EXCLUDED\.public/)
    expect(reject(`${FULL_UPSERT}, public = EXCLUDED.public`)).toThrow(
      /^m3: .*assigns a column twice/
    )
    expect(() =>
      bucketDefinitionsFromSql(
        `INSERT INTO storage.buckets (id, name, public) VALUES ('a', 'a', true) ${FULL_UPSERT};`,
        'm4'
      )
    ).toThrow(/^m4: a storage\.buckets insert must list exactly/)
  })

  it('R63-SB-03 refuses a migration that touches storage.buckets in a way it cannot read', () => {
    expect(() =>
      bucketDefinitionsFromSql("DELETE FROM storage.buckets WHERE id = 'x';", 'm1')
    ).toThrow(/m1 touches storage\.buckets/)
    expect(() => bucketDefinitionsFromSql(insert('x', 'false', "lower('X')"))).toThrow(
      /unsupported SQL literal/
    )
  })

  it('R63-SB-04 plans a create for an absent bucket and an update for a drifted one', () => {
    const community = { ...wardrobe, id: 'community-images', name: 'community-images' }
    const extra = { ...wardrobe, id: 'avatars', name: 'avatars' }
    const plan = planBuckets(
      [wardrobe, community, extra],
      [
        { ...wardrobe, allowed_mime_types: ['image/png', 'image/jpeg'] },
        { ...community, file_size_limit: 5 },
      ]
    )
    expect(plan.create.map((bucket) => bucket.id)).toEqual(['avatars'])
    expect(plan.update.map((bucket) => bucket.id)).toEqual(['community-images'])
    expect(plan.unchanged).toEqual(['wardrobe-images'])
  })

  it('R63-SB-05 the preflight names each missing bucket and passes when all exist', () => {
    const required = [{ id: 'wardrobe-images' }, { id: 'community-images' }]
    expect(missingBuckets(required, [{ id: 'community-images' }])).toEqual([
      'wardrobe-images',
    ])
    expect(() => assertBucketsPresent(required, [])).toThrow(
      'The local Supabase Storage lacks the buckets the seed needs: wardrobe-images, community-images. Provision them with node scripts/local-storage-buckets.mjs provision.'
    )
    expect(() => assertBucketsPresent(required, [{ id: 'community-images' }])).toThrow(
      /lacks the bucket the seed needs: wardrobe-images\./
    )
    expect(() => assertBucketsPresent(required, required)).not.toThrow()
  })

  it('R63-SB-06 talks to a loopback Storage API only, with the key in headers only', async () => {
    expect(() =>
      localStorageApi({
        supabaseUrl: 'https://abc.supabase.co',
        serviceRoleKey: 'dummy-key',
      })
    ).toThrow(/local Supabase only/)
    expect(() =>
      localStorageApi({ supabaseUrl: 'http://127.0.0.1:54321', serviceRoleKey: '' })
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)

    const send = vi.fn(() =>
      Promise.resolve(
        new Response('{"error":"dummy-service-key echoed"}', { status: 500 })
      )
    )
    const api = localStorageApi({
      supabaseUrl: 'http://127.0.0.1:54321',
      serviceRoleKey: 'dummy-service-key',
      fetch: send as unknown as typeof fetch,
    })
    const error = (await api.list().catch((caught: unknown) => caught)) as Error
    expect(error.message).toBe('Storage API answered 500 for GET /storage/v1/bucket')
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:54321/storage/v1/bucket')
    expect(init.headers).toMatchObject({ authorization: 'Bearer dummy-service-key' })
  })

  it('R63-SB-07 retries the listing while Storage starts, within its deadline', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce([{ id: 'wardrobe-images' }])
    expect(await listWhenReady({ list }, { timeoutMs: 1_000, intervalMs: 10 })).toEqual([
      { id: 'wardrobe-images' },
    ])

    const down = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      listWhenReady({ list: down }, { timeoutMs: 50, intervalMs: 20 })
    ).rejects.toThrow('ECONNREFUSED')
  })
})
