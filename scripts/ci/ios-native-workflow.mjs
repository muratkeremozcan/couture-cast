// Story 6.15 D6: the rules the one iOS job (.github/workflows/ios-native.yml) must keep. It runs
// what five macOS jobs ran before (the accessibility-focus Release app build, and the share-card
// iOS client build, four journey shards, their evidence and the Expo Go proof), so the guards
// those jobs had are held here: off the pull request path, Xcode 26.4 or later chosen by name,
// one prebuild, a client that is secret-scanned before it is cached and installed only from a
// scanned build, every shard with its own runtime, budget and fail-closed evidence, a merge that
// fails on a skipped or partial shard, and cleanup that always runs.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { shardsOf } from './native-matrix-shards.mjs'

export const IOS_NATIVE_WORKFLOW = '.github/workflows/ios-native.yml'
export const IOS_NATIVE_JOB = 'ios-native'
export const RUNTIME_SCRIPT = 'scripts/ci/native-ios-runtime.sh'
export const HARNESS_DIRECTORY = '_bmad-output/test-artifacts/story-6-8/runtime'
export const EVIDENCE_PATH = `${HARNESS_DIRECTORY}/public-evidence/`
export const IOS_CLIENT =
  '/tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/CoutureCastStory68.app'
// The limit each shard job had; story68-flow-timeouts.mjs sizes the share-sheet headroom from it.
export const SHARD_FLOW_MINUTES = 70
// GitHub-hosted runners stop any job at 360 minutes.
const HOSTED_JOB_LIMIT = 360
const keyOutput = '${{ steps.native_key.outputs.key }}'
const pathOutput = '${{ steps.native_key.outputs.path }}'
const always = (step) =>
  /^\$\{\{ always\(\)( && .*)? \}\}$|^always\(\)$/.test(step?.if ?? '')

const runtimeStart = `bash ${RUNTIME_SCRIPT} start`
const runtimeStop = (name) => `bash ${RUNTIME_SCRIPT} stop ${name}`

/** Every Metro start names its platform, in the workflow and in the runtime script it calls. */
function metroProblems(texts, check) {
  for (const text of texts)
    for (const line of String(text).split('\n'))
      check(
        !line.includes('node scripts/run-story68-native.mjs metro') ||
          /run-story68-native\.mjs metro --platform ios(?=\s)/.test(line),
        'every Metro start must pass --platform ios'
      )
}

function triggerProblems(on, check) {
  check(
    on !== null && typeof on === 'object' && !('pull_request' in on),
    'ios-native must stay off pull requests: it cannot fit the 15-minute budget (D6)'
  )
  check(
    JSON.stringify(on?.push?.branches) === JSON.stringify(['main']) &&
      Array.isArray(on?.push?.paths) &&
      on.push.paths.length > 0,
    'ios-native must run on a merge to main, filtered by its native iOS inputs'
  )
  const crons = [on?.schedule ?? []].flat().map((entry) => entry?.cron)
  check(
    crons.length > 0 && crons.every((cron) => /^\S+( \S+){4}$/.test(String(cron))),
    'ios-native needs a nightly schedule'
  )
  check(
    on?.workflow_dispatch?.inputs?.ref?.default === '' &&
      on.workflow_dispatch.inputs.ref.required === false,
    'ios-native must take an optional ref so a pull request head SHA can be dispatched'
  )
}

function jobProblems(workflow, job, check) {
  check(
    JSON.stringify(Object.keys(workflow.jobs ?? {})) === JSON.stringify([IOS_NATIVE_JOB]),
    `ios-native holds exactly one job, ${IOS_NATIVE_JOB}: one macOS runner for all of it`
  )
  check(job?.['runs-on'] === 'macos-26', `${IOS_NATIVE_JOB}: macos-26 runner required`)
  const limit = job?.['timeout-minutes']
  check(
    Number.isInteger(limit) && limit > 0 && limit <= HOSTED_JOB_LIMIT,
    `${IOS_NATIVE_JOB}: limit must stay within the ${HOSTED_JOB_LIMIT}-minute hosted job limit`
  )
  check(
    job?.if === undefined && job?.needs === undefined,
    `${IOS_NATIVE_JOB} runs on every event of its workflow`
  )
  check(
    job?.['continue-on-error'] === undefined &&
      (job?.steps ?? []).every((step) => step['continue-on-error'] === undefined),
    `${IOS_NATIVE_JOB}: failures must remain visible`
  )
  check(
    job?.env?.CC68_HARNESS_DIR === HARNESS_DIRECTORY &&
      job.env.PLAYWRIGHT_SKIP_DB_RESET === 'true',
    `${IOS_NATIVE_JOB}: the harness directory env is required and the shared database reset stays off`
  )
  check(
    job?.steps?.[0]?.uses === 'actions/checkout@v4' &&
      job.steps[0].with?.ref === '${{ inputs.ref || github.sha }}',
    `${IOS_NATIVE_JOB}: check out the dispatched ref, or the commit that triggered the run`
  )
}

