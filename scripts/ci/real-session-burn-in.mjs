#!/usr/bin/env node
// Burn-in for the real-session specs a pull request changes. rwf-burn-in.yml leaves them out:
// under its config they have no owned stack, so every case skips and the run proves nothing.
// The Real-session community E2E job runs this after its own run, against a fresh stack
// (scripts/e2e-real-session/run.mjs) and the web build it already made: each changed spec
// BURN_IN_REPEATS times with no retries, the repeat count of playwright/config/.burn-in.config.ts.
// run.mjs fails the run when a case skips or none ran.
//
//   BASE_SHA=<40 hex> HEAD_SHA=<40 hex> GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... \
//     node scripts/ci/real-session-burn-in.mjs
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPARE_FILES_CAP, changedFiles } from './lanes.mjs'
import { REAL_SESSION_SPEC_MATCH } from '../e2e-real-session/harness.mjs'

export const BURN_IN_REPEATS = 3
export const TESTS_DIR = 'playwright/tests/'
const repository = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The real-session specs to burn in, sorted: the changed ones that still exist, or every
 * real-session spec when the comparison may be cut short at its file cap.
 * @param {string[]} files changed paths, old paths of renames included
 * @param {{ exists?: (file: string) => boolean, all?: () => string[] }} [io]
 */
export function burnInSpecs(files, io = {}) {
  const exists = io.exists ?? ((file) => fs.existsSync(path.join(repository, file)))
  const isRealSessionSpec = (file) =>
    file.startsWith(TESTS_DIR) && REAL_SESSION_SPEC_MATCH.test(file)
  const candidates =
    files.length >= COMPARE_FILES_CAP ? (io.all ?? allRealSessionSpecs)() : files
  return [
    ...new Set(candidates.filter((file) => isRealSessionSpec(file) && exists(file))),
  ].sort()
}

/** Every real-session spec in the checkout. */
function allRealSessionSpecs() {
  return fs
    .readdirSync(path.join(repository, TESTS_DIR), { recursive: true })
    .map((entry) => TESTS_DIR + String(entry).split(path.sep).join('/'))
}

/** The npm arguments for one burn-in run over the specs, reusing the job's web build. */
export function burnInCommand(specs) {
  return [
    'run',
    'test:pw-real-session',
    '--',
    '--skip-web-build',
    ...specs,
    `--repeat-each=${BURN_IN_REPEATS}`,
    '--retries=0',
  ]
}

async function main() {
  const { BASE_SHA: base, HEAD_SHA: head, GITHUB_REPOSITORY, GITHUB_TOKEN } = process.env
  const files = await changedFiles({
    repository: GITHUB_REPOSITORY,
    base,
    head,
    token: GITHUB_TOKEN,
  })
  const specs = burnInSpecs(files)
  if (specs.length === 0) {
    console.log(
      '[real-session-burn-in] No changed real-session spec. Nothing to burn in.'
    )
    return 0
  }
  console.log(
    `[real-session-burn-in] ${BURN_IN_REPEATS} runs each, no retries:\n  ${specs.join('\n  ')}`
  )
  const result = spawnSync('npm', burnInCommand(specs), {
    cwd: repository,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])
) {
  process.exitCode = await main()
}
