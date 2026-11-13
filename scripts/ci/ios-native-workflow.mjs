// Story 6.15 D6: the rules .github/workflows/ios-native.yml keeps. It runs the iOS work that cannot
// fit a pull request, on main, nightly and on demand for one commit, so these checks hold what the
// macOS jobs it carries already proved (a client scanned before it is cached and installed only
// from that scan, every shard with its own runtime, budget and fail-closed evidence, a merge that
// fails on a skipped or partial shard), and what makes a run usable as a pull request's evidence:
// the run name carries the commit, and every job checks out exactly that commit first.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { shardsOf } from './native-matrix-shards.mjs'

export const IOS_NATIVE_WORKFLOW = '.github/workflows/ios-native.yml'
export const MACOS_JOBS = ['ios-build', 'ios-shard', 'ios-expo-go', 'ios-app-build']
export const JOBS = [...MACOS_JOBS, 'ios-evidence']
export const HARNESS_DIRECTORY = '_bmad-output/test-artifacts/story-6-8/runtime'
export const EVIDENCE_PATH = `${HARNESS_DIRECTORY}/public-evidence/`
export const IOS_CLIENT =
  '/tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/CoutureCastStory68.app'
export const COMMIT = '${{ inputs.sha || github.sha }}'
export const RUN_NAME = `iOS native ${COMMIT}`
// GitHub-hosted runners stop any job at 360 minutes; the shards keep the 70 their budget assumes.
const HOSTED_JOB_LIMIT = 360
const SHARD_LIMIT = 70
const keyOutput = '${{ steps.native_key.outputs.key }}'
const pathOutput = '${{ steps.native_key.outputs.path }}'
const restoredKey = '${{ needs.ios-build.outputs.app-key }}'
const restoredPath = '${{ needs.ios-build.outputs.app-path }}'
const needsList = (job) => [job?.needs ?? []].flat()
const includesRun = (steps, command) => steps.some((step) => step.run?.includes(command))
const stepIndex = (job, predicate) => (job?.steps ?? []).findIndex(predicate)

function triggerProblems(workflow, check) {
  const on = workflow.on ?? workflow[true]
  check(
    on !== null &&
      typeof on === 'object' &&
      !('pull_request' in on) &&
      !('pull_request_target' in on),
    'ios-native never runs on a pull request: a run must test main’s copy of this workflow'
  )
  check(
    JSON.stringify(on?.push?.branches) === JSON.stringify(['main']) &&
      Array.isArray(on?.push?.paths) &&
      on.push.paths.length > 0,
    'ios-native runs on a merge to main, filtered by its native iOS inputs'
  )
  const crons = [on?.schedule ?? []].flat().map((entry) => entry?.cron)
  check(
    crons.length > 0 && crons.every((cron) => /^\S+( \S+){4}$/.test(String(cron))),
    'ios-native needs a nightly schedule'
  )
  const sha = on?.workflow_dispatch?.inputs?.sha
  check(
    sha?.required === true &&
      sha.type === 'string' &&
      Object.keys(on.workflow_dispatch.inputs).length === 1,
    'a dispatch names exactly one commit, by a required sha input'
  )
  check(
    workflow['run-name'] === RUN_NAME,
    `the run name must be "${RUN_NAME}" so a gate can read the commit from it`
  )
}

/** Each job checks out the commit under test and proves it before anything else runs. */
function commitProblems(name, job, check) {
  const [checkout, proof] = job?.steps ?? []
  check(
    checkout?.uses === 'actions/checkout@v4' && checkout.with?.ref === COMMIT,
    `${name}: check out the dispatched commit, or the one that triggered the run`
  )
  check(
    proof?.env?.SHA === COMMIT &&
      proof.if === undefined &&
      proof.run?.includes("grep -Eqx '[0-9a-f]{40}'") &&
      proof.run.includes('test "$(git rev-parse HEAD)" = "$SHA"'),
    `${name}: the second step must fail unless HEAD is exactly the commit under test`
  )
}

