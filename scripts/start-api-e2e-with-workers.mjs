import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { config as loadEnv } from 'dotenv'
import { applyLocalE2eDatabaseUrl } from './local-e2e-database.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const startWeb = process.argv.includes('--with-web')
const apiBaseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:4000'
const webBaseUrl = process.env.WEB_E2E_BASE_URL || 'http://127.0.0.1:3005'
const webUrl = new URL(webBaseUrl)

const env = {
  ...process.env,
  NODE_ENV: 'test',
  TEST_ENV: 'local',
  GARMENT_TAGGING_ENGINE: 'fixture',
  // Story 6.1: without this the ADR-013 NSFW model is absent, every post fails
  // closed to `flagged`, and the published path — the story's central
  // acceptance criterion — cannot be exercised at any tier. The fixture clears
  // every image and proves nothing about image safety; it is refused outside a
  // test environment by both the selector and the fixture's own constructor.
  COMMUNITY_NSFW_SCREENER: 'fixture',
  PORT: process.env.PORT || '4000',
  API_BASE_URL: apiBaseUrl,
  HTTP_CORS_ORIGIN: process.env.HTTP_CORS_ORIGIN || webBaseUrl,
  PUBLIC_API_URL: process.env.PUBLIC_API_URL || apiBaseUrl,
}

// Load the same root env files apps/api's own `load-env.ts` loads, into this
// script's `env` rather than `process.env`: every child this orchestrator
// spawns (`db:seed`, the API process, the worker process) gets the identical,
// explicit `DATABASE_URL` this way, instead of each relying on its own
// resolution. That assumption held for the API and worker processes (they
// both import `load-env.ts` at bootstrap) but not for `npm run db:seed`:
// `prisma db seed` has no such loader, so with no `DATABASE_URL` here it fell
// through to Prisma's own default `.env` auto-load, which resolves relative to
// its CWD to `packages/db/.env` -- a second, unrelated local Postgres some
// contributors keep for standalone `prisma studio`/`migrate dev` work, not the
// Supabase-style 127.0.0.1:54322 instance this whole stack runs against. The
// seed step ran, reported success, and silently left the real target database
// on stale fixture data (feature flags included) with nothing in this script's
// own output to suggest why.
const rootEnvFiles = [
  '.env.local',
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.preview',
  '.env',
]
const shouldForceLocalEnv = (env.TEST_ENV ?? '').toLowerCase() === 'local'

// Two things a caller may already have decided must survive the `.env.local`
// override below, both for the same reason: a file default is not allowed to
// second-guess a deliberate, already-made choice.
//
// `POSTHOG_API_KEY: ''` is a deliberate disable, mirroring the same guard
// `load-env.ts` needs: `.env.local` commonly carries a real key for local
// manual dev, and the override would otherwise silently win back over this
// run's explicit choice to keep feature-flag reads on the deterministic
// seeded/cached fallback rather than live PostHog.
//
// A non-empty `DATABASE_URL` a caller already set is the same class of
// problem for the opposite reason: `applyLocalE2eDatabaseUrl` below documents
// "an explicit DATABASE_URL always wins", and before this env-loading block
// existed that was true by construction (nothing here touched it). The
// override would otherwise silently break that contract whenever `.env.local`
// also defines one, which it normally does.
const explicitlyDisabled = Object.fromEntries(
  Object.entries(env).filter(([, value]) => value === '')
)
const callerDatabaseUrl = env.DATABASE_URL

for (const file of rootEnvFiles) {
  const fullPath = path.join(repoRoot, file)
  if (!existsSync(fullPath)) continue

  loadEnv({
    path: fullPath,
    override: shouldForceLocalEnv && file === '.env.local',
    processEnv: env,
    quiet: true,
  })
}

Object.assign(env, explicitlyDisabled)
if (callerDatabaseUrl) {
  env.DATABASE_URL = callerDatabaseUrl
}

