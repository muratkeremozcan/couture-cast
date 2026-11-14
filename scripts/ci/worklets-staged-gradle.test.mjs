// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseArgs, runStagedGradle } from './worklets-staged-gradle.mjs'

const TASKS = [
  ':app:assembleDebug',
  '-PreactNativeArchitectures=x86_64',
  '--console=plain',
]
const options = (evidence) => [
  '--project',
  'apps/mobile/android',
  '--configuration',
  'Debug',
  '--abis',
  'x86_64',
  '--evidence',
  evidence,
  '--',
  ...TASKS,
]

test('parseArgs needs every option, tasks, and the same architectures Gradle builds', () => {
  assert.deepEqual(parseArgs(options('/tmp/e')).gradle, TASKS)
  assert.throws(() => parseArgs(options('/tmp/e').slice(0, 8)), {
    message: 'worklets_gradle_tasks_required',
  })
  assert.throws(() => parseArgs(['--project', 'p', '--', ...TASKS]), {
    message: /^worklets_gradle_option_required:/,
  })
  assert.throws(
    () =>
      parseArgs([
        ...options('/tmp/e').slice(0, 9),
        ':app:assembleDebug',
        '-PreactNativeArchitectures=arm64-v8a',
      ]),
    { message: 'worklets_gradle_architectures_mismatch' }
  )
})

test('Gradle runs with the staging init script, and the proofs are verified only after a pass', (t) => {
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'worklets-staged-'))
  t.after(() => fs.rmSync(evidence, { recursive: true, force: true }))
  const calls = []
  const plan = {
    args: ['--init-script', `${evidence}/staging.init.gradle`],
    proofs: ['p'],
  }
  const prepare = (selection) => {
    calls.push(['prepare', selection])
    return plan
  }
  const verify = (given) => {
    calls.push(['verify', given])
    return ['verified']
  }
  const spawn = (binary, args, spawnOptions) => {
    calls.push(['gradle', binary, args, spawnOptions.cwd])
    return { status: 0 }
  }
  assert.deepEqual(runStagedGradle(options(evidence), { spawn, prepare, verify }), [
    'verified',
  ])
  assert.deepEqual(calls, [
    [
      'prepare',
      {
        projectRoot: 'apps/mobile/android',
        configuration: 'Debug',
        architectures: 'x86_64',
        evidenceDirectory: evidence,
      },
    ],
    ['gradle', './gradlew', [...plan.args, ...TASKS], 'apps/mobile/android'],
    ['verify', plan],
  ])
  // A failed build never reaches verification.
  calls.length = 0
  assert.throws(
    () =>
      runStagedGradle(options(evidence), {
        spawn: () => ({ status: 1 }),
        prepare,
        verify,
      }),
    { message: 'worklets_gradle_failed:1' }
  )
  assert.ok(!calls.some(([kind]) => kind === 'verify'))
})
