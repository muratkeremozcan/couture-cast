/**
 * The Story 6.5 real-session harness contract, in one place.
 *
 * `playwright/tests/community-real-session.spec.ts` and
 * `community-real-session-identity.spec.ts` sign in through the product sign-in
 * UI with a genuine local Supabase Auth OTP. They need what a normal Playwright
 * run does not have: an isolated UUID-named database, a web build without fixture
 * auth, and an Auth proxy that hands the tests the OTP of the accounts they
 * created. `run.mjs` starts all of that, `auth-proxy.mjs` is the proxy, and
 * `cleanup-users.mjs` deletes the Auth users a run created. This file holds the
 * values and the decisions they share, kept free of side effects so the unit
 * tests in `playwright/support/helpers/real-session-harness.spec.ts` can hold them.
 */
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

/** The specs hard-code these origins, so the harness serves exactly them. */
export const API_PORT = 4077
export const WEB_PORT = 3077
export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`
export const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`

/** The OTP-minting Auth proxy the web build talks to in place of Supabase Auth. */
export const AUTH_PROXY_PORT = 53051

/** Kept off the default 4010 so a normal local stack can run beside this one. */
export const WEATHER_DOUBLE_PORT = 4087

/** Mailpit from `supabase/config.toml` (`[inbucket] port`). */
export const MAILPIT_URL = 'http://127.0.0.1:54324'

/**
 * The web build this harness makes, relative to `apps/web`. A separate output keeps
 * the fixture-auth build of the normal lane intact; `apps/web/next.config.ts`
 * reads it from WEB_NEXT_DIST_DIR.
 */
export const WEB_DIST_DIR = '.next-real-session'

/** Where a run keeps its state when STORY65_REAL_SESSION_DIR is not set. */
export const DEFAULT_HARNESS_DIR = '.real-session-e2e'

/** The same shape `apps/api/integration/helpers/isolated-community-database.ts` creates. */
export const ISOLATED_DATABASE_NAME = /^tea_community_[a-f0-9]{32}$/

/**
 * The only Auth users the harness ever creates: `realCommunityEmail()` in
 * `playwright/support/helpers/community-real-session.ts`.
 */
export const REAL_SESSION_EMAIL =
  /^story65-real-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.test$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** State files a run writes into its directory, all removed before the next run. */
export const RUN_STATE_FILES = [
  'auth-harness.json',
  'auth-observations.json',
  'owned-env.json',
  'resources.json',
  'real-mail-proof.json',
  'web-real-session-proof.json',
  'identity-boundary-proof.json',
]

export const OTP_MODES = ['real-email', 'generated']

/** @param {() => string} [uuid] */
export function isolatedDatabaseName(uuid = randomUUID) {
  return `tea_community_${uuid().replaceAll('-', '')}`
}

/**
 * The isolated database's URL on the same server as `sourceUrl`.
 *
 * @param {string} sourceUrl
 * @param {string} name
 */
export function isolatedDatabaseUrl(sourceUrl, name) {
  if (!ISOLATED_DATABASE_NAME.test(name))
    throw new Error(`Refusing a database name outside tea_community_<32 hex>: ${name}`)
  const url = new URL(sourceUrl)
  if (!isLoopbackHost(url.hostname))
    throw new Error('The real-session harness only creates databases on a local server.')
  url.pathname = `/${name}`
  return url.toString()
}

/**
 * Throws unless `url` names an isolated database on this machine. Every process
 * the harness starts checks this before it touches the database.
 *
 * @param {string | undefined} url
 */
export function assertIsolatedDatabaseUrl(url) {
  let parsed
  try {
    parsed = new URL(url ?? '')
  } catch {
    throw new Error('DATABASE_URL is not a URL.')
  }
  if (!isLoopbackHost(parsed.hostname))
    throw new Error('DATABASE_URL must point at a local server.')
  if (!ISOLATED_DATABASE_NAME.test(parsed.pathname.slice(1)))
    throw new Error('DATABASE_URL must name an isolated tea_community_<32 hex> database.')
  return parsed.pathname.slice(1)
}

/** @param {string} hostname */
export function isLoopbackHost(hostname) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)
}

/**
 * The file the proxy writes a generated OTP to, and the spec helper reads it from.
 * Matches `readGeneratedCommunityCode` in `community-real-session.ts`.
 *
 * @param {string} email
 */
export function otpFileName(email) {
  return `${createHash('sha256').update(email).digest('hex')}.json`
}

