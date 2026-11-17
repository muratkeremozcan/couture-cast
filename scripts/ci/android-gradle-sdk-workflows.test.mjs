// Main run 43927343722 lost android36-controls when Gradle fetched NDK 27.1.12297006 itself, in
// the middle of the journey, and dl.google.com answered 429. Every Linux job that runs Gradle on
// the generated app (apps/mobile/android) must install the SDK packages first, through
// scripts/ci/android-sdk-install.sh --gradle, which retries and then forbids Gradle's own download.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { splitTopLevel } from './workflow-step-shadowing.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const workflowsDir = path.join(root, '.github/workflows')
const INSTALL = 'bash scripts/ci/android-sdk-install.sh --gradle'

// A step runs Gradle on the generated app when it calls the wrapper, a script that does (the
// Worklets staging, the story 6.8 build commands, the accessibility-focus tests) or an emulator
// script whose journey builds with it.
const GRADLE =
  /\.\/gradlew\b|worklets-staged-gradle\.mjs|run-story68-native\.mjs (?:build|share-receive-build) --platform (?:android|\$\{\{ matrix\.platform \}\})|fetch-gradle-wrapper\.sh apps\/mobile\/android|test:accessibility-focus:android|share-card-android\.sh|accessibility-focus-device-tests\.sh/

const stepText = (step) => `${step.run ?? ''}\n${step.with?.script ?? ''}`
const runsGradle = (step) => GRADLE.test(stepText(step))

/** The runner labels a job can land on, with `${{ matrix.os }}` expanded. */
function runnerLabels(job) {
  if (String(job['runs-on']).includes('matrix.os'))
    return (job.strategy?.matrix?.include ?? []).map((row) => row.os)
  return [String(job['runs-on'])]
}

const gradleJobs = fs
  .readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml'))
  .flatMap((name) =>
    Object.entries(
      parse(fs.readFileSync(path.join(workflowsDir, name), 'utf8')).jobs ?? {}
    )
      .filter(
        ([, job]) =>
          runnerLabels(job).every((label) => label.startsWith('ubuntu')) &&
          (job.steps ?? []).some(runsGradle)
      )
      .map(([id, job]) => ({ id: `${name}:${id}`, steps: job.steps }))
  )

test('finds every job that builds the app with Gradle', () => {
  const found = gradleJobs.map(({ id }) => id)
  for (const expected of [
    'android-native.yml:android-release-builds',
    'android-native.yml:android-network-timeout',
    'android-native.yml:android-google-sign-in',
    'pr-accessibility-focus.yml:android',
    'pr-accessibility-focus.yml:android-robolectric',
    'pr-accessibility-focus.yml:android-talkback',
    'pr-modal-system-bars.yml:robolectric',
    'pr-share-card-native.yml:original-resource',
    'pr-share-card-native.yml:android36-native-matrix',
    'pr-share-card-native.yml:android36-original',
    'pr-share-card-native.yml:android36-controls',
    'pr-share-card-native.yml:android36-interaction',
    'pr-share-card-native.yml:android36-release-font',
  ])
    assert.ok(
      found.includes(expected),
      `${expected} runs Gradle; found ${found.join(', ')}`
    )
})

describe('each Gradle job installs the SDK packages before Gradle runs', () => {
  for (const { id, steps } of gradleJobs)
    test(id, () => {
      const at = steps.findIndex((step) => String(step.run ?? '').trim() === INSTALL)
      assert.notEqual(at, -1, `${id} has no "${INSTALL}" step`)
      const install = steps[at]
      assert.ok(
        install['timeout-minutes'] > 0 && install['timeout-minutes'] <= 8,
        `${id}: the install step needs its own timeout of at most 8 minutes`
      )

      const index = (predicate) => steps.findIndex(predicate)
      const firstGradle = index(runsGradle)
      assert.ok(
        at < firstGradle,
        `${id}: the install runs after Gradle (step ${firstGradle})`
      )
      // free-runner-disk deletes the SDK's NDKs, the resolver reads node_modules and sdkmanager
      // comes from setup-android, so the install follows all three.
      for (const [what, predicate] of [
        [
          'free-runner-disk',
          (step) => step.uses === './.github/actions/free-runner-disk',
        ],
        ['the dependency install', (step) => step.uses === './.github/actions/install'],
        [
          'setup-android',
          (step) => String(step.uses ?? '').startsWith('android-actions/setup-android@'),
        ],
      ]) {
        const before = index(predicate)
        assert.ok(before !== -1 && before < at, `${id}: the install must follow ${what}`)
      }
    })
})

// A step whose condition lets it run after an earlier failure must not start Gradle when the
// install failed: Gradle would then fail later, on a missing package, with less to go on.
describe('no Gradle step runs after a failed SDK install', () => {
  for (const { id, steps } of gradleJobs)
    test(id, () => {
      const at = steps.findIndex((step) => String(step.run ?? '').trim() === INSTALL)
      assert.notEqual(at, -1)
      // Steps whose success implies the install succeeded: the install itself, and a later step
      // that runs only when everything before it passed or names such a step's success.
      const implied = new Set()
      if (steps[at].id) implied.add(steps[at].id)
      for (const step of steps.slice(at + 1)) {
        const condition = String(step.if ?? '')
          .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
          .trim()
        const resumes = /!cancelled\(\)|always\(\)|failure\(\)/.test(condition)
        // Only a top-level `&&` term binds: a success inside an `||` can be bypassed.
        const terms = splitTopLevel(condition, '&&')
        const guarded =
          !resumes ||
          [...implied].some((stepId) =>
            terms.includes(`steps.${stepId}.outcome == 'success'`)
          )
        if (guarded && step.id) implied.add(step.id)
        if (runsGradle(step))
          assert.ok(
            guarded,
            `${id}: "${step.name ?? step.uses}" can run Gradle after the SDK install failed`
          )
      }
    })
})
