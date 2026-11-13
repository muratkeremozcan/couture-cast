// Story 6.15 D6, C-13 and IOS-01/02: the rules the three iOS native workflows keep. No macOS job
// runs on a pull request or gates a merge (owner rule, 2026-11-13).
//
//   ios-native-jobs.yml      the iOS jobs, called for one commit `sha`: a client scanned before it
//                            is cached and installed only from that scan, every shard with its own
//                            runtime, budget and fail-closed evidence, a run that fails on a
//                            skipped or partial shard, and every job proving it checked out `sha`.
//   ios-native.yml           nightly on main, which may write the caches, and a manual dispatch,
//                            which saves none: ios-build builds and scans the dispatched commit's
//                            own client and hands it to the shards and Expo Go as an artifact.
//   ios-native-canary.yml    nightly on main with ios26-canary: the shards and Expo Go on the iOS
//                            26.5 simulator of macos-26. Only it passes the input, and it gates
//                            nothing.
//
// The rules check that each control is present, eligible to run (no disabled or bypassable
// condition) and able to fail its job.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { helperProblems } from './ios-native-helpers.mjs'
import { shardsOf } from './native-matrix-shards.mjs'

export const NIGHTLY_WORKFLOW = '.github/workflows/ios-native.yml'
export const JOBS_WORKFLOW = '.github/workflows/ios-native-jobs.yml'
export const CANARY_WORKFLOW = '.github/workflows/ios-native-canary.yml'
export const WORKFLOW_FILES = [NIGHTLY_WORKFLOW, JOBS_WORKFLOW, CANARY_WORKFLOW]
export const CANARY_INPUT = 'ios26-canary'
export const CANARY_JOB = 'ios-native-canary'
export const CANARY_RUN_NAME = 'iOS 26.5 canary ${{ github.sha }}'
const CANARY_CONCURRENCY = { group: 'ios-native-canary', 'cancel-in-progress': false }
const NIGHTLY = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/
export const MACOS_JOBS = ['ios-build', 'ios-shard', 'ios-expo-go', 'ios-app-build']
// The client and the Release app build on macos-26 with Xcode 26.4 or later, which SDK 56 needs;
// the shards and Expo Go run that client on macos-15's iOS 18.5 simulator, from Xcode 16.4, and
// only under the nightly canary on macos-26's iOS 26.5 simulator.
const CONSUMER_RUNNER = "${{ inputs.ios26-canary && 'macos-26' || 'macos-15' }}"
const CONSUMER_XCODE = "${{ inputs.ios26-canary && '26.4+' || '16.4' }}"
export const RUNNERS = {
  'ios-build': 'macos-26',
  'ios-shard': CONSUMER_RUNNER,
  'ios-expo-go': CONSUMER_RUNNER,
  'ios-app-build': 'macos-26',
  'ios-evidence': 'ubuntu-latest',
}
export const XCODE_CHOICES = {
  'ios-build': '26.4+',
  'ios-shard': CONSUMER_XCODE,
  'ios-expo-go': CONSUMER_XCODE,
  'ios-app-build': '26.4+',
}
const XCODE_LABELS = {
  '26.4+': '26.4 or later',
  [CONSUMER_XCODE]: '16.4, or 26.4 or later under the canary,',
}
export const TEST_JOBS = [...MACOS_JOBS, 'ios-evidence']
export const HARNESS_DIRECTORY = '_bmad-output/test-artifacts/story-6-8/runtime'
export const EVIDENCE_PATH = `${HARNESS_DIRECTORY}/public-evidence/`
export const IOS_CLIENT =
  '/tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/CoutureCastStory68.app'
export const COMMIT = '${{ inputs.sha }}'
export const NIGHTLY_COMMIT = '${{ github.sha }}'
export const NIGHTLY_RUN_NAME = 'iOS native ${{ github.sha }}'
// The one shell body every job runs right after its checkout: SHA syntax, then HEAD equality.
export const PROOF = [
  'echo "$SHA" | grep -Eqx \'[0-9a-f]{40}\' || { echo "::error::sha must be a full 40-character commit SHA, got \'$SHA\'"; exit 1; }',
  'test "$(git rev-parse HEAD)" = "$SHA" || { echo "::error::checked out $(git rev-parse HEAD), expected $SHA"; exit 1; }',
  '',
].join('\n')
const ON_DISPATCH = "github.event_name == 'workflow_dispatch'"
const NOT_DISPATCH = "github.event_name != 'workflow_dispatch'"
// The only cache values that are off on a dispatch: the condition itself, or a cache name chosen
// only when it holds. A substring match let `${{ NOT_DISPATCH || 'npm' }}` cache on a dispatch.
const DISPATCH_FREE_CACHE = new RegExp(
  `^\\$\\{\\{ ${NOT_DISPATCH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: && '[a-z]+' \\|\\| '')? \\}\\}$`
)

