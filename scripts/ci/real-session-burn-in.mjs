#!/usr/bin/env node
// Burn-in for the real-session specs a pull request changes. rwf-burn-in.yml leaves them out:
// under its config they have no owned stack, so every case skips and the run proves nothing.
// The Real-session community E2E job runs this after its own runs, against a fresh stack
// (scripts/e2e-real-session/run.mjs) and the web build it already made: each changed spec
// BURN_IN_REPEATS times with no retries, the repeat count of playwright/config/.burn-in.config.ts.
// run.mjs fails the run when a case skips or none ran.
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
  REAL_SESSION_SPEC_MATCH,
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
      file.startsWith(TESTS_DIR) && REAL_SESSION_SPEC_MATCH.test(file) && exists(file)
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
 * its shell, so a signal sent to this script reaches it; the lane's first run already built the
 * packages (prepare:playwright) and the web app this run reuses.
 */
export function burnInCommand(specs) {
  return [
    RUN_SCRIPT,
    '--skip-web-build',
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
  const child = start(process.execPath, burnInCommand(specs), {
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
  process.exitCode = await burnIn()
}
