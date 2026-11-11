// Fails when the production PostHog project (couturecast-prod, 329012) disagrees with the flags
// declared in packages/config/src/flags.ts.
//
// Why: on 2026-11-11 production read a PostHog project that defined 4 of the 14 declared flags.
// PostHog answers a flag it will not evaluate by leaving it out of /flags, so
// community_read_enabled read as unavailable and every push delivery re-deferred until its group
// expired, with nothing reporting it. The posthog-flag-drift workflow runs this hourly.
//
// It asks /flags (v2) with the project token, the public key the runtime ships with, and the API
// adapter's server User-Agent, so PostHog applies the runtime filtering the API gets. Each check
// evaluates every declared key for several synthetic subjects and fails when a key is:
// - omitted: missing, inactive, or filtered from the server runtime;
// - multivariate: the runtime reads booleans;
// - answered with a value other than the expected one for any subject: a partial rollout, or a
//   full rollout opposite the declared default. The expected value is the declared default unless
//   INTENTIONAL_OVERRIDES pins another, with its reason.
//
//   POSTHOG_PROD_PROJECT_TOKEN=phc_... node scripts/ci/posthog-flag-drift.mjs
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULT_HOST = 'https://us.i.posthog.com'
/** The User-Agent `apps/api/src/posthog/posthog.service.ts` sends; a test keeps them equal. */
export const SERVER_USER_AGENT = 'posthog-node/couturecast-community'
/** Enough subjects that a partial rollout shows up as disagreement. */
export const SUBJECTS = Array.from(
  { length: 12 },
  (_, index) => `couturecast-flag-drift-${index}`
)

/**
 * Production values that differ from the declared default on purpose. A key listed here must
 * answer `value` for every subject; any other divergence fails the check.
 */
export const INTENTIONAL_OVERRIDES = Object.freeze({
  color_analysis_enabled: {
    value: true,
    reason:
      'Owner decision 2026-11-11: color analysis stays on in production; the code default ' +
      'stays false so a degraded PostHog fails closed.',
  },
})

/** One /flags call for one subject: the answered flags, or why there is no definitive answer. */
async function evaluate({ keys, token, host, subject, fetchImpl }) {
  let response
  try {
    response = await fetchImpl(`${host.replace(/\/+$/, '')}/flags?v=2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': SERVER_USER_AGENT },
      body: JSON.stringify({
        api_key: token,
        distinct_id: subject,
        flag_keys_to_evaluate: keys,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    return {
      unavailable: `request failed: ${error instanceof Error ? error.message : error}`,
    }
  }
  if (!response.ok) return { unavailable: `HTTP ${response.status}` }
  let body
  try {
    body = await response.json()
  } catch {
    return { unavailable: 'response is not JSON' }
  }
  if (!body || typeof body.flags !== 'object' || body.flags === null)
    return { unavailable: 'response has no flags object' }
  if (body.errorsWhileComputingFlags) return { unavailable: 'errorsWhileComputingFlags' }
  if (body.quotaLimited?.length || body.quota_limited?.length)
    return { unavailable: 'quota limited' }
  return { flags: body.flags }
}

/**
 * Compares production with `expected` ({ key: boolean }) across `subjects`. Returns the drift
 * found, or `unavailable` when PostHog gave no definitive answer for some subject.
 */
export async function findFlagDrift({
  expected,
  token,
  host = DEFAULT_HOST,
  subjects = SUBJECTS,
  fetchImpl = fetch,
}) {
  const keys = Object.keys(expected)
  const omitted = new Set()
  const multivariate = new Set()
  const answers = new Map(keys.map((key) => [key, new Set()]))
  for (const subject of subjects) {
    const result = await evaluate({ keys, token, host, subject, fetchImpl })
    if (result.unavailable) return result
    for (const key of keys) {
      const flag = result.flags[key]
      if (!flag || flag.failed) omitted.add(key)
      else if (typeof flag.variant === 'string') multivariate.add(key)
      else answers.get(key).add(flag.enabled)
    }
  }
  const mismatched = keys
    .filter((key) => !omitted.has(key) && !multivariate.has(key))
    .filter((key) => [...answers.get(key)].some((value) => value !== expected[key]))
    .map((key) => ({
      key,
      expected: expected[key],
      observed: [...answers.get(key)].sort(),
    }))
  return { omitted: [...omitted], multivariate: [...multivariate], mismatched }
}

/** Retries an unavailable answer; a definitive answer, drift or none, returns at once. */
export async function checkFlagDrift({
  attempts = 3,
  wait = (ms) => delay(ms),
  ...options
}) {
  let result
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await findFlagDrift(options)
    if (!result.unavailable) return result
    if (attempt < attempts) await wait(attempt * 5_000)
  }
  return result
}

/** Declared defaults with the pinned overrides applied; refuses an override nobody declared. */
export function expectedValues(declared, overrides = INTENTIONAL_OVERRIDES) {
  const stale = Object.keys(overrides).filter((key) => !Object.hasOwn(declared, key))
  if (stale.length)
    throw new Error(`Overrides for undeclared flags: ${stale.join(', ')}.`)
  return Object.fromEntries(
    Object.entries(declared).map(([key, value]) => [
      key,
      Object.hasOwn(overrides, key) ? overrides[key].value : value,
    ])
  )
}

export function describeDrift(result) {
  const lines = []
  if (result.omitted.length)
    lines.push(
      `Omitted by PostHog (missing, inactive or not evaluated server-side): ${result.omitted.join(', ')}.`
    )
  if (result.multivariate.length)
    lines.push(
      `Multivariate, where the runtime reads a boolean: ${result.multivariate.join(', ')}.`
    )
  for (const { key, expected, observed } of result.mismatched)
    lines.push(
      `${key}: expected ${expected} for every subject, PostHog answered ${observed.join(' and ')}.`
    )
  return lines
}

async function main() {
  const token = process.env.POSTHOG_PROD_PROJECT_TOKEN
  if (!token) {
    console.error('POSTHOG_PROD_PROJECT_TOKEN is not set.')
    return 2
  }
  const { FEATURE_FLAG_KEYS, getDefaultFeatureFlagValue } = await import(
    '../../packages/config/src/flags.ts'
  )
  const declared = Object.fromEntries(
    FEATURE_FLAG_KEYS.map((key) => [key, getDefaultFeatureFlagValue(key)])
  )
  const expected = expectedValues(declared)
  const result = await checkFlagDrift({ expected, token, host: process.env.POSTHOG_HOST })
  if (result.unavailable) {
    console.error(
      `PostHog gave no definitive answer after 3 attempts: ${result.unavailable}.`
    )
    return 1
  }
  const drift = describeDrift(result)
  if (drift.length) {
    console.error(
      `${['Production PostHog disagrees with the declared flags:', ...drift].join('\n')}\n` +
        'Create a missing flag as an active boolean, release it to everyone at its declared ' +
        'default, or pin an intentional value with its reason in INTENTIONAL_OVERRIDES ' +
        '(deployment guide, PostHog flag drift).'
    )
    return 1
  }
  console.log(
    `All ${FEATURE_FLAG_KEYS.length} declared flags answer their expected value in production ` +
      `for ${SUBJECTS.length} subjects (${Object.keys(INTENTIONAL_OVERRIDES).length} pinned override).`
  )
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = await main()