/** Xcode 26.4 or later, chosen by name right after the commit proof, before anything builds. */
function xcodeProblems(name, job, check) {
  const steps = job?.steps ?? []
  const xcode = stepIndex(job, (step) => step.id === 'xcode')
  const run = steps[xcode]?.run ?? ''
  check(
    xcode === 2 &&
      run.includes('/Xcode_26.*.app') &&
      run.includes('[ "${BASH_REMATCH[1]}" -ge 4 ]') &&
      run.includes('sudo xcode-select -s') &&
      run.includes('DEVELOPER_DIR=') &&
      run.includes('xcodebuild -version'),
    `${name}: select Xcode 26.4 or later by name, right after the commit proof`
  )
}

function jobProblems(workflow, check) {
  const jobs = workflow.jobs ?? {}
  check(
    JSON.stringify(Object.keys(jobs).sort()) === JSON.stringify([...JOBS].sort()),
    `ios-native holds exactly ${JOBS.join(', ')}`
  )
  for (const name of JOBS) {
    const job = jobs[name]
    const macos = MACOS_JOBS.includes(name)
    check(
      job?.['runs-on'] === (macos ? 'macos-26' : 'ubuntu-latest'),
      `${name}: ${macos ? 'macos-26' : 'ubuntu-latest'} runner required`
    )
    const limit = job?.['timeout-minutes']
    check(
      Number.isInteger(limit) && limit > 0 && limit <= HOSTED_JOB_LIMIT,
      `${name}: limit must stay within the hosted job limit`
    )
    check(
      job?.['continue-on-error'] === undefined &&
        (job?.steps ?? []).every((step) => step['continue-on-error'] === undefined),
      `${name}: failures must remain visible`
    )
    commitProblems(name, job, check)
    if (macos) xcodeProblems(name, job, check)
  }
}

/** One build, then the four shards and Expo Go in parallel on what it cached. */
function shapeProblems(jobs, check) {
  const { 'ios-build': build, 'ios-shard': shard, 'ios-expo-go': expoGo } = jobs
  const evidence = jobs['ios-evidence']
  check(
    build?.needs === undefined && build?.if === undefined,
    'ios-build starts the run and depends on nothing'
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
      JSON.stringify(needsList(job)) === JSON.stringify(['ios-build']) &&
        job?.if === undefined,
      `${name} must need exactly ios-build`
    )
  check(
    JSON.stringify(shard?.strategy?.matrix?.shard) === JSON.stringify(shardsOf('ios')) &&
      shard?.strategy?.['fail-fast'] === false,
    'ios-shard must run every shard of the iOS plan without cancelling a sibling'
  )
  check(
    shard?.['timeout-minutes'] === SHARD_LIMIT,
    `ios-shard keeps its ${SHARD_LIMIT}-minute limit`
  )
  check(
    includesRun(shard?.steps ?? [], 'native-ios-shards.mjs commands') &&
      includesRun(shard?.steps ?? [], '--shard "$shard"') &&
      !includesRun(shard?.steps ?? [], 'expo-go-proof'),
    'ios-shard: every command must receive its shard, and no shard runs the Expo Go proof'
  )
  evidenceProblems(evidence, check)
  expoGoProblems(expoGo, check)
}

/** ios-evidence runs after any shard result and fails unless every shard reported its exact cases. */
function evidenceProblems(evidence, check) {
  check(
    JSON.stringify(needsList(evidence)) === JSON.stringify(['ios-shard']) &&
      evidence?.if === 'always()' &&
      includesRun(evidence?.steps ?? [], 'native-ios-shards.mjs merge') &&
      includesRun(evidence?.steps ?? [], 'test "$CC68_SHARD_RESULT" = success'),
    'ios-evidence must run after any shard result and require every shard’s exact cases'
  )
}

/** The Expo Go proof once, on its own simulator, and the iOS checks that need no client. */
function expoGoProblems(expoGo, check) {
  check(
    expoGo?.strategy === undefined &&
      (expoGo?.steps ?? []).filter((step) =>
        step.run?.includes('run-story68-native.mjs expo-go-proof')
      ).length === 1 &&
      includesRun(expoGo?.steps ?? [], '--platform ios --device "$device"'),
    'ios-expo-go runs the proof once, on its own simulator, without a shard'
  )
  const checks = expoGo?.steps ?? []
  check(
    includesRun(checks, 'swift test --package-path') &&
      includesRun(checks, 'e2e-share-card/bridge-a11y.mjs') &&
      includesRun(checks, 'maestro-check-flows.mjs') &&
      includesRun(checks, 'share-card-header-semantics.sh'),
    'ios-expo-go: PNG guards, accessibility bridge, flow check and heading semantics required'
  )
}

