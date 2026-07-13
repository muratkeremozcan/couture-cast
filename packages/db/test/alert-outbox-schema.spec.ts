import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260713151000_add_alert_delivery_outbox/migration.sql',
    import.meta.url
  ),
  'utf8'
)
const thresholdMigration = readFileSync(
  new URL(
    '../prisma/migrations/20260713160000_enforce_alert_rule_thresholds/migration.sql',
    import.meta.url
  ),
  'utf8'
)
const rollingCooldownMigration = readFileSync(
  new URL(
    '../prisma/migrations/20260713170000_add_rolling_alert_cooldowns/migration.sql',
    import.meta.url
  ),
  'utf8'
)

describe('alert delivery outbox schema', () => {
  it('persists queue handoff state beside alert envelopes', () => {
    expect(schema).toMatch(
      /model AlertDeliveryOutbox \{[\s\S]*event_id\s+String\s+@unique/
    )
    expect(schema).toMatch(
      /model AlertDeliveryOutbox \{[\s\S]*reservation_started_at\s+DateTime/
    )
    expect(schema).not.toContain('cooldown_bucket')
    expect(migration).toContain('CREATE TABLE public."AlertDeliveryOutbox"')
    expect(migration).toContain(
      'FOREIGN KEY ("event_id") REFERENCES public."EventEnvelope"("id")'
    )
    expect(migration).toContain(
      'ALTER TABLE public."AlertDeliveryOutbox" ENABLE ROW LEVEL SECURITY'
    )
  })

  it('reserves a rolling cooldown per alert fingerprint', () => {
    expect(schema).toMatch(
      /model AlertCooldownReservation \{[\s\S]*deduplication_key\s+String\s+@id[\s\S]*next_eligible_at\s+DateTime/
    )
    expect(rollingCooldownMigration).toContain(
      'CREATE TABLE public."AlertCooldownReservation"'
    )
    expect(rollingCooldownMigration).toContain('PRIMARY KEY ("deduplication_key")')
    expect(rollingCooldownMigration).toContain(
      'ALTER TABLE public."AlertCooldownReservation" ENABLE ROW LEVEL SECURITY'
    )
    expect(rollingCooldownMigration).toContain(
      'REVOKE ALL ON TABLE public."AlertCooldownReservation" FROM PUBLIC, anon, authenticated'
    )
    expect(rollingCooldownMigration).toContain(
      'RENAME COLUMN "cooldown_bucket" TO "reservation_started_at"'
    )
    expect(rollingCooldownMigration).toContain('"created_at" + INTERVAL \'1 hour\'')
  })

  it('enforces rule-specific thresholds at the database boundary', () => {
    expect(migration).toContain('AlertRule_threshold_check')
    expect(migration).toContain('"rule_type" = \'severe\'')
    expect(migration).toContain('"threshold" IN (1, 2, 3)')
    expect(thresholdMigration).toMatch(
      /WHEN 'temperature' THEN 5(?:\.0)?[\s\S]*WHEN 'precipitation' THEN 0\.5[\s\S]*WHEN 'severe' THEN 2/
    )
    expect(thresholdMigration).toContain('ALTER COLUMN "threshold" SET NOT NULL')
  })
})
