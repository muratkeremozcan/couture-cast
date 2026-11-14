#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 (TEA, 2026-11-13): a Gradle build of the app's Android project through the Worklets
// staging (scripts/lib/story68-worklets-staging.mjs). A plain Debug build can race Reanimated's
// legacy import of libworklets.so against Worklets' own build; the staging init script hands
// Reanimated the binary this build compiled and writes a proof per ABI, which is verified after
// Gradle exits. The device run of 2026-11-13 hit the race on a plain x86_64 assembleDebug.
//
//   node scripts/ci/worklets-staged-gradle.mjs --project apps/mobile/android \
//     --configuration Debug --abis x86_64 --evidence <dir> -- :app:assembleDebug ...
import { spawnSync } from 'node:child_process'
import fs, { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  prepareWorkletsStaging,
  verifyWorkletsStaging,
} from '../lib/story68-worklets-staging.mjs'

/** The options before `--` and the Gradle arguments after it. */
export function parseArgs(argv) {
  const split = argv.indexOf('--')
  if (split < 0) throw new Error('worklets_gradle_tasks_required')
  const options = argv.slice(0, split)
  const gradle = argv.slice(split + 1)
  const option = (name) => {
    const at = options.indexOf(`--${name}`)
    return at < 0 ? undefined : options[at + 1]
  }
  const parsed = {
    project: option('project'),
    configuration: option('configuration'),
    abis: option('abis'),
    evidence: option('evidence'),
    gradle,
  }
  for (const key of ['project', 'configuration', 'abis', 'evidence'])
    if (!parsed[key]) throw new Error(`worklets_gradle_option_required:${key}`)
  if (gradle.length === 0) throw new Error('worklets_gradle_tasks_required')
  // The architectures Gradle builds must be exactly the ones staged.
  const flag = gradle.find((arg) => arg.startsWith('-PreactNativeArchitectures='))
  if (flag?.split('=')[1] !== parsed.abis)
    throw new Error('worklets_gradle_architectures_mismatch')
  return parsed
}

/** Runs Gradle with the staging init script, then verifies every ABI's staging proof. */
export function runStagedGradle(
  argv,
  {
    spawn = spawnSync,
    prepare = prepareWorkletsStaging,
    verify = verifyWorkletsStaging,
  } = {}
) {
  const options = parseArgs(argv)
  fs.mkdirSync(options.evidence, { recursive: true })
  const plan = prepare({
    projectRoot: options.project,
    configuration: options.configuration,
    architectures: options.abis,
    evidenceDirectory: options.evidence,
  })
  const result = spawn('./gradlew', [...plan.args, ...options.gradle], {
    cwd: options.project,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`worklets_gradle_failed:${result.status}`)
  return verify(plan)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const proofs = runStagedGradle(process.argv.slice(2))
    console.log(`worklets staging verified: ${JSON.stringify(proofs)}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
