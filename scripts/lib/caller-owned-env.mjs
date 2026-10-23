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
