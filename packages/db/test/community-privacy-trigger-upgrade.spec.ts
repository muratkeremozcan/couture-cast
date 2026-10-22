import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, cp, readdir, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { Client } from 'pg'
import { expect, it } from 'vitest'

const execute = promisify(execFile)
const root = resolve(__dirname, '../../..')
const prisma = resolve(__dirname, '../prisma')
const original = '20261020120000_community_realtime'
const checksum = 'fd7c27d7d59a34295146410252338e500ac3f37e20220b0d4c71363ff946c081'

it.each(['fresh', 'already-applied'] as const)(
  'preserves applied realtime checksum and upgrades trigger rights on %s UUID database',
  async (mode) => {
    const name = `tea_community_${randomUUID().replaceAll('-', '')}`
    const source =
      process.env.RLS_TEST_DATABASE_URL ??
      process.env.INTEGRATION_TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    const url = new URL(source)
    url.pathname = `/${name}`
    const admin = new Client({ connectionString: source })
    const folder = await mkdtemp(join(tmpdir(), 'cc65-migration-upgrade-'))
    const db = new Client({ connectionString: url.toString() })
    let created = false
    try {
      await admin.connect()
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
      created = true
      await db.connect()
      await db.query(
        'CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$ SELECT jsonb_build_object() $fn$; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;'
      )
      const bytes = await readFile(join(prisma, 'migrations', original, 'migration.sql'))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(checksum)
      await cp(join(prisma, 'schema.prisma'), join(folder, 'schema.prisma'))
      await mkdir(join(folder, 'migrations'))
      await cp(
        join(prisma, 'migrations/migration_lock.toml'),
        join(folder, 'migrations/migration_lock.toml')
      )
      const migrations = (
        await readdir(join(prisma, 'migrations'), { withFileTypes: true })
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
      const copy = async (names: string[]) => {
        for (const migration of names)
          await cp(
            join(prisma, 'migrations', migration),
            join(folder, 'migrations', migration),
            { recursive: true }
          )
      }
      const deploy = () =>
        execute(
          process.execPath,
          [
            join(root, 'node_modules/prisma/build/index.js'),
            'migrate',
            'deploy',
            '--schema',
            join(folder, 'schema.prisma'),
          ],
          { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() } }
        )
      // The upgrade replaces the two guard functions in place. Same trigger and
      // function OIDs prove the triggers still fire the upgraded bodies rather
      // than dangling or being recreated.
      const bindings = async () =>
        (
          await db.query<{
            trigger: string
            table: string
            fn: string
            enabled: string
            triggerOid: string
            fnOid: string
          }>(
            `SELECT t.tgname AS trigger, c.relname AS table, p.proname AS fn,
                    t.tgenabled AS enabled, t.oid::text AS "triggerOid", p.oid::text AS "fnOid"
               FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE NOT t.tgisinternal
                AND p.proname IN ('community_privacy_assert_token','community_privacy_assert_policy')
              ORDER BY t.tgname`
          )
        ).rows
      const expectGuardBindings = (rows: Awaited<ReturnType<typeof bindings>>) =>
        expect(
          rows.map(({ trigger, table, fn, enabled }) => ({ trigger, table, fn, enabled }))
        ).toEqual([
          {
            trigger: 'community_account_policy_privacy_entry',
            table: 'NotificationPreference',
            fn: 'community_privacy_assert_policy',
            enabled: 'O',
          },
          {
            trigger: 'community_optin_privacy_entry',
            table: 'CommunityNotificationPreference',
            fn: 'community_privacy_assert_policy',
            enabled: 'O',
          },
          {
            trigger: 'community_token_privacy_entry',
            table: 'PushToken',
            fn: 'community_privacy_assert_token',
            enabled: 'O',
          },
        ])
      let priorBindings: Awaited<ReturnType<typeof bindings>> | undefined
      if (mode === 'already-applied') {
        await copy(migrations.filter((name) => name <= original))
        await deploy()
        priorBindings = await bindings()
        expectGuardBindings(priorBindings)
        const prior = await db.query<{ prosecdef: boolean }>(
          "SELECT prosecdef FROM pg_proc WHERE proname IN ('community_privacy_assert_token','community_privacy_assert_policy')"
        )
        expect(prior.rows).toEqual([{ prosecdef: false }, { prosecdef: false }])
        const history = await db.query(
          'SELECT checksum FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL',
          [original]
        )
        expect(history.rows).toEqual([{ checksum }])
        await copy(migrations.filter((name) => name > original))
      } else await copy(migrations)
      await deploy()
      const history = await db.query(
        'SELECT checksum FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL',
        [original]
      )
      expect(history.rows).toEqual([{ checksum }])
      const functions = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
        "SELECT prosecdef,proconfig FROM pg_proc WHERE proname IN ('community_privacy_assert_token','community_privacy_assert_policy')"
      )
      expect(functions.rows).toEqual(
        Array.from({ length: 2 }, () => ({
          prosecdef: true,
          proconfig: ['search_path=pg_catalog, public, pg_temp'],
        }))
      )
      const acl = await db.query<{ allowed: boolean }>(
        "SELECT has_function_privilege('authenticated',oid,'EXECUTE') AS allowed FROM pg_proc WHERE proname IN ('community_require_guard','community_has_exclusive_guard')"
      )
      expect(acl.rows).toEqual([{ allowed: false }, { allowed: false }])
      const upgraded = await bindings()
      expectGuardBindings(upgraded)
      if (priorBindings) expect(upgraded).toEqual(priorBindings)
      // Reapplying is a no-op and keeps both migration history and trigger bindings intact.
      await deploy()
      expect(await bindings()).toEqual(upgraded)
      const pending = await db.query(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL'
      )
      expect(pending.rows).toEqual([])
    } finally {
      await db.end()
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
      await admin.end()
      await rm(folder, { recursive: true, force: true })
    }
  },
  30_000
)
