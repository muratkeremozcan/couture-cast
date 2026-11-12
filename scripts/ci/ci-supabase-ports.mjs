// Story 6.14 follow-up: CI's local Supabase host ports, from .github/supabase-ci-ports.env.
//
// Every port supabase/config.toml assigns must have an override here, and every override
// must sit below 32768, outside Linux's ephemeral range (32768-60999) and macOS's
// (49152-65535): a port inside one can be held by an outgoing connection as its local
// port, which is how the runner's own connection took 54322 for a whole mobile e2e job
// (run 43079319997). The CLI writes the overrides and the URLs derived from them to
// $GITHUB_ENV, so no workflow names a port.
import { readFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** config.toml port keys and the Supabase CLI environment variable that overrides each. */
export const PORT_OVERRIDES = {
  'api.port': 'SUPABASE_API_PORT',
  'db.port': 'SUPABASE_DB_PORT',
  'db.shadow_port': 'SUPABASE_DB_SHADOW_PORT',
  'db.pooler.port': 'SUPABASE_DB_POOLER_PORT',
  'studio.port': 'SUPABASE_STUDIO_PORT',
  'inbucket.port': 'SUPABASE_INBUCKET_PORT',
  'analytics.port': 'SUPABASE_ANALYTICS_PORT',
}

/** The lowest ephemeral port on any runner OS: Linux starts at 32768. */
export const EPHEMERAL_FLOOR = 32768

/** Every `<section>.<key>` of supabase/config.toml whose key is `port` or `shadow_port`. */
export function configPortKeys(configText) {
  const keys = []
  let section = ''
  for (const line of configText.split('\n')) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      section = header[1]
      continue
    }
    const key = /^\s*((?:shadow_)?port)\s*=\s*\d+\s*$/.exec(line)
    if (key && section) keys.push(`${section}.${key[1]}`)
  }
  return keys
}

/** KEY=value lines, ignoring blanks and comments. */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const values = {}
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) throw new Error(`line ${index + 1} is not KEY=value: '${line}'`)
    values[match[1]] = match[2]
  }
  return values
}

/**
 * The $GITHUB_ENV lines for CI's Supabase: every override plus the derived URLs.
 * Throws naming the problem when a configured port has no override, an override is not
 * a port below the ephemeral floor, two overrides share a port, or the file sets a key
 * that overrides nothing.
 */
export function ciSupabaseEnv(envText, configText, { databaseUrl = false } = {}) {
  const values = parseEnvFile(envText)
  const known = new Set(Object.values(PORT_OVERRIDES))
  for (const key of Object.keys(values))
    if (!known.has(key)) throw new Error(`${key} overrides no supabase/config.toml port`)
  const missing = configPortKeys(configText).filter(
    (key) => !PORT_OVERRIDES[key] || values[PORT_OVERRIDES[key]] === undefined
  )
  if (missing.length)
    throw new Error(
      `supabase/config.toml ports without a CI override: ${missing.join(', ')}`
    )
  const seen = new Map()
  for (const [key, value] of Object.entries(values)) {
    const port = Number(value)
    if (!/^\d+$/.test(value) || port < 1024 || port >= EPHEMERAL_FLOOR)
      throw new Error(
        `${key}=${value} must be a port from 1024 to ${EPHEMERAL_FLOOR - 1}, below every runner's ephemeral range`
      )
    if (seen.has(port)) throw new Error(`${key} and ${seen.get(port)} both use ${port}`)
    seen.set(port, key)
  }
  const local = `postgresql://postgres:postgres@127.0.0.1:${values.SUPABASE_DB_PORT}/postgres`
  return [
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    `LOCAL_DATABASE_URL=${local}`,
    ...(databaseUrl ? [`DATABASE_URL=${local}`] : []),
    `SUPABASE_LOCAL_API_URL=http://127.0.0.1:${values.SUPABASE_API_PORT}`,
    `SUPABASE_LOCAL_MAILPIT_URL=http://127.0.0.1:${values.SUPABASE_INBUCKET_PORT}`,
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')
  try {
    const lines = ciSupabaseEnv(
      readFileSync(path.join(root, '.github/supabase-ci-ports.env'), 'utf8'),
      readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'),
      { databaseUrl: process.env.EXPORT_DATABASE_URL === 'true' }
    )
    const target = process.env.GITHUB_ENV
    if (!target) throw new Error('GITHUB_ENV is not set')
    appendFileSync(target, `${lines.join('\n')}\n`)
    console.log(`CI Supabase ports:\n${lines.join('\n')}`)
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
