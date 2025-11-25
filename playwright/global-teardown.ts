import { execSync } from 'node:child_process'
import path from 'node:path'

export default async function globalTeardown() {
  const env = { ...process.env }
  // Allow local Postgres path if available (non-fatal if missing)
  const postgresPaths = [
    process.env.POSTGRES_BIN_PATH,
    '/opt/homebrew/opt/postgresql@15/bin',
  ]
  env.PATH = [...postgresPaths, env.PATH].filter(Boolean).join(path.delimiter)

  if (env.CI || !env.DATABASE_URL) {
    console.warn('Skipping db:reset in global teardown (CI or DATABASE_URL missing)')
    return
  }

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
    throw error
  }
}
