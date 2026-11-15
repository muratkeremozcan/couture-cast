import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArgs, runGradleWithResolutionRetry } from './gradle-resolution-retry.mjs'

const cli = fileURLToPath(new URL('./gradle-resolution-retry.mjs', import.meta.url))

// The lines run 43767969866 printed, and a real test failure for contrast.
const RATE_LIMITED =
  "Could not GET 'https://repo.maven.apache.org/maven2/com/google/code/gson/gson/2.9.1/gson-2.9.1.pom'. Received status code 429 from server: Too Many Requests"
const TEST_FAILED =
  'ModalSystemBarsTest > appliesLightBarsOnApi33 FAILED\n    java.lang.AssertionError at ModalSystemBarsTest.kt:61'

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
