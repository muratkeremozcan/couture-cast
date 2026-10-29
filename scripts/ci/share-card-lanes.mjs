import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { matrixRows } from './workflow-step-shadowing.mjs'
import { requiredShareCardJobs } from './share-card-job-gate.mjs'

export const android36Lanes = Object.freeze({
  'browser-acceptance': 'browser',
  'android36-native-matrix': 'matrix',
  'android36-original': 'original',
  'android36-interaction': 'interaction',
})
// pr-gate.yml publishes the required ruleset context gate as a commit status; no job or
// check run may take that name.
export const gateJobName = 'share-card-lanes-gate'
const reservedContext = 'gate'
const emulatorAction = 'reactivecircus/android-emulator-runner@v2'
const nativeSdkActions = ['actions/setup-java@v4', 'android-actions/setup-android@v3']
const maxMinutes = 90
const iosMaxMinutes = 150
const iosHarnessDirectory = '_bmad-output/test-artifacts/story-6-8/runtime'
const includesRun = (steps, command) => steps.some((step) => step.run?.includes(command))
const stepIsAlways = (steps, run) =>
  steps.some((step) => step.if === 'always()' && step.run === run)

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

function legacyProblems(jobs, check) {
  const legacy = jobs['original-resource']
  const rows = matrixRows(legacy?.strategy?.matrix) ?? []
  check(
    rows.length === 1 &&
      rows[0]?.platform === 'android' &&
      rows[0]?.api === 32 &&
      rows[0]?.suite === 'all',
    'legacy API32 journey must remain complete and be the only original-resource row'
  )
  check(legacy?.needs === undefined, 'original-resource must start independently')
  // Run 40686881166 measured the API32 emulator step at 62m19s, so a 65 minute bound is a
  // flake; its behavior stays exactly as it was, bounded only by the job limit.
  check(
    rows.every((row) => row.journey_timeout === undefined) &&
      (legacy?.steps ?? []).every(
        (step) => step.uses !== emulatorAction || step['timeout-minutes'] === undefined
      ),
    'legacy API32 journey must not gain a step timeout'
  )
  check(
    legacy?.['timeout-minutes'] === maxMinutes,
    'legacy journeys keep their existing 90 minute limit'
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

function iosShapeProblems({ build, shard, evidence }, check) {
  check(build?.needs === undefined, 'ios-build must start independently')
  check(
    JSON.stringify(needsList(shard)) === JSON.stringify(['ios-build']),
    'ios-shard must need exactly ios-build'
  )
  check(
    JSON.stringify(needsList(evidence)) === JSON.stringify(['ios-shard']) &&
      evidence?.if === 'always()',
    'ios-evidence must run after any ios-shard result'
  )
  check(
    JSON.stringify(shard?.strategy?.matrix?.shard) === JSON.stringify([1, 2]) &&
      shard?.strategy?.['fail-fast'] === false,
    'ios-shard must run shards 1 and 2 without cancelling the sibling'
  )
  check(
    includesRun(shard?.steps ?? [], 'native-ios-shards.mjs commands') &&
      includesRun(shard?.steps ?? [], '--shard "$shard"'),
    'ios-shard: every command must receive its shard'
  )
  check(
    includesRun(evidence?.steps ?? [], 'native-ios-shards.mjs merge') &&
      includesRun(evidence?.steps ?? [], 'test "$CC68_SHARD_RESULT" = success'),
    'ios-evidence: both shards must report their exact cases'
  )
}

function iosEvidenceProblems(jobs, check) {
  for (const name of ['ios-build', 'ios-shard']) {
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

function iosAppProblems(build, check) {
  // The built app is downloadable by any signed-in user: scan first, keep it one day.
  const scan = stepIndex(build, (step) =>
    step.run?.includes('native-ios-app-secret-scan.mjs')
  )
  const appUpload = stepIndex(build, (step) => step.with?.name === 'cc68-ios-app')
  check(
    scan >= 0 && appUpload > scan,
    'ios-build: the app must be secret-scanned before it is uploaded'
  )
  // The scan compares the app with the private owned environment; with no harness directory it
  // would compare nothing and pass.
  check(
    build?.env?.CC68_HARNESS_DIR === iosHarnessDirectory &&
      /native-ios-app-secret-scan\.mjs \S+ "\$CC68_HARNESS_DIR"/.test(
        build?.steps?.[scan]?.run ?? ''
      ),
    'ios-build: the app scan must run with the harness directory set'
  )
  check(
    build?.steps?.[appUpload]?.with?.['retention-days'] === 1,
    'ios-build: the app artifact keeps one day'
  )
  check(
    includesRun(build?.steps ?? [], 'swift test --package-path') &&
      includesRun(build?.steps ?? [], 'e2e-share-card/bridge-a11y.mjs') &&
      includesRun(build?.steps ?? [], 'run-story68-native.mjs build --platform ios'),
    'ios-build: PNG guards, accessibility bridge and native build required'
  )
}

/**
 * The iOS journey: one build job, a two-way shard matrix and a job that proves both shards
 * reported their exact cases. All three run on the free macos-15 runner (evidence on Ubuntu).
 */
function iosProblems(jobs, check) {
  const parts = {
    build: jobs['ios-build'],
    shard: jobs['ios-shard'],
    evidence: jobs['ios-evidence'],
  }
  iosJobProblems(jobs, check)
  iosShapeProblems(parts, check)
  iosEvidenceProblems(jobs, check)
  iosAppProblems(parts.build, check)
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
function commonProblems(name, job, suite, rows, check) {
  const steps = job.steps ?? []
  check(job['runs-on'] === 'ubuntu-latest', `${name}: free Ubuntu runner required`)
  check(
    job.needs === undefined && job.if === undefined,
    `${name}: partitions must start independently`
  )
  check(job['continue-on-error'] === undefined, `${name}: failures must remain visible`)
  check(
    job.strategy?.['fail-fast'] === false,
    `${name}: failures must preserve sibling evidence`
  )
  check(
    rows.length === 1 &&
      rows[0]?.platform === 'android' &&
      rows[0]?.api === 36 &&
      rows[0]?.suite === suite,
    `${name}: exact API36 partition required`
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

function nativeProblems(name, job, rows, check) {
  const steps = job.steps ?? []
  const prepare = steps.find((step) => step.id === 'runtime')
  const engines = steps.find((step) => step.id === 'browser_deps')?.run ?? ''
  const emulator = steps.find((step) => step.uses === emulatorAction)
  const row = rows[0]
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
    row?.target === 'google_apis_playstore',
    `${name}: actual TalkBack system image required`
  )
  check(
    emulator?.['timeout-minutes'] === '${{ matrix.journey_timeout }}' &&
      Number.isInteger(row?.journey_timeout) &&
      row.journey_timeout > 0 &&
      job['timeout-minutes'] - row.journey_timeout >= 25,
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
  gateProblems(jobs, check)
  legacyProblems(jobs, check)
  iosProblems(jobs, check)
  workflowProblems(jobs, check)
  const artifacts = new Set()
  for (const [name, suite] of Object.entries(android36Lanes)) {
    const job = jobs[name]
    if (!job) {
      problems.push(`${name}: required parallel job missing`)
      continue
    }
    const rows = matrixRows(job.strategy?.matrix) ?? []
    const upload = commonProblems(name, job, suite, rows, check)
    for (const row of rows) {
      const artifact = (upload?.with?.name ?? '').replace(
        /\$\{\{ matrix\.(\w+) \}\}/g,
        (_, key) => row[key] ?? ''
      )
      check(
        artifact.length > 0 && !artifacts.has(artifact),
        `${name}: artifact name must be unique`
      )
      artifacts.add(artifact)
    }
    if (suite === 'browser') browserProblems(name, job.steps ?? [], check)
    else nativeProblems(name, job, rows, check)
  }
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
      'Four independent Ubuntu API36 partitions, owned runtimes, budgets and strict gate validated.'
    )
}
