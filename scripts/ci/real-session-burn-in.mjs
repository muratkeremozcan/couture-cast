#!/usr/bin/env node
// Burn-in for the real-session specs a pull request changes. rwf-burn-in.yml leaves them out:
// under its config they have no owned stack, so every case skips and the run proves nothing.
// Its own job (Real-session burn-in) runs this beside the Real-session community E2E job, on a
// stack of its own (scripts/e2e-real-session/run.mjs): each changed spec BURN_IN_REPEATS times
// with no retries, the repeat count of playwright/config/.burn-in.config.ts. run.mjs fails the
// run when a case skips or none ran. The burn-in moved out of the lane job on CC-7.9: with eight
// changed specs its three repeats on two projects took over 7 minutes after the lane's own runs
// (CI 7c284e60), past the step budget and toward the 20-minute job cap.
//
// REAL_SESSION_BURN_IN_BUILD_WEB=true makes the run build the web app (the job's first pass);
// otherwise it serves the build an earlier pass made. `--plan` only writes `any=true|false` to
// GITHUB_OUTPUT, so the job skips its stack when no real-session spec changed.
//
// GUARDIAN_CONSENT_POLICY picks the pass, as it picks the lane's runs: `off` burns in the
// policy-off cases of every changed spec, `required_13_15` the @consent-required cases of the
// changed specs that carry the tag. A changed spec holding only consent cases fails the `off`
// pass with Playwright's "No tests found"; no such spec exists, and the failure is loud.
//
//   BASE_SHA=<40 hex> HEAD_SHA=<40 hex> GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... \
//     [GUARDIAN_CONSENT_POLICY=required_13_15] node scripts/ci/real-session-burn-in.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPARE_FILES_CAP, changedFiles } from './lanes.mjs'
import {
  CONSENT_REQUIRED_TAG,
  REAL_SESSION_SPEC_PATTERN,
  realSessionConsentPolicy,
} from '../e2e-real-session/harness.mjs'

export const BURN_IN_REPEATS = 3
export const TESTS_DIR = 'playwright/tests/'
const repository = fileURLToPath(new URL('../../', import.meta.url))

/**
 * @typedef {object} SpecIo
 * @property {(file: string) => boolean} [exists]
 * @property {() => string[]} [all] every spec path under TESTS_DIR
 * @property {(file: string) => string} [read]
 */

/**
 * The real-session specs to burn in under a consent policy, sorted: the changed ones that still
 * exist, or every real-session spec when the comparison may be cut short at its file cap. The
 * `required_13_15` pass keeps only the specs that tag consent cases.
 * @param {string[]} files changed paths, old paths of renames included
 * @param {'off' | 'required_13_15'} policy
 * @param {SpecIo} [io]
 */
export function burnInSpecs(files, policy, io = {}) {
  const exists = io.exists ?? ((file) => fs.existsSync(path.join(repository, file)))
  const read = io.read ?? ((file) => fs.readFileSync(path.join(repository, file), 'utf8'))
  const candidates = files.length >= COMPARE_FILES_CAP ? (io.all ?? allSpecs)() : files
  const selected = candidates.filter(
    (file) =>
      file.startsWith(TESTS_DIR) && REAL_SESSION_SPEC_PATTERN.test(file) && exists(file)
  )
  const forPolicy =
    policy === 'required_13_15'
      ? selected.filter((file) => tagsConsentCases(read(file)))
      : selected
  return [...new Set(forPolicy)].sort()
}

/** Whether a spec's source tags cases @consent-required, by the shared constant or literally. */
export function tagsConsentCases(source) {
  return source.includes('CONSENT_REQUIRED_TAG') || source.includes(CONSENT_REQUIRED_TAG)
}

/** Every spec path in the checkout under TESTS_DIR. */
function allSpecs() {
  return fs
    .readdirSync(path.join(repository, TESTS_DIR), { recursive: true })
    .map((entry) => TESTS_DIR + String(entry).split(path.sep).join('/'))
}

