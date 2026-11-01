// Story 6.8 Task 12 step 1 owner: enforce lane triggers and the gate in `scripts/ci/share-card-lanes.mjs`
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { matrixRows } from './workflow-step-shadowing.mjs'
import { shardsOf } from './native-matrix-shards.mjs'
import {
  pullRequestEvent,
  pullRequestShareCardJobs,
  requiredShareCardJobs,
} from './share-card-job-gate.mjs'

/**
 * The sharded Android lanes: each runs one row per shard of its plan, suites `<suite>-N`, and an
 * evidence job proves every shard reported exactly its cases.
 */
export const shardedAndroidLanes = Object.freeze({
  'original-resource': Object.freeze({
    plan: 'android-32',
    suite: 'all',
    evidence: 'original-resource-evidence',
  }),
  'android36-native-matrix': Object.freeze({
    plan: 'android-36',
    suite: 'matrix',
    evidence: 'android36-matrix-evidence',
  }),
})
const shardSuites = (job) => {
  const { plan, suite } = shardedAndroidLanes[job]
  return Object.freeze(shardsOf(plan).map((shard) => `${suite}-${shard}`))
}
// Every other API36 lane runs one row.
export const android36Lanes = Object.freeze({
  'browser-acceptance': ['browser'],
  'android36-native-matrix': shardSuites('android36-native-matrix'),
  'android36-original': ['original'],
  'android36-controls': ['controls'],
  'android36-interaction': ['interaction'],
})
// pr-gate.yml publishes the required ruleset context gate as a commit status; no job or
// check run may take that name.
export const gateJobName = 'share-card-lanes-gate'
const reservedContext = 'gate'
// Every device lane takes over an hour, so a pull request runs only the lanes in
// pullRequestShareCardJobs. The rest carry this job-level condition; the gate expects them
// skipped on pull_request and successful on main, the nightly schedule and dispatch.
export const deviceLaneCondition = `github.event_name != '${pullRequestEvent}'`
export const evidenceCondition = `always() && ${deviceLaneCondition}`
// The Expo Go proof runs alone on a fresh simulator, like every other device lane: skipped on a
// pull request, required by share-card-lanes-gate on main, nightly and dispatch runs.
export const expoGoJobName = 'ios-expo-go'
export const expoGoLaneCondition = deviceLaneCondition
const deviceLaneIf = (name) =>
  pullRequestShareCardJobs.includes(name) ? undefined : deviceLaneCondition
const emulatorAction = 'reactivecircus/android-emulator-runner@v2'
const nativeSdkActions = ['actions/setup-java@v4', 'android-actions/setup-android@v3']
const maxMinutes = 90
const iosMaxMinutes = 150
const iosHarnessDirectory = '_bmad-output/test-artifacts/story-6-8/runtime'
const includesRun = (steps, command) => steps.some((step) => step.run?.includes(command))
const stepIsAlways = (steps, run) =>
  steps.some((step) => step.if === 'always()' && step.run === run)

function triggerProblems(on, check) {
  check(
    on !== null &&
      typeof on === 'object' &&
      pullRequestEvent in on &&
      JSON.stringify(on.push?.branches) === JSON.stringify(['main']) &&
      'workflow_dispatch' in on,
    'workflow must trigger on pull_request, push to main and workflow_dispatch'
  )
  const crons = [on?.schedule ?? []].flat().map((entry) => entry?.cron)
  check(
    crons.length > 0 && crons.every((cron) => /^\S+( \S+){4}$/.test(String(cron))),
    'the device lanes need a nightly schedule'
  )
}

