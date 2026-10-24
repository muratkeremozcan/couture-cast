/**
 * Keys the local end-to-end launcher settled for its children.
 *
 * `scripts/start-api-e2e-with-workers.mjs` chooses some values itself (an
 * isolated DATABASE_URL, the weather double's origins and dummy keys) and
 * lists their names in E2E_CALLER_OWNED_ENV_KEYS. Under TEST_ENV=local several
 * loaders let `.env.local` override the inherited environment, which would
 * silently swap those values back to the developer's defaults: a run aimed at
 * its own database would migrate and read 127.0.0.1:54322 instead.
 *
 * `apps/api/src/load-env.ts` applies the same rule inside the API, which is
 * compiled on its own and cannot import this file.
 *
 * The Playwright runner and its workers are the launcher's parent, not its
 * children, so the list never reaches them. They keep an inherited loopback
 * stack instead (`inheritedLocalStackEnv`), which is also what the launcher
 * starts from: a caller who points a local run at its own database, Redis or
 * Supabase keeps it in every process, while a remote value inherited from the
 * shell still loses to `.env.local`, which is what the override is for.
 */

/**
 * The caller-owned keys that currently hold a value, with those values.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, string>}
 */
export function callerOwnedEnv(env = process.env) {
  /** @type {Record<string, string>} */
  const owned = {}
  for (const key of (env.E2E_CALLER_OWNED_ENV_KEYS ?? '').split(',')) {
    const name = key.trim()
    const value = name ? env[name] : undefined
    if (value) owned[name] = value
  }
  return owned
}

/**
 * Runs `loadEnvFiles`, then puts every caller-owned key back as it was.
 *
 * @param {() => void} loadEnvFiles
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadEnvKeepingCallerOwned(loadEnvFiles, env = process.env) {
  const owned = callerOwnedEnv(env)
  loadEnvFiles()
  Object.assign(env, owned)
}

/**
 * True for a URL whose host is this machine.
 *
 * @param {string | undefined} value
 */
export function isLoopbackUrl(value) {
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
      new URL(value ?? '').hostname
    )
  } catch {
    return false
  }
}

/** URL keys kept from the caller only when they point at this machine. */
const LOOPBACK_STACK_URL_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
]
/** Credentials that belong to an inherited loopback SUPABASE_URL. */
const LOOPBACK_SUPABASE_KEYS = [
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]

/**
 * The local stack a caller already chose: every loopback URL among the stack
 * keys, plus the Supabase credentials when SUPABASE_URL is one of them.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, string>}
 */
export function inheritedLocalStackEnv(env = process.env) {
  /** @type {Record<string, string>} */
  const kept = {}
  for (const key of LOOPBACK_STACK_URL_KEYS) {
    const value = env[key]
    if (value && isLoopbackUrl(value)) kept[key] = value
  }
  if (kept.SUPABASE_URL) {
    for (const key of LOOPBACK_SUPABASE_KEYS) {
      const value = env[key]
      if (value) kept[key] = value
    }
  }
  return kept
}

/**
 * Runs `loadEnvFiles`, then puts back the caller-owned keys and the inherited
 * loopback stack. For loaders that run above the launcher, where
 * E2E_CALLER_OWNED_ENV_KEYS is not set.
 *
 * @param {() => void} loadEnvFiles
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadEnvKeepingLocalStack(loadEnvFiles, env = process.env) {
  const kept = { ...inheritedLocalStackEnv(env), ...callerOwnedEnv(env) }
  loadEnvFiles()
  Object.assign(env, kept)
}

/** Keys the launcher keeps from its caller whatever their value. */
const LAUNCHER_CALLER_OWNED_KEYS = [
  'DATABASE_URL',
  'COMMUNITY_NSFW_SCREENER',
  'OPENWEATHER_API_ORIGIN',
  'WEATHERAPI_API_ORIGIN',
]

/**
 * The launcher's env resolution: runs `loadEnvFiles`, keeps what the caller
 * settled (explicit empty-string disables, the launcher's own keys, the
 * inherited loopback stack, and any keys a caller above the launcher already
 * listed in E2E_CALLER_OWNED_ENV_KEYS), and lists the kept keys in
 * E2E_CALLER_OWNED_ENV_KEYS for every child it spawns. The real-session harness
 * (`scripts/e2e-real-session/run.mjs`) uses that inbound list for its ports and
 * origins, which a developer's `.env.local` would otherwise replace.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {() => void} loadEnvFiles
 */
export function loadLauncherEnv(env, loadEnvFiles) {
  const explicitlyDisabled = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value === '')
  )
  /** @type {Record<string, string>} */
  const kept = {}
  for (const key of LAUNCHER_CALLER_OWNED_KEYS) {
    const value = env[key]
    if (value) kept[key] = value
  }
  Object.assign(kept, inheritedLocalStackEnv(env), callerOwnedEnv(env))
  loadEnvFiles()
  Object.assign(env, explicitlyDisabled, kept)
  env.E2E_CALLER_OWNED_ENV_KEYS = Object.keys(kept).join(',')
}
