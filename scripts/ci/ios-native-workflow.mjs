// Story 6.15 D6, C-13 and IOS-01/02: the rules the three iOS native workflows keep.
//
//   ios-native-jobs.yml      the iOS jobs, called for one commit `sha`: a client scanned before it
//                            is cached and installed only from that scan, every shard with its own
//                            runtime, budget and fail-closed evidence, a merge that fails on a
//                            skipped or partial shard, and every job proving it checked out `sha`.
//   ios-native.yml           a merge to main that changed a native iOS input, and the nightly run.
//                            Trusted main code, so they may write the caches.
//   ios-native-dispatch.yml  a commit that has not merged. cache-mode: read on the workflow and on
//                            every job makes GitHub issue a read-only cache token, so the code it
//                            runs cannot save a cache main's runs restore; each consumer job builds
//                            its own client, and ios-cache-proof shows nothing was stored.
//
// The rules check that each control is present, eligible to run (no disabled or bypassable
// condition) and able to fail its job.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { helperProblems } from './ios-native-helpers.mjs'
import { PUSH_ONLY_PATHS } from './ios-native-inputs.mjs'
import { shardsOf } from './native-matrix-shards.mjs'

export const PUSH_WORKFLOW = '.github/workflows/ios-native.yml'
export const DISPATCH_WORKFLOW = '.github/workflows/ios-native-dispatch.yml'
export const JOBS_WORKFLOW = '.github/workflows/ios-native-jobs.yml'
export const WORKFLOW_FILES = [PUSH_WORKFLOW, DISPATCH_WORKFLOW, JOBS_WORKFLOW]
export const MACOS_JOBS = ['ios-build', 'ios-shard', 'ios-expo-go', 'ios-app-build']
export const TEST_JOBS = [...MACOS_JOBS, 'ios-evidence']
export const DECISION_JOB = 'ios-changes'
export const PROBE_JOB = 'ios-cache-proof'
export const GATE_JOB = 'ios-dispatch-gate'
export const HARNESS_DIRECTORY = '_bmad-output/test-artifacts/story-6-8/runtime'
export const EVIDENCE_PATH = `${HARNESS_DIRECTORY}/public-evidence/`
export const IOS_CLIENT =
  '/tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/CoutureCastStory68.app'
export const COMMIT = '${{ inputs.sha }}'
export const PUSH_COMMIT = '${{ github.sha }}'
export const RUN_NAME = 'iOS native ${{ inputs.sha }}'
export const PUSH_RUN_NAME = 'iOS native ${{ github.sha }}'
// The one shell body every job runs right after its checkout: SHA syntax, then HEAD equality.
export const PROOF = [
  'echo "$SHA" | grep -Eqx \'[0-9a-f]{40}\' || { echo "::error::sha must be a full 40-character commit SHA, got \'$SHA\'"; exit 1; }',
  'test "$(git rev-parse HEAD)" = "$SHA" || { echo "::error::checked out $(git rev-parse HEAD), expected $SHA"; exit 1; }',
  '',
].join('\n')
const ON_DISPATCH = "github.event_name == 'workflow_dispatch'"
const NOT_DISPATCH = "github.event_name != 'workflow_dispatch'"
export const RUN_IF = "${{ needs.ios-changes.outputs.run == 'true' }}"
// The ios-native call's group: merges share one and the nightly run has its own.
export const PUSH_GROUP =
  "${{ github.event_name == 'schedule' && 'ios-native-nightly' || 'ios-native-main-push' }}"
export const CONSUMER_IF = `\${{ !cancelled() && (needs.ios-build.result == 'success' || (${ON_DISPATCH} && needs.ios-build.result == 'skipped')) }}`
// A dispatch builds the client in the job first, 31 minutes at p95, before the shard's 70.
export const CONSUMER_LIMITS = {
  'ios-shard': `\${{ ${ON_DISPATCH} && 110 || 70 }}`,
  'ios-expo-go': `\${{ ${ON_DISPATCH} && 95 || 60 }}`,
}
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
const steps = (job) => job?.steps ?? []
const stepIndex = (job, predicate) => steps(job).findIndex(predicate)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const onOf = (workflow) => workflow?.on ?? workflow?.[true]

