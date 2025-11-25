import { execSync } from 'node:child_process'
import path from 'node:path'

export default async function globalTeardown() {
  const env = { ...process.env }
  // Allow local Postgres path if available (non-fatal if missing)
  env.PATH = ['/opt/homebrew/opt/postgresql@15/bin', env.PATH]
    .filter(Boolean)
    .join(path.delimiter)

  execSync('npm run db:reset', {
    stdio: 'inherit',
    env,
  })
}