function gateProblems(jobs, check) {
  check(
    Object.entries(jobs).every(
      ([id, job]) => id !== reservedContext && job?.name !== reservedContext
    ),
    `no job id or name may be ${reservedContext}: it is the required ruleset context`
  )
  const gate = jobs[gateJobName] ?? {}
  check(gate.name === gateJobName, `${gateJobName}: explicit job name required`)
  check(gate.if === 'always()', 'gate must run after failure and cancellation')
  check(
    JSON.stringify([...(gate.needs ?? [])].sort()) ===
      JSON.stringify([...requiredShareCardJobs].sort()),
    'gate must require every browser and native partition'
  )
  check(gate['continue-on-error'] === undefined, 'gate cannot hide failure')
  check(
    gate.steps?.find((step) => step.run === 'node scripts/ci/share-card-job-gate.mjs')
      ?.env?.CC68_EVENT_NAME === '${{ github.event_name }}',
    'gate must know the triggering event to expect skipped device lanes on pull_request'
  )
  const gateStep = gate.steps?.find(
    (step) => step.run === 'node scripts/ci/share-card-job-gate.mjs'
  )
  check(
    gateStep?.env?.CC68_JOB_RESULTS === '${{ toJSON(needs) }}' &&
      gateStep['continue-on-error'] === undefined &&
      gateStep.if === undefined,
    'gate must check actual dependency results without a bypass'
  )
}

/** The API32 journey: one row per shard of the android-32 plan, each with a journey budget. */
function legacyProblems(jobs, check) {
  const legacy = jobs['original-resource']
  androidClientCacheProblems('original-resource', legacy?.steps ?? [], check)
  const rows = matrixRows(legacy?.strategy?.matrix) ?? []
  const suites = shardSuites('original-resource')
  check(
    rows.length === suites.length &&
      rows.every(
        (row, index) =>
          row?.platform === 'android' &&
          row?.api === 32 &&
          row?.target === 'google_apis' &&
          row?.suite === suites[index]
      ),
    'original-resource: exact API32 shards required, one row per shard'
  )
  check(legacy?.needs === undefined, 'original-resource must start independently')
  check(
    legacy?.if === deviceLaneCondition,
    'original-resource must be skipped on pull_request'
  )
  check(
    legacy?.strategy?.['fail-fast'] === false,
    'original-resource: failures must preserve sibling evidence'
  )
  // Run 41202706840 took 83 of the job's 90 minutes as one 62.7 minute journey, so each shard
  // has a journey budget and the job keeps its limit for preparation and cleanup.
  const emulator = (legacy?.steps ?? []).find((step) => step.uses === emulatorAction)
  check(
    emulator?.['timeout-minutes'] === '${{ matrix.journey_timeout }}' &&
      rows.every(
        (row) =>
          Number.isInteger(row?.journey_timeout) &&
          row.journey_timeout > 0 &&
          legacy['timeout-minutes'] - row.journey_timeout >= 25
      ),
    'original-resource: journey must leave preparation and cleanup budget'
  )
  check(
    legacy?.['timeout-minutes'] === maxMinutes,
    'original-resource: the job keeps its 90 minute limit'
  )
}

const needsList = (job) => [job?.needs ?? []].flat()
const uploads = (job) =>
  (job?.steps ?? []).filter((step) => step.uses === 'actions/upload-artifact@v4')
const stepIndex = (job, predicate) => (job?.steps ?? []).findIndex(predicate)

/** Runner, limit and visibility rules for each of the three iOS jobs. */
function iosJobProblems(jobs, check) {
  for (const [name, runner] of [
    ['ios-build', 'macos-15'],
    ['ios-shard', 'macos-15'],
    [expoGoJobName, 'macos-15'],
    ['ios-evidence', 'ubuntu-latest'],
  ]) {
    const job = jobs[name]
    check(job !== undefined, `${name}: required iOS job missing`)
    check(job?.['runs-on'] === runner, `${name}: free ${runner} runner required`)
    check(
      job?.['continue-on-error'] === undefined,
      `${name}: failures must remain visible`
    )
    check(
      (job?.steps ?? []).every((step) => step['continue-on-error'] === undefined),
      `${name}: steps cannot hide failures`
    )
    const limit = job?.['timeout-minutes']
    check(
      Number.isInteger(limit) && limit > 0 && limit <= iosMaxMinutes,
      `${name}: independent limit must stay within ${iosMaxMinutes} minutes`
    )
  }
}

