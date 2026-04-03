// Step 9 env-loading owner: searchable owner anchor
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

function findRepoRoot(): string {
  const searchStarts = [process.cwd(), __dirname]

  for (const start of searchStarts) {
    let current = path.resolve(start)
    let reachedRoot = false

    while (!reachedRoot) {
      if (
        existsSync(path.join(current, '.env.local')) ||
        existsSync(path.join(current, '.env.dev')) ||
        existsSync(path.join(current, '.env.prod'))
      ) {
        return current
      }

      const parent = path.dirname(current)
      if (parent === current) {
        reachedRoot = true
      } else {
        current = parent
      }
    }
  }

  return path.resolve(process.cwd())
}

const rootDir = findRepoRoot()
const rootEnvFiles = [
  '.env.local',
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev',
  '.env',
]
const shouldForceLocalEnv = (process.env.TEST_ENV ?? '').toLowerCase() === 'local'

// Load root env files before AppModule/bootstrap reads process.env.
for (const file of rootEnvFiles) {
  const fullPath = path.join(rootDir, file)
  if (!existsSync(fullPath)) continue

  // Local smoke/test runs should not inherit remote service URLs from the
  // parent shell. When TEST_ENV=local, let .env.local win for keys it defines.
  loadEnv({
    path: fullPath,
    override: shouldForceLocalEnv && file === '.env.local',
    quiet: true,
  })
}
