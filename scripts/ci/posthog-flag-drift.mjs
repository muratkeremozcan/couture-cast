// Fails when the production PostHog project (couturecast-prod, 329012) disagrees with the flags
// declared in packages/config/src/flags.ts.
//
// Why: on 2026-11-11 production read a PostHog project that defined 4 of the 14 declared flags.
// PostHog answers a flag it will not evaluate by leaving it out of /flags, so
// community_read_enabled read as unavailable and every push delivery re-deferred until its group
// expired, with nothing reporting it. The posthog-flag-drift workflow runs this hourly.
//
// Two checks, both required:
// 1. Definitions, read through the PostHog API with a read-only personal key (feature_flag:read
//    on 329012): every declared flag exists, is active, boolean, evaluated server-side, and
//    released to everyone at its expected value: every release group has no property or cohort
//    filter and a 0 or 100 percent rollout, with no super group, early exit, holdout, early-access
//    enrollment or remote configuration. This is what proves a rollout is uniform.
// 2. Runtime probes, below, which see what the API itself is answered.
//
// The probes ask /flags (v2) with the project token, the public key the runtime ships with, and the API
// adapter's server User-Agent, so PostHog applies the runtime filtering the API gets. Each check
// evaluates every declared key for several synthetic subjects and fails when a key is:
// - omitted: missing, inactive, or filtered from the server runtime;
// - multivariate: the runtime reads booleans;
// - answered with a value other than the expected one for any subject: a partial rollout, or a
//   full rollout opposite the declared default. The expected value is the declared default unless
//   INTENTIONAL_OVERRIDES pins another, with its reason.
//
//   POSTHOG_PROD_PROJECT_TOKEN=phc_... node scripts/ci/posthog-flag-drift.mjs
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

const DEFAULT_APP_HOST = 'https://us.posthog.com'
export const PRODUCTION_PROJECT_ID = '329012'

/** Every flag definition in the project, following pagination. */
export async function readFlagDefinitions({
  key,
  projectId = PRODUCTION_PROJECT_ID,
  appHost = DEFAULT_APP_HOST,
  fetchImpl = fetch,
}) {
  const definitions = []
  let url = `${appHost.replace(/\/+$/, '')}/api/projects/${projectId}/feature_flags/?limit=200`
  while (url) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok)
      throw new Error(`reading flag definitions returned HTTP ${response.status}`)
    const page = await response.json()
    if (!Array.isArray(page?.results))
      throw new Error('flag definitions page has no results')
    definitions.push(...page.results)
    url = page.next ?? null
  }
  return definitions
}

/**
 * The production project's settings, read with the same key (it needs project:read as well as
 * feature_flag:read). An HTTP error or a body that is not a project is an error, never a pass.
 */
export async function readProjectPrivacy({
  key,
  projectId = PRODUCTION_PROJECT_ID,
  appHost = DEFAULT_APP_HOST,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    `${appHost.replace(/\/+$/, '')}/api/projects/${projectId}/`,
    { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) }
  )
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(
      `reading project settings returned HTTP ${response.status}` +
        (typeof body?.detail === 'string' ? ` (${body.detail})` : '')
    )
  }
  const project = await response.json()
  if (typeof project !== 'object' || project === null || Array.isArray(project))
    throw new Error('the project answer has no project settings')
  if (String(project.id) !== String(projectId))
    throw new Error(`the project answer is for project ${project.id}, not ${projectId}`)
  return project
}

/**
 * Project settings the analytics privacy boundary depends on. Mobile events go from the device
 * straight to PostHog, and PostHog fills the null $ip the privacy filter sends from the request,
 * so only the project's Discard client IP data setting keeps the address out of storage.
 */
export function projectPrivacyProblems(project) {
  return project.anonymize_ips === true
    ? []
    : [
        'Discard client IP data (anonymize_ips) is off, so PostHog stores the IP of every mobile event',
      ]
}

const empty = (value) => value == null || (Array.isArray(value) && value.length === 0)

/** Flag-level settings that make a flag anything but a plain server-side boolean. */
function flagProblems(definition) {
  const filters = definition.filters ?? {}
  return [
    [definition.active !== true, 'inactive'],
    [definition.archived === true, 'archived'],
    [definition.is_remote_configuration === true, 'remote configuration'],
    [
      !['all', 'server', null, undefined].includes(definition.evaluation_runtime),
      `evaluation runtime ${definition.evaluation_runtime}`,
    ],
    [!empty(filters.multivariate?.variants), 'multivariate'],
    [filters.aggregation_group_type_index != null, 'group aggregation'],
    [!empty(filters.super_groups), 'super group'],
    [
      filters.early_exit === true,
      'early exit: the first matching release group decides, so groups cannot be read as one uniform release',
    ],
    [!empty(filters.holdout_groups) || definition.holdout != null, 'holdout'],
    [
      filters.feature_enrollment === true || !empty(definition.features),
      'early access enrollment',
    ],
  ]
    .filter(([failed]) => failed)
    .map(([, problem]) => problem)
}

/** Release-group settings that target anyone short of everyone or no one. */
function groupProblems(group, index) {
  const label = `release group ${index + 1}`
  // PostHog reads a missing rollout percentage as everyone.
  const rollout = group.rollout_percentage ?? 100
  return [
    [!empty(group.properties), `${label} filters on properties or cohorts`],
    [group.variant != null, `${label} forces a variant`],
    [group.aggregation_group_type_index != null, `${label} aggregates by group`],
    [rollout !== 0 && rollout !== 100, `${label} rolls out to ${rollout} percent`],
  ]
    .filter(([failed]) => failed)
    .map(([, problem]) => problem)
}

