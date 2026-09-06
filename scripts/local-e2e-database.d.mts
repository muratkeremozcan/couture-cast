/**
 * Type declarations for `local-e2e-database.mjs`.
 *
 * The script is plain JavaScript so it can be run by node with no build step, which
 * is the point: it is imported by other scripts, by `packages/db`'s seed, and by the
 * Playwright stack launcher. Without declarations a literal-specifier import fails
 * this repository's TypeScript config with TS7016, which forced one caller into a
 * variable specifier plus a hand-written local type. One declaration file lets every
 * caller import it plainly and keeps the shape in a single place.
 */

/** The throwaway local Supabase connection string. Matches CI's `LOCAL_DATABASE_URL`. */
export declare const LOCAL_E2E_DATABASE_URL: string

/** The repo-level env files every local startup path already reads, in order. */
export declare const ROOT_ENV_FILES: readonly string[]

/** The two Supabase Storage variables the community seed needs. */
export declare const LOCAL_SUPABASE_ENV_KEYS: readonly [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]

/** True when the process has declared itself a local or test run. */
export declare function isLocalTestRun(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): boolean

/**
 * Fills in `DATABASE_URL` for a local or test run that does not already have one.
 * Returns whether the default was applied.
 */
export declare function applyLocalE2eDatabaseUrl(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options?: { repoRootToScan?: string }
): boolean

/** What `applyLocalSupabaseStorageEnv` reads out of `supabase status -o json`. */
export interface LocalSupabaseStatus {
  API_URL?: string
  SERVICE_ROLE_KEY?: string
  [key: string]: unknown
}

export type ApplyLocalSupabaseStorageEnvResult =
  | { applied: true; keys: string[] }
  | {
      applied: false
      reason:
        | 'already-set'
        | 'not-a-local-run'
        | 'supabase-status-unavailable'
        | 'supabase-status-incomplete'
      missing?: string[]
    }

/**
 * Fills in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase status` for a
 * local or test run that does not already have them. Never overwrites a value that is
 * already set, and never runs outside a declared local or test run.
 */
export declare function applyLocalSupabaseStorageEnv(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options?: { runner?: () => LocalSupabaseStatus | null }
): ApplyLocalSupabaseStorageEnvResult