/** The steps a dispatch builds its own client with, in each consumer, before the cache restore. */
export const DISPATCH_BUILD = [
  {
    id: 'prebuild',
    if: ON_DISPATCH,
    run: 'node scripts/run-story68-native.mjs prebuild --platform ios',
  },
  {
    id: 'build_window',
    if: ON_DISPATCH,
    run: 'node scripts/ci/native-build-daemons.mjs mark',
  },
  {
    id: 'native_build',
    if: ON_DISPATCH,
    run: 'node scripts/run-story68-native.mjs build --platform ios',
  },
]

// IOS-02 and IOS-R2-04: the checks every run keeps. Each entry names the job, how to find the
// step, the one condition it may carry (none means it runs whenever every earlier step passed),
// and the exact lines it must execute: on a line of their own, outside comments, here-documents
// and conditional blocks, with nothing after them that can swallow a failure. Each must exist
// exactly once.
const runs = (command) => (step) => String(step.run ?? '').includes(command)
const INSTALLED = "${{ !cancelled() && steps.install.outcome == 'success' }}"
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
    "${{ !cancelled() && steps.app_scan.outcome == 'success' }}",
    [],
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
  ...['ios-shard', 'ios-expo-go'].flatMap((job) =>
    DISPATCH_BUILD.map(({ id, if: condition, run }) => [
      job,
      (step) => step.id === id,
      condition,
      [run],
    ])
  ),
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

/** The push and nightly caller: main's own code, which may write the caches. */
function pushProblems(push, check) {
  const on = onOf(push)
  check(
    same(Object.keys(on ?? {}).sort(), ['push', 'schedule']),
    'ios-native.yml runs only on a merge to main and nightly; a pull request commit runs ios-native-dispatch.yml'
  )
  check(
    same(on?.push?.branches, ['main']) &&
      Array.isArray(on?.push?.paths) &&
      on.push.paths.includes(PUSH_WORKFLOW) &&
      on.push.paths.includes(JOBS_WORKFLOW),
    'ios-native runs on a merge to main, filtered by its native iOS inputs, its own file and the jobs'
  )
  // C-14: the JavaScript block leads the list, so the native entries after it keep their tests.
  const paths = Array.isArray(on?.push?.paths) ? on.push.paths : []
  check(
    same(paths.slice(0, PUSH_ONLY_PATHS.length), PUSH_ONLY_PATHS),
    'ios-native.yml: the push paths start with PUSH_ONLY_PATHS (scripts/ci/ios-native-inputs.mjs), so a JavaScript-only merge runs iOS'
  )
  const crons = [on?.schedule ?? []].flat().map((entry) => entry?.cron)
  check(
    crons.length === 1 && /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/.test(String(crons[0])),
    'ios-native needs one nightly schedule: a fixed minute and hour, every day'
  )
  check(
    push?.['run-name'] === PUSH_RUN_NAME,
    `ios-native.yml: the run name must be "${PUSH_RUN_NAME}"`
  )
  check(
    same(push?.permissions, { contents: 'read' }) && push?.['cache-mode'] === undefined,
    'ios-native.yml: contents: read only, the trusted cache default'
  )
  // A run in progress finishes, the newest pending one waits, and ios-changes runs ungrouped.
  const jobs = push?.jobs ?? {}
  check(
    push?.concurrency === undefined &&
      Object.entries(jobs).every(([name, job]) =>
        name === 'ios-native'
          ? same(job?.concurrency, { group: PUSH_GROUP, 'cancel-in-progress': false })
          : job?.concurrency === undefined
      ),
    `ios-native.yml: one group, on the ios-native call only: ${PUSH_GROUP} without cancelling a run in progress`
  )
}