/** Why one definition cannot give everyone `expected`, or an empty list. */
export function definitionProblems(definition, expected) {
  if (!definition) return ['no active definition in the project']
  const groups = definition.filters?.groups ?? []
  const problems = [...flagProblems(definition), ...groups.flatMap(groupProblems)]
  if (problems.length) return problems
  const released = groups.some((group) => (group.rollout_percentage ?? 100) === 100)
  return released === expected
    ? []
    : [`released to everyone as ${released}, expected ${expected}`]
}

/** Checks every expected key against the project's definitions. */
export function checkDefinitions(definitions, expected) {
  const byKey = new Map(
    definitions.filter((definition) => definition.deleted !== true).map((d) => [d.key, d])
  )
  return Object.entries(expected).flatMap(([key, value]) =>
    definitionProblems(byKey.get(key), value).map((problem) => ({ key, problem }))
  )
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

/**
 * Every production check, each reported on its own: the project settings, the flag definitions
 * and, when the definitions are sound, the runtime probes. One failing check never hides
 * another, so a settings problem still shows flag drift in the same run. Returns the failure
 * messages, empty when production agrees.
 */
export async function checkProduction({
  expected,
  token,
  readKey,
  host,
  fetchImpl,
  wait,
}) {
  const failures = []
  try {
    const problems = projectPrivacyProblems(
      await readProjectPrivacy({ key: readKey, fetchImpl })
    )
    if (problems.length)
      failures.push(
        ['Production project 329012 breaks the analytics privacy settings:']
          .concat(problems.map((problem) => `${problem}.`))
          .join('\n')
      )
  } catch (error) {
    failures.push(`Could not read the production project settings: ${error.message}.`)
  }
  let definitionDrift
  try {
    definitionDrift = checkDefinitions(
      await readFlagDefinitions({ key: readKey, fetchImpl }),
      expected
    )
  } catch (error) {
    failures.push(`Could not read the production flag definitions: ${error.message}.`)
    return failures
  }
  if (definitionDrift.length) {
    failures.push(
      ['Production flag definitions disagree with the declared flags:']
        .concat(definitionDrift.map(({ key, problem }) => `${key}: ${problem}.`))
        .join('\n')
    )
    return failures
  }
  const result = await checkFlagDrift({ expected, token, host, fetchImpl, wait })
  if (result.unavailable) {
    failures.push(
      `PostHog gave no definitive answer after 3 attempts: ${result.unavailable}.`
    )
    return failures
  }
  const drift = describeDrift(result)
  if (drift.length)
    failures.push(
      `${['Production PostHog disagrees with the declared flags:', ...drift].join('\n')}\n` +
        'Create a missing flag as an active boolean, release it to everyone at its declared ' +
        'default, or pin an intentional value with its reason in INTENTIONAL_OVERRIDES ' +
        '(deployment guide, PostHog flag drift).'
    )
  return failures
}

/**
 * Imports packages/config/src/flags.ts as an ES module. The package declares no "type", because
 * its dist is CommonJS while its source is ES module TypeScript, so a plain import of the source
 * makes Node reparse it and log MODULE_TYPELESS_PACKAGE_JSON. A `.mts` copy states the module
 * type, and Node strips its types the same way. flags.ts imports nothing (a test holds that), so
 * the copy loads on its own.
 */
async function importDeclaredFlags() {
  const source = fileURLToPath(
    new URL('../../packages/config/src/flags.ts', import.meta.url)
  )
  const directory = mkdtempSync(path.join(tmpdir(), 'posthog-flag-drift-'))
  try {
    const copy = path.join(directory, 'flags.mts')
    copyFileSync(source, copy)
    return await import(pathToFileURL(copy).href)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function main() {
  const token = process.env.POSTHOG_PROD_PROJECT_TOKEN
  if (!token) {
    console.error('POSTHOG_PROD_PROJECT_TOKEN is not set.')
    return 2
  }
  const { FEATURE_FLAG_KEYS, getDefaultFeatureFlagValue } = await importDeclaredFlags()
  const declared = Object.fromEntries(
    FEATURE_FLAG_KEYS.map((key) => [key, getDefaultFeatureFlagValue(key)])
  )
  const expected = expectedValues(declared)
  const readKey = process.env.POSTHOG_FLAG_READ_KEY
  if (!readKey) {
    console.error(
      'POSTHOG_FLAG_READ_KEY is not set: the definition check needs a personal API key with ' +
        'feature_flag:read and project:read on project 329012.'
    )
    return 2
  }
  const failures = await checkProduction({
    expected,
    token,
    readKey,
    host: process.env.POSTHOG_HOST,
  })
  if (failures.length) {
    console.error(failures.join('\n'))
    return 1
  }
  console.log(
    `All ${FEATURE_FLAG_KEYS.length} declared flags are released uniformly and answer their ` +
      'expected value in production ' +
      `for ${SUBJECTS.length} subjects (${Object.keys(INTENTIONAL_OVERRIDES).length} pinned override).`
  )
  return 0
}

// The real path: an argv[1] through a symlink (macOS keeps /tmp as one) must still run main.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main()
