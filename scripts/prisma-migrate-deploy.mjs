/**
 * Prisma migrate wrapper used by local startup commands.
 *
 * Purpose:
 * - Run `prisma migrate deploy` from the repo root.
 * - Load the same root env files that the API startup path expects.
 * - Avoid fragile assumptions about the caller's current working directory.
 *
 * Why this script exists:
 * - `prisma migrate deploy` needs DATABASE_URL and the repo-level schema path.
 * - Some callers start from the repo root, some from script paths, and some via
 *   npm workspace commands. This wrapper normalizes that setup first.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { config as loadEnv } from 'dotenv'
import { applyLocalE2eDatabaseUrl } from './local-e2e-database.mjs'

/**
 * Find the repository root by walking upward until we see the env files that
 * define the local runtime contract.
 *
 * Order matters:
 * 1) start from the current shell cwd,
 * 2) also try the script directory,
 * 3) walk upward until a repo-level env file is found,
 * 4) fall back to the current cwd if no better signal exists.
 *
 * @returns {string}
 */
function findRepoRoot() {
  const searchStarts = [process.cwd(), path.dirname(new URL(import.meta.url).pathname)]

  for (const start of searchStarts) {
    let current = path.resolve(start)

    for (;;) {
      if (
        existsSync(path.join(current, '.env.local')) ||
        existsSync(path.join(current, '.env.preview')) ||
        existsSync(path.join(current, '.env.prod'))
      ) {
        return current
      }

      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  return path.resolve(process.cwd())
}

const repoRoot = findRepoRoot()
const rootEnvFiles = [
  '.env.local',
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.preview',
  '.env',
]
const shouldForceLocalEnv = (process.env.TEST_ENV ?? '').toLowerCase() === 'local'

// Load env files in the same order the local API path expects: the most
// specific repo-level file first, then the environment-specific file, then the
// generic fallback. Local Playwright smoke runs should prefer .env.local over
// inherited remote service URLs from the parent shell.
for (const file of rootEnvFiles) {
  const fullPath = path.join(repoRoot, file)
  if (!existsSync(fullPath)) continue

  loadEnv({
    path: fullPath,
    override: shouldForceLocalEnv && file === '.env.local',
    quiet: true,
  })
}

// A fresh clone and a new git worktree both have no repo-level env file, so a
// local run would otherwise stop here on a missing DATABASE_URL whose value is
// not a secret. Only fills a gap, and only for a local or test run.
if (applyLocalE2eDatabaseUrl(process.env)) {
  console.log(
    `[prisma-migrate-deploy] No DATABASE_URL set; using the local end-to-end default ${process.env.DATABASE_URL}`
  )
}

// Run the deploy-style migration command, which applies committed migrations
// without creating new ones. That is the safe behavior we want in startup flows.
const child = spawn(
  'npx',
  ['prisma', 'migrate', 'deploy', '--schema', 'packages/db/prisma/schema.prisma'],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: true,
  }
)

child.on('exit', (code, signal) => {
  // Mirror the child outcome so callers see the real migration status instead
  // of a wrapper-specific success code.
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
