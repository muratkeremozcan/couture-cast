import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260804180000_add_garment_capture_lifecycle/migration.sql',
    import.meta.url
  ),
  'utf8'
)

describe('garment upload lifecycle migration', () => {
  it('keeps Prisma lifecycle fields and database constraints aligned', () => {
    expect(schema).toContain('enum GarmentUploadStatus')
    expect(schema).toContain('enum GarmentRetentionStatus')
    expect(schema).toContain('@@unique([user_id, upload_idempotency_key])')
    expect(schema).toContain('@@unique([user_id, commit_idempotency_key])')
    expect(migration).toContain('CREATE TYPE "GarmentUploadStatus"')
    expect(migration).toContain('"GarmentItem_user_id_upload_idempotency_key_key"')
    expect(migration).toContain('"GarmentItem_user_id_commit_idempotency_key_key"')
  })

  it('preserves legacy garments and provisions a private bounded storage bucket', () => {
    expect(migration).toContain('"upload_status" = \'ready\'')
    expect(migration).toContain('"committed_at" = "created_at"')
    expect(migration).toMatch(/'wardrobe-images'/)
    expect(migration).toContain('false,')
    expect(migration).toContain('10485760')
    expect(migration).toMatch(/ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]/)
  })

  it('grants only user-scoped reads to authenticated storage clients', () => {
    expect(migration).toContain('FOR SELECT')
    expect(migration).toContain('private.can_read_shared_user_row')
    expect(migration).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE)/)
  })

  it('includes smart tagging enums, metadata columns, legacy data normalization, and check constraints', () => {
    const smartTaggingMigration = readFileSync(
      new URL(
        '../prisma/migrations/20260805120000_add_garment_smart_tags/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    expect(schema).toContain('enum GarmentCategory')
    expect(schema).toContain('enum GarmentMaterial')
    expect(schema).toContain('enum GarmentComfortRange')
    expect(schema).toContain('awaiting_tags')
    expect(smartTaggingMigration).toContain('CREATE TYPE "GarmentCategory"')
    expect(smartTaggingMigration).toContain('CREATE TYPE "GarmentMaterial"')
    expect(smartTaggingMigration).toContain('CREATE TYPE "GarmentComfortRange"')
    for (const column of [
      'tag_suggestions',
      'tagging_model_version',
      'tag_suggested_at',
      'tags_confirmed_at',
      'tagging_failure_code',
      'tagging_telemetry_emitted_at',
    ]) {
      expect(schema).toContain(column)
      expect(smartTaggingMigration).toContain(`"${column}"`)
    }
    for (const value of ['top', 'cotton', 'mild']) {
      expect(schema).toContain(value)
      expect(smartTaggingMigration).toContain(`'${value}'`)
    }
    expect(smartTaggingMigration).toContain('awaiting_tags')
    expect(smartTaggingMigration).toContain('GarmentItem_ready_tags_check')
    expect(smartTaggingMigration).toContain('LEGACY_TAGS_REQUIRED')
    expect(smartTaggingMigration).toContain('IRREVERSIBLE CHECKPOINT')
    expect(smartTaggingMigration).toContain('DATA-LOSS CHECKPOINT')
    expect(smartTaggingMigration).toContain('back up GarmentItem')
    expect(smartTaggingMigration).toContain('no automatic down migration')
    expect(smartTaggingMigration).toContain('NOT VALID')
    expect(smartTaggingMigration).toContain(
      'VALIDATE CONSTRAINT "GarmentItem_ready_tags_check"'
    )
    expect(schema).toContain('GarmentItem_ritual_candidates_idx')
    expect(smartTaggingMigration).toContain('GarmentItem_ritual_candidates_idx')
  })
})
