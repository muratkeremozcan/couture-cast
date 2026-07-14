import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url)
const migrationsPath = new URL('../prisma/migrations/', import.meta.url)

const schema = readFileSync(schemaPath, 'utf8')

const modelBlock = (name: string) => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))

  expect(match, `Expected Prisma model ${name}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('alert persistence schema', () => {
  it('defines user-owned alert rules and notification preferences', () => {
    const user = modelBlock('User')
    const alertRule = modelBlock('AlertRule')
    const notificationPreference = modelBlock('NotificationPreference')

    expect(user).toMatch(/alert_rules\s+AlertRule\[\]/)
    expect(user).toMatch(/notification_preference\s+NotificationPreference\?/)

    expect(alertRule).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/)
    expect(alertRule).toMatch(
      /user\s+User\s+@relation\(fields: \[user_id\], references: \[id\], onDelete: Cascade\)/
    )
    expect(alertRule).toMatch(/user_id\s+String/)
    expect(alertRule).toMatch(/rule_type\s+String/)
    expect(alertRule).toMatch(/threshold\s+Float(?:\s|$)/)
    expect(alertRule).not.toMatch(/threshold\s+Float\?/)
    expect(alertRule).toMatch(/enabled\s+Boolean\s+@default\(true\)/)
    expect(alertRule).toMatch(/created_at\s+DateTime\s+@default\(now\(\)\)/)
    expect(alertRule).toMatch(/updated_at\s+DateTime\s+@updatedAt/)
    expect(alertRule).toMatch(/@@unique\(\[user_id, rule_type\]\)/)
    expect(alertRule).toMatch(/@@index\(\[user_id\]\)/)

    expect(notificationPreference).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/)
    expect(notificationPreference).toMatch(
      /user\s+User\s+@relation\(fields: \[user_id\], references: \[id\], onDelete: Cascade\)/
    )
    expect(notificationPreference).toMatch(/user_id\s+String\s+@unique/)
    expect(notificationPreference).toMatch(
      /quiet_hours_enabled\s+Boolean\s+@default\(false\)/
    )
    expect(notificationPreference).toMatch(/push_enabled\s+Boolean\s+@default\(true\)/)
    expect(notificationPreference).toMatch(
      /quiet_hours_start\s+String\s+@default\("22:00"\)/
    )
    expect(notificationPreference).toMatch(
      /quiet_hours_end\s+String\s+@default\("07:00"\)/
    )
    expect(notificationPreference).toMatch(/timezone\s+String\s+@default\("UTC"\)/)
    expect(notificationPreference).toMatch(/created_at\s+DateTime\s+@default\(now\(\)\)/)
    expect(notificationPreference).toMatch(/updated_at\s+DateTime\s+@updatedAt/)
  })

  it('ships constraints and self-only RLS policies in a migration', () => {
    const migrationDirectories = readdirSync(migrationsPath, {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory() && entry.name.includes('alert'))
    const migrationDirectory = migrationDirectories.find((entry) =>
      entry.name.endsWith('_add_alert_rules_notification_preferences')
    )

    expect(migrationDirectory, 'Expected the alerts persistence migration').toBeDefined()

    if (!migrationDirectory) {
      return
    }

    const persistenceMigration = readFileSync(
      new URL(`${migrationDirectory.name}/migration.sql`, migrationsPath),
      'utf8'
    )
    const pushOptOutMigrationDirectory = migrationDirectories.find((entry) =>
      entry.name.endsWith('_add_alert_push_opt_out')
    )

    expect(
      pushOptOutMigrationDirectory,
      'Expected the alert push opt-out migration'
    ).toBeDefined()

    if (!pushOptOutMigrationDirectory) {
      return
    }

    const pushOptOutMigration = readFileSync(
      new URL(`${pushOptOutMigrationDirectory.name}/migration.sql`, migrationsPath),
      'utf8'
    )
    const migration = `${persistenceMigration}\n${pushOptOutMigration}`

    for (const table of ['AlertRule', 'NotificationPreference']) {
      expect(migration).toContain(`CREATE TABLE public."${table}"`)
      expect(migration).toContain(
        `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`
      )
      expect(migration).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."${table}" TO authenticated`
      )

      for (const operation of ['read', 'insert', 'update', 'delete']) {
        expect(migration).toContain(
          `CREATE POLICY authenticated_${operation}_own_user_data\n  ON public."${table}"`
        )
      }
    }

    expect(migration).toMatch(
      /CONSTRAINT "AlertRule_rule_type_check"\s+CHECK \("rule_type" IN \('temperature', 'precipitation', 'severe'\)\)/
    )
    expect(migration).toMatch(/"push_enabled" BOOLEAN NOT NULL DEFAULT TRUE/)
    expect(
      persistenceMigration.match(/private\.can_manage_self_row\("user_id"\)/g)
    ).toHaveLength(10)
  })
})
