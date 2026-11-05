// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: the database every enforcement proof runs on.
//
// A superuser skips the privilege layer, and `pr-checks` connects as one, so a proof on the suite's
// own database could not fail when the ownership move is missing. This builds a throwaway database
// and migrates it as a login with local Supabase's attributes for `postgres`: not a superuser, able
// to create roles and databases, and holding BYPASSRLS. That login is what the migration treats as
// the application role, and every enforcement statement runs through it.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client } from 'pg'

const run = promisify(execFile)

export const OWNER_ROLE = 'moderation_history_owner'
export const APP_LOGIN = 'moderation_app_probe'
export const NO_BYPASS_LOGIN = 'moderation_app_no_bypass_probe'
const PROBE_PASSWORD = 'moderation-history-probe'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const schemaPath = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url))

export const suiteDatabaseUrl = () =>
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export const urlFor = (
  base: string,
  database: string,
  user?: { name: string; password: string }
) => {
  const url = new URL(base)
  url.pathname = `/${database}`
  if (user) {
    url.username = user.name
    url.password = user.password
  }
  return url.toString()
}

export const appLoginUrl = (database: string, login = APP_LOGIN) =>
  urlFor(suiteDatabaseUrl(), database, { name: login, password: PROBE_PASSWORD })

export async function canReachDatabase(url = suiteDatabaseUrl()): Promise<boolean> {
  const probe = new Client({ connectionString: url, connectionTimeoutMillis: 2000 })
  try {
    await probe.connect()
    return true
  } catch {
    return false
  } finally {
    await probe.end().catch(() => undefined)
  }
}

/** Runs the real `prisma migrate deploy`, as the given login, on a throwaway database. */
export async function migrateAs(url: string): Promise<void> {
  await run(
    'npx',
    ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', schemaPath],
    {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      maxBuffer: 16 * 1024 * 1024,
    }
  )
}

/**
 * The owner path needs `SET ROLE` to the owner, and no login in the cluster may hold that, so it runs
 * as a superuser. Local Supabase's `postgres` is not one, and its `supabase_admin` is.
 */
export async function resolveSuperuserUrl(): Promise<string> {
  const base = suiteDatabaseUrl()
  const candidates = [
    base,
    urlFor(base, new URL(base).pathname.slice(1), {
      name: 'supabase_admin',
      password: new URL(base).password,
    }),
  ]
  for (const candidate of candidates) {
    const client = new Client({
      connectionString: candidate,
      connectionTimeoutMillis: 2000,
    })
    try {
      await client.connect()
      const { rows } = await client.query<{ rolsuper: boolean }>(
        'SELECT rolsuper FROM pg_roles WHERE rolname = current_user'
      )
      if (rows[0]?.rolsuper) return candidate
    } catch {
      // The next candidate decides.
    } finally {
      await client.end().catch(() => undefined)
    }
  }
  throw new Error(
    `Moderation history proofs need a superuser for the owner path, and neither the suite's login nor supabase_admin at ${new URL(base).host} is one.`
  )
}

async function ensureLogin(admin: Client, login: string, attributes: string) {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
    login,
  ])
  await admin.query(
    `${rowCount ? 'ALTER' : 'CREATE'} ROLE ${login} WITH LOGIN PASSWORD '${PROBE_PASSWORD}' ${attributes}`
  )
}

async function ensureClusterRoles(admin: Client) {
  for (const [role, attributes] of [
    ['anon', 'NOLOGIN'],
    ['authenticated', 'NOLOGIN'],
    ['service_role', 'NOLOGIN BYPASSRLS'],
  ] as const) {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
      role,
    ])
    if (!rowCount) await admin.query(`CREATE ROLE ${role} ${attributes}`)
  }
  await ensureLogin(admin, APP_LOGIN, 'NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS')
  await ensureLogin(admin, NO_BYPASS_LOGIN, 'NOSUPERUSER CREATEROLE CREATEDB NOBYPASSRLS')
  // Whoever created the owner role earlier holds ADMIN on it. A second cluster member's migration
  // needs the same to grant itself SET, which is what `CREATEROLE` gives a role's creator.
  const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
    OWNER_ROLE,
  ])
  if (!rowCount) await admin.query(`CREATE ROLE ${OWNER_ROLE} NOLOGIN BYPASSRLS`)
  for (const login of [APP_LOGIN, NO_BYPASS_LOGIN])
    await admin.query(
      `GRANT ${OWNER_ROLE} TO ${login} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`
    )
}

