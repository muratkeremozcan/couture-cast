// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
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

  /**
   * Production follow-up 2026-11-19 (review round 2, Codex 4 and 11): staged uploads are
   * service-only, and every wardrobe-images deletion is recorded durably.
   */
  it('limits wardrobe reads to the wardrobe/ prefix and adds an API-only deletion outbox', () => {
    const round3 = readFileSync(
      new URL(
        '../prisma/migrations/20261119130000_wardrobe_staging_reads_and_deletion_outbox/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    expect(round3).toContain("(storage.foldername(name))[1] = 'wardrobe'")
    expect(round3).toContain(
      'private.can_read_shared_user_row((storage.foldername(name))[2])'
    )
    expect(round3).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE)/)
    expect(round3).toContain(
      'CREATE UNIQUE INDEX "WardrobeObjectDeletion_object_path_key"'
    )
    expect(round3).toContain(
      'REVOKE ALL ON TABLE public."WardrobeObjectDeletion" FROM anon, authenticated;'
    )
    expect(round3).toContain(
      'ALTER TABLE public."WardrobeObjectDeletion" ENABLE ROW LEVEL SECURITY;'
    )
    expect(schema).toContain('model WardrobeObjectDeletion {')
  })

  /**
   * Production follow-up 2026-11-19 (review round 3, Codex 1, 5, 6 and 11): publication claims
   * on the three upload rows, job handoff markers and the analysis attempt on the profiles, and
   * an API-only maintenance state table for the staging sweep's continuation.
   */
  it('adds publication claims, profile job handoff markers and API-only maintenance state', () => {
    const round4 = readFileSync(
      new URL(
        '../prisma/migrations/20261119140000_wardrobe_publication_claims/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    for (const [table, columns] of [
      ['GarmentItem', ['publish_attempt_id', 'publish_started_at']],
      [
        'SilhouetteProfile',
        [
          'my_form_publish_attempt_id',
          'my_form_publish_started_at',
          'my_form_processing_job_enqueued_at',
        ],
      ],
      [
        'PaletteProfile',
        [
          'selfie_publish_attempt_id',
          'selfie_publish_started_at',
          'analysis_attempt_id',
          'processing_job_enqueued_at',
        ],
      ],
    ] as const) {
      expect(round4).toContain(`ALTER TABLE public."${table}"`)
      for (const column of columns) {
        expect(schema).toContain(column)
        expect(round4).toContain(`ADD COLUMN "${column}"`)
      }
    }
    // Round 5 (Codex C4-7): nothing records whether a row already processing at deploy had its
    // job delivered, so the handoff markers stay null for replay and the hourly handoff to
    // recover. A historical wardrobe analysis gets the known legacy attempt, which only a job
    // for that attempt may finish.
    expect(round4).not.toMatch(/SET "my_form_processing_job_enqueued_at" =/)
    expect(round4).not.toMatch(/"processing_job_enqueued_at" = CURRENT_TIMESTAMP/)
    expect(round4).toMatch(
      /"analysis_attempt_id" = CASE\s+WHEN "source" = 'selfie' THEN "selfie_upload_session_id"\s+ELSE 'legacy-wardrobe-analysis'\s+END/
    )
    expect(round4).toContain(
      'REVOKE ALL ON TABLE public."WardrobeMaintenanceState" FROM anon, authenticated;'
    )
    expect(round4).toContain(
      'ALTER TABLE public."WardrobeMaintenanceState" ENABLE ROW LEVEL SECURITY;'
    )
    expect(schema).toContain('model WardrobeMaintenanceState {')
  })

  /**
   * Production follow-up 2026-11-19 (review round 4, Codex C4-2, C4-5 and C4-6): an explicit
   * ended state for rejected garment sessions, the held source digest, and repeating removals.
   */
  it('adds the garment upload end, the held source record and repeating removals', () => {
    const round5 = readFileSync(
      new URL(
        '../prisma/migrations/20261119150000_wardrobe_upload_endings_and_held_sources/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    for (const column of [
      'upload_ended_at',
      'held_source_sha256',
      'held_source_captured_at',
      'repeat_until',
    ]) {
      expect(schema).toContain(column)
      expect(round5).toContain(`ADD COLUMN "${column}"`)
    }
    expect(round5).toContain('ALTER TABLE public."GarmentItem"')
    expect(round5).toContain('ALTER TABLE public."WardrobeObjectDeletion"')
    expect(round5).not.toMatch(/GRANT|CREATE POLICY/)
  })

  /**
   * Production follow-up 2026-11-19 (review round 6, Codex C5-2 to C5-7): cleanup horizons that
   * outlive a claim, the held copy's obligation and operator-visible capture state, and the
   * color worker's hold deferral.
   */
  it('adds cleanup horizons, the held copy obligation and capture state, and the hold deferral', () => {
    const round6 = readFileSync(
      new URL(
        '../prisma/migrations/20261119160000_wardrobe_cleanup_horizons_and_held_capture/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    for (const column of [
      'publish_cleanup_until',
      'held_source_object_path',
      'held_source_capture_outcome',
      'held_source_checked_at',
      'processing_deferred_at',
      'my_form_publish_cleanup_until',
      'selfie_publish_cleanup_until',
    ]) {
      expect(schema).toContain(column)
      expect(round6).toContain(`ADD COLUMN "${column}"`)
    }
    // A claim taken before the deploy keeps the horizon its start implies.
    expect(round6).toContain(
      'SET "publish_cleanup_until" = "publish_started_at" + INTERVAL \'24 hours\''
    )
    expect(round6).not.toMatch(/GRANT|CREATE POLICY/)
  })
})