/** The merge caller's jobs: ios-changes decides, then the jobs run for github.sha. */
function pushJobProblems(push, check) {
  const jobs = push?.jobs ?? {}
  check(
    same(Object.keys(jobs).sort(), [DECISION_JOB, 'ios-native']),
    'ios-native.yml holds ios-changes and the jobs call'
  )
  const call = jobs['ios-native']
  check(
    call?.uses === `./${JOBS_WORKFLOW}` &&
      same(call?.with, { sha: PUSH_COMMIT }) &&
      call?.needs === DECISION_JOB &&
      call?.if === RUN_IF &&
      call?.['cache-mode'] === undefined &&
      call?.permissions === undefined,
    'ios-native.yml must call the jobs for github.sha, skipping only a run whose ios-changes decided run=false'
  )
  const decision = jobs[DECISION_JOB]
  check(
    decision?.['runs-on'] === 'ubuntu-latest' &&
      decision?.['timeout-minutes'] === 5 &&
      same(decision?.permissions, { actions: 'read', contents: 'read' }),
    'ios-changes: a 5-minute Linux job with actions: read and contents: read only'
  )
  commitProblems(`ios-native.yml ${DECISION_JOB}`, decision, PUSH_COMMIT, check)
  const step = steps(decision).find((row) => row.id === 'changes')
  check(
    decision?.outputs?.run === '${{ steps.changes.outputs.run }}' &&
      step?.run === 'node scripts/ci/ios-native-inputs.mjs push-changes' &&
      same(step.env, {
        EVENT: '${{ github.event_name }}',
        BEFORE: '${{ github.event.before }}',
        SHA: PUSH_COMMIT,
        GITHUB_TOKEN: '${{ github.token }}',
      }) &&
      step.if === undefined &&
      steps(decision).at(-1) === step,
    'ios-changes: decide from scripts/ci/ios-native-inputs.mjs with the event, the commit before the merge, the commit and a token'
  )
}

/** IOS-01: the dispatch caller grants read-only cache access to every job, enforced by GitHub. */
function dispatchProblems(dispatch, check) {
  const on = onOf(dispatch)
  const sha = on?.workflow_dispatch?.inputs?.sha
  check(
    same(Object.keys(on ?? {}), ['workflow_dispatch']) &&
      sha?.required === true &&
      sha.type === 'string' &&
      Object.keys(on.workflow_dispatch.inputs).length === 1,
    'ios-native-dispatch.yml runs only on a dispatch naming exactly one commit, by a required sha input'
  )
  check(
    dispatch?.['run-name'] === RUN_NAME,
    `ios-native-dispatch.yml: the run name must be "${RUN_NAME}"`
  )
  const jobs = dispatch?.jobs ?? {}
  check(
    dispatch?.['cache-mode'] === 'read' &&
      Object.values(jobs).length > 0 &&
      Object.values(jobs).every((job) => job?.['cache-mode'] === 'read'),
    'ios-native-dispatch.yml: cache-mode: read on the workflow and on every job, so no job can save a cache'
  )
  check(
    same(Object.keys(jobs).sort(), [PROBE_JOB, GATE_JOB, 'ios-native']),
    'ios-native-dispatch.yml holds ios-dispatch-gate, the jobs call and ios-cache-proof'
  )
  const call = jobs['ios-native']
  check(
    same(dispatch?.permissions, { contents: 'read' }) &&
      call?.uses === `./${JOBS_WORKFLOW}` &&
      same(call?.with, { sha: COMMIT }) &&
      call?.permissions === undefined &&
      call?.if === undefined &&
      call?.needs === GATE_JOB,
    'ios-native-dispatch.yml: call the jobs for inputs.sha with contents: read only, after ios-dispatch-gate'
  )
  check(
    jobs[PROBE_JOB]?.needs === GATE_JOB && jobs[PROBE_JOB]?.if === undefined,
    'ios-cache-proof runs after ios-dispatch-gate'
  )
  gateProblems(jobs[GATE_JOB], check)
  probeProblems(jobs[PROBE_JOB], check)
}

/** A 5-minute Linux job, first in the dispatch, with actions: read and contents: read only. */
const gateJob = (gate) =>
  gate?.['runs-on'] === 'ubuntu-latest' &&
  gate?.['timeout-minutes'] === 5 &&
  gate?.if === undefined &&
  gate?.needs === undefined &&
  same(gate?.permissions, { actions: 'read', contents: 'read' })

/** main's rules: a checkout of the default branch without credentials, then Node. */
const mainRules = ([checkout = {}, node = {}]) =>
  String(checkout.uses).startsWith('actions/checkout@') &&
  checkout.with?.ref === '${{ github.event.repository.default_branch }}' &&
  checkout.with?.['persist-credentials'] === false &&
  String(node.uses).startsWith('actions/setup-node@')

