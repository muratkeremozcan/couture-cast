/**
 * The built iOS development client is uploaded once and downloaded by each shard. The repository
 * is public, so any signed-in user can fetch that artifact. This scan runs before the upload and
 * fails if the app carries anything but a publishable client key:
 *
 * - a JWT whose role is not `anon` (the service role key, for one),
 * - a long value from the private owned environment file (database URLs, tokens, secrets).
 *
 * The anon key is published by design in every client build; here it is also signed by a secret
 * generated for one job and checked only by that job's loopback stack, which the job stops.
 * Whether the app embeds it is reported as a boolean. Values are never printed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const MIN_SECRET_LENGTH = 16

function* files(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* files(child)
    else if (entry.isFile()) yield child
  }
}

function jwtRole(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role ?? null
  } catch {
    return null
  }
}

/** Long string values of a flat JSON environment record. */
export function secretCandidates(env) {
  return Object.values(env ?? {}).filter(
    (value) => typeof value === 'string' && value.length >= MIN_SECRET_LENGTH
  )
}

/**
 * Scans every file under `appDirectory`. `anonKey` is the one value allowed to appear.
 * Returns counts and booleans only.
 */
export function scanApp(appDirectory, { candidates = [], anonKey = '' } = {}) {
  const needles = candidates
    .filter((value) => value !== anonKey)
    .map((value) => Buffer.from(value))
  let scanned = 0
  let foreignJwt = 0
  let ownedValue = 0
  let anonKeyEmbedded = false
  for (const file of files(appDirectory)) {
    const bytes = fs.readFileSync(file)
    scanned++
    for (const needle of needles) if (bytes.includes(needle)) ownedValue++
    for (const token of bytes.toString('latin1').match(JWT) ?? []) {
      if (anonKey && token === anonKey) anonKeyEmbedded = true
      else if (jwtRole(token) !== 'anon') foreignJwt++
      else anonKeyEmbedded = true
    }
  }
  return { scanned, foreignJwt, ownedValue, anonKeyEmbedded }
}

export function assertAppCarriesNoSecret(result) {
  if (result.scanned === 0) throw new Error('ios_app_scan_empty')
  if (result.foreignJwt) throw new Error('ios_app_embeds_non_anon_jwt')
  if (result.ownedValue) throw new Error('ios_app_embeds_owned_env_value')
  return result
}

const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/

/**
 * The owned environment's long values that are not published. A missing harness directory, an
 * unreadable file or a file with no such value would let the scan pass having compared nothing,
 * so each one throws.
 */
export function loadScanInputs(harness) {
  if (typeof harness !== 'string' || harness.trim() === '')
    throw new Error('ios_app_scan_harness_required')
  const read = (name) => JSON.parse(fs.readFileSync(path.join(harness, name), 'utf8'))
  let owned
  try {
    owned = read('owned-env.json')
  } catch {
    throw new Error('ios_app_scan_owned_env_unreadable')
  }
  let publicBuild = {}
  try {
    publicBuild = read('public-build-env.json')
  } catch {
    // Without it nothing is allowed through: every long owned value stays a candidate.
  }
  // Published by design: whatever the build env hands the app, and bare loopback origins such as
  // the API and Supabase URLs that app.config.ts puts in the app's extra.
  const published = new Set(
    Object.values(publicBuild).filter((value) => typeof value === 'string')
  )
  const candidates = secretCandidates(owned).filter(
    (value) => !published.has(value) && !LOOPBACK_ORIGIN.test(value)
  )
  if (candidates.length === 0) throw new Error('ios_app_scan_no_candidates')
  return {
    candidates,
    anonKey: publicBuild.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [appDirectory, harness] = process.argv.slice(2)
    if (!appDirectory) throw new Error('ios_app_scan_app_required')
    const result = assertAppCarriesNoSecret(
      scanApp(appDirectory, loadScanInputs(harness))
    )
    console.log(JSON.stringify({ iosAppSecretScan: result }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
