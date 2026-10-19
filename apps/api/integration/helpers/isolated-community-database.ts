import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'

/** Global sweeps own a complete migrated database, including their clock and backlog. */
export function isolatedCommunityDatabase() {
  const name = `tea_community_${randomUUID().replaceAll('-', '')}`
  const source = new URL(
    process.env.INTEGRATION_TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  )
  const target = new URL(source)
  target.pathname = `/${name}`
  let created = false

  async function drop() {
    if (!created) return
    const admin = new Client({ connectionString: source.toString() })
    await admin.connect()
    try {
      // Only the UUID-named database this helper created can be dropped.
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      created = false
    } finally {
      await admin.end()
    }
  }

  async function migrate() {
    const admin = new Client({ connectionString: source.toString() })
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
      created = true
    } finally {
      await admin.end()
    }
    const isolated = new Client({ connectionString: target.toString() })
    try {
      await isolated.connect()
      // Same auth.jwt contract and client default grants as pr-checks.yml.
      // Roles are cluster-scoped and are provisioned by the existing test environment.
      await isolated.query(`
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
          SELECT coalesce(
            nullif(current_setting('request.jwt.claim', true), ''),
            nullif(current_setting('request.jwt.claims', true), '')
          )::jsonb
        $fn$;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
      `)
      const directory = resolve(__dirname, '../../../../packages/db/prisma/migrations/')
      const migrations = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
      for (const migration of migrations) {
        await isolated.query(
          await readFile(resolve(directory, migration, 'migration.sql'), 'utf8')
        )
      }
    } catch (error) {
      await isolated.end()
      await drop()
      throw error
    }
    await isolated.end()
  }

  return { url: target.toString(), migrate, drop }
}
