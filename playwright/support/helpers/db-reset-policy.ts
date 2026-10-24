/**
 * Whether Playwright's global teardown may run `npm run db:reset`.
 *
 * The reset drops and rebuilds the database, so it is opt-in: only
 * `npm run test:pw-local` sets `PLAYWRIGHT_DB_RESET=true`. A raw
 * `npx playwright test` resolves the developer's default local database through
 * the environment loader just the same, and used to reset it; on 2026-10-23 a
 * quick validation run wiped the shared database at 127.0.0.1:54322 that way.
 * CI, non-local targets, a missing or remote DATABASE_URL and
 * `PLAYWRIGHT_SKIP_DB_RESET=true` still skip, whatever the opt-in says.
 */
export interface DatabaseResetDecision {
  reset: boolean
  reason: string
}

export function isLocalDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return [
      '127.0.0.1',
      'localhost',
      '0.0.0.0',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
    ].includes(hostname)
  } catch {
    return false
  }
}

export function databaseResetDecision(
  env: Record<string, string | undefined>
): DatabaseResetDecision {
  if (env.CI) return { reset: false, reason: 'Skipping db:reset in global teardown: CI.' }
  if ((env.TEST_ENV ?? 'local').toLowerCase() !== 'local')
    return {
      reset: false,
      reason: 'Skipping db:reset in global teardown: non-local TEST_ENV.',
    }
  if (env.DATABASE_URL === undefined || !isLocalDatabaseUrl(env.DATABASE_URL))
    return {
      reset: false,
      reason: 'Skipping db:reset in global teardown: DATABASE_URL is missing or remote.',
    }
  if (env.PLAYWRIGHT_SKIP_DB_RESET === 'true')
    return {
      reset: false,
      reason: 'Skipping db:reset in global teardown: PLAYWRIGHT_SKIP_DB_RESET=true.',
    }
  if (env.PLAYWRIGHT_DB_RESET !== 'true')
    return {
      reset: false,
      reason:
        'Skipping db:reset in global teardown: the reset is opt-in. `npm run test:pw-local` ' +
        'sets PLAYWRIGHT_DB_RESET=true; a raw `npx playwright test` leaves the database as it is.',
    }
  return {
    reset: true,
    reason: 'Resetting the local database (PLAYWRIGHT_DB_RESET=true).',
  }
}