export const CONSUMER_IF = "${{ !cancelled() && needs.ios-build.result == 'success' }}"
// A dispatch saves no cache, so ios-build hands the scanned client to the consumers of its run as
// this artifact: a tar, since upload-artifact drops the executable bit.
export const CLIENT_ARTIFACT = 'ios-dev-client'
export const CLIENT_DIRECTORY = '${{ runner.temp }}/ios-client'
export const CLIENT_TAR = `${CLIENT_DIRECTORY}/client.tar`
export const CLIENT_PACK =
  'tar -C "$(dirname "$APP")" -cf "$RUNNER_TEMP/ios-client/client.tar" "$(basename "$APP")"'
export const CLIENT_UNPACK =
  'tar -C "$(dirname "$APP")" -xf "$RUNNER_TEMP/ios-client/client.tar"'
const PACK_IF = `\${{ ${ON_DISPATCH} && !cancelled() && steps.app_scan.outcome == 'success' }}`
const HAND_OFF_IF = `\${{ ${ON_DISPATCH} && !cancelled() && steps.client_pack.outcome == 'success' }}`
// GitHub-hosted runners stop any job at 360 minutes.
const HOSTED_JOB_LIMIT = 360
// actions/cache 5.1 is the first to handle a read-only cache token cleanly.
const CACHE_ACTION =
  /^actions\/cache\/(restore|save)@v(5\.([1-9]\d*)|([6-9]|\d{2,})\.\d+)(\.\d+)?$/
const keyOutput = '${{ steps.native_key.outputs.key }}'
const pathOutput = '${{ steps.native_key.outputs.path }}'
const restoredKey = '${{ needs.ios-build.outputs.app-key }}'
const restoredPath = '${{ needs.ios-build.outputs.app-path }}'
const needsList = (job) => [job?.needs ?? []].flat()
const evidenceUpload = (step) =>
  step.uses === 'actions/upload-artifact@v4' &&
  step.with?.path === EVIDENCE_PATH &&
  step.if === 'always()' &&
  step.with?.['if-no-files-found'] === 'error'
const clientUpload = (step) =>
  step.uses === 'actions/upload-artifact@v4' &&
  step.if === HAND_OFF_IF &&
  same(step.with, {
    name: CLIENT_ARTIFACT,
    path: CLIENT_TAR,
    'retention-days': 1,
    'if-no-files-found': 'error',
  })
const clientDownload = (step) =>
  step.uses === 'actions/download-artifact@v4' &&
  step.if === ON_DISPATCH &&
  same(step.with, { name: CLIENT_ARTIFACT, path: CLIENT_DIRECTORY })
// The commands that build a development client; only ios-build runs them.
const CLIENT_BUILD = [
  'run-story68-native.mjs prebuild',
  'run-story68-native.mjs build',
  'native-build-daemons.mjs',
]
const steps = (job) => job?.steps ?? []
const stepIndex = (job, predicate) => steps(job).findIndex(predicate)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const onOf = (workflow) => workflow?.on ?? workflow?.[true]

// IOS-02 and IOS-R2-04: the checks every run keeps. Each entry names the job, how to find the
// step, the one condition it may carry (none means it runs whenever every earlier step passed),
// and the exact lines it must execute: on a line of their own, outside comments, here-documents
// and conditional blocks, with nothing after them that can swallow a failure. Each must exist
// exactly once.
const runs = (command) => (step) => String(step.run ?? '').includes(command)
const INSTALLED = "${{ !cancelled() && steps.install.outcome == 'success' }}"
/** C-16: the client's deployment target against the selected simulator runtime. */
const CLIENT_FITS = [
  'min=$(plutil -extract MinimumOSVersion raw "$APP/Info.plist")',
  'sdk=$(xcrun --sdk iphonesimulator --show-sdk-version)',
  'node scripts/ci/native-ios-runtime-fits.mjs "$min" "$sdk"',
]

