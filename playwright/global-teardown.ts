import { execSync } from 'node:child_process'
import path from 'node:path'

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

  if (env.CI || !env.DATABASE_URL || env.PLAYWRIGHT_SKIP_DB_RESET === 'true') {
    console.warn(
      'Skipping db:reset in global teardown (CI, DATABASE_URL missing, or PLAYWRIGHT_SKIP_DB_RESET=true)'
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
