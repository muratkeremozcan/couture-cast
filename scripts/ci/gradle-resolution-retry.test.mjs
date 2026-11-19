// Learning path Step 58: Production status and nightly health.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-status-and-nightly-health
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { parseArgs, runGradleWithResolutionRetry } from './gradle-resolution-retry.mjs'
import { EXPECTED_TESTS, NEED_OS_REPORT } from './check-accessibility-focus-results.mjs'
import {
  RESOLUTION_RETRY_DELAYS_MS,
  runWithResolutionRetry,
  transientResolutionFailure,
} from '../lib/transient-resolution-retry.cjs'

const cli = fileURLToPath(new URL('./gradle-resolution-retry.mjs', import.meta.url))

// The lines run 43767969866 printed, and a real test failure for contrast.
const RATE_LIMITED =
  "Could not GET 'https://repo.maven.apache.org/maven2/com/google/code/gson/gson/2.9.1/gson-2.9.1.pom'. Received status code 429 from server: Too Many Requests"
const TEST_FAILED =
  'ModalSystemBarsTest > appliesLightBarsOnApi33 FAILED\n    java.lang.AssertionError at ModalSystemBarsTest.kt:61'
// Gradle's closing lines when the test task fails.
const TEST_TASK_FAILED = [
  '> Task :modal-system-bars:testDebugUnitTest FAILED',
  '* What went wrong:',
  "Execution failed for task ':modal-system-bars:testDebugUnitTest'.",
  '> There were failing tests. See the report at: file:///build/reports/tests/index.html',
  'BUILD FAILED in 41s',
].join('\n')
// Robolectric's own runtime download, which fails inside the test task.
const ROBOLECTRIC_RATE_LIMITED =
  'java.io.IOException: Server returned HTTP response code: 429 for URL: https://repo1.maven.org/maven2/org/robolectric/android-all-instrumented/13-robolectric-9030017-i6/android-all-instrumented-13-robolectric-9030017-i6.jar'

/**
 * A stand-in for Gradle: attempt N plays outcomes[N - 1] ('rate-limit', 'test-failure' or
 * 'pass'), printing to stderr, and records each attempt in a counter file.
 */
function fakeGradle(t, outcomes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-retry-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const counter = path.join(directory, 'attempts')
  const script = path.join(directory, 'gradle.cjs')
  fs.writeFileSync(
    script,
    `const fs = require('node:fs')
const counter = ${JSON.stringify(counter)}
const attempt = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1
fs.writeFileSync(counter, String(attempt))
const outcome = ${JSON.stringify(outcomes)}[attempt - 1]
if (outcome === 'pass') { console.log('BUILD SUCCESSFUL'); process.exit(0) }
console.error(outcome === 'rate-limit' ? ${JSON.stringify(RATE_LIMITED)} : ${JSON.stringify(TEST_FAILED)})
console.error('BUILD FAILED')
process.exit(outcome === 'rate-limit' ? 1 : 3)
`
  )
  return {
    command: ['--', process.execPath, script],
    attempts: () => Number(fs.readFileSync(counter, 'utf8')),
  }
}

test('the command comes after --, with nothing before it', () => {
  assert.deepEqual(parseArgs(['--', './gradlew', ':m:test', '--console=plain']), [
    './gradlew',
    ':m:test',
    '--console=plain',
  ])
  for (const argv of [[], ['--'], ['./gradlew'], ['--project', 'x', '--', './gradlew']])
    assert.throws(() => parseArgs(argv), /Usage: gradle-resolution-retry\.mjs/)
})

test('a rate-limited Gradle run is retried, each retry logged, until it passes', (t) => {
  const gradle = fakeGradle(t, ['rate-limit', 'rate-limit', 'pass'])
  const waits = []
  const logs = []
  const status = runGradleWithResolutionRetry(gradle.command, {
    wait: (ms) => waits.push(ms),
    log: (message) => logs.push(message),
  })
  assert.equal(status, 0)
  assert.equal(gradle.attempts(), 3)
  assert.deepEqual(waits, [20000, 40000])
  assert.deepEqual(logs, [
    'Attempt 1/3 hit a transient download error (status code 429); retrying in 20 s.',
    'Attempt 2/3 hit a transient download error (status code 429); retrying in 40 s.',
  ])
})

