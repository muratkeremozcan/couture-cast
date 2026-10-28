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
const emulatorAction = 'reactivecircus/android-emulator-runner@v2'
const nativeSdkActions = ['actions/setup-java@v4', 'android-actions/setup-android@v3']
const maxMinutes = 90
const includesRun = (steps, command) => steps.some((step) => step.run?.includes(command))
const stepIsAlways = (steps, run) =>
  steps.some((step) => step.if === 'always()' && step.run === run)

function gateProblems(jobs, check) {
  const gate = jobs.gate ?? {}
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
  const has = (platform, api) =>
    rows.some((r) => r.platform === platform && r.api === api && r.suite === 'all')
  check(
    rows.length === 2 && has('android', 32) && has('ios', 0),
    'legacy API32 and iOS journeys must remain complete'
  )
  check(
    legacy?.['timeout-minutes'] === maxMinutes,
    'legacy journeys keep their existing 90 minute limit'
  )
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
