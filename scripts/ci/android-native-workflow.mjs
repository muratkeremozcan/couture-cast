// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 (Antigravity r6 P3, TEA ruling): the rules android-native.yml keeps. Its two Linux
// jobs run the Android checks that ran only by hand, nightly and by manual dispatch, never on a
// pull request or a merge:
//
//   android-release-builds    one Gradle run builds the release AAB with every shipped ABI and
//                             the minifiedDebuggable APK; android-release-abis.mjs reads the AAB
//                             and minified-debuggable-evidence.mjs the APK, and either failing
//                             fails the job.
//   android-network-timeout   the debug development client on an emulator runs
//                             maestro/network-timeout/dev-client-timeout.yaml against
//                             scripts/lib/network-tarpit.mjs through
//                             scripts/ci/android-network-timeout.sh.
//
// Each rule checks that a control is present, eligible to run and able to fail its job, and that
// the evidence uploads for a short time without a secret in reach.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import {
  disabledCondition,
  executedLines,
  neutralizedRun,
  requiredLineProblems,
} from './ios-native-workflow.mjs'

export const WORKFLOW = '.github/workflows/android-native.yml'
export const NETWORK_SCRIPT = 'scripts/ci/android-network-timeout.sh'
export const RELEASE_JOB = 'android-release-builds'
export const NETWORK_JOB = 'android-network-timeout'
export const LIMITS = { [RELEASE_JOB]: 120, [NETWORK_JOB]: 60 }
const NIGHTLY = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/
const HOSTED_JOB_LIMIT = 360
const ANDROID = 'apps/mobile/android'
const BUILT = "${{ !cancelled() && steps.android_build.outcome == 'success' }}"

export const RELEASE_BUILD =
  './gradlew :app:bundleRelease :app:assembleMinifiedDebuggable --console=plain'
// TEA, 2026-11-13: the Debug x86_64 client goes through the Worklets staging, which the device run
// needed against Reanimated's legacy libworklets.so race; the release builds stay plain.
export const CLIENT_BUILD =
  'node scripts/ci/worklets-staged-gradle.mjs --project apps/mobile/android --configuration Debug --abis x86_64 --evidence "$RUNNER_TEMP/android-network-timeout/worklets" -- :app:assembleDebug -PreactNativeArchitectures=x86_64 --console=plain'
export const MINIFIED_EVIDENCE =
  'node scripts/lib/minified-debuggable-evidence.mjs --android apps/mobile/android | tee "$RUNNER_TEMP/android-release-builds/minified-debuggable.json"'
export const RELEASE_ABIS =
  'node scripts/ci/android-release-abis.mjs apps/mobile/android/app/build/outputs/bundle/release/app-release.aab | tee "$RUNNER_TEMP/android-release-builds/release-abis.txt"'
export const PREBUILD = 'npx expo prebuild --platform android --no-install'
export const NETWORK_RUN = `bash ${NETWORK_SCRIPT}`
export const NETWORK_EVIDENCE = '${{ runner.temp }}/android-network-timeout'
export const ARTIFACTS = {
  [RELEASE_JOB]: {
    name: RELEASE_JOB,
    path: '${{ runner.temp }}/android-release-builds/',
    'retention-days': 7,
    'if-no-files-found': 'error',
  },
  [NETWORK_JOB]: {
    name: NETWORK_JOB,
    path: `${NETWORK_EVIDENCE}/`,
    'retention-days': 7,
    'if-no-files-found': 'error',
  },
}
// The run steps of the flow's own header, in the one strict shell the emulator action starts.
// The tarpit and Metro run in the background; the lines after them prove both are up.
export const NETWORK_SERVICES = [
  'node scripts/lib/network-tarpit.mjs --port 4010 > "$evidence/tarpit.log" 2>&1 &',
  // Placeholder Supabase public env: without it the app's Supabase client throws before Home's
  // request leaves the app (device run, 2026-11-13).
  '(cd apps/mobile && CI=1 EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4010 EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:4011 EXPO_PUBLIC_SUPABASE_ANON_KEY=network-timeout-placeholder npx expo start --dev-client --port 8081 > "$evidence/metro.log" 2>&1) &',
]
export const NETWORK_LINES = [
  'set -euo pipefail',
  // Each background service gets its own process group, so cleanup stops what it spawned.
  'set -m',
  "curl -fsS --max-time 5 http://127.0.0.1:8081/status | grep -q 'packager-status:running'",
  'kill -0 "$tarpit"',
  'adb -s "$ANDROID_SERIAL" install -r "$apk"',
  '"$HOME/.maestro/bin/maestro" --device "$ANDROID_SERIAL" test -e MAESTRO_APP_ID=com.couturecast.app -e \'APP_URL=mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081\' --test-output-dir "$evidence/maestro" maestro/network-timeout/dev-client-timeout.yaml',
]
export const NETWORK_APK =
  'apk=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const steps = (job) => job?.steps ?? []
