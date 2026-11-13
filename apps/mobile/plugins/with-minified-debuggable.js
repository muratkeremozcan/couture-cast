// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// TEA-17, R3-03 (Story 6.15 D15): the RevenueCat Test Store journey runs only in debuggable
// builds, and the app's debuggable builds are not minified, so no build ran RevenueCat under R8.
// This plugin adds an Android `minifiedDebuggable` build type: it starts from `release` (its
// proguard files and R8 rules), forces minify and resource shrinking on, is debuggable, links
// the release variant of every library, builds the app's own C++ as Release (as React Native's
// `debugOptimized` does) so it links against those libraries' release React Native prefabs, and
// is listed in the React Native Gradle plugin's
// `debuggableVariants`, so no JS bundle is embedded and the app loads a development bundle from
// Metro.
//
// TEA-19: Android debug keystores are machine or template specific, and the paid over-install
// crosses SDK templates. `debug` and `minifiedDebuggable` are both signed with the test-only
// keystore committed next to this file. `release` keeps the template's signing so the Release
// over-install from the previous step (U-05) keeps its certificate. The keystore signs local test
// builds only; production signing is EAS-managed and never uses it.
const fs = require('node:fs')
const path = require('node:path')
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins')

const BUILD_TYPE = 'minifiedDebuggable'
const KEYSTORE_SOURCE = path.join(
  __dirname,
  'test-signing',
  'couturecast-test-only.keystore'
)
const KEYSTORE_FILE = 'couturecast-test-only.keystore'
const SIGNING_CONFIG = 'pinnedTest'
// Test-only credentials for a key that signs local debuggable builds; not a secret.
const KEYSTORE_PASSWORD = 'couturecast-test-only'
const KEY_ALIAS = 'couturecast-test-only'
// React Native's default list is ["debug", "debugOptimized"]; setting it replaces the default.
const DEBUGGABLE_VARIANTS = ['debug', 'debugOptimized', BUILD_TYPE]

const signingConfigBlock = [
  `        ${SIGNING_CONFIG} {`,
  `            storeFile file('${KEYSTORE_FILE}')`,
  `            storePassword '${KEYSTORE_PASSWORD}'`,
  `            keyAlias '${KEY_ALIAS}'`,
  `            keyPassword '${KEYSTORE_PASSWORD}'`,
  '        }',
].join('\n')

const buildTypeBlock = [
  `        ${BUILD_TYPE} {`,
  '            initWith release',
  '            debuggable true',
  '            minifyEnabled true',
  '            shrinkResources true',
  `            signingConfig signingConfigs.${SIGNING_CONFIG}`,
  "            matchingFallbacks = ['release']",
  '            externalNativeBuild {',
  '                cmake {',
  '                    arguments "-DCMAKE_BUILD_TYPE=Release"',
  '                }',
  '            }',
  '        }',
].join('\n')

// Cleartext to Metro and the dev overlay permission, exactly as the debug variant has them.
const sourceSetBlock = [
  '    sourceSets {',
  `        ${BUILD_TYPE} {`,
  "            manifest.srcFile 'src/debug/AndroidManifest.xml'",
  '        }',
  '    }',
].join('\n')

function replaceOnce(contents, pattern, replacer, label) {
  const matches = contents.match(new RegExp(pattern.source, `${pattern.flags}g`)) ?? []
  if (matches.length !== 1)
    throw new Error(
      `with-minified-debuggable: expected one ${label}, found ${matches.length}`
    )
  return contents.replace(pattern, replacer)
}

/** Returns the app build.gradle with the build type, signing and debuggable variant added. */
function addMinifiedDebuggable(contents) {
  if (contents.includes(`${BUILD_TYPE} {`)) return contents
  if (/^\s*debuggableVariants\s*=/m.test(contents))
    throw new Error('with-minified-debuggable: debuggableVariants is already set')
  let next = replaceOnce(
    contents,
    /^react \{\n/m,
    (match) =>
      `${match}    debuggableVariants = [${DEBUGGABLE_VARIANTS.map((v) => `"${v}"`).join(', ')}]\n`,
    'react block'
  )
  next = replaceOnce(
    next,
    /^ {4}signingConfigs \{\n/m,
    (match) => `${match}${signingConfigBlock}\n`,
    'signingConfigs block'
  )
  next = replaceOnce(
    next,
    /(^ {4}buildTypes \{\n {8}debug \{\n {12}signingConfig signingConfigs\.)debug\n/m,
    `$1${SIGNING_CONFIG}\n`,
    'debug build type signed with signingConfigs.debug'
  )
  // After `release`, so `initWith release` copies its proguard files and settings.
  next = replaceOnce(
    next,
    /(^ {8}release \{\n[\s\S]*?\n {8}\}\n)( {4}\}\n)/m,
    `$1${buildTypeBlock}\n$2${sourceSetBlock}\n`,
    'release build type'
  )
  return next
}

function withMinifiedDebuggable(config) {
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy')
      throw new Error('with-minified-debuggable: app build.gradle must be Groovy')
    mod.modResults.contents = addMinifiedDebuggable(mod.modResults.contents)
    return mod
  })
  return withDangerousMod(config, [
    'android',
    (mod) => {
      fs.copyFileSync(
        KEYSTORE_SOURCE,
        path.join(mod.modRequest.platformProjectRoot, 'app', KEYSTORE_FILE)
      )
      return mod
    },
  ])
}

module.exports = withMinifiedDebuggable
module.exports.addMinifiedDebuggable = addMinifiedDebuggable
module.exports.BUILD_TYPE = BUILD_TYPE
module.exports.KEYSTORE_FILE = KEYSTORE_FILE
module.exports.KEYSTORE_SOURCE = KEYSTORE_SOURCE
