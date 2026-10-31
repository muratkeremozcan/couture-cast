/**
 * How `scripts/prisma-migrate-deploy.mjs` connects for `prisma migrate deploy`.
 *
 * Production runs migrations inside the Vercel API build while the previous
 * deployment's functions still hold their Prisma pools. On Supabase's session
 * pooler (port 5432) every client holds one of `pool_size` server slots, so a
 * build can find all of them taken and fail with
 * `(EMAXCONNSESSION) max clients reached in session mode`.
 *
 * Supabase's guidance for Prisma on serverless splits the two paths: the
 * runtime uses the transaction pooler (port 6543, `pgbouncer=true`, a small
 * `connection_limit`) and migrations use a session or direct URL, which Prisma
 * needs for advisory locks and prepared statements. This module picks the
 * migration URL (`DIRECT_URL` when it reaches the same database, otherwise
 * `DATABASE_URL`), refuses a transaction-mode URL, and retries the transient
 * pool-exhaustion failure a bounded number of times.
 *
 * Why not `directUrl = env("DIRECT_URL")` in schema.prisma: Prisma 6.19 then
 * rejects every CLI command run without DIRECT_URL (P1012 "Environment
 * variable not found: DIRECT_URL"), including the local `migrate reset`,
 * `migrate dev`, `studio` and the CI migrate step. Production migrations only
 * ever run through this wrapper, so the choice lives here.
 */

/** Attempts in all, the first included. */
export const POOL_RETRY_ATTEMPTS = 8
/** First wait; each later wait doubles, up to POOL_RETRY_MAX_DELAY_MS. */
export const POOL_RETRY_BASE_DELAY_MS = 10_000
export const POOL_RETRY_MAX_DELAY_MS = 60_000
/** Keep this much of the child's output to classify a failure. */
export const OUTPUT_TAIL_LIMIT = 64 * 1024

/**
 * Supavisor's session-mode cap (EMAXCONNSESSION, and EMAXCONN for its other
 * client caps) and Postgres's own max_connections refusals. All of them are
 * refused at connect time, before `migrate deploy` applies anything, so a new
 * attempt starts from the same state.
 */
const POOL_EXHAUSTION_PATTERNS = [
  /\bEMAXCONN\w*/,
  /max clients reached/i,
  /too many clients already/i,
  /remaining connection slots are reserved/i,
]

/** @param {string} output */
export function isPoolExhaustionOutput(output) {
  return POOL_EXHAUSTION_PATTERNS.some((pattern) => pattern.test(output))
}

/**
 * The waits between attempts: base, doubled each time, capped.
 *
 * @param {{ attempts?: number, baseMs?: number, maxMs?: number }} [options]
 * @returns {number[]}
 */
export function poolRetryDelays({
  attempts = POOL_RETRY_ATTEMPTS,
  baseMs = POOL_RETRY_BASE_DELAY_MS,
  maxMs = POOL_RETRY_MAX_DELAY_MS,
} = {}) {
  return Array.from({ length: attempts - 1 }, (_, index) =>
    Math.min(maxMs, baseMs * 2 ** index)
  )
}

/**
 * `PRISMA_MIGRATE_POOL_RETRY_BASE_MS` shortens or lengthens the first wait; a
 * missing or malformed value keeps the default.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function poolRetryBaseDelay(env) {
  const raw = env.PRISMA_MIGRATE_POOL_RETRY_BASE_MS
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return POOL_RETRY_BASE_DELAY_MS
  return Math.max(1, Number(raw.trim()))
}

/** Thrown after the last attempt still met an exhausted pool. */
export class PrismaMigratePoolExhaustedError extends Error {
  /** @param {number} attempts */
  constructor(attempts) {
    super(
      `prisma migrate deploy could not get a database connection after ${attempts} attempts: ` +
        'the pooler reported its client limit reached every time. Point DIRECT_URL at a ' +
        'session or direct connection and keep the runtime DATABASE_URL on the transaction ' +
        'pooler (port 6543, pgbouncer=true, connection_limit) so running functions stop ' +
        'holding the session slots migrations need.'
    )
    this.name = 'PrismaMigratePoolExhaustedError'
    this.attempts = attempts
  }
}

