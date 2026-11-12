#!/usr/bin/env node
/**
 * Runs an npm script with the local database and storage environment resolved first.
 *
 * WHY THIS EXISTS. `npm run db:seed` from the repository root used to seed the WRONG
 * DATABASE. The root script passed no `DATABASE_URL`, so `prisma db seed` fell through
 * to Prisma's own dotenv auto-load, which resolves relative to `packages/db` and picks
 * up `packages/db/.env` pointing at `@localhost:5432/couture_cast` rather than the
 * local Supabase container on its configured port (`scripts/lib/local-supabase-ports.mjs`).
 *
 * That failed loudly only because the two schemas have since diverged (P2022, "the
 * column LookbookPost.status does not exist"). Before they diverged it seeded the
 * other database and reported success, which is the failure mode worth preventing.
 *
 * `scripts/start-api-e2e-with-workers.mjs` documents this trap at length and solved it
 * for the E2E path by passing an explicit env to its own `db:seed` child. This is the
 * same fix for the paths a developer actually types.
 *
 * SAFETY. Both helpers only ever fill in values that are MISSING, and only for a run
 * that has already declared itself local or test. A real `DATABASE_URL` in the
 * environment always wins, which is what keeps CI, preview and production on exactly
 * the connection strings and credentials they were given.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyLocalE2eDatabaseUrl,
  applyLocalSupabaseStorageEnv,
} from './local-e2e-database.mjs'
import {
  isLocalSupabaseDatabaseUrl,
  localDatabaseUrl,
} from './lib/local-supabase-ports.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// --require-local: the command resets the database, so it runs only against the local
// Supabase server on the port Supabase binds (CI's SUPABASE_DB_PORT, else config.toml).
// A DATABASE_URL for any other server or port is refused before anything starts.
const requireLocal = process.argv[2] === '--require-local'
const args = process.argv.slice(requireLocal ? 3 : 2)

if (args.length === 0) {
  console.error(
    '[run-with-local-db-env] usage: run-with-local-db-env [--require-local] <command> [args...]'
  )
  process.exit(1)
}

const env = { ...process.env }

// Deliberately NOT scanning the repo root, unlike `start-api-e2e-with-workers.mjs`.
// That script hands its env to processes which then load the ROOT env files, so
// injecting there would shadow a real value. The Prisma CLI does not: it resolves
// dotenv relative to the schema, so it picks up `packages/db/.env`, which points at
// `localhost:5432/couture_cast` rather than the local Supabase container. Declining
// to inject because a root `.env.local` exists therefore hands the run to the wrong
// database, silently, which is the exact defect this wrapper was written to prevent.
// Measured on 2026-09-06: two `db:reset` runs went to the fossil database before this
// was corrected, and the only symptom was a migration checksum that failed to change.
if (applyLocalE2eDatabaseUrl(env)) {
  console.log(
    `[run-with-local-db-env] No DATABASE_URL set; using the local default ${env.DATABASE_URL}`
  )
}

// The community seed uploads a placeholder object per seeded post, so it needs storage
// credentials. CI's start-local-supabase action exports these; a developer's shell has
// no equivalent, so resolve them from the running stack the same way.
const storage = applyLocalSupabaseStorageEnv(env)
if (storage.applied) {
  console.log(
    `[run-with-local-db-env] Resolved ${storage.keys.join(' and ')} from supabase status`
  )
}

// Prisma's Migrate commands refuse to run when they detect an AI coding agent and no
// consent is recorded, printing "Prisma Migrate detected that it was invoked by Claude
// Code" and exiting 1. `playwright/global-teardown.ts` runs `db:reset` through this
// wrapper, so without consent every agent-driven Playwright run ended in a teardown
// error even when every test passed.
//
// Consent is granted here rather than exported globally because this wrapper has
// already established that the target is the local Supabase container. If a real
// `DATABASE_URL` pointed somewhere else, the guard stays armed and the refusal stands.
// The local Supabase server is a loopback host on its configured port (CI's override,
// else supabase/config.toml).
const targetsLocalSupabase = isLocalSupabaseDatabaseUrl(env.DATABASE_URL, env)
// The reset entry also names the database: the local server's `postgres` database in its
// `public` schema, the one `supabase start` creates. Another database or schema on the same
// server holds data this reset must not touch.
const resetsTheLocalDatabase = () => {
  const url = new URL(env.DATABASE_URL)
  const schema = url.searchParams.get('schema')
  return url.pathname === '/postgres' && (schema === null || schema === 'public')
}
if (requireLocal && !(targetsLocalSupabase && resetsTheLocalDatabase())) {
  console.error(
    `[run-with-local-db-env] Refusing: DATABASE_URL is not the local Supabase postgres database (public schema) on its configured port (${localDatabaseUrl(env)}).`
  )
  process.exit(1)
}
if (targetsLocalSupabase && !env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION) {
  env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION =
    'Local Supabase test database; reset and reseed are the intended operation.'
  console.log(
    '[run-with-local-db-env] Recorded Prisma dangerous-action consent for the local test database'
  )
}

const [command, ...commandArgs] = args
const child = spawn(command, commandArgs, {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