export const MANDATORY = [
  [
    'ios-build',
    (step) => step.id === 'deadline_controls',
    INSTALLED,
    ['node scripts/ci/node-test-gate.mjs startup-deadline'],
  ],
  [
    'ios-build',
    (step) => step.id === 'native_key',
    INSTALLED,
    ['node scripts/ci/native-build-cache.mjs key --platform ios >> "$GITHUB_OUTPUT"'],
  ],
  [
    'ios-build',
    (step) => step.id === 'app_scan',
    "${{ !cancelled() && steps.native_build.outcome == 'success' }}",
    [`node scripts/ci/native-ios-app-secret-scan.mjs ${IOS_CLIENT} "$CC68_HARNESS_DIR"`],
  ],
  [
    'ios-build',
    (step) => step.id === 'native_save',
    `\${{ ${NOT_DISPATCH} && !cancelled() && steps.app_scan.outcome == 'success' }}`,
    [],
  ],
  [
    'ios-build',
    (step) => step.id === 'client_pack',
    PACK_IF,
    ['set -euo pipefail', CLIENT_PACK],
  ],
  [
    'ios-shard',
    runs('native-ios-shards.mjs commands'),
    undefined,
    [
      'commands=$(node scripts/ci/native-ios-shards.mjs commands "$shard")',
      'test -n "$commands"',
      'node scripts/run-story68-native.mjs "$command" --platform ios --device "$device" --shard "$shard"',
    ],
  ],
  [
    'ios-expo-go',
    runs('run-story68-native.mjs expo-go-proof'),
    undefined,
    [
      'node scripts/run-story68-native.mjs expo-go-proof --platform ios --device "$device"',
    ],
  ],
  [
    'ios-expo-go',
    runs('node scripts/ci/node-test-gate.mjs native-harness'),
    INSTALLED,
    [
      'node scripts/ci/node-test-gate.mjs share-card-plugins',
      'node scripts/ci/node-test-gate.mjs native-harness',
    ],
  ],
  [
    'ios-expo-go',
    runs('maestro-check-flows.mjs'),
    "${{ !cancelled() && steps.runtime.outcome == 'success' }}",
    ['node scripts/ci/maestro-check-flows.mjs'],
  ],
  [
    'ios-expo-go',
    runs('e2e-share-card/bridge-a11y.mjs'),
    "${{ !cancelled() && steps.runtime.outcome == 'success' && steps.ios_browser.outcome == 'success' }}",
    ['node scripts/e2e-share-card/bridge-a11y.mjs'],
  ],
  [
    'ios-expo-go',
    runs('share-card-header-semantics.sh'),
    '${{ !cancelled() }}',
    ['bash scripts/ci/share-card-header-semantics.sh'],
  ],
  [
    'ios-expo-go',
    runs('swift test --package-path'),
    '${{ !cancelled() }}',
    [
      'set -euo pipefail',
      'swift test --package-path apps/mobile/modules/share-card-photo-save/ios 2>&1 | tee "$RUNNER_TEMP/cc68-png-file-tests.log"',
      'if [ "${count:-0}" -eq 0 ] || [ "${failures:-1}" -ne 0 ]; then echo "::error::swift test ran zero tests or had failures"; exit 1; fi',
    ],
  ],
  [
    'ios-app-build',
    (step) => step.id === 'app_build',
    "${{ !cancelled() && steps.ios_project.outcome == 'success' }}",
    [
      'xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Release -destination \'generic/platform=iOS Simulator\' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build',
    ],
  ],
  [
    'ios-app-build',
    runs('check-accessibility-focus-builds.sh ios-app'),
    "${{ !cancelled() && steps.app_build.outcome == 'success' }}",
    [
      'bash scripts/ci/check-accessibility-focus-builds.sh ios-app "apps/mobile/ios/build/Build/Products/Release-iphonesimulator/$scheme.app/$scheme" apps/mobile/ios',
    ],
  ],
  [
    'ios-evidence',
    runs('native-ios-shards.mjs merge'),
    undefined,
    [
      'test "$CC68_SHARD_RESULT" = success',
      'node scripts/ci/native-ios-shards.mjs merge /tmp/ios-shards',
    ],
  ],
  ...['ios-shard', 'ios-expo-go'].map((job) => [
    job,
    (step) => step.id === 'client_unpack',
    ON_DISPATCH,
    ['set -euo pipefail', CLIENT_UNPACK, 'test -d "$APP"'],
  ]),
  // C-16: on every event, before any flow; a neutralized comparison is a missing one.
  ...['ios-shard', 'ios-expo-go'].map((job) => [
    job,
    (step) => step.id === 'client_fits',
    undefined,
    ['set -euo pipefail', ...CLIENT_FITS],
  ]),
]

/**
 * The lines a shell body executes: continuations joined, comments and blank lines dropped, each
 * marked when it sits inside an if or case block (where a failure may not stop the step).
 */
