// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i (TEA change 1): the text layout probe (modules/text-layout-probe) has no
// production footprint. Unless COUTURE_TEXT_LAYOUT_PROBE=1 at prebuild, this plugin excludes the
// module from Expo autolinking in both native projects, so neither the Android package list nor
// the iOS ExpoModulesProvider nor the Podfile carries it:
//   android/settings.gradle  expoAutolinking.exclude, which the settings plugin passes to every
//                            autolinking command, the generated package list included
//   ios/Podfile              use_expo_modules!(exclude: [...]), which the pod install and the
//                            ExpoModulesProvider generation both use
// The probe itself is allowed only in an isolated local native test build (Story 6.5 or 6.8
// identity) outside EAS, so no production or preview profile can turn it on.
// scripts/ci/mobile-android-autolinking.test.mjs proves all of it.
const { withPodfile, withSettingsGradle } = require('@expo/config-plugins')

const MODULE = 'text-layout-probe'
const SETTINGS_ANCHOR = 'expoAutolinking.useExpoModules()'
const PODFILE_ANCHOR = /^(\s*)use_expo_modules!\s*$/m

const probeRequested = () => process.env.COUTURE_TEXT_LAYOUT_PROBE === '1'

function assertIsolatedProbeBuild(config) {
  const isolated =
    process.env.STORY68_NATIVE_TEST_BUILD === '1' ||
    process.env.STORY65_NATIVE_TEST_BUILD === '1'
  const profile = process.env.EAS_BUILD_PROFILE
  if (
    !isolated ||
    !/^com\.couturecast\.story6[58]$/.test(config.android?.package ?? '') ||
    (profile && profile !== 'cc68-release-proof')
  )
    throw new Error('text_layout_probe_isolated_build_required')
}

const NOTE =
  'with-text-layout-probe: the probe links only into COUTURE_TEXT_LAYOUT_PROBE=1 builds.'
const settingsLines = [
  `// ${NOTE}`,
  `expoAutolinking.exclude = (expoAutolinking.exclude ?: []) + ['${MODULE}']`,
]

function excludeFromSettingsGradle(contents) {
  if (contents.includes(`'${MODULE}'`)) return contents
  if (!contents.includes(SETTINGS_ANCHOR))
    throw new Error('text_layout_probe_settings_gradle_anchor_missing')
  return contents.replace(SETTINGS_ANCHOR, [...settingsLines, SETTINGS_ANCHOR].join('\n'))
}

function excludeFromPodfile(contents) {
  if (contents.includes(`'${MODULE}'`)) return contents
  if (!PODFILE_ANCHOR.test(contents))
    throw new Error('text_layout_probe_podfile_anchor_missing')
  return contents.replace(
    PODFILE_ANCHOR,
    [`$1# ${NOTE}`, `$1use_expo_modules!(exclude: ['${MODULE}'])`].join('\n')
  )
}

/** A probe prebuild over an earlier one without --clean drops that build's exclusion. */
function includeInSettingsGradle(contents) {
  return contents
    .split('\n')
    .filter((line) => !settingsLines.includes(line))
    .join('\n')
}

function includeInPodfile(contents) {
  return contents
    .split('\n')
    .filter((line) => line.trim() !== `# ${NOTE}`)
    .map((line) =>
      line.trim() === `use_expo_modules!(exclude: ['${MODULE}'])`
        ? line.replace(/use_expo_modules!.*$/, 'use_expo_modules!')
        : line
    )
    .join('\n')
}

module.exports = (config) => {
  if (probeRequested()) {
    assertIsolatedProbeBuild(config)
    config = withSettingsGradle(config, (mod) => {
      mod.modResults.contents = includeInSettingsGradle(mod.modResults.contents)
      return mod
    })
    return withPodfile(config, (mod) => {
      mod.modResults.contents = includeInPodfile(mod.modResults.contents)
      return mod
    })
  }
  config = withSettingsGradle(config, (mod) => {
    mod.modResults.contents = excludeFromSettingsGradle(mod.modResults.contents)
    return mod
  })
  return withPodfile(config, (mod) => {
    mod.modResults.contents = excludeFromPodfile(mod.modResults.contents)
    return mod
  })
}

module.exports.MODULE = MODULE
module.exports.excludeFromPodfile = excludeFromPodfile
module.exports.excludeFromSettingsGradle = excludeFromSettingsGradle
module.exports.includeInPodfile = includeInPodfile
module.exports.includeInSettingsGradle = includeInSettingsGradle
