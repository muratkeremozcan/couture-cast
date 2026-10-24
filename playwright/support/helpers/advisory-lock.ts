/**
 * A lock across Playwright workers, held as a Postgres session advisory lock in
 * the test database. Postgres grants a key to one session at a time and drops
 * it when that session's connection closes, so a worker that crashes cannot
 * leave it held and nothing here detects stale holders. Two checkouts share the
 * lock only when they share a database, which is when their tests share data.
 */
import { createHash } from 'node:crypto'
import pg from 'pg'

/** A stable signed 64-bit key for `name`, as Postgres's bigint text. */
export function advisoryLockKey(name: string): string {
  const prefix = createHash('sha256').update(name).digest('hex').slice(0, 16)
  return BigInt.asIntN(64, BigInt(`0x${prefix}`)).toString()
}

/**
 * Waits up to `timeoutMs` for the lock named `name`; resolves with its release.
 * The wait fails with Postgres's lock_not_available error at the deadline.
 */
export async function acquireAdvisoryLock(
  databaseUrl: string,
  name: string,
  { timeoutMs }: { timeoutMs: number }
): Promise<() => Promise<void>> {
  const key = advisoryLockKey(name)
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(`SET lock_timeout = ${Math.max(1, Math.ceil(timeoutMs))}`)
    await client.query('SELECT pg_advisory_lock($1::bigint)', [key])
  } catch (error) {
    await client.end().catch(() => undefined)
    throw error
  }
  return async () => {
    // Closing the session releases the lock whether or not the unlock ran.
    try {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [key])
    } finally {
      await client.end()
    }
  }
}