test('a failing test fails at once, with its own exit status and no retry', (t) => {
  const gradle = fakeGradle(t, ['test-failure', 'pass'])
  const logs = []
  const status = runGradleWithResolutionRetry(gradle.command, {
    wait: () => assert.fail('a real failure must not wait'),
    log: (message) => logs.push(message),
  })
  assert.equal(status, 3)
  assert.equal(gradle.attempts(), 1)
  assert.deepEqual(logs, [])
})

test('the attempts are bounded: a rate limit that outlasts them fails the step', (t) => {
  const gradle = fakeGradle(t, ['rate-limit', 'rate-limit', 'rate-limit', 'pass'])
  const logs = []
  const status = runGradleWithResolutionRetry(gradle.command, {
    wait: () => undefined,
    log: (message) => logs.push(message),
  })
  assert.equal(status, 1)
  assert.equal(gradle.attempts(), 3)
  assert.equal(logs.length, 3)
  assert.match(logs[2], /^Attempt 3\/3 hit a transient download error .*; giving up\.$/)
})

test('the CLI streams the command output and exits with its status', (t) => {
  const passing = fakeGradle(t, ['pass'])
  const passed = spawnSync(process.execPath, [cli, ...passing.command], {
    encoding: 'utf8',
  })
  assert.equal(passed.status, 0, passed.stderr)
  assert.match(passed.stdout, /BUILD SUCCESSFUL/)
  assert.doesNotMatch(passed.stdout, /::warning::/)

  // Gradle's stderr reaches the step log through the same stream the retry reads.
  const failing = fakeGradle(t, ['test-failure'])
  const failed = spawnSync(process.execPath, [cli, ...failing.command], {
    encoding: 'utf8',
  })
  assert.equal(failed.status, 3)
  assert.match(failed.stdout, /AssertionError at ModalSystemBarsTest\.kt:61/)
  assert.equal(failing.attempts(), 1)

  const usage = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
  assert.equal(usage.status, 2)
  assert.match(usage.stderr, /Usage: gradle-resolution-retry\.mjs -- <command>/)
})

test('the retry waits are frozen, so no caller can change the attempt bound', () => {
  assert.ok(Object.isFrozen(RESOLUTION_RETRY_DELAYS_MS))
  assert.deepEqual(RESOLUTION_RETRY_DELAYS_MS, [20000, 40000])
  assert.throws(() => RESOLUTION_RETRY_DELAYS_MS.push(60000), TypeError)
})

test('a real 429 resolution failure still retries', () => {
  const resolution = [
    '> Could not resolve com.google.code.gson:gson:2.9.1.',
    `   > ${RATE_LIMITED}`,
    'BUILD FAILED in 12s',
  ].join('\n')
  assert.equal(
    transientResolutionFailure({ status: 1, signal: null, stdout: resolution }),
    'status code 429'
  )
})

test('a signal-killed run is not retried, even after printing a transient error', () => {
  const killed = { status: null, signal: 'SIGTERM', stdout: RATE_LIMITED, stderr: '' }
  assert.equal(transientResolutionFailure(killed), undefined)
  let runs = 0
  const result = runWithResolutionRetry(
    () => {
      runs += 1
      return killed
    },
    { wait: () => assert.fail('a killed run must not wait'), log: () => undefined }
  )
  assert.equal(result, killed)
  assert.equal(runs, 1)
})

test('a failing test is not retried when its output only mentions a timeout or a 429', () => {
  for (const noise of [
    'java.net.SocketTimeoutException: Read timed out',
    'expected status code 429 but was 200',
    'Too Many Requests',
  ])
    for (const failure of [
      `${TEST_FAILED}\n    ${noise}`,
      `${noise}\n${TEST_TASK_FAILED}`,
    ])
      assert.equal(
        transientResolutionFailure({ status: 1, signal: null, stdout: failure }),
        undefined,
        failure
      )
})

test('a failing test whose failure is a rate-limited artifact download still retries', () => {
  for (const download of [ROBOLECTRIC_RATE_LIMITED, RATE_LIMITED])
    assert.match(
      transientResolutionFailure({
        status: 1,
        signal: null,
        stdout: `${TEST_FAILED}\n    ${download}\n${TEST_TASK_FAILED}`,
      }),
      /^(?:HTTP response code: 429|status code 429)$/
    )
})

test('a test task that failed resolving before its tests ran retries on a nested transient cause', () => {
  // The old classifier read the task's FAILED line as a failing test and needed the transient
  // word on the download's own line, so this failed on the first attempt.
  assert.equal(
    transientResolutionFailure({ status: 1, signal: null, stdout: UTP_READ_TIMED_OUT }),
    'Read timed out'
  )
})

