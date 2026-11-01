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
 * - The Vercel API build runs it too, so it migrates through DIRECT_URL when
 *   that reaches the same database and retries a pooler that is out of client
 *   slots (`scripts/lib/prisma-migrate-connection.mjs` says why).
 * - A remote migration connection verifies the database certificate against
 *   the committed Supabase CA, as the API runtime does
 *   (`scripts/lib/database-tls.mjs`).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { config as loadEnv } from 'dotenv'
import { applyLocalE2eDatabaseUrl } from './local-e2e-database.mjs'
import { loadEnvKeepingCallerOwned } from './lib/caller-owned-env.mjs'
import { withVerifiedDatabaseTls } from './lib/database-tls.mjs'
import {
  OUTPUT_TAIL_LIMIT,
  poolRetryBaseDelay,
  poolRetryDelays,
  resolveMigrationDatabaseUrl,
  runWithPoolRetry,
} from './lib/prisma-migrate-connection.mjs'

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
// inherited remote service URLs from the parent shell, except for the keys the
// local E2E launcher settled itself (E2E_CALLER_OWNED_ENV_KEYS), such as an
// isolated DATABASE_URL: those are what this run must migrate.
loadEnvKeepingCallerOwned(() => {
  for (const file of rootEnvFiles) {
    const fullPath = path.join(repoRoot, file)
    if (!existsSync(fullPath)) continue

    loadEnv({
      path: fullPath,
      override: shouldForceLocalEnv && file === '.env.local',
      quiet: true,
    })
  }
})

// A fresh clone and a new git worktree both have no repo-level env file, so a
// local run would otherwise stop here on a missing DATABASE_URL whose value is
// not a secret. Only fills a gap, and only for a local or test run.
if (applyLocalE2eDatabaseUrl(process.env)) {
  console.log(
    `[prisma-migrate-deploy] No DATABASE_URL set; using the local end-to-end default ${process.env.DATABASE_URL}`
  )
}

const log = (message) => console.log(`[prisma-migrate-deploy] ${message}`)

/**
 * One `prisma migrate deploy` run. Output still streams to the caller; the
 * tail is kept so a failure can be classified.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, output: string }>}
 */
function runMigrateDeploy(env) {
  return new Promise((resolve, reject) => {
    // Deploy-style migration applies committed migrations without creating new
    // ones, which is the safe behavior startup and build flows want.
    // One command string: Node deprecates (DEP0190) passing args with `shell`.
    const child = spawn(
      'npx prisma migrate deploy --schema packages/db/prisma/schema.prisma',
      { cwd: repoRoot, env, stdio: ['inherit', 'pipe', 'pipe'], shell: true }
    )
    let output = ''
    const keep = (chunk, stream) => {
      stream.write(chunk)
      output = (output + chunk.toString()).slice(-OUTPUT_TAIL_LIMIT)
    }
    child.stdout.on('data', (chunk) => keep(chunk, process.stdout))
    child.stderr.on('data', (chunk) => keep(chunk, process.stderr))
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, output }))
  })
}

try {
  const migration = resolveMigrationDatabaseUrl(process.env)
  if (migration.ignoredDirectUrl)
    log('Ignoring DIRECT_URL: it reaches a different database than DATABASE_URL')
  if (migration.source === 'DIRECT_URL') log('Migrating through DIRECT_URL')
  const url = migration.url ? withVerifiedDatabaseTls(migration.url) : migration.url
  if (url !== migration.url) log('Verifying the database certificate (sslaccept=strict)')
  const env = url === undefined ? process.env : { ...process.env, DATABASE_URL: url }

  const result = await runWithPoolRetry({
    runAttempt: () => runMigrateDeploy(env),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
    delaysMs: poolRetryDelays({ baseMs: poolRetryBaseDelay(process.env) }),
  })

  // Mirror the child outcome so callers see the real migration status instead
  // of a wrapper-specific success code.
  if (result.signal) process.kill(process.pid, result.signal)
  else process.exit(result.code ?? 1)
} catch (error) {
  const named = error instanceof Error ? error : new Error(String(error))
  console.error(`[prisma-migrate-deploy] ${named.name}: ${named.message}`)
  process.exit(1)
}