/** Xcode 26.4 or later, chosen by name before anything builds, and logged. */
function xcodeProblems(steps, at, check) {
  const xcode = at((step) => step.id === 'xcode')
  const run = steps[xcode]?.run ?? ''
  check(
    xcode >= 0 &&
      run.includes('/Xcode_26.*.app') &&
      run.includes('[ "${BASH_REMATCH[1]}" -ge 4 ]') &&
      run.includes('sudo xcode-select -s') &&
      run.includes('DEVELOPER_DIR=') &&
      run.includes('xcodebuild -version'),
    `${IOS_NATIVE_JOB}: select Xcode 26.4 or later by name and log xcodebuild -version`
  )
  const firstBuild = steps.findIndex(
    (step, index) =>
      index !== xcode &&
      /run-story68-native\.mjs (prebuild|build)|swift test|xcodebuild /.test(
        step.run ?? ''
      )
  )
  check(
    xcode >= 0 && firstBuild > xcode,
    `${IOS_NATIVE_JOB}: Xcode is selected before anything builds`
  )
}

/** One prebuild, then the Release app the accessibility-focus check reads. */
function releaseProblems(steps, at, check) {
  const prebuilds = steps.filter((step) =>
    step.run?.includes('run-story68-native.mjs prebuild')
  )
  check(prebuilds.length === 1, `${IOS_NATIVE_JOB}: prebuild the iOS project once`)
  const prebuild = at((step) => step.run?.includes('run-story68-native.mjs prebuild'))
  const release = at((step) => step.id === 'release_build')
  const focus = at((step) => step.id === 'focus_check')
  check(
    release > prebuild &&
      steps[release].run.includes('--configuration Release') &&
      focus > release &&
      steps[focus].run.includes('check-accessibility-focus-builds.sh ios-app') &&
      steps[focus].if?.includes("steps.release_build.outcome == 'success'"),
    `${IOS_NATIVE_JOB}: the Release app build and its accessibility-focus check are required`
  )
}

/** The development client: keyed, restored, built only on a miss, scanned before it is cached. */
function clientProblems(steps, at, check) {
  const key = at((step) => step.id === 'native_key')
  check(
    key >= 0 &&
      steps[key].run ===
        'node scripts/ci/native-build-cache.mjs key --platform ios >> "$GITHUB_OUTPUT"',
    `${IOS_NATIVE_JOB}: the client must be keyed by scripts/ci/native-build-cache.mjs`
  )
  const restore = at(
    (step) =>
      step.id === 'native_cache' &&
      step.uses === 'actions/cache/restore@v4' &&
      step.with?.key === keyOutput &&
      step.with?.path === pathOutput &&
      step.with?.['lookup-only'] === undefined
  )
  const build = at((step) => step.id === 'native_build')
  check(
    restore > key &&
      build > restore &&
      steps[build].run === 'node scripts/run-story68-native.mjs build --platform ios' &&
      steps[build].if?.includes("steps.native_cache.outputs.cache-hit != 'true'"),
    `${IOS_NATIVE_JOB}: restore the client of its key and build it only on a miss`
  )
  const scan = at((step) => step.id === 'app_scan')
  const save = at(
    (step) =>
      step.uses === 'actions/cache/save@v4' &&
      step.with?.key === keyOutput &&
      step.with?.path === pathOutput
  )
  check(
    scan > build &&
      steps[scan].run ===
        `node scripts/ci/native-ios-app-secret-scan.mjs ${IOS_CLIENT} "$CC68_HARNESS_DIR"` &&
      steps[scan].if?.includes("steps.native_build.outcome == 'success'") &&
      save > scan &&
      steps[save].if?.includes("steps.app_scan.outcome == 'success'"),
    `${IOS_NATIVE_JOB}: the client must be secret-scanned before it is cached`
  )
  const client = at((step) => step.id === 'client')
  check(
    client > save &&
      steps[client].if?.includes("steps.native_cache.outputs.cache-hit == 'true'") &&
      steps[client].if.includes("steps.app_scan.outcome == 'success'") &&
      !steps[client].if.includes("steps.native_build.outcome == 'success' ||"),
    `${IOS_NATIVE_JOB}: install only a restored client or one this job built and scanned`
  )
  return client
}

