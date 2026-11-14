// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: a native build must link the text layout probe exactly when it was asked for.
// apps/mobile/plugins/with-text-layout-probe.js writes the exclusion into the generated
// android/settings.gradle and ios/Podfile unless COUTURE_TEXT_LAYOUT_PROBE=1 at prebuild, and a
// build reuses whatever project the last prebuild left. A probe build over a production project
// (or the reverse) once built silently, so scripts/run-story68-native.mjs checks the generated
// project against the requested mode before it builds and after it prebuilds.
import fs from 'node:fs'
import path from 'node:path'

const MODULE = 'text-layout-probe'

/** The generated file that carries each platform's exclusion, relative to apps/mobile. */
export const PROBE_MODE_FILES = Object.freeze({
  android: 'android/settings.gradle',
  ios: 'ios/Podfile',
})

const EXCLUDED = Object.freeze({
  android: new RegExp(`^expoAutolinking\\.exclude\\s*=.*'${MODULE}'`, 'm'),
  ios: new RegExp(
    `^\\s*use_expo_modules!\\(exclude: \\[[^\\]]*'${MODULE}'[^\\]]*\\]\\)\\s*$`,
    'm'
  ),
})

/** The mode the environment asks for: the probe only with COUTURE_TEXT_LAYOUT_PROBE=1. */
export const requestedProbeMode = (env) =>
  env.COUTURE_TEXT_LAYOUT_PROBE === '1' ? 'probe' : 'production'

/** The mode a generated project builds: production when it excludes the probe, else probe. */
export function generatedProbeMode(platform, contents) {
  const excluded = EXCLUDED[platform]
  if (!excluded) throw new Error('native_build_platform_required')
  return excluded.test(contents) ? 'production' : 'probe'
}

/** A coded problem when the generated project and the requested mode disagree, else null. */
export function probeModeProblem({ platform, contents, env }) {
  if (contents === undefined || contents === null)
    return `native_probe_mode_project_missing:${platform}`
  const generated = generatedProbeMode(platform, contents)
  const requested = requestedProbeMode(env)
  return generated === requested
    ? null
    : `native_probe_mode_mismatch:${platform}:${generated}_project:${requested}_requested`
}

/** Throws the coded problem for the generated project under apps/mobile, if any. */
export function assertNativeProbeMode({ platform, mobileDirectory, env }) {
  const file = PROBE_MODE_FILES[platform]
  if (!file) throw new Error('native_build_platform_required')
  let contents
  try {
    contents = fs.readFileSync(path.join(mobileDirectory, file), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const problem = probeModeProblem({ platform, contents, env })
  if (problem) throw new Error(problem)
}
