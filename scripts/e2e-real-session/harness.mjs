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
import fs from 'node:fs'
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

/**
 * Where Playwright writes its JUnit and failure output inside the run directory,
 * outside the upload directory (`artifacts.mjs` publishes a redacted copy). Kept
 * here, with no `import.meta`, so the owned Playwright config can import it.
 */
export const RAW_DIR = 'raw'

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
 * mint a code for any other user of the local Auth server. A pending row (written
 * ahead of the Auth call, see `identities.mjs`) names no user yet and never
 * qualifies.
 *
 * @template {{ email?: unknown; pending?: unknown }} T
 * @param {readonly T[]} rows
 * @param {unknown} email
 * @returns {T | undefined}
 */
export function findIssuableAccount(rows, email) {
  if (typeof email !== 'string' || !REAL_SESSION_EMAIL.test(email)) return undefined
  return rows.find((row) => row.email === email && row.pending !== true)
}

/**
 * Splits the recorded identities into the Auth users cleanup may delete, the
 * pending rows whose Auth id it must first resolve from the address, and the rows
 * it must refuse. A created row qualifies only with a harness email and a UUID Auth
 * id; a pending row only with a harness email and no Auth id. Anything else means
 * the file holds something the specs did not write.
 *
 * @param {readonly { email?: unknown; authUserId?: unknown; label?: unknown; pending?: unknown }[]} rows
 */
export function selectRecordedUsers(rows) {
  /** @type {{ authUserId: string; email: string; label: string }[]} */
  const deletable = []
  /** @type {{ email: string; label: string }[]} */
  const pending = []
  /** @type {string[]} */
  const refused = []
  const seen = new Set()
  const pendingSeen = new Set()
  for (const row of rows) {
    const label = typeof row.label === 'string' ? row.label : 'unlabelled'
    const harnessEmail =
      typeof row.email === 'string' && REAL_SESSION_EMAIL.test(row.email)
    if (row.pending === true) {
      if (!harnessEmail || row.authUserId !== undefined) {
        refused.push(label)
        continue
      }
      if (pendingSeen.has(row.email)) continue
      pendingSeen.add(row.email)
      pending.push({ email: /** @type {string} */ (row.email), label })
      continue
    }
    if (
      !harnessEmail ||
      typeof row.authUserId !== 'string' ||
      !UUID.test(row.authUserId)
    ) {
      refused.push(label)
      continue
    }
    if (seen.has(row.authUserId)) continue
    seen.add(row.authUserId)
    deletable.push({
      authUserId: row.authUserId,
      email: /** @type {string} */ (row.email),
      label,
    })
  }
  // A pending row whose created row is also present needs no lookup: deleting the
  // created row's user covers it.
  const created = new Set(deletable.map((user) => user.email))
  return {
    deletable,
    pending: pending.filter((row) => !created.has(row.email)),
    refused,
  }
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
 * Why the real-session specs cannot run here, or undefined when they can. Normal
 * Playwright runs have no owned harness, so the specs skip with this reason. Under
 * `run.mjs` (and the CI job) STORY65_REAL_SESSION_REQUIRED=true turns a reason into
 * an error: a harness that drifted (a renamed file, a different DATABASE_URL shape)
 * must fail the run, because six skipped tests exit 0.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string | undefined}
 */
export function realSessionSkipReason(env = process.env) {
  const reason = skipReasonFor(env)
  if (reason && env.STORY65_REAL_SESSION_REQUIRED === 'true')
    throw new Error(
      `STORY65_REAL_SESSION_REQUIRED=true, but the specs would skip: ${reason}`
    )
  return reason
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
function skipReasonFor(env) {
  const directory = env.STORY65_REAL_SESSION_DIR
  if (!directory)
    return 'Story 6.5 real-session acceptance runs only in an owned harness (STORY65_REAL_SESSION_DIR is unset).'
  if (!fs.existsSync(path.join(directory, 'auth-harness.json')))
    return 'Story 6.5 real-session acceptance needs the owned local Auth harness (auth-harness.json is missing).'
  let database = ''
  try {
    database = new URL(env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    database = ''
  }
  if (!ISOLATED_DATABASE_NAME.test(database))
    return 'Story 6.5 real-session acceptance needs an isolated UUID database.'
  return undefined
}

/**
 * The tests the two real-session specs hold: one in `community-real-session.spec.ts`
 * and five in `community-real-session-identity.spec.ts`. A full run must report
 * exactly this many, none skipped.
 */
export const EXPECTED_REAL_SESSION_TESTS = 6

/**
 * Whether a JUnit report shows a complete passing run: `expected` tests (any count
 * above zero when `expected` is undefined, for a run filtered with Playwright
 * arguments), with no failure, error or skip. Playwright exits 0 when every test
 * skipped, so its exit code alone cannot say the specs ran.
 *
 * @param {string} xml
 * @param {number | undefined} expected
 * @returns {{ ok: true; tests: number } | { ok: false; reason: string }}
 */
export function junitOutcome(xml, expected) {
  const root = xml.match(/<testsuites\b([^>]*)>/)
  if (!root) return { ok: false, reason: 'the JUnit report has no <testsuites> element' }
  /** @param {string} name */
  const count = (name) => {
    const value = root[1].match(new RegExp(`\\b${name}="(\\d+)"`))?.[1]
    return value === undefined ? undefined : Number(value)
  }
  const tests = count('tests')
  const failures = count('failures')
  const skipped = count('skipped')
  const errors = count('errors') ?? 0
  if (tests === undefined || failures === undefined || skipped === undefined)
    return { ok: false, reason: 'the JUnit report lacks its test, failure or skip count' }
  if (skipped > 0) return { ok: false, reason: `${skipped} of ${tests} test(s) skipped` }
  if (failures > 0 || errors > 0)
    return { ok: false, reason: `${failures + errors} of ${tests} test(s) failed` }
  if (expected === undefined ? tests === 0 : tests !== expected)
    return {
      ok: false,
      reason: `the JUnit report holds ${tests} test(s), expected ${expected ?? 'at least 1'}`,
    }
  return { ok: true, tests }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} repoRoot
 */
export function resolveHarnessDir(env, repoRoot) {
  const configured = (env.STORY65_REAL_SESSION_DIR ?? '').trim()
  return path.resolve(repoRoot, configured || DEFAULT_HARNESS_DIR)
}