/**
 * Each segment (the build, every shard, Expo Go) starts its own runtime and always selects its
 * evidence, uploads it fail-closed and stops its runtime, in that order.
 */
function segmentProblems(steps, at, name, runtimeId, artifact, check) {
  const start = at((step) => step.id === runtimeId)
  check(
    start >= 0 && steps[start].run === runtimeStart,
    `${name}: start its own runtime with ${RUNTIME_SCRIPT}`
  )
  const after = (predicate) => {
    const index = steps.findIndex((step, i) => i > start && predicate(step))
    return index
  }
  const evidence = after(
    (step) => step.run === 'node scripts/e2e-share-card/public-evidence.mjs'
  )
  const upload = after(
    (step) => step.uses === 'actions/upload-artifact@v4' && step.with?.name === artifact
  )
  const stop = after(
    (step) => step.run === runtimeStop(artifact.replace('share-card-ios-', ''))
  )
  check(
    evidence > start &&
      always(steps[evidence]) &&
      steps[evidence].env?.CC68_CI_PLATFORM === 'ios',
    `${name}: closed evidence must always be selected`
  )
  check(
    upload > evidence &&
      always(steps[upload]) &&
      steps[upload].with?.path === EVIDENCE_PATH &&
      steps[upload].with?.['if-no-files-found'] === 'error',
    `${name}: evidence upload must fail closed`
  )
  check(stop > upload && always(steps[stop]), `${name}: owned cleanup must always run`)
  return { start, stop }
}

function shardProblems(steps, at, client, check) {
  const shards = shardsOf('ios')
  const ends = []
  for (const shard of shards) {
    const name = `shard ${shard}`
    const runtimeId = `shard_${shard}_runtime`
    const { start, stop } = segmentProblems(
      steps,
      at,
      name,
      runtimeId,
      `share-card-ios-shard-${shard}`,
      check
    )
    check(
      start > client && steps[start]?.if?.includes("steps.client.outcome == 'success'"),
      `${name}: install only the scanned client`
    )
    const flows = at((step) => step.id === `shard_${shard}`)
    const run = steps[flows]?.run ?? ''
    check(
      flows > start &&
        flows < stop &&
        run.includes(`shard='${shard}/${shards.length}'`) &&
        run.includes('native-ios-shards.mjs commands "$shard"') &&
        run.includes('--shard "$shard"') &&
        run.includes('native-ios-startup-probe.mjs --for-native-flow') &&
        steps[flows].if?.includes(`steps.${runtimeId}.outcome == 'success'`),
      `${name}: every command must receive its shard, on its own runtime`
    )
    check(
      steps[flows]?.['timeout-minutes'] === SHARD_FLOW_MINUTES,
      `${name}: the flows keep their ${SHARD_FLOW_MINUTES}-minute budget`
    )
    check(!run.includes('expo-go-proof'), `${name} must not run the Expo Go proof`)
    const copy = steps.findIndex(
      (step, i) =>
        i > flows &&
        i < stop &&
        step.run?.includes(`$RUNNER_TEMP/ios-shards/shard-${shard}`) &&
        always(step)
    )
    check(copy > flows, `${name}: keep its evidence for the shard merge`)
    ends.push(stop)
  }
  const merge = at((step) =>
    step.run?.includes(
      'node scripts/ci/native-ios-shards.mjs merge "$RUNNER_TEMP/ios-shards"'
    )
  )
  const outcomes = String(steps[merge]?.env?.CC68_SHARD_OUTCOMES ?? '')
  check(
    merge > Math.max(...ends) &&
      steps[merge].if === '${{ !cancelled() }}' &&
      steps[merge].run.includes('test "$outcome" = success') &&
      shards.every((shard) => outcomes.includes(`\${{ steps.shard_${shard}.outcome }}`)),
    `${IOS_NATIVE_JOB}: every shard must run and report its exact cases`
  )
  return merge
}