/** Thrown when the only URL available for migrations is in transaction mode. */
export class PrismaMigrateTransactionPoolerError extends Error {
  /** @param {string} source */
  constructor(source) {
    super(
      `${source} points at a transaction-mode pooler (port 6543 or pgbouncer=true), which ` +
        'cannot run prisma migrate deploy. Set DIRECT_URL to the session pooler (port 5432) ' +
        'or a direct connection for the same database.'
    )
    this.name = 'PrismaMigrateTransactionPoolerError'
    this.source = source
  }
}

/** @param {string | undefined} value */
function parseUrl(value) {
  if (!value) return undefined
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/**
 * Which database a URL reaches, whichever route it takes. Supabase's direct
 * host carries the project ref in the hostname and its poolers carry it in the
 * user name (`postgres.<ref>`), so both routes to one project compare equal.
 *
 * @param {URL} url
 */
export function databaseIdentity(url) {
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname)
  if (direct) return `supabase:${direct[1].toLowerCase()}/${database}`
  if (/\.pooler\.supabase\.com$/i.test(url.hostname)) {
    const ref = decodeURIComponent(url.username).split('.').slice(1).join('.')
    if (ref) return `supabase:${ref.toLowerCase()}/${database}`
  }
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}/${database}`
}

/** @param {URL} url */
export function isTransactionPoolerUrl(url) {
  if ((url.searchParams.get('pgbouncer') ?? '').toLowerCase() === 'true') return true
  return /\.pooler\.supabase\.com$/i.test(url.hostname) && url.port === '6543'
}

/**
 * The URL `prisma migrate deploy` should use.
 *
 * DIRECT_URL wins only when it reaches the same database as DATABASE_URL. The
 * wrapper loads `.env.preview` or `.env.prod` under `.env.local`, so a
 * DIRECT_URL mirrored into those files would otherwise send a local run's
 * migrations to a remote database while DATABASE_URL still says local.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ url: string | undefined, source: 'DIRECT_URL' | 'DATABASE_URL', ignoredDirectUrl: boolean }}
 */
export function resolveMigrationDatabaseUrl(env) {
  const runtime = parseUrl(env.DATABASE_URL)
  const direct = parseUrl(env.DIRECT_URL)
  let source = /** @type {'DIRECT_URL' | 'DATABASE_URL'} */ ('DATABASE_URL')
  let ignoredDirectUrl = false

  if (direct && (!runtime || databaseIdentity(direct) === databaseIdentity(runtime))) {
    source = 'DIRECT_URL'
  } else if (env.DIRECT_URL) {
    ignoredDirectUrl = true
  }

  const url = source === 'DIRECT_URL' ? env.DIRECT_URL : env.DATABASE_URL
  const parsed = source === 'DIRECT_URL' ? direct : runtime
  if (parsed && isTransactionPoolerUrl(parsed))
    throw new PrismaMigrateTransactionPoolerError(source)
  return { url, source, ignoredDirectUrl }
}

/**
 * Runs `runAttempt` until it succeeds, fails for another reason, or the pool
 * stays exhausted through the last attempt. Only a pool-exhaustion failure is
 * retried; any other failure, and a child stopped by a signal, comes back as is.
 *
 * @param {{
 *   runAttempt: (attempt: number) => Promise<{ code: number | null, signal: NodeJS.Signals | null, output: string }>,
 *   sleep: (ms: number) => Promise<void>,
 *   log: (message: string) => void,
 *   delaysMs?: number[],
 * }} options
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, attempts: number }>}
 */
export async function runWithPoolRetry({
  runAttempt,
  sleep,
  log,
  delaysMs = poolRetryDelays(),
}) {
  const attempts = delaysMs.length + 1
  for (let attempt = 1; ; attempt++) {
    const result = await runAttempt(attempt)
    if (result.signal || result.code === 0 || !isPoolExhaustionOutput(result.output))
      return { code: result.code, signal: result.signal, attempts: attempt }
    if (attempt >= attempts) throw new PrismaMigratePoolExhaustedError(attempts)
    const wait = delaysMs[attempt - 1]
    log(
      `Database pool exhausted on attempt ${attempt}/${attempts}; retrying in ${wait}ms`
    )
    await sleep(wait)
  }
}
