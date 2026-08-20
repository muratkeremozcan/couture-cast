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
        existsSync(path.join(current, '.env.preview')) ||
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
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.preview',
  '.env',
]
const shouldForceLocalEnv = (process.env.TEST_ENV ?? '').toLowerCase() === 'local'

// A caller that explicitly sets a var to the empty string (the local E2E
// harness does this for POSTHOG_API_KEY, to keep feature-flag reads on the
// deterministic seeded/cached fallback rather than live PostHog) means it's
// off on purpose. That is a different signal than "unset", and the
// .env.local override below must not treat it as something to fill in:
// .env.local commonly carries a real value for local manual dev, and without
// this guard that value silently wins back over the caller's explicit
// disable, which is what made local Playwright runs diverge from CI (CI has
// no .env.local to begin with, so the disable there was never actually
// exercised).
const explicitlyDisabled = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value === '')
)

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

Object.assign(process.env, explicitlyDisabled)
