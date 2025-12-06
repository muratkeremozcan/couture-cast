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

  if (env.CI || !env.DATABASE_URL) {
    console.warn('Skipping db:reset in global teardown (CI or DATABASE_URL missing)')
    return
  }

  let resetError: unknown

  try {
    execSync('npm run db:reset', {
      stdio: 'inherit',
      env,
    })
  } catch (error) {
    console.error(
      'Global teardown failed: Unable to reset the database. Check DATABASE_URL and db:reset script.'
    )
    console.error('Error details:', error)
    resetError = error
  }

  if (resetError) {
    if (resetError instanceof Error) {
      throw resetError
    }
    const serialized = (() => {
      try {
        return JSON.stringify(resetError)
      } catch {
        if (typeof resetError === 'string') return resetError
        return '[unserializable error]'
      }
    })()
    throw new Error(`Global teardown failed: ${serialized}`)
  }
}