const onOf = (workflow) => workflow?.on ?? workflow?.[true]
const indexOf = (job, predicate) => steps(job).findIndex(predicate)
const runs = (command) => (step) => String(step.run ?? '').includes(command)

/** Why a workflow step's shell body may not execute each required line or may hide a failure. */
function stepProblems(label, step, condition, required, check) {
  check(
    !!step &&
      step.if === condition &&
      step.shell === undefined &&
      step['continue-on-error'] === undefined &&
      !neutralizedRun(step.run),
    `${label} must exist, run on ${condition ?? 'every earlier success'} and fail its job`
  )
  if (step)
    for (const problem of requiredLineProblems(step.run, required))
      check(false, `${label} ${problem}`)
}

/** Triggers, permissions and the job set. */
function workflowProblems(workflow, check) {
  const on = onOf(workflow)
  check(
    same(Object.keys(on ?? {}).sort(), ['schedule', 'workflow_dispatch']) &&
      (on.workflow_dispatch === null ||
        Object.keys(on.workflow_dispatch ?? {}).length === 0),
    'android-native.yml runs only nightly and on a manual dispatch without inputs, never on a pull request or a merge'
  )
  const crons = [on?.schedule ?? []].flat().map((entry) => entry?.cron)
  check(
    crons.length === 1 && NIGHTLY.test(String(crons[0])),
    'android-native.yml needs one nightly schedule: a fixed minute and hour, every day'
  )
  check(
    same(workflow?.permissions, { contents: 'read' }) &&
      Object.values(workflow?.jobs ?? {}).every((job) => job?.permissions === undefined),
    'android-native.yml: contents: read only, on every job'
  )
  check(
    same(Object.keys(workflow?.jobs ?? {}).sort(), [NETWORK_JOB, RELEASE_JOB]),
    `android-native.yml holds exactly ${RELEASE_JOB} and ${NETWORK_JOB}`
  )
  check(
    !/\bsecrets\./.test(JSON.stringify(workflow ?? {})),
    'android-native.yml reads no secret'
  )
}

/** Each job: Linux, its fixed limit, no gate, nothing that hides a failure, short evidence. */
function jobProblems(name, job, check) {
  check(job?.['runs-on'] === 'ubuntu-latest', `${name}: ubuntu-latest runner required`)
  const limit = job?.['timeout-minutes']
  check(
    Number.isInteger(limit) && limit > 0 && limit <= HOSTED_JOB_LIMIT,
    `${name}: limit must be a fixed number of minutes within the hosted job limit`
  )
  check(
    job?.if === undefined && job?.needs === undefined,
    `${name}: runs on every nightly and dispatch run, with no condition`
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
  check(
    steps(job).every(
      (step) =>
        !Number.isInteger(step['timeout-minutes']) || step['timeout-minutes'] < limit
    ),
    `${name}: every step limit stays inside the job's`
  )
  const uploads = steps(job).filter((step) =>
    String(step.uses).startsWith('actions/upload-artifact')
  )
  check(
    uploads.length === 1 &&
      uploads[0].uses === 'actions/upload-artifact@v4' &&
      uploads[0].if === 'always()' &&
      same(uploads[0].with, ARTIFACTS[name]) &&
      indexOf(job, (step) => step === uploads[0]) === steps(job).length - 1,
    `${name}: upload its evidence once, last, on every outcome, as ${ARTIFACTS[name]?.name}, kept for 7 days, failing when it is missing`
  )
  const prebuild = indexOf(job, (step) => step.run === PREBUILD)
  check(
    prebuild >= 0 &&
      steps(job)[prebuild]['working-directory'] === 'apps/mobile' &&
      steps(job)[prebuild].if === undefined,
    `${name}: generate the Android project with the plain prebuild`
  )
}

/** The release AAB of every ABI and the minifiedDebuggable APK, then both checks. */
function releaseProblems(job, check) {
  const rows = steps(job)
  const build = rows.find((step) => step.id === 'android_build')
  stepProblems(`${RELEASE_JOB}: the build`, build, undefined, [RELEASE_BUILD], check)
  check(
    build?.['working-directory'] === ANDROID &&
      !String(build?.run ?? '').includes('reactNativeArchitectures') &&
      Number.isInteger(build?.['timeout-minutes']),
    `${RELEASE_JOB}: build in ${ANDROID} with every shipped ABI and its own limit`
  )
  const minified = rows.find((step) => step.id === 'minified_debuggable')
  stepProblems(
    `${RELEASE_JOB}: the minifiedDebuggable check`,
    minified,
    BUILT,
    ['set -euo pipefail', MINIFIED_EVIDENCE],
    check
  )
  const abis = rows.find((step) => step.id === 'release_abis')
  stepProblems(
    `${RELEASE_JOB}: the ABI check`,
    abis,
    BUILT,
    ['set -euo pipefail', RELEASE_ABIS],
    check
  )
  const order = [
    indexOf(job, (step) => step.run === PREBUILD),
    indexOf(job, (step) => step.id === 'android_build'),
    indexOf(job, (step) => step.id === 'minified_debuggable'),
    indexOf(job, (step) => step.id === 'release_abis'),
  ]
  check(
    order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])),
    `${RELEASE_JOB}: prebuild, build, then check the APK and the AAB`
  )
}

