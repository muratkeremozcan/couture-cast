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

// Load root env files before AppModule/bootstrap reads process.env.
for (const file of rootEnvFiles) {
  const fullPath = path.join(rootDir, file)
  if (!existsSync(fullPath)) continue

  loadEnv({ path: fullPath, override: false, quiet: true })
}
