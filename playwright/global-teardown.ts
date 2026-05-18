import { execSync } from 'node:child_process'
import path from 'node:path'

function isLocalDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['127.0.0.1', 'localhost', '0.0.0.0'].includes(url.hostname)
  } catch {
    return false
  }
}

export default function globalTeardown() {
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