/** Creates an empty database as the login, with what the migrations expect of Supabase. */
export const createEmptyDatabase = (login = APP_LOGIN): Promise<string> =>
  createPreparedDatabase(appLoginUrl('postgres', login), (name) =>
    appLoginUrl(name, login)
  )

/** The same, as the superuser, which is how `pr-checks` migrates. */
export async function createEmptySuperuserDatabase(): Promise<{
  name: string
  url: string
}> {
  const superBase = await resolveSuperuserUrl()
  const name = await createPreparedDatabase(superBase, (database) =>
    urlFor(superBase, database)
  )
  return { name, url: urlFor(superBase, name) }
}

async function createPreparedDatabase(
  maintenanceUrl: string,
  urlOf: (name: string) => string
): Promise<string> {
  const name = `mh_${randomUUID().replaceAll('-', '').slice(0, 24)}`
  const creator = new Client({ connectionString: maintenanceUrl })
  await creator.connect()
  try {
    await creator.query(`CREATE DATABASE ${name} TEMPLATE template0`)
  } finally {
    await creator.end()
  }
  const db = new Client({ connectionString: urlOf(name) })
  await db.connect()
  try {
    await db.query(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $fn$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      -- Supabase's default privileges. Without them a revoke has nothing to remove and proves nothing.
      -- service_role is here too, because D1 revokes it explicitly for this reason.
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
    `)
  } finally {
    await db.end()
  }
  return name
}

export interface HistoryDatabase {
  name: string
  appUrl: string
  superUrl: string
  /** A fresh connection as the application role. */
  app: () => Promise<Client>
  /** A fresh connection as a superuser. */
  superuser: () => Promise<Client>
  /** Runs `work` as the table owner, on a superuser connection that has `SET ROLE` to it. */
  asOwner: <T>(work: (client: Client) => Promise<T>) => Promise<T>
  drop: () => Promise<void>
}

export async function createHistoryDatabase(): Promise<HistoryDatabase> {
  const superBase = await resolveSuperuserUrl()
  const admin = new Client({ connectionString: superBase })
  await admin.connect()
  try {
    await ensureClusterRoles(admin)
  } finally {
    await admin.end()
  }

  await dropAbandonedDatabases(superBase)
  const name = await createEmptyDatabase()
  const appUrl = appLoginUrl(name)
  try {
    await migrateAs(appUrl)
  } catch (error) {
    await dropDatabase(superBase, name)
    throw error
  }

  const superUrl = urlFor(superBase, name)
  const connect = async (url: string) => {
    const client = new Client({ connectionString: url })
    await client.connect()
    return client
  }
  return {
    name,
    appUrl,
    superUrl,
    app: () => connect(appUrl),
    superuser: () => connect(superUrl),
    asOwner: async (work) => {
      const client = await connect(superUrl)
      try {
        await client.query(`SET ROLE ${OWNER_ROLE}`)
        return await work(client)
      } finally {
        await client.end()
      }
    },
    drop: () => dropDatabase(superBase, name),
  }
}

/**
 * A killed run cannot clean up after itself. Age keeps this off a live run's database: the suites in
 * this workspace run one file at a time, and a run takes minutes.
 */
async function dropAbandonedDatabases(superBase: string): Promise<void> {
  const admin = new Client({ connectionString: superBase })
  await admin.connect()
  try {
    const { rows } = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database
       WHERE datname ~ '^mh_[0-9a-f]{24}$'
         AND (pg_stat_file('base/' || oid || '/PG_VERSION')).modification
           < now() - interval '6 hours'`
    )
    for (const { datname } of rows)
      await admin.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}

export async function dropDatabase(superBase: string, name: string): Promise<void> {
  const admin = new Client({ connectionString: superBase })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}

/** The real guard the erasure transaction holds. `privacy_version` stays at its migrated default. */
export const takeGuard = (client: Client, member: string) =>
  client.query('SELECT community_privacy_guards(ARRAY[$1], ARRAY[]::text[], true)', [
    member,
  ])

/** Runs `work` in a transaction that always rolls back, for statements that must leave no trace. */
export async function inRollback<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    return await work()
  } finally {
    await client.query('ROLLBACK').catch(() => undefined)
  }
}

/** The SQLSTATE a statement raised, or `ok`. One savepoint keeps the enclosing transaction usable. */
export async function sqlState(
  client: Client,
  statement: string,
  values: unknown[] = []
): Promise<string> {
  await client.query('SAVEPOINT probe')
  try {
    await client.query(statement, values)
    await client.query('RELEASE SAVEPOINT probe')
    return 'ok'
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe')
    return (error as { code?: string }).code ?? 'unknown'
  }
}
