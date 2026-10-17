import { execSync } from 'node:child_process'
import path from 'node:path'
import {
  e2eStackLauncherPath,
  e2eStackRecordPath,
  stopE2eStack,
} from '../scripts/e2e-stack-pid.mjs'
import { resolveEnvironmentConfig } from './config/environments'

function isLocalDatabaseUrl(value: string): boolean {
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

/**
 * Playwright stops its web server only after this teardown returns, so the E2E
 * stack's workers would still be polling tables that db:reset drops, and log
 * false `community_sweep_failed` errors. Stop the stack first; its SIGTERM
 * handler shuts its children down gracefully.
 *
 * Only this run's stack: the record is keyed by this checkout and the web port
 * the launcher served, and the pid is signalled only while the live process has
 * the OS start time the launcher recorded and this checkout's absolute launcher
 * path on its command line, so a stale record whose pid was reused, even by
 * another checkout's launcher, stops nothing.
 */
async function stopThisRunsE2eStack(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..')
  const webPort = new URL(resolveEnvironmentConfig('local').webBaseUrl).port || '3005'
  const outcome = await stopE2eStack(e2eStackRecordPath(repoRoot, webPort), {
    expectedLauncherPath: e2eStackLauncherPath(repoRoot),
  })
  if (outcome !== 'stopped' && outcome !== 'no-record') {
    console.warn(`E2E stack teardown signalled nothing: ${outcome}`)
  }
}

export default async function globalTeardown() {
  const env = { ...process.env }
  // Allow local Postgres path if available (non-fatal if missing)
  const postgresPaths = [
    process.env.POSTGRES_BIN_PATH,
    '/opt/homebrew/opt/postgresql@15/bin',
  ]
  const existingPath = env.PATH || ''
  env.PATH = [...postgresPaths.filter(Boolean), existingPath]
    .filter(Boolean)
    .join(path.delimiter)

  const testEnv = (env.TEST_ENV ?? 'local').toLowerCase()
  const shouldResetDatabase =
    testEnv === 'local' &&
    env.DATABASE_URL !== undefined &&
    isLocalDatabaseUrl(env.DATABASE_URL) &&
    env.PLAYWRIGHT_SKIP_DB_RESET !== 'true'

  if (env.CI || !shouldResetDatabase) {
    console.warn(
      'Skipping db:reset in global teardown (CI, non-local TEST_ENV, remote/missing DATABASE_URL, or PLAYWRIGHT_SKIP_DB_RESET=true)'
    )
    return
  }

  await stopThisRunsE2eStack()

  try {
    execSync('npm run db:reset', {
      stdio: 'pipe',
      env,
    })
  } catch (error) {
    const details = (() => {
      if (!(error instanceof Error)) {
        return String(error)
      }

      const maybeStdout = 'stdout' in error ? error.stdout : undefined
      const maybeStderr = 'stderr' in error ? error.stderr : undefined
      const stdout =
        typeof maybeStdout === 'string'
          ? maybeStdout
          : Buffer.isBuffer(maybeStdout)
            ? maybeStdout.toString()
            : ''
      const stderr =
        typeof maybeStderr === 'string'
          ? maybeStderr
          : Buffer.isBuffer(maybeStderr)
            ? maybeStderr.toString()
            : ''

      return `${error.message}\n${stdout}\n${stderr}`
    })()

    const isDatabaseUnavailable =
      details.includes('P1001') || details.includes('reach database server')
    if (isDatabaseUnavailable) {
      console.warn(
        'Skipping db:reset in global teardown because the database is unreachable.'
      )
      return
    }

    console.error(
      'Global teardown failed: Unable to reset the database. Check DATABASE_URL and db:reset script.'
    )
    console.error('Error details:', details)
    throw error
  }
}
