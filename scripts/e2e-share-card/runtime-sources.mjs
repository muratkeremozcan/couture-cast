/**
 * Where the share-card runtime gets its local Supabase and Redis. One rule holds
 * for every lane, whatever its platform:
 *
 * - A lane that provides SUPABASE_URL, SUPABASE_ANON_KEY and
 *   SUPABASE_SERVICE_ROLE_KEY is used as given (the Linux lanes export them from
 *   `.github/actions/start-local-supabase`, the iOS lane from
 *   `scripts/ci/native-supabase.mjs`). Otherwise `supabase status -o json` is read.
 * - A lane that provides REDIS_URL is used as given and the runtime owns no Redis.
 *   Otherwise the runtime starts its own Docker Redis container and records it,
 *   and cleanup removes exactly that recorded container.
 *
 * Both must be loopback: the runtime never provisions against a remote service.
 */
import { randomUUID } from 'node:crypto'

export const SUPABASE_VARIABLES = /** @type {const} */ ([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
])

const OWNED_REDIS_CONTAINER = /^cc68-runtime-redis-[a-f0-9]{8}$/

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {() => { API_URL?: string, ANON_KEY?: string, SERVICE_ROLE_KEY?: string }} readStatus
 *   reads `supabase status -o json`; called only when the lane provides no credentials
 */
export function resolveSupabase(env, readStatus) {
  const provided = SUPABASE_VARIABLES.every((name) => env[name])
  let credentials
  if (provided) {
    credentials = {
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    }
  } else {
    const status = readStatus()
    credentials = {
      SUPABASE_URL: status.API_URL,
      SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    }
  }
  if (Object.values(credentials).some((value) => !value))
    throw new Error('Local Supabase credentials unavailable.')
  if (new URL(/** @type {string} */ (credentials.SUPABASE_URL)).hostname !== '127.0.0.1')
    throw new Error('Runtime requires loopback Supabase.')
  return {
    source: provided ? 'environment' : 'supabase-status',
    credentials: /** @type {Record<(typeof SUPABASE_VARIABLES)[number], string>} */ (
      credentials
    ),
  }
}

/**
 * The Redis the runtime uses: the lane's REDIS_URL, owned by no one here, or a
 * Docker container the runtime starts under a fresh owned name.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {() => string} [id]
 * @returns {{ owned: false, url: string } | { owned: true, container: string }}
 */
export function planRedis(env, id = () => randomUUID().slice(0, 8)) {
  if (env.REDIS_URL) {
    const url = new URL(env.REDIS_URL)
    if (url.protocol !== 'redis:' || url.hostname !== '127.0.0.1')
      throw new Error('Runtime requires a loopback redis:// REDIS_URL.')
    return { owned: false, url: env.REDIS_URL }
  }
  return { owned: true, container: `cc68-runtime-redis-${id()}` }
}

/**
 * The Redis container a resource manifest records as owned, or null when the
 * runtime used the lane's Redis. A recorded name outside the owned pattern stops
 * cleanup.
 *
 * @param {{ redisContainer?: string | null }} resources
 */
export function ownedRedisContainer(resources) {
  if (!resources.redisContainer) return null
  if (!OWNED_REDIS_CONTAINER.test(resources.redisContainer))
    throw new Error('owned_redis_required')
  return resources.redisContainer
}