export const RUN_SCRIPT = 'scripts/e2e-real-session/run.mjs'

/**
 * The node arguments for one burn-in run over the specs. run.mjs starts directly, without npm and
 * its shell, so a signal sent to this script reaches it; the job built the packages
 * (prepare:playwright) before it. Only the first pass builds the web app; the next reuses it.
 * @param {string[]} specs
 * @param {{ buildWeb?: boolean }} [options]
 */
export function burnInCommand(specs, { buildWeb = false } = {}) {
  return [
    RUN_SCRIPT,
    ...(buildWeb ? [] : ['--skip-web-build']),
    ...specs,
    `--repeat-each=${BURN_IN_REPEATS}`,
    '--retries=0',
  ]
}

/** The run's environment: the job's, less the token this script alone needs. */
export function childEnv(env) {
  const rest = { ...env }
  delete rest.GITHUB_TOKEN
  return rest
}

/**
 * Runs the burn-in and resolves to its exit code. SIGINT and SIGTERM reach the run, so run.mjs
 * tears its stack down and drops its database on a cancel or a step timeout.
 * @param {{ env?: NodeJS.ProcessEnv, list?: typeof changedFiles,
 *   start?: typeof spawn, io?: SpecIo, log?: (line: string) => void,
 *   signals?: NodeJS.EventEmitter }} [deps]
 */
export async function burnIn({
  env = process.env,
  list = changedFiles,
  start = spawn,
  io,
  log = console.log,
  signals = process,
} = {}) {
  const policy = realSessionConsentPolicy(env)
  const files = await list({
    repository: env.GITHUB_REPOSITORY,
    base: env.BASE_SHA,
    head: env.HEAD_SHA,
    token: env.GITHUB_TOKEN,
  })
  const specs = burnInSpecs(files, policy, io)
  if (specs.length === 0) {
    log(`[real-session-burn-in] No changed real-session spec for policy ${policy}.`)
    return 0
  }
  log(
    `[real-session-burn-in] Policy ${policy}, ${BURN_IN_REPEATS} runs each, no retries:\n  ${specs.join('\n  ')}`
  )
  const buildWeb = env.REAL_SESSION_BURN_IN_BUILD_WEB === 'true'
  const child = start(process.execPath, burnInCommand(specs, { buildWeb }), {
    cwd: repository,
    env: childEnv(env),
    stdio: 'inherit',
  })
  const forward = (signal) => child.kill(signal)
  signals.on('SIGINT', forward)
  signals.on('SIGTERM', forward)
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })
  } finally {
    signals.off('SIGINT', forward)
    signals.off('SIGTERM', forward)
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])
) {
  process.exitCode = process.argv.includes('--plan') ? await plan() : await burnIn()
}

/**
 * Writes `any=true` to GITHUB_OUTPUT when some real-session spec changed (the policy-off set
 * holds every consent spec too), else `any=false`, and logs the list.
 * @param {{ env?: NodeJS.ProcessEnv, list?: typeof changedFiles, io?: SpecIo,
 *   log?: (line: string) => void, write?: (file: string, text: string) => void }} [deps]
 */
export async function plan({
  env = process.env,
  list = changedFiles,
  io,
  log = console.log,
  write = (file, text) => fs.appendFileSync(file, text),
} = {}) {
  const files = await list({
    repository: env.GITHUB_REPOSITORY,
    base: env.BASE_SHA,
    head: env.HEAD_SHA,
    token: env.GITHUB_TOKEN,
  })
  const specs = burnInSpecs(files, 'off', io)
  log(
    specs.length
      ? `[real-session-burn-in] ${specs.length} changed real-session spec(s):\n  ${specs.join('\n  ')}`
      : '[real-session-burn-in] No changed real-session spec; the burn-in job ends here.'
  )
  if (env.GITHUB_OUTPUT) write(env.GITHUB_OUTPUT, `any=${specs.length > 0}\n`)
  return 0
}