// A fresh clone or a new git worktree has no repo-level env file yet, so the
// loop above fills nothing in. Only then does the local default apply, same
// gap-filler role `prisma-migrate-deploy.mjs` gives it. An explicit
// `DATABASE_URL`, as CI supplies, still always wins: `applyLocalE2eDatabaseUrl`
// declines whenever one is already set.
if (applyLocalE2eDatabaseUrl(env, { repoRootToScan: repoRoot })) {
  console.log(
    `[start-api-e2e-with-workers] No DATABASE_URL set; using the local end-to-end default ${env.DATABASE_URL}`
  )
}

const processes = []
let shuttingDown = false

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    child.once('exit', resolve)
    child.once('error', resolve)
  })
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const proc of processes) {
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGTERM')
    }
  }
  await Promise.race([
    Promise.all(processes.map(waitForExit)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  const remaining = processes.filter(
    (proc) => proc.exitCode === null && proc.signalCode === null
  )
  for (const proc of remaining) proc.kill('SIGKILL')
  await Promise.all(remaining.map(waitForExit))
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void shutdown(0))
}

async function runPreparation(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${exitCode}`)
  }
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`Timed out waiting for ${url}`, { cause: lastError })
}

function startManagedProcess(command, args, processEnv = env, cwd = repoRoot, readyText) {
  const child = spawn(command, args, {
    cwd,
    env: processEnv,
    stdio: readyText ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  })
  let resolveReady
  let rejectReady
  let readinessObserved = !readyText
  let readinessOutput = ''
  let readinessTimer
  const ready = readyText
    ? new Promise((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
        readinessTimer = setTimeout(
          () =>
            reject(new Error(`Timed out waiting for process readiness: ${readyText}`)),
          60_000
        )
      })
    : Promise.resolve()
  const forwardOutput = (stream, destination) => {
    stream?.on('data', (chunk) => {
      destination.write(chunk)
      readinessOutput = `${readinessOutput}${chunk.toString()}`.slice(-4096)
      if (readyText && readinessOutput.includes(readyText)) {
        readinessObserved = true
        clearTimeout(readinessTimer)
        resolveReady?.()
      }
    })
  }
  forwardOutput(child.stdout, process.stdout)
  forwardOutput(child.stderr, process.stderr)
  child.once('error', (error) => {
    clearTimeout(readinessTimer)
    rejectReady?.(error)
    console.error(`[start-api-e2e-with-workers] Failed to spawn ${command}:`, error)
    void shutdown(1)
  })
  child.once('exit', (code) => {
    if (readyText && !readinessObserved) {
      clearTimeout(readinessTimer)
      rejectReady?.(new Error(`${command} exited before readiness with code ${code}`))
    }
  })
  processes.push(child)
  return { child, ready }
}

async function isUrlHealthy(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function main() {
  console.log('[start-api-e2e-with-workers] Preparing database and application builds...')
  const reuseExistingWeb =
    startWeb &&
    process.env.REUSE_EXISTING_WEB_SERVER === 'true' &&
    (await isUrlHealthy(webBaseUrl))
  await runPreparation('npm', ['run', 'db:generate'])
  await runPreparation('node', ['scripts/prisma-migrate-deploy.mjs'])

  /*
   * Migrations create the schema and no rows, so a database that has never been
   * seeded starts this stack perfectly and then fails any spec that reads a
   * fixture. Story 5.1's affiliate specs are the sharp example: the sample
   * partner catalog and the `commerce_affiliate_enabled` flag row only exist
   * after a seed, and without them the suite reports "no offer was eligible",
   * which reads as a product bug rather than an empty table.
   *
   * Safe to run every time, and safe to run against a database someone else is
   * using: every seed in `packages/db/prisma/seeds` is an upsert and none of
   * them delete. This is emphatically NOT `db:reset`, which drops the database
   * and is reserved for the Playwright teardown and for CI.
   */
  if (process.env.SKIP_E2E_SEED === 'true') {
    console.log(
      '[start-api-e2e-with-workers] SKIP_E2E_SEED=true; leaving fixture data as it is.'
    )
  } else {
    console.log('[start-api-e2e-with-workers] Applying idempotent seed fixtures...')
    await runPreparation('npm', ['run', 'db:seed'])
  }
  if (startWeb) {
    if (process.env.PLAYWRIGHT_SHARED_DEPS_PREPARED !== 'true') {
      await runPreparation('npm', ['run', 'prepare:playwright'])
    }
    await runPreparation('npm', ['run', 'build:e2e', '--workspace', 'api'])
    if (!reuseExistingWeb) {
      await runPreparation('npm', ['run', 'build:e2e', '--workspace', 'web'])
    }
  } else {
    await runPreparation('npm', ['run', 'build', '--workspace', 'api'])
  }

  console.log(
    '[start-api-e2e-with-workers] Starting API, Wardrobe Worker and Community Worker in E2E fixture mode...'
  )

  const { child: apiProcess } = startManagedProcess('node', ['apps/api/dist/src/main.js'])

  const { child: workerProcess, ready: workerReady } = startManagedProcess(
    'node',
    ['apps/api/dist/src/workers/wardrobe.bootstrap.js'],
    env,
    repoRoot,
    'Dedicated wardrobe worker started'
  )

  /*
   * Story 6.1: without this process nothing consumes `community-moderation`, so
   * a post published through the real API sits at `pending_review` forever and
   * the community loop cannot be exercised end to end — by a Playwright spec or
   * by anyone running the app locally.
   *
   * `community.bootstrap.js` rather than `bootstrap.js`, which also runs the
   * community pipeline in production: that process starts weather ingestion and
   * registers its refresh scheduler, so booting it here would make live calls to
   * a weather provider on a timer from a test stack. The two share one
   * composition (`createCommunityWorkerRuntime`) so they cannot drift, and they
   * subscribe to disjoint queue names so neither steals the other's jobs.
   */
  const { child: communityWorkerProcess, ready: communityWorkerReady } =
    startManagedProcess(
      'node',
      ['apps/api/dist/src/workers/community.bootstrap.js'],
      env,
      repoRoot,
      'Dedicated community worker started'
    )

  apiProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[start-api-e2e-with-workers] API process exited with code ${code}`)
      void shutdown(code ?? 1)
    }
  })

  workerProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(
        `[start-api-e2e-with-workers] Wardrobe worker process exited with code ${code}`
      )
      void shutdown(code ?? 1)
    }
  })

  communityWorkerProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(
        `[start-api-e2e-with-workers] Community worker process exited with code ${code}`
      )
      void shutdown(code ?? 1)
    }
  })

  // Awaited on both paths, not just the web one: an unawaited readiness promise
  // that rejects on its own timeout is an unhandled rejection, and a stack that
  // reports itself up before its workers are consuming is how a spec ends up
  // waiting on a post that nothing is screening.
  await Promise.all([
    waitForUrl(new URL('/api/health', apiBaseUrl).toString(), 30_000),
    workerReady,
    communityWorkerReady,
  ])

  if (startWeb) {
    if (reuseExistingWeb) {
      console.log(
        `[start-api-e2e-with-workers] Reusing existing Web server at ${webBaseUrl}`
      )
      return
    }
    const { child: webProcess } = startManagedProcess(
      'node',
      [
        path.join(repoRoot, 'node_modules/next/dist/bin/next'),
        'start',
        '--hostname',
        webUrl.hostname,
        '--port',
        webUrl.port || '3005',
      ],
      {
        ...env,
        API_BASE_URL: apiBaseUrl,
        POSTHOG_API_KEY: process.env.POSTHOG_API_KEY || '',
      },
      path.join(repoRoot, 'apps/web')
    )

    webProcess.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(`[start-api-e2e-with-workers] Web process exited with code ${code}`)
        void shutdown(code ?? 1)
      }
    })
  }
}

void main().catch((error) => {
  console.error('[start-api-e2e-with-workers] Startup failed:', error)
  void shutdown(1)
})
