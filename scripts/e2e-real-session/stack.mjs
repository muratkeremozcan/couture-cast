/**
 * The parts of an owned real-session stack that the web lane (`run.mjs`) and the Google device
 * lane (`scripts/run-google-native.mjs`) share: the local Supabase it may use, the caller's own
 * Redis, the UUID-named isolated database and readiness polling.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'
import {
  ISOLATED_DATABASE_NAME,
  isLoopbackHost,
  isolatedDatabaseName,
  isolatedDatabaseUrl,
} from './harness.mjs'

// Same contract and client default grants as pr-checks.yml and
// apps/api/integration/helpers/isolated-community-database.ts. Eight RLS policies
// call auth.jwt(), which only the Supabase `postgres` database defines, so a new
// database needs it before `prisma migrate deploy` can apply them. Roles are
// cluster-scoped and already exist in the local Supabase Postgres.
const AUTH_BOOTSTRAP_SQL = `
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
`

/**
 * The URL and keys of the local Supabase; CI's start-local-supabase exports them.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} repoRoot where `supabase status` runs
 */
export function resolveSupabase(env, repoRoot) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  const resolved = Object.fromEntries(keys.map((key) => [key, env[key]?.trim() ?? '']))
  if (keys.some((key) => !resolved[key])) {
    let status
    try {
      status = JSON.parse(
        execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      )
    } catch {
      throw new Error(
        'Local Supabase is not running. Start it with `npm run supabase:start` (Mailpit included) or export SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.'
      )
    }
    resolved.SUPABASE_URL ||= status.API_URL ?? ''
    resolved.SUPABASE_ANON_KEY ||= status.ANON_KEY ?? ''
    resolved.SUPABASE_SERVICE_ROLE_KEY ||= status.SERVICE_ROLE_KEY ?? ''
  }
  if (keys.some((key) => !resolved[key]))
    throw new Error('The local Supabase URL or keys could not be resolved.')
  if (!isLoopbackHost(new URL(resolved.SUPABASE_URL).hostname))
    throw new Error(
      'SUPABASE_URL must point at the local Supabase. Unset the remote value in this shell.'
    )
  return resolved
}

export function resolveRedisUrl(env) {
  const value = env.REDIS_URL?.trim()
  if (!value)
    throw new Error(
      'Set REDIS_URL to a Redis this run owns, for example `docker run -d --rm --name real-session-redis -p 127.0.0.1:6390:6379 redis:7-alpine` and REDIS_URL=redis://127.0.0.1:6390. Sharing the development Redis would let another stack consume the queues of this run.'
    )
  if (!isLoopbackHost(new URL(value).hostname))
    throw new Error('REDIS_URL must point at a Redis on this machine.')
  return value
}

/**
 * Reserves the database's name before creating it, so a teardown that starts
 * while CREATE DATABASE is in flight still knows what to drop.
 *
 * @param {string} sourceUrl
 * @param {(database: { name: string; url: string }) => void} reserve
 */
export async function createIsolatedDatabase(sourceUrl, reserve) {
  const name = isolatedDatabaseName()
  const url = isolatedDatabaseUrl(sourceUrl, name)
  reserve({ name, url })
  const admin = new pg.Client({ connectionString: sourceUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
  } finally {
    await admin.end()
  }
  const isolated = new pg.Client({ connectionString: url })
  await isolated.connect()
  try {
    await isolated.query(AUTH_BOOTSTRAP_SQL)
  } finally {
    await isolated.end()
  }
  return { name, url }
}

export async function dropIsolatedDatabase(sourceUrl, name) {
  // Only the UUID-named database this run created can be dropped.
  if (!ISOLATED_DATABASE_NAME.test(name)) throw new Error('Refusing to drop ' + name)
  const admin = new pg.Client({ connectionString: sourceUrl })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}

/**
 * Polls `url` until it answers 200, the process behind it exits, the deadline
 * passes, or teardown begins (`assertRunning` throws).
 */
export async function waitForHealthy(url, handle, timeoutMs, readLog, assertRunning) {
  const deadline = Date.now() + timeoutMs
  let early
  void handle.exited.then((result) => (early = result))
  while (Date.now() < deadline) {
    assertRunning()
    if (early)
      throw new Error(
        `${handle.name} exited (${early.code ?? early.signal}) before ${url} answered.\n${readLog()}`
      )
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(5_000) })).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(
    `Timed out after ${timeoutMs / 1000}s waiting for ${url}.\n${readLog()}`
  )
}

export function tail(file, lines = 60) {
  if (!fs.existsSync(file)) return ''
  return fs.readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
}