/**
 * ios-dispatch-gate fails a dispatch of a commit that already passed: main's rules from a sparse
 * checkout, actions: read, and a last step that runs and can fail.
 */
function gateProblems(gate, check) {
  const rows = steps(gate)
  const decide = rows[2] ?? {}
  check(
    gateJob(gate) &&
      rows.length === 3 &&
      mainRules(rows) &&
      decide.run === 'node scripts/ci/ios-native-inputs.mjs dispatch-gate' &&
      same(decide.env, { GITHUB_TOKEN: '${{ github.token }}', SHA: COMMIT }),
    "ios-dispatch-gate: main's sparse rules, actions: read and contents: read, then dispatch-gate for inputs.sha"
  )
  for (const row of rows)
    check(
      !disabledCondition(row.if) &&
        row.if === undefined &&
        row['continue-on-error'] === undefined &&
        !neutralizedRun(row.run),
      `ios-dispatch-gate: "${row.name ?? row.uses}" must run and be able to fail`
    )
}

/** ios-cache-proof tries a save and a direct cache API write, and fails if either stored anything. */
function probeProblems(probe, check) {
  const rows = steps(probe)
  check(
    same(probe?.permissions, { actions: 'read' }) &&
      probe?.['runs-on'] === 'ubuntu-latest' &&
      rows.length === 4 &&
      !rows.some((row) => /^actions\/checkout|^\.\//.test(String(row.uses ?? ''))) &&
      String(probe?.env?.PROBE ?? '').startsWith(
        'ios-native-dispatch-probe-${{ github.run_id }}'
      ),
    'ios-cache-proof: actions: read only, no checkout and no local action, four steps'
  )
  probeStepProblems(rows, check)
}

/** The four probe steps: list, save, reserve through the API, list again and fail on any entry. */
function probeStepProblems(rows, check) {
  const [before = {}, save = {}, api = {}, after = {}] = rows.map((row) => row ?? {})
  const script = String(api.with?.script ?? '')
  const saves =
    CACHE_ACTION.test(String(save.uses)) &&
    String(save.uses).startsWith('actions/cache/save') &&
    save.with?.key === '${{ env.PROBE }}-save'
  const reserves =
    String(api.uses).startsWith('actions/github-script@') &&
    [
      /CreateCacheEntry/,
      /ACTIONS_CACHE_MODE/,
      /core\.setFailed\('The cache service reserved a writable entry/,
    ].every((pattern) => pattern.test(script))
  check(
    /gh api -X GET "repos\/\$GH_REPO\/actions\/caches" -f key="\$PROBE"/.test(
      String(before.run)
    ) &&
      saves &&
      reserves &&
      after.if === '${{ !cancelled() }}' &&
      /if \[ -n "\$entries" \]; then[\s\S]*exit 1/.test(String(after.run)),
    'ios-cache-proof: list, save, reserve through the API, then fail if any probe entry exists'
  )
  for (const row of rows)
    check(
      !disabledCondition(row.if) &&
        row['continue-on-error'] === undefined &&
        !neutralizedRun(row.run),
      `ios-cache-proof: "${row.name}" must run and be able to fail`
    )
}

/** The jobs file: called only, with read-only contents and no cache-mode of its own. */
function jobsFileProblems(jobsFile, check) {
  const on = onOf(jobsFile)
  check(
    same(Object.keys(on ?? {}), ['workflow_call']) &&
      same(Object.keys(on.workflow_call?.inputs ?? {}), ['sha']) &&
      on.workflow_call.inputs.sha.required === true &&
      on.workflow_call.inputs.sha.type === 'string',
    'ios-native-jobs.yml runs only when called, for one required sha'
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
  const macos = MACOS_JOBS.includes(name)
  check(
    job?.['runs-on'] === (macos ? 'macos-26' : 'ubuntu-latest'),
    `${name}: ${macos ? 'macos-26' : 'ubuntu-latest'} runner required`
  )
  const limit = job?.['timeout-minutes']
  check(
    CONSUMER_LIMITS[name]
      ? limit === CONSUMER_LIMITS[name]
      : Number.isInteger(limit) && limit > 0 && limit <= HOSTED_JOB_LIMIT,
    `${name}: limit must stay within the hosted job limit${CONSUMER_LIMITS[name] ? `, as ${CONSUMER_LIMITS[name]}` : ''}`
  )
  commitProblems(name, job, COMMIT, check)
  if (macos) xcodeProblems(name, job, check)
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

/** Xcode 26.4 or later, chosen by name right after the commit proof, before anything builds. */
function xcodeProblems(name, job, check) {
  const xcode = stepIndex(job, (step) => step.id === 'xcode')
  const run = steps(job)[xcode]?.run ?? ''
  check(
    xcode === 2 &&
      steps(job)[xcode].if === undefined &&
      run.includes('/Xcode_26.*.app') &&
      run.includes('[ "${BASH_REMATCH[1]}" -ge 4 ]') &&
      run.includes('sudo xcode-select -s') &&
      run.includes('DEVELOPER_DIR=') &&
      run.includes('xcodebuild -version'),
    `${name}: select Xcode 26.4 or later by name, right after the commit proof`
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
    build?.needs === undefined && build?.if === `\${{ ${NOT_DISPATCH} }}`,
    'ios-build fills the cache: it starts the run, and a dispatch skips it'
  )
  // A dispatch skips the whole job, so a step-level dispatch branch in it is dead code.
  check(
    !JSON.stringify(steps(build)).includes('workflow_dispatch'),
    'ios-build: no step branches on a dispatch, which never runs the job'
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
      `${name} must need exactly ios-build, and run after it or, on a dispatch, without it`
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
  check(
    stepIndex(
      build,
      (step) =>
        String(step.uses).startsWith('actions/cache/restore') &&
        step.with?.key === keyOutput &&
        step.with?.['lookup-only'] === true &&
        step.with?.['fail-on-cache-miss'] === true
    ) > save,
    'ios-build: prove the saved key exists before the shards need it'
  )
}

/** The shards and Expo Go restore ios-build's scanned client, or on a dispatch build their own. */
function consumerProblems(jobs, check) {
  for (const name of ['ios-shard', 'ios-expo-go']) {
    const restore = stepIndex(
      jobs[name],
      (step) =>
        String(step.uses).startsWith('actions/cache/restore') &&
        step.with?.key === restoredKey &&
        step.with?.path === restoredPath &&
        step.with?.['fail-on-cache-miss'] === true &&
        step.if === NOT_DISPATCH
    )
    check(
      restore >= 0,
      `${name}: restore exactly the key ios-build resolved, fail on a miss, and skip it on a dispatch`
    )
    const build = DISPATCH_BUILD.map(({ id, run }) =>
      stepIndex(jobs[name], (step) => step.id === id && step.run === run)
    )
    check(
      build.every((index, at) => index >= 0 && (at === 0 || index > build[at - 1])) &&
        build.at(-1) < restore,
      `${name}: a dispatch builds its own client before the restore it skips`
    )
  }
  for (const [name, job] of Object.entries(jobs))
    for (const step of steps(job)) {
      if (step.uses === 'actions/download-artifact@v4' && name !== 'ios-evidence')
        check(false, `${name}: the client travels by cache only, never as an artifact`)
      if (step.uses !== 'actions/upload-artifact@v4') continue
      check(
        step.with?.path === EVIDENCE_PATH &&
          step.if === 'always()' &&
          step.with?.['if-no-files-found'] === 'error',
        `${name}: upload only closed evidence, always, failing when it is missing`
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
        String(cache).includes(NOT_DISPATCH),
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
      `${file} never runs on a pull request: a run must test main’s copy of these workflows`
    )
  }
  pushProblems(files[PUSH_WORKFLOW], check)
  pushJobProblems(files[PUSH_WORKFLOW], check)
  dispatchProblems(files[DISPATCH_WORKFLOW], check)
  jobsFileProblems(jobsFile, check)
  eligibilityProblems(files, check)
  shapeProblems(jobs, check)
  clientProblems(jobs['ios-build'], check)
  consumerProblems(jobs, check)
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
