// Local Supabase host ports: the Supabase CLI's SUPABASE_<SECTION>_PORT override when set,
// else supabase/config.toml. CI sets the overrides from .github/supabase-ci-ports.env
// (configure-ci-supabase-ports), so CI's stack sits on ports outside the ephemeral range
// while a developer's stays on config.toml's 5432x. Every script and guard that needs
// "the local Supabase database" asks here instead of naming a port.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const configPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/config.toml'
)

/** The `port` under `[section]` in supabase/config.toml. */
function configPort(section) {
  const text = readFileSync(configPath, 'utf8')
  let inside = false
  for (const line of text.split('\n')) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      inside = header[1] === section
      continue
    }
    const port = inside && /^\s*port\s*=\s*(\d+)\s*$/.exec(line)
    if (port) return Number(port[1])
  }
  throw new Error(`supabase/config.toml assigns no port under [${section}]`)
}

/** An override must be a whole TCP port; anything else is a broken environment. */
function overridePort(env, name) {
  const value = env[name]?.trim()
  if (!value) return undefined
  const port = Number(value)
  if (!/^\d+$/.test(value) || port < 1 || port > 65535)
    throw new Error(`${name} must be a TCP port, got '${value}'`)
  return port
}

/**
 * The local Supabase host ports this environment uses.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ api: number, db: number, inbucket: number }}
 */
export function localSupabasePorts(env = process.env) {
  return {
    api: overridePort(env, 'SUPABASE_API_PORT') ?? configPort('api'),
    db: overridePort(env, 'SUPABASE_DB_PORT') ?? configPort('db'),
    inbucket: overridePort(env, 'SUPABASE_INBUCKET_PORT') ?? configPort('inbucket'),
  }
}

/** The local Supabase database URL, as the CLI's `supabase status` reports it. */
export function localDatabaseUrl(env = process.env) {
  return `postgresql://postgres:postgres@127.0.0.1:${localSupabasePorts(env).db}/postgres`
}

/** The local Supabase API (Kong) origin. */
export function localSupabaseApiUrl(env = process.env) {
  return `http://127.0.0.1:${localSupabasePorts(env).api}`
}

/** The local Mailpit origin (config.toml's [inbucket]). */
export function localMailpitUrl(env = process.env) {
  return `http://127.0.0.1:${localSupabasePorts(env).inbucket}`
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Whether `value` addresses the local Supabase database server: a loopback host on the
 * configured database port. The database name is the caller's concern.
 * @param {string | undefined} value
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isLocalSupabaseDatabaseUrl(value, env = process.env) {
  if (!value) return false
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
    LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) &&
    url.port === String(localSupabasePorts(env).db)
  )
}