test('a failing test is not retried by a transient word beside, not under, a failed download', () => {
  // A case's own output: the timeout is not a nested cause of the download line above it.
  const assertion = [
    'AccessibilityFocusTalkBackTest > reportsFocus[emulator-5554] FAILED',
    "    java.lang.AssertionError: Could not GET 'https://example.test/fixture.json' in the stub",
    '    Read timed out',
    '> There were failing tests. See the report.',
  ].join('\n')
  assert.equal(
    transientResolutionFailure({ status: 1, signal: null, stdout: assertion }),
    undefined
  )
  // A failed download whose nested cause is not transient (a 404) retries nothing either.
  const missing = [
    '> Could not resolve com.example:absent:1.0.0.',
    "   > Could not GET 'https://repo.maven.apache.org/maven2/com/example/absent/1.0.0/absent-1.0.0.pom'.",
    '      > Received status code 404 from server: Not Found',
    'BUILD FAILED in 4s',
  ].join('\n')
  assert.equal(
    transientResolutionFailure({ status: 1, signal: null, stdout: missing }),
    undefined
  )
})

test('the modal system bars workflow runs its Gradle build through the retry', () => {
  const workflow = fs.readFileSync(
    fileURLToPath(
      new URL('../../.github/workflows/pr-modal-system-bars.yml', import.meta.url)
    ),
    'utf8'
  )
  assert.match(
    workflow,
    /node \.\.\/\.\.\/\.\.\/scripts\/ci\/gradle-resolution-retry\.mjs -- \.\/gradlew /
  )
  assert.doesNotMatch(workflow, /^\s+\.\/gradlew /m)
  // Only main writes either cache: Setup Gradle reads only off main, and the Robolectric runtimes
  // are restored on every ref and saved only on main after a miss.
  assert.match(
    workflow,
    /^ {10}cache-read-only: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}$/m
  )
  assert.doesNotMatch(workflow, /uses: actions\/cache@/)
  assert.match(workflow, /id: robolectric_cache\n {8}uses: actions\/cache\/restore@v4\n/)
  const save = workflow.match(
    /- name: Save Robolectric Android runtimes\n {8}if: (.+)\n {8}uses: actions\/cache\/save@v4\n/
  )
  assert.ok(save, 'the Robolectric runtimes are saved by actions/cache/save@v4')
  assert.equal(
    save[1],
    "${{ !cancelled() && github.ref == 'refs/heads/main' && steps.robolectric_cache.outputs.cache-hit != 'true' && steps.robolectric_tests.outcome == 'success' }}"
  )
  assert.equal(workflow.split('uses: actions/cache/').length - 1, 2)
  for (const file of [
    'scripts/ci/gradle-resolution-retry.mjs',
    'scripts/lib/transient-resolution-retry.cjs',
  ])
    assert.equal(
      workflow.split(`- '${file}'`).length - 1,
      2,
      `${file} must be in both path filters`
    )
})

// Scheduled run 44311237727 failed the accessibility-focus Robolectric job before any test ran:
// both registries answered 429 for gson, the foojay toolchain resolver plugin's dependency, the
// same failure the modal system bars job retries above.
test('the accessibility focus workflow runs every Gradle build through the retry', () => {
  const read = (file) =>
    fs.readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8')
  const text = read('.github/workflows/pr-accessibility-focus.yml')
  const { jobs } = parse(text)
  const retry =
    /^node \.\.\/\.\.\/\.\.\/scripts\/ci\/gradle-resolution-retry\.mjs -- \.\/gradlew /
  const gradleRuns = (job) =>
    job.steps.filter((step) =>
      /\.\/gradlew|npm run test:accessibility-focus/.test(step.run ?? '')
    )

  // The app build and the Robolectric tests call Gradle in their own steps; both retry.
  for (const id of ['android', 'android-robolectric']) {
    const runs = gradleRuns(jobs[id])
    assert.equal(runs.length, 1, `${id} runs Gradle in one step`)
    assert.match(runs[0].run, retry, `${id}: Gradle goes through the retry`)
    assert.equal(runs[0]['working-directory'], 'apps/mobile/android')
  }
  // The TalkBack job builds and runs inside its device script, whose every Gradle call goes
  // through the retry (the run itself is proved by the device-script test below).
  assert.deepEqual(gradleRuns(jobs['android-talkback']), [])
  const device = read('scripts/ci/accessibility-focus-device-tests.sh')
  assert.match(
    device,
    /node "\$here\/gradle-resolution-retry\.mjs" -- \\\n\s+\.\/gradlew /
  )
  assert.equal(device.match(/\.\/gradlew/g).length, 1, 'one Gradle call site, the retry')
  assert.deepEqual(device.match(/^\s*gradle\w* :accessibility-focus:\w+/gm), [
    '  gradle_retry :accessibility-focus:connectedDebugAndroidTest',
    'gradle_retry :accessibility-focus:assembleDebugAndroidTest',
  ])

  // Every Android job restores Gradle's cache, written only on main, before Gradle runs.
  for (const id of ['android', 'android-robolectric', 'android-talkback']) {
    const steps = jobs[id].steps
    const setup = steps.findIndex((step) =>
      String(step.uses ?? '').startsWith('gradle/actions/setup-gradle@')
    )
    assert.notEqual(setup, -1, `${id} sets up Gradle's cache`)
    assert.equal(
      steps[setup].with['cache-read-only'],
      "${{ github.ref != 'refs/heads/main' }}",
      `${id}: only main writes Gradle's cache`
    )
    const generate = steps.findIndex(
      (step) => step.name === 'Generate the Android project'
    )
    assert.ok(
      setup < generate,
      `${id}: Gradle's cache is set up before the project is generated`
    )
  }
  for (const file of [
    'scripts/ci/gradle-resolution-retry.mjs',
    'scripts/lib/transient-resolution-retry.cjs',
  ])
    assert.equal(
      text.split(`- '${file}'`).length - 1,
      2,
      `${file} must be in both path filters`
    )
})