/** The development client, Maestro, the emulator and the flow against the tarpit. */
function networkProblems(job, script, check) {
  const rows = steps(job)
  const build = rows.find((step) => step.id === 'client_build')
  stepProblems(
    `${NETWORK_JOB}: the client build`,
    build,
    undefined,
    [CLIENT_BUILD],
    check
  )
  check(
    build?.['working-directory'] === undefined &&
      Number.isInteger(build?.['timeout-minutes']),
    `${NETWORK_JOB}: build the client from the repository root through the Worklets staging, with its own limit`
  )
  const flow = rows.find((step) => step.id === 'network_timeout')
  check(
    flow?.uses === 'reactivecircus/android-emulator-runner@v2' &&
      flow.if === undefined &&
      flow.with?.script === NETWORK_RUN &&
      same(flow.env, { NETWORK_TIMEOUT_EVIDENCE: NETWORK_EVIDENCE }) &&
      Number.isInteger(flow['timeout-minutes']),
    `${NETWORK_JOB}: run ${NETWORK_RUN} on the emulator after every earlier success, with the evidence directory and its own limit`
  )
  const order = [
    indexOf(job, (step) => step.run === PREBUILD),
    indexOf(job, (step) => step.id === 'client_build'),
    indexOf(job, runs('node scripts/maestro-install.mjs')),
    indexOf(job, runs('test -r /dev/kvm && test -w /dev/kvm')),
    indexOf(job, (step) => step.id === 'network_timeout'),
  ]
  check(
    order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])),
    `${NETWORK_JOB}: prebuild, build the client, install Maestro, enable KVM, then run the flow`
  )
  const lines = executedLines(script)
  check(
    lines[0]?.line === 'set -euo pipefail' &&
      !neutralizedRun(script.replace(/\|\| true/, '')),
    `${NETWORK_SCRIPT}: one strict shell that cannot hide a failure`
  )
  check(
    lines.some(({ line }) => line === NETWORK_APK),
    `${NETWORK_SCRIPT}: install the debug development client`
  )
  for (const service of NETWORK_SERVICES)
    check(
      lines.some(({ line, conditional }) => line === service && !conditional),
      `${NETWORK_SCRIPT} does not start: ${service}`
    )
  for (const problem of requiredLineProblems(script, NETWORK_LINES))
    check(false, `${NETWORK_SCRIPT} ${problem}`)
  // The services stop on exit, by process group; that cleanup is the one place a status may be
  // ignored.
  check(
    (script.match(/\|\| true/g) ?? []).length <= 1 &&
      /kill -- "-\$tarpit" "-\$metro" 2> \/dev\/null \|\| true/.test(script) &&
      /trap stop_services EXIT/.test(script),
    `${NETWORK_SCRIPT}: stop the tarpit and Metro on exit, and ignore no other status`
  )
}

/** Every rule android-native.yml keeps; an empty list means it keeps them all. */
export function androidNativeProblems(workflow, script) {
  const problems = []
  const check = (ok, message) => {
    if (!ok) problems.push(message)
  }
  workflowProblems(workflow, check)
  for (const name of [RELEASE_JOB, NETWORK_JOB])
    jobProblems(name, workflow?.jobs?.[name], check)
  releaseProblems(workflow?.jobs?.[RELEASE_JOB], check)
  networkProblems(workflow?.jobs?.[NETWORK_JOB], String(script ?? ''), check)
  return problems
}

export function readAndroidNative(read = (file) => fs.readFileSync(file, 'utf8')) {
  return { workflow: parse(read(WORKFLOW)), script: read(NETWORK_SCRIPT) }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const { workflow, script } = readAndroidNative()
  const problems = androidNativeProblems(workflow, script)
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else console.log('android-native.yml keeps every Android nightly guard.')
}