function iosShapeProblems({ build, shard, evidence, expoGo }, check) {
  check(build?.needs === undefined, 'ios-build must start independently')
  check(build?.if === deviceLaneCondition, 'ios-build must be skipped on pull_request')
  check(shard?.if === deviceLaneCondition, 'ios-shard must be skipped on pull_request')
  check(
    JSON.stringify(needsList(shard)) === JSON.stringify(['ios-build']),
    'ios-shard must need exactly ios-build'
  )
  check(
    JSON.stringify(needsList(evidence)) === JSON.stringify(['ios-shard']) &&
      evidence?.if === evidenceCondition,
    'ios-evidence must run after any ios-shard result, except on pull_request'
  )
  check(
    JSON.stringify(shard?.strategy?.matrix?.shard) === JSON.stringify(shardsOf('ios')) &&
      shard?.strategy?.['fail-fast'] === false,
    'ios-shard must run every shard of the iOS plan without cancelling a sibling'
  )
  check(
    includesRun(shard?.steps ?? [], 'native-ios-shards.mjs commands') &&
      includesRun(shard?.steps ?? [], '--shard "$shard"'),
    'ios-shard: every command must receive its shard'
  )
  check(
    includesRun(evidence?.steps ?? [], 'native-ios-shards.mjs merge') &&
      includesRun(evidence?.steps ?? [], 'test "$CC68_SHARD_RESULT" = success'),
    'ios-evidence: every shard must report its exact cases'
  )
  expoGoProblems({ shard, expoGo }, check)
}

/**
 * The Expo Go proof: its own job on a fresh simulator, off every pull request and out of the
 * gate. The shard steps it shares run the same setup text as the shards, so a change to one
 * cannot leave the other behind.
 */
function expoGoProblems({ shard, expoGo }, check) {
  const name = expoGoJobName
  check(
    expoGo?.if === expoGoLaneCondition,
    `${name} must skip pull requests like the other device lanes`
  )
  check(
    JSON.stringify(needsList(expoGo)) === JSON.stringify(['ios-build']),
    `${name} must need exactly ios-build`
  )
  check(
    expoGo?.strategy === undefined,
    `${name} runs once on its own simulator, not in a matrix`
  )
  const proof = (expoGo?.steps ?? []).filter((step) =>
    step.run?.includes('run-story68-native.mjs expo-go-proof')
  )
  check(
    proof.length === 1 &&
      proof[0].run.includes('--platform ios --device "$device"') &&
      !proof[0].run.includes('--shard') &&
      includesRun(expoGo?.steps ?? [], 'native-ios-startup-probe.mjs --for-native-flow'),
    `${name}: the proof must run once, on the probe's simulator, without a shard`
  )
  check(
    !includesRun(shard?.steps ?? [], 'expo-go-proof'),
    'ios-shard must not run the Expo Go proof'
  )
  const shared = (shard?.steps ?? []).findIndex((step) => step.name === 'iOS shard flows')
  check(
    shared > 0 &&
      JSON.stringify((expoGo?.steps ?? []).slice(0, shared)) ===
        JSON.stringify((shard?.steps ?? []).slice(0, shared)),
    `${name}: the runtime setup must be the ios-shard setup, step for step`
  )
}

function iosEvidenceProblems(jobs, check) {
  for (const name of ['ios-build', 'ios-shard', expoGoJobName]) {
    const job = jobs[name]
    check(
      job?.env?.CC68_HARNESS_DIR === iosHarnessDirectory,
      `${name}: the harness directory env is required`
    )
    check(
      stepIsAlways(job?.steps ?? [], 'node scripts/e2e-share-card/cleanup.mjs'),
      `${name}: owned cleanup must always run`
    )
    check(
      (job?.steps ?? []).some(
        (step) =>
          step.if === 'always()' &&
          step.run === 'node scripts/e2e-share-card/public-evidence.mjs'
      ),
      `${name}: closed evidence must always be selected`
    )
    const evidenceUpload = uploads(job).find(
      (step) => step.with?.path === `${iosHarnessDirectory}/public-evidence/`
    )
    check(
      evidenceUpload?.if === 'always()' &&
        evidenceUpload.with?.['if-no-files-found'] === 'error',
      `${name}: evidence upload must fail closed`
    )
  }
}