/**
 * The recorded account the proxy may issue an OTP for, or undefined. Only an exact
 * match on an address the harness itself created qualifies, so the proxy can never
 * mint a code for any other user of the local Auth server.
 *
 * @template {{ email?: unknown }} T
 * @param {readonly T[]} rows
 * @param {unknown} email
 * @returns {T | undefined}
 */
export function findIssuableAccount(rows, email) {
  if (typeof email !== 'string' || !REAL_SESSION_EMAIL.test(email)) return undefined
  return rows.find((row) => row.email === email)
}

/**
 * Splits the recorded identities into the Auth users cleanup may delete and the
 * rows it must refuse. A row qualifies only with a harness email and a UUID Auth
 * id; anything else means the file holds something the specs did not write.
 *
 * @param {readonly { email?: unknown; authUserId?: unknown; label?: unknown }[]} rows
 */
export function selectRecordedUsers(rows) {
  /** @type {{ authUserId: string; email: string; label: string }[]} */
  const deletable = []
  /** @type {string[]} */
  const refused = []
  const seen = new Set()
  for (const row of rows) {
    const label = typeof row.label === 'string' ? row.label : 'unlabelled'
    if (
      typeof row.email !== 'string' ||
      !REAL_SESSION_EMAIL.test(row.email) ||
      typeof row.authUserId !== 'string' ||
      !UUID.test(row.authUserId)
    ) {
      refused.push(label)
      continue
    }
    if (seen.has(row.authUserId)) continue
    seen.add(row.authUserId)
    deletable.push({ authUserId: row.authUserId, email: row.email, label })
  }
  return { deletable, refused }
}

/**
 * The OTP issuance mode for the run. `real-email` sends the first account's code
 * through local Auth's real mailer and reads it back from Mailpit; `generated` has
 * the proxy mint every code with the Auth Admin API. Unset picks `real-email`
 * whenever Mailpit answers. An explicit `real-email` with no Mailpit is an error:
 * downgrading silently would report a real-mail proof the run never made.
 *
 * @param {string | undefined} requested
 * @param {boolean} mailpitReachable
 * @returns {'real-email' | 'generated'}
 */
export function resolveOtpMode(requested, mailpitReachable) {
  const mode = (requested ?? '').trim().toLowerCase()
  if (mode === '') return mailpitReachable ? 'real-email' : 'generated'
  if (mode === 'generated') return 'generated'
  if (mode === 'real-email') {
    if (!mailpitReachable)
      throw new Error(
        `STORY65_REAL_SESSION_OTP_MODE=real-email needs Mailpit at ${MAILPIT_URL}. Start Supabase with Mailpit, or set STORY65_REAL_SESSION_OTP_MODE=generated.`
      )
    return 'real-email'
  }
  throw new Error(
    `Unsupported STORY65_REAL_SESSION_OTP_MODE value: ${requested}. Expected one of: ${OTP_MODES.join(', ')}.`
  )
}

/**
 * The sign-in code in a Mailpit message body. Same pattern as
 * `readCommunityMailCode` in `community-real-session.ts`.
 *
 * @param {string} body
 */
export function extractMailCode(body) {
  return body.match(/\b(\d{6,10})\b/)?.[1]
}

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

/**
 * Replaces every known secret value, then anything shaped like a JWT. The keys
 * and codes are the ones the run holds; the JWT pattern catches the session
 * bearers and refresh payloads nobody listed.
 *
 * @param {string} text
 * @param {readonly (string | undefined)[]} secrets
 */
export function redactSecrets(text, secrets) {
  // Longest first, so a secret that contains a shorter one is replaced whole.
  const values = [...new Set(secrets.filter((value) => value && value.length >= 6))]
    .map(String)
    .sort((left, right) => right.length - left.length)
  let output = text
  for (const value of values) output = output.split(value).join('[REDACTED]')
  return output.replace(JWT, '[REDACTED_JWT]')
}

/**
 * The names an env file defines that the web build was not given. The harness
 * sets each to the empty string: `apps/web/next.config.ts` fills only keys that
 * are undefined, so a developer's `.env.local` cannot hand the web build a
 * remote API origin or a service key.
 *
 * @param {Iterable<string>} fileKeys
 * @param {Record<string, string>} provided
 */
export function envKeysToBlank(fileKeys, provided) {
  return [...new Set(fileKeys)].filter((key) => !(key in provided)).sort()
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} repoRoot
 */
export function resolveHarnessDir(env, repoRoot) {
  const configured = (env.STORY65_REAL_SESSION_DIR ?? '').trim()
  return path.resolve(repoRoot, configured || DEFAULT_HARNESS_DIR)
}