export function executedLines(run) {
  const lines = []
  const blocks = []
  for (const raw of String(run ?? '')
    .replace(/\s*\\\n\s*/g, ' ')
    .split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    lines.push({ line, conditional: blocks.some((block) => block !== 'loop') })
    if (/^(if|case)\b/.test(line) && !/\b(fi|esac)$/.test(line)) blocks.push('branch')
    else if (/^(for|while|until)\b/.test(line) && !/\bdone$/.test(line))
      blocks.push('loop')
    else if (/^(fi|esac|done)\b/.test(line)) blocks.pop()
    else if (/^\w+\s*\(\)\s*\{?$|^function\b/.test(line)) blocks.push('function')
    else if (line === '}' && blocks.at(-1) === 'function') blocks.pop()
  }
  return lines
}

/** Why a shell body may not execute each required line, or may swallow its failure. */
export function requiredLineProblems(run, required) {
  const lines = executedLines(run)
  const pipefail = lines.findIndex(({ line }) => /^set -[a-z]*o pipefail\b/.test(line))
  const problems = []
  for (const want of required) {
    const index = lines.findIndex(
      ({ line, conditional }) => line === want && !conditional
    )
    if (index < 0) problems.push(`does not execute: ${want}`)
    else if (/(\||&)\s*$/.test(want)) problems.push(`cannot fail its step: ${want}`)
    else if (/[^|]\|[^|]/.test(` ${want} `) && !(pipefail >= 0 && pipefail < index))
      problems.push(`hides a failure in its pipeline: ${want}`)
  }
  return problems
}

/** A condition no run can satisfy, or one that ignores everything before it. */
export function disabledCondition(condition) {
  if (condition === undefined) return false
  if (typeof condition !== 'string') return true
  const body = condition
    .trim()
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/'[^']*'/g, "''")
  return (
    body === '' ||
    /(^|[^\w.-])(false|null|0)(?=$|[^\w.-])/.test(body) ||
    /!\s*\(?\s*(always|success)\(\)/.test(body)
  )
}

/**
 * A shell body that cannot fail its step: an ignored status outside a command substitution, a
 * here-document, `set +e`, or a line that is only `true`, `:` or `exit 0`.
 */
export function neutralizedRun(run) {
  let text = String(run ?? '')
  for (let previous = ''; previous !== text; ) {
    previous = text
    text = text.replace(/\$\([^()]*\)/g, '$()')
  }
  return (
    /\|\|\s*(true|:)(?=\s|;|$)/m.test(text) ||
    /<</.test(text) ||
    /\bset\s+\+e\b/.test(text) ||
    /^\s*(true|:|exit 0)\s*$/m.test(text)
  )
}

/** The conjuncts an `if` requires; none when an `||` could satisfy it another way. */
export function requiredConditions(condition) {
  const body = String(condition ?? '')
    .trim()
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
  if (!body || body.includes('||')) return []
  return body.split('&&').map((part) => part.trim())
}
const requires = (holder, condition) => requiredConditions(holder?.if).includes(condition)

/** The nightly and dispatch caller: main's nightly run may write the caches; a dispatch saves none. */
function nightlyProblems(nightly, check) {
  const on = onOf(nightly)
  check(
    same(Object.keys(on ?? {}).sort(), ['schedule', 'workflow_dispatch']) &&
      (on.workflow_dispatch === null ||
        Object.keys(on.workflow_dispatch ?? {}).length === 0),
    'ios-native.yml runs only nightly and on a manual dispatch without inputs: no macOS job runs on a pull request or a merge'
  )
  const crons = [on?.schedule ?? []].flat().map((entry) => entry?.cron)
  check(
    crons.length === 1 && NIGHTLY.test(String(crons[0])),
    'ios-native needs one nightly schedule: a fixed minute and hour, every day'
  )
  check(
    nightly?.['run-name'] === NIGHTLY_RUN_NAME,
    `ios-native.yml: the run name must be "${NIGHTLY_RUN_NAME}"`
  )
  check(
    same(nightly?.permissions, { contents: 'read' }) &&
      nightly?.['cache-mode'] === undefined &&
      String(nightly?.concurrency?.group ?? '').includes('${{ github.event_name }}') &&
      String(nightly?.concurrency?.group ?? '').includes(NIGHTLY_COMMIT),
    'ios-native.yml: contents: read only, the trusted cache default, and one run per event and commit'
  )
}

/** The nightly caller's one job: the jobs call for github.sha, never the canary. */
function nightlyCallProblems(nightly, check) {
  const jobs = nightly?.jobs ?? {}
  check(
    same(Object.keys(jobs), ['ios-native']),
    'ios-native.yml holds only the jobs call'
  )
  const call = jobs['ios-native']
  check(
    call?.with?.[CANARY_INPUT] === undefined,
    `ios-native.yml never passes ${CANARY_INPUT}: only the nightly canary runs the iOS 26.5 simulator`
  )
  check(
    call?.uses === `./${JOBS_WORKFLOW}` &&
      same(call?.with, { sha: NIGHTLY_COMMIT }) &&
      call?.needs === undefined &&
      call?.if === undefined &&
      call?.['cache-mode'] === undefined &&
      call?.permissions === undefined,
    'ios-native.yml must call the jobs for github.sha on every run'
  )
}

/**
 * C-16: the nightly canary runs the jobs on main's head with the shards and Expo Go on the iOS
 * 26.5 simulator. Schedule only, its own nightly slot and queue, and nothing else in it.
 */
function canaryProblems(canary, nightly, check) {
  const on = onOf(canary)
  const crons = [on?.schedule ?? []].flat().map((entry) => entry?.cron)
  const nightlyCrons = [onOf(nightly)?.schedule ?? []].flat().map((entry) => entry?.cron)
  check(
    same(Object.keys(on ?? {}), ['schedule']) &&
      crons.length === 1 &&
      NIGHTLY.test(String(crons[0])) &&
      !nightlyCrons.includes(crons[0]),
    'ios-native-canary.yml runs only on its own nightly schedule, apart from ios-native.yml'
  )
  check(
    canary?.['run-name'] === CANARY_RUN_NAME &&
      same(canary?.permissions, { contents: 'read' }) &&
      canary?.['cache-mode'] === undefined &&
      same(canary?.concurrency, CANARY_CONCURRENCY),
    `ios-native-canary.yml: run name "${CANARY_RUN_NAME}", contents: read only, and one queued canary at a time`
  )
  const jobs = canary?.jobs ?? {}
  const call = jobs[CANARY_JOB]
  check(
    same(Object.keys(jobs), [CANARY_JOB]) &&
      same(Object.keys(call ?? {}).sort(), ['uses', 'with']) &&
      call.uses === `./${JOBS_WORKFLOW}` &&
      same(call.with, { sha: NIGHTLY_COMMIT, [CANARY_INPUT]: true }),
    `ios-native-canary.yml: one call of the jobs for github.sha with ${CANARY_INPUT}: true`
  )
}

/** The jobs file: called only, with read-only contents and no cache-mode of its own. */
function jobsFileProblems(jobsFile, check) {
  const on = onOf(jobsFile)
  const inputs = on?.workflow_call?.inputs ?? {}
  check(
    same(Object.keys(on ?? {}), ['workflow_call']) &&
      same(Object.keys(inputs).sort(), [CANARY_INPUT, 'sha']) &&
      inputs.sha.required === true &&
      inputs.sha.type === 'string',
    'ios-native-jobs.yml runs only when called, for one required sha'
  )
  const canary = inputs[CANARY_INPUT]
  check(
    canary?.type === 'boolean' && canary.required === false && canary.default === false,
    `ios-native-jobs.yml: ${CANARY_INPUT} is an optional boolean, off unless a caller turns it on`
  )
  const jobs = jobsFile?.jobs ?? {}
  check(
    same(jobsFile?.permissions, { contents: 'read' }) &&
      Object.values(jobs).every((job) => job?.permissions === undefined),
    'ios-native-jobs.yml: contents: read only, on every job'
  )
  check(
    jobsFile?.['cache-mode'] === undefined &&
      Object.values(jobs).every((job) => job?.['cache-mode'] === undefined),
    'ios-native-jobs.yml declares no cache-mode: each caller sets the access its trigger allows'
  )
  check(
    same(Object.keys(jobs).sort(), [...TEST_JOBS].sort()),
    `ios-native-jobs.yml holds exactly ${TEST_JOBS.join(', ')}`
  )
  for (const name of TEST_JOBS) calledJobProblems(name, jobs[name], check)
}

/** One called job: its runner, its limit, the commit proof and, on macOS, the Xcode choice. */
function calledJobProblems(name, job, check) {
  check(job?.['runs-on'] === RUNNERS[name], `${name}: ${RUNNERS[name]} runner required`)
  const limit = job?.['timeout-minutes']
  check(
    Number.isInteger(limit) && limit > 0 && limit <= HOSTED_JOB_LIMIT,
    `${name}: limit must be a fixed number of minutes within the hosted job limit`
  )
  commitProblems(name, job, COMMIT, check)
  if (MACOS_JOBS.includes(name)) xcodeProblems(name, job, check)
}

/** IOS-02: each job's first steps check out the commit and run the exact shared proof. */
function commitProblems(name, job, commit, check) {
  const [checkout, proof] = steps(job)
  check(
    checkout?.uses === 'actions/checkout@v4' &&
      checkout.with?.ref === commit &&
      checkout.if === undefined,
    `${name}: check out the commit under test first`
  )
  check(
    proof?.run === PROOF &&
      proof.env?.SHA === commit &&
      Object.keys(proof.env).length === 1 &&
      proof.if === undefined &&
      proof.shell === undefined &&
      proof['working-directory'] === undefined &&
      proof['continue-on-error'] === undefined,
    `${name}: the second step must fail unless HEAD is exactly the commit under test`
  )
}

/**
 * The job's Xcode, chosen by name right after the commit proof, before anything builds: 26.4 or
 * later, or 16.4, whose iOS 18.5 simulator SDK the startup probe boots the runtime of.
 */
function xcodeProblems(name, job, check) {
  const xcode = stepIndex(job, (step) => step.id === 'xcode')
  const row = steps(job)[xcode]
  const run = String(row?.run ?? '')
  const choice = XCODE_CHOICES[name]
  check(
    xcode === 2 &&
      row.if === undefined &&
      same(row.env, { XCODE: choice }) &&
      [
        '/Xcode_26.*.app',
        '[ "${BASH_REMATCH[1]}" -ge 4 ]',
        '"$root/Xcode_16.4.app"',
        'sudo xcode-select -s',
        'DEVELOPER_DIR=',
        'xcodebuild -version',
        '16.4:18.5 | 26.4+:26.*) ;;',
      ].every((fragment) => run.includes(fragment)),
    `${name}: select Xcode ${XCODE_LABELS[choice]} by name, right after the commit proof, and require its iOS simulator SDK`
  )
}

/** IOS-02: no step or job is disabled, and every mandatory check runs on its own condition. */
function eligibilityProblems(files, check) {
  for (const [file, workflow] of Object.entries(files))
    for (const [name, job] of Object.entries(workflow?.jobs ?? {})) {
      check(
        !disabledCondition(job?.if),
        `${file} ${name}: the job's condition disables it`
      )
      check(
        job?.['continue-on-error'] === undefined &&
          steps(job).every((step) => step['continue-on-error'] === undefined),
        `${name}: failures must remain visible`
      )
      for (const step of steps(job))
        check(
          !disabledCondition(step.if),
          `${name}: "${step.name ?? step.id ?? step.uses}" has a condition that disables it`
        )
    }
  mandatoryProblems(files[JOBS_WORKFLOW]?.jobs ?? {}, check)
}

/** IOS-02: each mandatory check exists once, on its one condition, and can fail its job. */
function mandatoryProblems(jobs, check) {
  for (const [name, predicate, condition, required] of MANDATORY) {
    const found = steps(jobs[name]).filter(predicate)
    const [step] = found
    const label = `${name}: "${step?.name ?? step?.id ?? 'a mandatory check'}"`
    check(
      found.length === 1 &&
        step.if === condition &&
        step.shell === undefined &&
        step['continue-on-error'] === undefined &&
        !neutralizedRun(step.run),
      `${label} must exist once, run on ${condition ?? 'every earlier success'} and fail its job`
    )
    if (found.length === 1)
      for (const problem of requiredLineProblems(step.run, required))
        check(false, `${label} ${problem}`)
  }
}

/** One build, then the four shards and Expo Go in parallel on what it cached or built. */
function shapeProblems(jobs, check) {
  const { 'ios-build': build, 'ios-shard': shard, 'ios-expo-go': expoGo } = jobs
  check(
    build?.needs === undefined && build?.if === undefined,
    'ios-build starts every run, a dispatch included: it alone builds the client'
  )
  check(
    jobs['ios-app-build']?.needs === undefined && jobs['ios-app-build']?.if === undefined,
    'ios-app-build runs beside the client build'
  )
  for (const [name, job] of [
    ['ios-shard', shard],
    ['ios-expo-go', expoGo],
  ])
    check(
      same(needsList(job), ['ios-build']) && job?.if === CONSUMER_IF,
      `${name} must need exactly ios-build and run only after it succeeded`
    )
  check(
    same(shard?.strategy?.matrix?.shard, shardsOf('ios')) &&
      shard?.strategy?.['fail-fast'] === false,
    'ios-shard must run every shard of the iOS plan without cancelling a sibling'
  )
  check(
    steps(shard).some((step) => step.run?.includes('native-ios-shards.mjs commands')) &&
      steps(shard).some((step) => step.run?.includes('--shard "$shard"')) &&
      !steps(shard).some((step) => step.run?.includes('expo-go-proof')),
    'ios-shard: every command must receive its shard, and no shard runs the Expo Go proof'
  )
  const evidence = jobs['ios-evidence']
  check(
    same(needsList(evidence), ['ios-shard']) &&
      evidence?.if === 'always()' &&
      steps(evidence).some((step) =>
        step.run?.includes('test "$CC68_SHARD_RESULT" = success')
      ),
    'ios-evidence must run after any shard result and require every shard’s exact cases'
  )
  check(
    expoGo?.strategy === undefined &&
      steps(expoGo).some((step) =>
        step.run?.includes('--platform ios --device "$device"')
      ),
    'ios-expo-go runs the proof once, on its own simulator, without a shard'
  )
}

/** ios-build keys the client, builds only on a miss and caches only what it scanned. */
function clientProblems(build, check) {
  const rows = steps(build)
  const key = stepIndex(build, (step) => step.id === 'native_key')
  check(
    key >= 0 &&
      rows[key].run ===
        'node scripts/ci/native-build-cache.mjs key --platform ios >> "$GITHUB_OUTPUT"',
    'ios-build: the client must be keyed by scripts/ci/native-build-cache.mjs'
  )
  check(
    build?.outputs?.['app-key'] === keyOutput &&
      build?.outputs?.['app-path'] === pathOutput,
    'ios-build: publish the key and path the shards restore'
  )
  const lookup = stepIndex(
    build,
    (step) => step.id === 'native_cache' && step.with?.['lookup-only'] === true
  )
  const java = stepIndex(build, (step) => step.id === 'java')
  const native = stepIndex(build, (step) =>
    step.run?.includes('run-story68-native.mjs build --platform ios')
  )
  check(
    lookup > key &&
      java > lookup &&
      rows[java]?.if?.includes("steps.native_cache.outputs.cache-hit != 'true'") &&
      native > java &&
      rows[native]?.if?.includes("steps.build_window.outcome == 'success'"),
    'ios-build: build only when the key is not cached'
  )
  // The run's consumers take a dispatch's client from the hand-off below, which only a build makes.
  check(
    lookup >= 0 && requires(rows[lookup], NOT_DISPATCH),
    `ios-build: a dispatch always builds the commit's own client; skip the cache lookup with ${NOT_DISPATCH}`
  )
  const scan = stepIndex(build, (step) => step.id === 'app_scan')
  const save = stepIndex(
    build,
    (step) =>
      String(step.uses).startsWith('actions/cache/save') &&
      step.with?.key === keyOutput &&
      step.with?.path === pathOutput
  )
  check(
    native >= 0 &&
      scan > native &&
      rows[scan].run ===
        `node scripts/ci/native-ios-app-secret-scan.mjs ${IOS_CLIENT} "$CC68_HARNESS_DIR"` &&
      save > scan,
    'ios-build: the client must be secret-scanned before it is cached'
  )
  const proof = stepIndex(
    build,
    (step) =>
      String(step.uses).startsWith('actions/cache/restore') &&
      step.with?.key === keyOutput &&
      step.with?.['lookup-only'] === true &&
      step.with?.['fail-on-cache-miss'] === true
  )
  check(
    proof > save && requires(rows[proof], NOT_DISPATCH),
    `ios-build: prove the saved key exists before the shards need it, except on a dispatch, which saves nothing (${NOT_DISPATCH})`
  )
  handOffProblems(build, scan, check)
}

/** On a dispatch ios-build tars the scanned client and uploads it once for the run's consumers. */
function handOffProblems(build, scan, check) {
  const rows = steps(build)
  const pack = stepIndex(build, (step) => step.id === 'client_pack')
  const handOff = stepIndex(build, clientUpload)
  check(
    scan >= 0 &&
      pack > scan &&
      rows[pack].env?.APP === pathOutput &&
      handOff > pack &&
      rows.filter(clientUpload).length === 1,
    `ios-build: on a dispatch, tar the scanned client and upload it once as ${CLIENT_ARTIFACT}, after the scan, kept for one day`
  )
}

/**
 * The shards and Expo Go install only ios-build's scanned client: from the cache on a merge or a
 * nightly run, from the run's artifact on a dispatch. None builds one, and no artifact carries
 * anything else but closed evidence.
 */
function consumerProblems(jobs, check) {
  for (const name of ['ios-shard', 'ios-expo-go']) {
    const rows = steps(jobs[name])
    const restore = stepIndex(
      jobs[name],
      (step) =>
        String(step.uses).startsWith('actions/cache/restore') &&
        step.with?.key === restoredKey &&
        step.with?.path === restoredPath &&
        step.with?.['fail-on-cache-miss'] === true &&
        step.if === NOT_DISPATCH
    )
    const download = stepIndex(jobs[name], clientDownload)
    const unpack = stepIndex(jobs[name], (step) => step.id === 'client_unpack')
    const flows = stepIndex(jobs[name], (step) =>
      String(step.run ?? '').includes('native-ios-startup-probe.mjs --for-native-flow')
    )
    check(
      restore >= 0 && flows > restore,
      `${name}: restore exactly the key ios-build resolved, fail on a miss, and skip it on a dispatch`
    )
    check(
      download >= 0 &&
        rows.filter(clientDownload).length === 1 &&
        unpack > download &&
        rows[unpack].env?.APP === restoredPath &&
        flows > unpack,
      `${name}: on a dispatch, download ${CLIENT_ARTIFACT} and unpack it at the path ios-build resolved, before the flows`
    )
    // C-16: an Xcode 26 client runs on the macos-15 iOS 18.5 runtime only while its deployment
    // target is at most that runtime, so every consumer checks it, on every event, before a flow.
    const fits = stepIndex(
      jobs[name],
      (step) =>
        step.id === 'client_fits' &&
        step.if === undefined &&
        step.env?.APP === restoredPath &&
        CLIENT_FITS.every((line) => String(step.run ?? '').includes(line))
    )
    check(
      fits > restore && fits > unpack && flows > fits,
      `${name}: check the client's MinimumOSVersion against the simulator runtime, on every event, before the flows`
    )
    check(
      !rows.some((step) =>
        CLIENT_BUILD.some((command) => String(step.run ?? '').includes(command))
      ),
      `${name}: install ios-build's scanned client; never build one in the job`
    )
  }
}

/** Artifacts carry closed evidence, the shard reports, and on a dispatch the scanned client. */
function artifactProblems(jobs, check) {
  for (const [name, job] of Object.entries(jobs))
    for (const step of steps(job)) {
      if (String(step.uses).startsWith('actions/download-artifact'))
        check(
          (name === 'ios-evidence' && step.with?.pattern === 'share-card-ios-shard-*') ||
            (['ios-shard', 'ios-expo-go'].includes(name) && clientDownload(step)),
          `${name}: download only the shard reports, or on a dispatch the scanned client`
        )
      if (!String(step.uses).startsWith('actions/upload-artifact')) continue
      check(
        evidenceUpload(step) || (name === 'ios-build' && clientUpload(step)),
        `${name}: upload only closed evidence, always, failing when it is missing, or from ios-build on a dispatch the scanned client`
      )
    }
}

/** Every job that owns a runtime keeps the harness directory, cleans up and selects its evidence. */
function runtimeProblems(jobs, check) {
  for (const name of ['ios-build', 'ios-shard', 'ios-expo-go']) {
    check(
      jobs[name]?.env?.CC68_HARNESS_DIR === HARNESS_DIRECTORY &&
        jobs[name].env.PLAYWRIGHT_SKIP_DB_RESET === 'true',
      `${name}: the harness directory env is required`
    )
    for (const run of [
      'node scripts/e2e-share-card/cleanup.mjs',
      'node scripts/e2e-share-card/public-evidence.mjs',
      'node scripts/ci/native-supabase.mjs stop',
    ])
      check(
        steps(jobs[name]).some((step) => step.if === 'always()' && step.run === run),
        `${name}: ${run} must always run`
      )
    for (const step of steps(jobs[name]))
      for (const line of String(step.run ?? '').split('\n'))
        check(
          !line.includes('run-story68-native.mjs metro') ||
            /run-story68-native\.mjs metro --platform ios(?=\s)/.test(line),
          `${name}: every Metro start must pass --platform ios`
        )
  }
  check(
    steps(jobs['ios-app-build']).some((step) =>
      step.run?.includes('-configuration Release')
    ),
    'ios-app-build: the Release app and its accessibility-focus check are required'
  )
}

/** Where a step can run: only on a dispatch, never on one, or either. */
function dispatchReach(job, step) {
  return {
    dispatchOnly: requires(job, ON_DISPATCH) || requires(step, ON_DISPATCH),
    neverDispatch: requires(job, NOT_DISPATCH) || requires(step, NOT_DISPATCH),
  }
}

/**
 * IOS-01 behind the enforced read-only token: no save step a dispatch can reach, cache actions new
 * enough to honor read-only access, exact restores, and no local action or setup cache on a
 * dispatch.
 */
function cacheStepProblems(name, job, step, check) {
  const uses = String(step.uses ?? '')
  const label = `${name}: "${step.name ?? uses}"`
  const reach = dispatchReach(job, step)
  check(
    !/^actions\/cache@/.test(uses),
    `${label}: a combined actions/cache step saves after any run; restore and save apart`
  )
  if (uses.startsWith('actions/cache/')) {
    check(
      CACHE_ACTION.test(uses),
      `${label}: use actions/cache 5.1 or later, which handles read-only access`
    )
    check(
      step.with?.['restore-keys'] === undefined,
      `${label}: no restore-keys on any cache step`
    )
    if (uses.startsWith('actions/cache/save'))
      check(
        reach.neverDispatch,
        `${label} is reachable from a dispatch: guard it with ${NOT_DISPATCH}`
      )
    else
      check(
        /^\$\{\{ (steps\.[\w-]+\.outputs\.[\w-]+|needs\.ios-build\.outputs\.app-key) \}\}$/.test(
          String(step.with?.key ?? '')
        ),
        `${label}: restore only exact keys from a step output`
      )
  }
  if (uses.startsWith('./'))
    check(
      reach.neverDispatch,
      `${label}: a local action runs the dispatched commit's own code; skip it on a dispatch`
    )
  if (/^actions\/setup-/.test(uses)) {
    const cache = step.with?.cache
    check(
      (cache === undefined && !uses.startsWith('actions/setup-go')) ||
        reach.neverDispatch ||
        DISPATCH_FREE_CACHE.test(String(cache)),
      `${label}: ${uses.split('@')[0].split('/')[1]} caches on a dispatch; set its cache from ${NOT_DISPATCH}`
    )
  }
}

/** Every rule the iOS native workflows keep; an empty list means they keep them all. */
export function iosNativeProblems(files) {
  const problems = []
  const check = (ok, message) => {
    if (!ok) problems.push(message)
  }
  const jobsFile = files[JOBS_WORKFLOW] ?? {}
  const jobs = jobsFile.jobs ?? {}
  for (const file of WORKFLOW_FILES) {
    const on = onOf(files[file])
    check(
      on && !('pull_request' in on) && !('pull_request_target' in on),
      `${file} never runs on a pull request: no macOS job runs on a pull request or gates a merge`
    )
  }
  nightlyProblems(files[NIGHTLY_WORKFLOW], check)
  nightlyCallProblems(files[NIGHTLY_WORKFLOW], check)
  canaryProblems(files[CANARY_WORKFLOW], files[NIGHTLY_WORKFLOW], check)
  jobsFileProblems(jobsFile, check)
  eligibilityProblems(files, check)
  shapeProblems(jobs, check)
  clientProblems(jobs['ios-build'], check)
  consumerProblems(jobs, check)
  artifactProblems(jobs, check)
  runtimeProblems(jobs, check)
  for (const [name, job] of Object.entries(jobs))
    for (const step of steps(job)) cacheStepProblems(name, job, step, check)
  return problems
}

/** The three workflows, parsed, by file name. */
export function readWorkflows(read = (file) => fs.readFileSync(file, 'utf8')) {
  return Object.fromEntries(WORKFLOW_FILES.map((file) => [file, parse(read(file))]))
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const files = readWorkflows()
  const problems = [...iosNativeProblems(files), ...helperProblems(files)]
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else console.log('The iOS native workflows keep every iOS guard.')
}