/** ios-build keys the client, builds only on a miss and caches only what it scanned. */
function clientProblems(build, check) {
  const steps = build?.steps ?? []
  const key = stepIndex(build, (step) => step.id === 'native_key')
  check(
    key >= 0 &&
      steps[key].run ===
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
      steps[java]?.if?.includes("steps.native_cache.outputs.cache-hit != 'true'") &&
      native > java &&
      steps[native]?.if?.includes("steps.build_window.outcome == 'success'"),
    'ios-build: build only when the key is not cached'
  )
  const scan = stepIndex(build, (step) => step.id === 'app_scan')
  const save = stepIndex(
    build,
    (step) =>
      step.uses === 'actions/cache/save@v4' &&
      step.with?.key === keyOutput &&
      step.with?.path === pathOutput
  )
  check(
    native >= 0 &&
      scan > native &&
      steps[scan].run ===
        `node scripts/ci/native-ios-app-secret-scan.mjs ${IOS_CLIENT} "$CC68_HARNESS_DIR"` &&
      save > scan &&
      steps[save].if?.includes("steps.app_scan.outcome == 'success'"),
    'ios-build: the client must be secret-scanned before it is cached'
  )
  check(
    stepIndex(
      build,
      (step) =>
        step.uses === 'actions/cache/restore@v4' &&
        step.with?.['lookup-only'] === true &&
        step.with?.['fail-on-cache-miss'] === true
    ) > save,
    'ios-build: prove the saved key exists before the shards need it'
  )
}

/** The shards and Expo Go install only the client ios-build resolved; it never travels as an artifact. */
function consumerProblems(jobs, check) {
  for (const name of ['ios-shard', 'ios-expo-go'])
    check(
      (jobs[name]?.steps ?? []).some(
        (step) =>
          step.uses === 'actions/cache/restore@v4' &&
          step.with?.key === restoredKey &&
          step.with?.path === restoredPath &&
          step.with?.['fail-on-cache-miss'] === true
      ),
      `${name}: restore exactly the key ios-build resolved and fail on a miss`
    )
  for (const [name, job] of Object.entries(jobs))
    for (const step of job?.steps ?? []) {
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
    const steps = jobs[name]?.steps ?? []
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
        steps.some((step) => step.if === 'always()' && step.run === run),
        `${name}: ${run} must always run`
      )
    for (const step of steps)
      for (const line of String(step.run ?? '').split('\n'))
        check(
          !line.includes('run-story68-native.mjs metro') ||
            /run-story68-native\.mjs metro --platform ios(?=\s)/.test(line),
          `${name}: every Metro start must pass --platform ios`
        )
  }
  const app = jobs['ios-app-build']?.steps ?? []
  check(
    includesRun(app, '-configuration Release') &&
      includesRun(app, 'check-accessibility-focus-builds.sh ios-app'),
    'ios-app-build: the Release app and its accessibility-focus check are required'
  )
}

/** Every repository script and local action the workflow calls exists. */
export function missingHelpers(text, exists = (file) => fs.existsSync(file)) {
  const named = new Set()
  for (const match of text.matchAll(
    /(?:^|[\s"'])((?:scripts|\.\/\.github\/actions)\/[\w./-]+?\.(?:mjs|sh|js))(?=[\s"']|$)/gm
  ))
    named.add(match[1])
  for (const match of text.matchAll(/uses: (\.\/\.github\/actions\/[\w-]+)/g))
    named.add(`${match[1]}/action.yml`)
  return [...named].filter((file) => !exists(file.replace(/^\.\//, '')))
}

/** Every rule ios-native.yml must keep; an empty list means it keeps them all. */
export function iosNativeProblems(workflow) {
  const problems = []
  const check = (ok, message) => {
    if (!ok) problems.push(message)
  }
  const jobs = workflow.jobs ?? {}
  triggerProblems(workflow, check)
  jobProblems(workflow, check)
  shapeProblems(jobs, check)
  clientProblems(jobs['ios-build'], check)
  consumerProblems(jobs, check)
  runtimeProblems(jobs, check)
  return problems
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const text = fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8')
  const problems = [
    ...iosNativeProblems(parse(text)),
    ...missingHelpers(text).map((file) => `missing helper ${file}`),
  ]
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else console.log('ios-native.yml keeps every iOS guard.')
}