const iosClient =
  '/tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/CoutureCastStory68.app'
const keyOutput = '${{ steps.native_key.outputs.key }}'
const pathOutput = '${{ steps.native_key.outputs.path }}'
const cacheStep = (job, action, predicate = () => true) =>
  stepIndex(
    job,
    (step) =>
      step.uses === `actions/cache/${action}@v4` &&
      step.with?.key === keyOutput &&
      step.with?.path === pathOutput &&
      predicate(step)
  )

/** ios-build keys the client, looks the key up and builds only on a miss. */
function iosBuildKeyProblems(build, check) {
  const steps = build?.steps ?? []
  const key = stepIndex(build, (step) => step.id === 'native_key')
  check(
    key >= 0 &&
      steps[key].run ===
        'node scripts/ci/native-build-cache.mjs key --platform ios >> "$GITHUB_OUTPUT"',
    'ios-build: the client must be keyed by scripts/ci/native-build-cache.mjs'
  )
  const lookup = cacheStep(build, 'restore', (step) => step.with['lookup-only'] === true)
  check(
    lookup > key && steps[lookup]?.id === 'native_cache',
    'ios-build: look the key up before building'
  )
  check(
    build?.outputs?.['app-key'] === keyOutput &&
      build?.outputs?.['app-path'] === pathOutput,
    'ios-build: publish the key and path the shards restore'
  )
  const native = stepIndex(build, (step) =>
    step.run?.includes('run-story68-native.mjs build --platform ios')
  )
  // Every step of the build path waits on a miss: java starts it and each later step needs it.
  const java = stepIndex(build, (step) => step.id === 'java')
  check(
    java > lookup &&
      steps[java]?.if?.includes("steps.native_cache.outputs.cache-hit != 'true'") &&
      native > java,
    'ios-build: build only when the key is not cached'
  )
  return native
}

/** The repository is public and a fork's pull request can restore this cache: scan first. */
function iosClientScanProblems(build, native, check) {
  const steps = build?.steps ?? []
  // The scan compares the client with the private owned environment; with no harness directory it
  // would compare nothing and pass.
  const scan = stepIndex(build, (step) =>
    step.run?.includes('native-ios-app-secret-scan.mjs')
  )
  const save = cacheStep(build, 'save')
  check(
    native >= 0 && scan > native && save > scan,
    'ios-build: the client must be secret-scanned before it is cached'
  )
  check(
    build?.env?.CC68_HARNESS_DIR === iosHarnessDirectory &&
      steps[scan]?.run ===
        `node scripts/ci/native-ios-app-secret-scan.mjs ${iosClient} "$CC68_HARNESS_DIR"` &&
      steps[save]?.if?.includes("steps.app_scan.outcome == 'success'") &&
      steps[scan]?.id === 'app_scan',
    'ios-build: cache exactly the scanned client, scanned with the harness directory set'
  )
  check(
    cacheStep(
      build,
      'restore',
      (step) =>
        step.with['lookup-only'] === true && step.with['fail-on-cache-miss'] === true
    ) > save,
    'ios-build: prove the saved key exists before the shards need it'
  )
  check(
    !steps.some(
      (step) =>
        step.uses === 'actions/upload-artifact@v4' &&
        step.with?.path !== `${iosHarnessDirectory}/public-evidence/`
    ),
    'ios-build: the client travels by cache only, never as a public artifact'
  )
}