// Codex review of 384b830d: each connected run resolves AGP's UTP test-runner artifacts when it
// starts, after the APK build, so a 429 there failed the lane past the build's retry. This runs
// the real device script with a stand-in Gradle and adb: the build passes, the TalkBack run's
// first start is rate-limited, and the suppressed-focus control fails on its assertion.
// Codex review 4: a connected run whose UTP resolution fails before any test runs marks its task
// FAILED and prints the transient cause on a nested line, not beside the download.
const UTP_READ_TIMED_OUT = [
  '> Task :accessibility-focus:connectedDebugAndroidTest FAILED',
  'FAILURE: Build failed with an exception.',
  '* What went wrong:',
  "Execution failed for task ':accessibility-focus:connectedDebugAndroidTest'.",
  "> Could not resolve all files for configuration ':accessibility-focus:_internal-unified-test-platform-android-device-provider-ddmlib'.",
  '   > Could not resolve com.android.tools.utp:android-device-provider-ddmlib:31.11.0.',
  "      > Could not get resource 'https://dl.google.com/dl/android/maven2/com/android/tools/utp/android-device-provider-ddmlib/31.11.0/android-device-provider-ddmlib-31.11.0.pom'.",
  "         > Could not GET 'https://dl.google.com/dl/android/maven2/com/android/tools/utp/android-device-provider-ddmlib/31.11.0/android-device-provider-ddmlib-31.11.0.pom'.",
  '            > Read timed out',
  'BUILD FAILED in 31s',
].join('\n')

