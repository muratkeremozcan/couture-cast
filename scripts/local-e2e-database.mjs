/**
 * The local end-to-end database contract, in one place.
 *
 * WHY THIS FILE EXISTS.
 *
 * Running the local Playwright stack used to require a repo-level `.env` that
 * is gitignored and therefore absent from every fresh clone and every new git
 * worktree. Without it `scripts/prisma-migrate-deploy.mjs` fails on
 * `Environment variable not found: DATABASE_URL` before anything starts, and
 * the value it wants is not a secret: it is the same throwaway local Supabase
 * connection string that `.github/workflows/pr-pw-e2e-local.yml` writes in
 * plain text. Every contributor then rediscovers that by reading CI, or by
 * asking someone.
 *
 * So the default lives in the repository instead of in each person's head.
 *
 * SAFETY. This only ever fills in a value that is missing, and only for a run
 * that has already declared itself local or test. A real `DATABASE_URL` in the
 * environment always wins, which is what keeps CI, preview, and production on
 * exactly the connection strings they were given.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Must stay identical to `LOCAL_DATABASE_URL` in
 * `.github/workflows/pr-pw-e2e-local.yml`. Both point at the local Supabase
 * container from `supabase/config.toml`, whose credentials are fixed defaults
 * for a database that only ever holds generated fixtures.
 */
export const LOCAL_E2E_DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * True when the process has declared itself a local or test run.
 *
 * Deliberately the same predicate as `allowsTestOnlySecrets()` in
 * `apps/api/src/config/runtime-environment.ts` and `allowsCommerceSeeding()` in
 * `packages/db/prisma/seeds/commerce.ts`. Three gates that decide "is this a
 * throwaway environment" should agree, or one of them is a production hazard.
 */
export function isLocalTestRun(env = process.env) {
  return env.NODE_ENV === 'test' || (env.TEST_ENV ?? '').trim().toLowerCase() === 'local'
}

/** The repo-level env files every local startup path already reads, in order. */
export const ROOT_ENV_FILES = ['.env.local', '.env.preview', '.env.prod', '.env']

/**
 * Fills in `DATABASE_URL` for a local or test run that does not already have
 * one. Mutates the given env object, so a caller can apply it to `process.env`
 * or to a child process's env.
 *
 * Returns whether the default was applied. A silent connection-string
 * substitution is the last thing anyone should have to discover from a stack
 * trace, so callers log it.
 *
 * `repoRootToScan` is for the caller that has NOT yet loaded the repo-level env
 * files and is about to hand this env to something that will. Injecting a
 * default there would shadow the file's own value, because `dotenv` leaves an
 * already-set variable alone. Passing the root makes this decline whenever any
 * such file exists and lets the real loader win. Omit it once the files are
 * loaded, when `env.DATABASE_URL` is already the whole answer.
 */
export function applyLocalE2eDatabaseUrl(env = process.env, { repoRootToScan } = {}) {
  if (env.DATABASE_URL && env.DATABASE_URL.trim().length > 0) {
    return false
  }
  if (!isLocalTestRun(env)) {
    return false
  }
  if (repoRootToScan !== undefined && hasRootEnvFile(repoRootToScan)) {
    return false
  }

  env.DATABASE_URL = LOCAL_E2E_DATABASE_URL
  return true
}

function hasRootEnvFile(repoRoot) {
  return ROOT_ENV_FILES.some((file) => existsSync(path.join(repoRoot, file)))
}