function expoGoProblems(steps, at, merge, check) {
  const { start } = segmentProblems(
    steps,
    at,
    'Expo Go',
    'runtime',
    'share-card-ios-expo-go',
    check
  )
  const proofs = steps.filter((step) =>
    step.run?.includes('run-story68-native.mjs expo-go-proof')
  )
  const proof = at((step) => step.run?.includes('run-story68-native.mjs expo-go-proof'))
  check(
    proofs.length === 1 &&
      proof > start &&
      start > merge &&
      proofs[0].run.includes('--platform ios --device "$device"') &&
      !proofs[0].run.includes('--shard') &&
      proofs[0].run.includes('native-ios-startup-probe.mjs --for-native-flow'),
    "Expo Go: the proof runs once, after the shards, on its own runtime's simulator, without a shard"
  )
  const includesRun = (command) => steps.some((step) => step.run?.includes(command))
  check(
    includesRun(
      'swift test --package-path apps/mobile/modules/share-card-photo-save/ios'
    ) &&
      includesRun('e2e-share-card/bridge-a11y.mjs') &&
      includesRun('maestro-check-flows.mjs') &&
      includesRun('share-card-header-semantics.sh'),
    'Expo Go: PNG guards, accessibility bridge, flow check and heading semantics required'
  )
}

/** Validate ios-native.yml; `runtimeScript` is the text of scripts/ci/native-ios-runtime.sh. */
export function iosNativeProblems(workflow, { runtimeScript = '' } = {}) {
  const problems = []
  const check = (ok, message) => {
    if (!ok) problems.push(message)
  }
  const job = workflow.jobs?.[IOS_NATIVE_JOB]
  const steps = job?.steps ?? []
  const at = (predicate) => steps.findIndex(predicate)
  triggerProblems(workflow.on ?? workflow[true], check)
  jobProblems(workflow, job, check)
  xcodeProblems(steps, at, check)
  releaseProblems(steps, at, check)
  const client = clientProblems(steps, at, check)
  segmentProblems(
    steps,
    at,
    'build segment',
    'build_runtime',
    'share-card-ios-build',
    check
  )
  const merge = shardProblems(steps, at, client, check)
  expoGoProblems(steps, at, merge, check)
  const starts = steps.filter((step) => step.run === runtimeStart).length
  const stops = steps.filter((step) =>
    step.run?.startsWith(`bash ${RUNTIME_SCRIPT} stop `)
  )
  check(
    starts === shardsOf('ios').length + 2 &&
      stops.length === starts &&
      new Set(stops.map((step) => step.run)).size === stops.length,
    `${IOS_NATIVE_JOB}: every runtime started is stopped once, under its own name`
  )
  const uploads = steps.filter((step) => step.uses === 'actions/upload-artifact@v4')
  check(
    uploads.every((step) => step.with?.path === EVIDENCE_PATH) &&
      new Set(uploads.map((step) => step.with?.name)).size === uploads.length,
    `${IOS_NATIVE_JOB}: only closed evidence is uploaded, under unique names; the client travels by cache`
  )
  const stopStack = steps.at(-1)
  check(
    stopStack?.run === 'node scripts/ci/native-supabase.mjs stop' && always(stopStack),
    `${IOS_NATIVE_JOB}: the native Supabase stack always stops last`
  )
  metroProblems([...steps.map((step) => step.run ?? ''), runtimeScript], check)
  check(
    runtimeScript.includes('node scripts/e2e-share-card/prepare.mjs') &&
      runtimeScript.includes('node scripts/e2e-share-card/cleanup.mjs') &&
      runtimeScript.includes('node scripts/ci/native-ios-device-cleanup.mjs'),
    `${RUNTIME_SCRIPT}: each segment provisions, cleans up and deletes its own simulator`
  )
  return problems
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const problems = iosNativeProblems(
    parse(fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8')),
    {
      runtimeScript: fs.readFileSync(RUNTIME_SCRIPT, 'utf8'),
    }
  )
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else console.log('ios-native.yml keeps every iOS guard.')
}
