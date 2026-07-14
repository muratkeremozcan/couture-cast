import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = new URL(
  '../prisma/migrations/20260713142500_secure_alert_delivery_records/migration.sql',
  import.meta.url
)
const migrationSql = readFileSync(migrationPath, 'utf8')
const rollingCooldownMigrationSql = readFileSync(
  new URL(
    '../prisma/migrations/20260713170000_add_rolling_alert_cooldowns/migration.sql',
    import.meta.url
  ),
  'utf8'
)

describe('alert delivery database security', () => {
  it('enables self-only push token policies for every mutation', () => {
    const pushTokenSection = migrationSql.split(
      'GRANT SELECT ON TABLE public."EventEnvelope"'
    )[0]
    expect(migrationSql).toContain(
      'ALTER TABLE public."PushToken" ENABLE ROW LEVEL SECURITY'
    )
    for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(migrationSql).toContain(`FOR ${operation}`)
    }
    expect(
      pushTokenSection?.match(/private\.can_manage_self_row\("user_id"\)/g)
    ).toHaveLength(5)
  })

  it('allows authenticated users to read only owned or global event envelopes', () => {
    expect(migrationSql).toContain(
      'ALTER TABLE public."EventEnvelope" ENABLE ROW LEVEL SECURITY'
    )
    expect(migrationSql).toContain('GRANT SELECT ON TABLE public."EventEnvelope"')
    expect(migrationSql).toContain('"user_id" IS NULL')
    expect(migrationSql).toContain('private.can_manage_self_row("user_id")')
    expect(migrationSql).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."EventEnvelope"'
    )
  })

  it('keeps cooldown reservation state private to trusted database workers', () => {
    expect(rollingCooldownMigrationSql).toContain(
      'REVOKE ALL ON TABLE public."AlertCooldownReservation" FROM PUBLIC, anon, authenticated'
    )
    expect(rollingCooldownMigrationSql).toContain(
      'ALTER TABLE public."AlertCooldownReservation" ENABLE ROW LEVEL SECURITY'
    )
    expect(rollingCooldownMigrationSql).not.toContain('CREATE POLICY')
  })
})