/** The jobs that install the client restore the resolved key; the client-free checks run in Expo Go. */
function iosClientConsumerProblems({ shard, expoGo }, check) {
  for (const [name, job] of [
    ['ios-shard', shard],
    [expoGoJobName, expoGo],
  ])
    check(
      (job?.steps ?? []).some(
        (step) =>
          step.uses === 'actions/cache/restore@v4' &&
          step.with?.key === '${{ needs.ios-build.outputs.app-key }}' &&
          step.with?.path === '${{ needs.ios-build.outputs.app-path }}' &&
          step.with?.['fail-on-cache-miss'] === true
      ) &&
        !(job?.steps ?? []).some((step) => step.uses === 'actions/download-artifact@v4'),
      `${name}: restore exactly the key ios-build resolved and fail on a miss`
    )
  const checks = expoGo?.steps ?? []
  check(
    includesRun(checks, 'swift test --package-path') &&
      includesRun(checks, 'e2e-share-card/bridge-a11y.mjs') &&
      includesRun(checks, 'maestro-check-flows.mjs') &&
      includesRun(checks, 'share-card-header-semantics.sh'),
    `${expoGoJobName}: PNG guards, accessibility bridge, flow check and heading semantics required`
  )
}

/**
 * The iOS development client: ios-build keys it by its native fingerprint and builds, scans and
 * saves it only when no client of that key is cached; every job that installs it restores exactly
 * that key and fails on a miss, so no job can run a client it did not get from the scanned build.
 */
function iosAppProblems(parts, check) {
  const native = iosBuildKeyProblems(parts.build, check)
  iosClientScanProblems(parts.build, native, check)
  iosClientConsumerProblems(parts, check)
}

/**
 * The iOS journey: one job that keys and, on a miss, builds the client, a shard matrix and a job
 * that proves every shard reported its exact cases, plus the Expo Go proof job. All run on the
 * free macos-15 runner (evidence on Ubuntu).
 */
function iosProblems(jobs, check) {
  const parts = {
    build: jobs['ios-build'],
    shard: jobs['ios-shard'],
    expoGo: jobs[expoGoJobName],
    evidence: jobs['ios-evidence'],
  }
  iosJobProblems(jobs, check)
  iosShapeProblems(parts, check)
  iosEvidenceProblems(jobs, check)
  iosAppProblems(parts, check)
}

