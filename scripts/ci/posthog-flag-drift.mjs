// Fails when a flag declared in packages/config/src/flags.ts is missing from the production
// PostHog project (couturecast-prod, 329012).
//
// Why: on 2026-11-11 production read a PostHog project that defined 4 of the 14 declared flags.
// PostHog answers a missing key by leaving it out of /flags, so community_read_enabled read as
// "unavailable" and every push delivery re-deferred until its group expired, with nothing
// reporting it. The posthog-flag-drift workflow runs this hourly, so a declared flag that nobody
// created, or one deleted later, turns the job red instead of degrading production quietly.
//
// It asks /flags (v2) with the project token, the same public key the runtime ships with, for
// every declared key, and reports each key PostHog leaves out. It never reads rollout values:
// a rollout is an operator decision, a missing key is a defect.
//
//   POSTHOG_PROD_PROJECT_TOKEN=phc_... node scripts/ci/posthog-flag-drift.mjs
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULT_HOST = 'https://us.i.posthog.com'
const DISTINCT_ID = 'couturecast-flag-drift-check'

/**
 * One /flags call. Returns the declared keys PostHog left out, or `unavailable` when PostHog could
 * not give a definitive answer (HTTP error, evaluation error, quota limit, unparseable body).
 */
export async function findMissingFlags({
  keys,
  token,
  host = DEFAULT_HOST,
  fetchImpl = fetch,
}) {
  let response
  try {
    response = await fetchImpl(`${host.replace(/\/+$/, '')}/flags?v=2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: token,
        distinct_id: DISTINCT_ID,
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
  return { missing: keys.filter((key) => !Object.hasOwn(body.flags, key)) }
}

/** Retries an unavailable answer; a definitive answer, missing keys or none, returns at once. */
export async function checkFlagDrift({
  keys,
  token,
  host,
  fetchImpl,
  attempts = 3,
  wait = (ms) => delay(ms),
}) {
  let result
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await findMissingFlags({ keys, token, host, fetchImpl })
    if (!result.unavailable) return result
    if (attempt < attempts) await wait(attempt * 5_000)
  }
  return result
}

async function main() {
  const token = process.env.POSTHOG_PROD_PROJECT_TOKEN
  if (!token) {
    console.error('POSTHOG_PROD_PROJECT_TOKEN is not set.')
    return 2
  }
  const { FEATURE_FLAG_KEYS } = await import('../../packages/config/src/flags.ts')
  const keys = [...FEATURE_FLAG_KEYS]
  const result = await checkFlagDrift({ keys, token, host: process.env.POSTHOG_HOST })
  if (result.unavailable) {
    console.error(
      `PostHog gave no definitive answer after 3 attempts: ${result.unavailable}.`
    )
    return 1
  }
  if (result.missing.length) {
    console.error(
      `Declared flags missing from the production PostHog project: ${result.missing.join(', ')}.\n` +
        'Create each as an active boolean whose rollout matches its declared default ' +
        '(see the deployment guide, PostHog flag drift).'
    )
    return 1
  }
  console.log(
    `All ${keys.length} declared flags exist in the production PostHog project.`
  )
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = await main()