function runDeviceScript(t, firstConnectedFailure) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-focus-device-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const android = path.join(root, 'apps/mobile/android')
  fs.mkdirSync(android, { recursive: true })
  const calls = path.join(root, 'gradle-calls.jsonl')
  const waits = path.join(root, 'waits.jsonl')
  const testcase = (name, failing) =>
    failing
      ? `<testcase name="${name}" classname="AccessibilityFocusTalkBackTest"><failure message="focus">java.lang.AssertionError: the OS reported focus on nothing</failure></testcase>`
      : `<testcase name="${name}" classname="AccessibilityFocusTalkBackTest" />`
  const xml = (failing) =>
    `<?xml version="1.0"?><testsuite name="AccessibilityFocusTalkBackTest">${EXPECTED_TESTS.map(
      (name) => testcase(name, failing.includes(name))
    ).join('')}</testsuite>`
  fs.writeFileSync(
    path.join(android, 'gradlew'),
    `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const calls = ${JSON.stringify(calls)}
const args = process.argv.slice(2)
const task = args.find((arg) => arg.startsWith(':accessibility-focus:'))
const suppressed = args.some((arg) => arg.endsWith('suppressFocus=true'))
const prior = fs.existsSync(calls)
  ? fs.readFileSync(calls, 'utf8').trim().split('\\n').map((line) => JSON.parse(line))
  : []
fs.appendFileSync(calls, JSON.stringify({ task, suppressed }) + '\\n')
if (task === ':accessibility-focus:assembleDebugAndroidTest') {
  console.log('BUILD SUCCESSFUL')
  process.exit(0)
}
const earlier = prior.filter((call) => call.task === task && call.suppressed === suppressed)
if (!suppressed && earlier.length === 0) {
  console.error(${JSON.stringify(firstConnectedFailure)})
  process.exit(1)
}
const raw = '../modules/accessibility-focus/android/build/outputs/androidTest-results/connected'
fs.mkdirSync(raw, { recursive: true })
fs.writeFileSync(
  path.join(raw, 'TEST-emulator.xml'),
  suppressed ? ${JSON.stringify(xml(NEED_OS_REPORT))} : ${JSON.stringify(xml([]))}
)
if (!suppressed) {
  console.log('BUILD SUCCESSFUL')
  process.exit(0)
}
console.error('> Task :accessibility-focus:connectedDebugAndroidTest FAILED')
console.error('> There were failing tests. See the report.')
process.exit(1)
`,
    { mode: 0o755 }
  )
  const settings = path.join(root, 'touch-exploration')
  const adb = path.join(root, 'adb')
  fs.writeFileSync(
    adb,
    `#!${process.execPath}
const fs = require('node:fs')
const settings = ${JSON.stringify(settings)}
const args = process.argv.slice(2).join(' ')
if (args === 'shell getprop ro.product.cpu.abi') console.log('x86_64')
if (args === 'shell settings put secure accessibility_enabled 1') fs.writeFileSync(settings, '1')
if (args === 'shell settings put secure accessibility_enabled 0') fs.writeFileSync(settings, '0')
if (args === 'shell settings get secure touch_exploration_enabled')
  console.log(fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : '0')
if (args === 'shell dumpsys accessibility')
  console.log('  A11yWindow[AccessibilityWindowInfo[title=Settings, id=12, type=TYPE_APPLICATION, active=true]]')
`,
    { mode: 0o755 }
  )
  // The retry's waits are recorded and skipped, so the test does not sleep 20 s.
  const noWait = path.join(root, 'no-wait.cjs')
  fs.writeFileSync(
    noWait,
    `const fs = require('node:fs')
Atomics.wait = (array, index, value, ms) => {
  fs.appendFileSync(${JSON.stringify(waits)}, JSON.stringify(ms) + '\\n')
  return 'timed-out'
}
`
  )
  const device = fileURLToPath(
    new URL('./accessibility-focus-device-tests.sh', import.meta.url)
  )
  const result = spawnSync('bash', [device], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ADB: adb,
      NODE_OPTIONS: `--require ${noWait}`,
      ACCESSIBILITY_FOCUS_WINDOW_WAIT: '1',
    },
  })
  return {
    result,
    calls: fs
      .readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
    waits: fs.existsSync(waits)
      ? fs.readFileSync(waits, 'utf8').trim().split('\n').map(Number)
      : [],
  }
}

for (const [cause, failure, error] of [
  [
    'a 429 beside the download',
    [
      '> Could not resolve com.android.tools.utp:android-test-plugin-host-retention:31.11.0.',
      `   > ${RATE_LIMITED}`,
      'BUILD FAILED in 9s',
    ].join('\n'),
    'status code 429',
  ],
  [
    'a read timeout nested under the download, with the task FAILED',
    UTP_READ_TIMED_OUT,
    'Read timed out',
  ],
])
  test(`the TalkBack device script retries a connected run that failed resolving (${cause}) and never the control`, (t) => {
    const { result, calls, waits } = runDeviceScript(t, failure)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    // The build once; the TalkBack run twice, its first start failed resolving; the control once.
    assert.deepEqual(calls, [
      { task: ':accessibility-focus:assembleDebugAndroidTest', suppressed: false },
      { task: ':accessibility-focus:connectedDebugAndroidTest', suppressed: false },
      { task: ':accessibility-focus:connectedDebugAndroidTest', suppressed: false },
      { task: ':accessibility-focus:connectedDebugAndroidTest', suppressed: true },
    ])
    assert.deepEqual(waits, [RESOLUTION_RETRY_DELAYS_MS[0]])
    assert.ok(
      result.stdout
        .split('\n')
        .includes(
          `::warning::Attempt 1/3 hit a transient download error (${error}); retrying in 20 s.`
        ),
      result.stdout
    )
    assert.match(
      result.stdout,
      /^TalkBack run: 5 passed\. Suppressed-focus control: the 4 tests that need the OS focus report failed on it, the rest passed\.$/m
    )
  })