/** A shell glob such as an artifact download pattern, as a whole-string regular expression. */
const globPattern = (glob) =>
  new RegExp(
    `^${String(glob)
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  )

/**
 * The job that proves every shard of a sharded lane reported exactly its cases: it runs after
 * any shard result, downloads exactly the shard artifacts and fails unless the shard job
 * succeeded and the merged reports equal the plan.
 */
function shardEvidenceProblems(shardJob, jobs, artifactsByJob, check) {
  const { plan, evidence: name } = shardedAndroidLanes[shardJob]
  const job = jobs[name]
  const steps = job?.steps ?? []
  check(job !== undefined, `${name}: required job missing`)
  check(
    job?.['runs-on'] === 'ubuntu-latest',
    `${name}: free ubuntu-latest runner required`
  )
  check(
    job?.['continue-on-error'] === undefined &&
      steps.every((step) => step['continue-on-error'] === undefined),
    `${name}: failures must remain visible`
  )
  const limit = job?.['timeout-minutes']
  check(
    Number.isInteger(limit) && limit > 0 && limit <= maxMinutes,
    `${name}: independent limit must stay within ${maxMinutes} minutes`
  )
  check(
    JSON.stringify(needsList(job)) === JSON.stringify([shardJob]) &&
      job?.if === evidenceCondition,
    `${name} must run after any ${shardJob} result, except on pull_request`
  )
  const download = steps.find((step) => step.uses === 'actions/download-artifact@v4')
  const pattern = globPattern(download?.with?.pattern)
  const shardArtifacts = artifactsByJob[shardJob] ?? []
  check(
    shardArtifacts.length === shardsOf(plan).length &&
      shardArtifacts.every((artifact) => pattern.test(artifact)) &&
      Object.entries(artifactsByJob).every(
        ([lane, artifacts]) =>
          lane === shardJob || !artifacts.some((artifact) => pattern.test(artifact))
      ),
    `${name}: download every shard artifact and nothing else`
  )
  const merge = steps.find((step) => step.run?.includes('native-matrix-shards.mjs merge'))
  check(
    merge?.env?.CC68_SHARD_RESULT === `\${{ needs.${shardJob}.result }}` &&
      merge.run.includes('test "$CC68_SHARD_RESULT" = success') &&
      merge.run.includes(`node scripts/ci/native-matrix-shards.mjs merge ${plan} `),
    `${name}: every shard must report its exact cases`
  )
}

/** Rules for every job of the workflow, native and browser alike. */
function workflowProblems(jobs, check) {
  for (const [name, job] of Object.entries(jobs)) {
    check(
      !String(job?.['runs-on']).includes('macos-15-intel'),
      `${name}: the Intel macOS runner is retired`
    )
    for (const step of job?.steps ?? []) {
      const paths = String(step.with?.path ?? '')
      check(
        step.uses !== 'actions/upload-artifact@v4' ||
          !/private|\.log\b|owned-env|public-build-env|-device\b|device-cleanup/.test(
            paths
          ),
        `${name}: an uploaded artifact may not name a private, log, environment or device file`
      )
      for (const line of String(step.run ?? '').split('\n'))
        check(
          !line.includes('run-story68-native.mjs metro') ||
            /run-story68-native\.mjs metro --platform (android|ios|\$\{\{ matrix\.platform \}\})(?=\s)/.test(
              line
            ),
          `${name}: every Metro start must pass --platform`
        )
    }
  }
}

/** Independence, limits, owned runtime and evidence every lane needs. */
function commonProblems(name, job, suites, rows, check) {
  const steps = job.steps ?? []
  check(job['runs-on'] === 'ubuntu-latest', `${name}: free Ubuntu runner required`)
  check(job.needs === undefined, `${name}: partitions must start independently`)
  check(
    job.if === deviceLaneIf(name),
    pullRequestShareCardJobs.includes(name)
      ? `${name}: the pull request lane cannot be conditional`
      : `${name}: device lane must be skipped on pull_request`
  )
  check(job['continue-on-error'] === undefined, `${name}: failures must remain visible`)
  check(
    job.strategy?.['fail-fast'] === false,
    `${name}: failures must preserve sibling evidence`
  )
  check(
    rows.length === suites.length &&
      rows.every(
        (row, index) =>
          row?.platform === 'android' && row?.api === 36 && row?.suite === suites[index]
      ),
    suites.length > 1
      ? `${name}: exact API36 partition required, one row per shard`
      : `${name}: exact API36 partition required`
  )
  const limit = job['timeout-minutes']
  check(
    Number.isInteger(limit) && limit > 0 && limit <= maxMinutes,
    `${name}: independent limit must stay within ${maxMinutes} minutes`
  )
  check(
    steps.every((step) => step['continue-on-error'] === undefined),
    `${name}: steps cannot hide failures`
  )
  check(
    job.env?.PLAYWRIGHT_SKIP_DB_RESET === 'true',
    `${name}: shared database reset must remain disabled`
  )
  const prepare = steps.find((step) => step.id === 'runtime')
  check(
    prepare?.run?.includes('node scripts/e2e-share-card/prepare.mjs') &&
      prepare.run.includes('scripts/e2e-share-card/auth.mjs') &&
      prepare.run.includes('scripts/run-story68-native.mjs serve'),
    `${name}: own UUID database, auth and API required`
  )
  check(
    steps.some((step) => step.uses === './.github/actions/start-local-supabase'),
    `${name}: own local services required`
  )
  check(
    stepIsAlways(steps, 'node scripts/e2e-share-card/cleanup.mjs'),
    `${name}: owned cleanup must always run`
  )
  check(
    stepIsAlways(steps, 'node scripts/e2e-share-card/public-evidence.mjs'),
    `${name}: closed evidence must always be selected`
  )
  const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v4')
  check(
    upload?.if === 'always()' && upload.with?.['if-no-files-found'] === 'error',
    `${name}: evidence upload must fail closed`
  )
  return upload
}

function browserProblems(name, steps, check) {
  const prepare = steps.find((step) => step.id === 'runtime')
  const engines = steps.find((step) => step.id === 'browser_deps')?.run ?? ''
  check(
    engines
      .split('\n')
      .some((line) => line.trim() === 'node scripts/ci/share-card-browser-deps.mjs'),
    `${name}: all three pinned browsers required`
  )
  check(
    !steps.some((step) => step.uses === emulatorAction) &&
      !steps.some((step) => nativeSdkActions.includes(step.uses)) &&
      !includesRun(steps, 'run-story68-native.mjs build') &&
      !includesRun(steps, 'run-story68-native.mjs prebuild') &&
      !prepare?.run?.includes('cc68-metro') &&
      !prepare?.run?.includes('maestro-install'),
    `${name}: browser job must avoid native preparation`
  )
  const acceptance = steps.find((step) =>
    step.run?.includes('npx playwright test --config playwright/share-card.config.ts')
  )
  check(
    acceptance?.run?.includes('node scripts/e2e-share-card/web.mjs build') &&
      acceptance.run.includes('node scripts/e2e-share-card/web.mjs start') &&
      acceptance.run.includes('node scripts/e2e-share-card/wait-web.mjs') &&
      acceptance.run.includes('node scripts/e2e-share-card/assert-web-matrix.mjs'),
    `${name}: production startup and complete browser matrix validator required`
  )
}

/**
 * An Android lane restores the APK of its native key and builds only on a miss; it caches only an
 * APK it built, tested and scanned; and its journey runs only on a build or a hit.
 */
function androidClientCacheProblems(name, steps, check) {
  const at = (predicate) => steps.findIndex(predicate)
  const key = at((step) => step.id === 'native_key')
  const restore = at(
    (step) =>
      step.id === 'native_cache' &&
      step.uses === 'actions/cache/restore@v4' &&
      step.with?.key === '${{ steps.native_key.outputs.key }}'
  )
  const build = at((step) => step.id === 'native_build')
  const scan = at((step) => step.id === 'apk_scan')
  const save = at(
    (step) =>
      step.uses === 'actions/cache/save@v4' &&
      step.with?.key === '${{ steps.native_key.outputs.key }}'
  )
  const journey = at((step) => step.uses === emulatorAction)
  check(
    key >= 0 &&
      steps[key].run?.startsWith(
        'node scripts/ci/native-build-cache.mjs key --platform '
      ) &&
      restore > key &&
      build > restore &&
      steps[build].if?.includes("steps.native_cache.outputs.cache-hit != 'true'"),
    `${name}: restore the client of its native key and build only on a miss`
  )
  check(
    scan > build &&
      steps[scan].run?.includes('native-ios-app-secret-scan.mjs') &&
      steps[scan].if?.includes("steps.native_build.outcome == 'success'") &&
      steps[scan].if?.includes("steps.modal_system_bars.outcome == 'success'") &&
      save > scan &&
      steps[save].if?.includes("steps.apk_scan.outcome == 'success'"),
    `${name}: cache only a built, tested and scanned client`
  )
  check(
    journey > save &&
      steps[journey].if?.includes(
        "(steps.native_build.outcome == 'success' || steps.native_cache.outputs.cache-hit == 'true')"
      ),
    `${name}: run the journey only on a built or restored client`
  )
}

function nativeProblems(name, job, rows, check) {
  androidClientCacheProblems(name, job.steps ?? [], check)
  const steps = job.steps ?? []
  const prepare = steps.find((step) => step.id === 'runtime')
  const engines = steps.find((step) => step.id === 'browser_deps')?.run ?? ''
  const emulator = steps.find((step) => step.uses === emulatorAction)
  check(
    engines.includes('share-card-browser-deps.mjs --chromium-only'),
    `${name}: Chromium bridge prerequisite required`
  )
  check(
    prepare?.run?.includes('cc68-metro') && prepare.run.includes('maestro-install'),
    `${name}: own Metro and Maestro required`
  )
  check(
    includesRun(steps, 'run-story68-native.mjs prebuild') &&
      includesRun(steps, 'run-story68-native.mjs build') &&
      includesRun(steps, 'e2e-share-card/bridge-a11y.mjs'),
    `${name}: native build and accessibility bridge required`
  )
  check(
    emulator?.env?.CC68_ANDROID_API === '${{ matrix.api }}' &&
      emulator?.env?.CC68_ANDROID_SUITE === '${{ matrix.suite }}' &&
      emulator?.with?.script === 'bash scripts/ci/share-card-android.sh' &&
      emulator?.with?.arch === 'x86_64' &&
      emulator?.with?.target === '${{ matrix.target }}',
    `${name}: exact API, suite and free-runner emulator required`
  )
  check(
    rows.every((row) => row?.target === 'google_apis_playstore'),
    `${name}: actual TalkBack system image required`
  )
  check(
    emulator?.['timeout-minutes'] === '${{ matrix.journey_timeout }}' &&
      rows.every(
        (row) =>
          Number.isInteger(row?.journey_timeout) &&
          row.journey_timeout > 0 &&
          job['timeout-minutes'] - row.journey_timeout >= 25
      ),
    `${name}: journey must leave preparation and cleanup budget`
  )
  check(
    !includesRun(steps, 'playwright test --config playwright/share-card.config.ts'),
    `${name}: browser matrix belongs to its independent job`
  )
}

/** Validate the parallel partition, each owned runtime and the aggregate failure boundary. */
export function shareCardLaneProblems(workflow) {
  const problems = []
  const jobs = workflow.jobs ?? {}
  const check = (ok, message) => {
    if (!ok) problems.push(message)
  }
  triggerProblems(workflow.on, check)
  gateProblems(jobs, check)
  legacyProblems(jobs, check)
  iosProblems(jobs, check)
  workflowProblems(jobs, check)
  const artifacts = new Set()
  // original-resource keeps its own step list and checks; its artifact names join the rest.
  const legacyUpload = (jobs['original-resource']?.steps ?? []).find(
    (step) => step.uses === 'actions/upload-artifact@v4'
  )
  const artifactName = (upload, row) =>
    (upload?.with?.name ?? '').replace(
      /\$\{\{ matrix\.(\w+) \}\}/g,
      (_, key) => row[key] ?? ''
    )
  const artifactsByJob = {
    'original-resource': (
      matrixRows(jobs['original-resource']?.strategy?.matrix) ?? []
    ).map((row) => artifactName(legacyUpload, row)),
  }
  for (const artifact of artifactsByJob['original-resource']) {
    check(
      artifact.length > 0 && !artifacts.has(artifact),
      'original-resource: artifact name must be unique'
    )
    artifacts.add(artifact)
  }
  for (const [name, suites] of Object.entries(android36Lanes)) {
    const job = jobs[name]
    if (!job) {
      problems.push(`${name}: required parallel job missing`)
      continue
    }
    const rows = matrixRows(job.strategy?.matrix) ?? []
    const upload = commonProblems(name, job, suites, rows, check)
    artifactsByJob[name] = []
    for (const row of rows) {
      const artifact = artifactName(upload, row)
      check(
        artifact.length > 0 && !artifacts.has(artifact),
        `${name}: artifact name must be unique`
      )
      artifacts.add(artifact)
      artifactsByJob[name].push(artifact)
    }
    if (suites.includes('browser')) browserProblems(name, job.steps ?? [], check)
    else nativeProblems(name, job, rows, check)
  }
  for (const shardJob of Object.keys(shardedAndroidLanes))
    shardEvidenceProblems(shardJob, jobs, artifactsByJob, check)
  return problems
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const workflow = parse(
    fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
  )
  const problems = shareCardLaneProblems(workflow)
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else
    console.log(
      'Browser lane on pull requests, device lanes on main, nightly and dispatch, owned runtimes, budgets and strict gate validated.'
    )
}
