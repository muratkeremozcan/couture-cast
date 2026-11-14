// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S4-15 (TEA-17, R3-03): the prebuilt app build.gradle differs from the one without the plugin
// by exactly the `minifiedDebuggable` build type (from release, debuggable, minified, signed with
// the pinned test-only keystore), the pinned signing config on `debug`, the debug manifest for
// the new source set and `minifiedDebuggable` in React Native's `debuggableVariants`. The
// keystore the prebuild copies is byte-identical to the pinned one, and `release` keeps the
// template's signing config.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  assertCommand,
  createExpoPrebuildFixture,
  runExpoPrebuild,
} = require('./prebuild-test-helpers')
const withMinifiedDebuggable = require('./with-minified-debuggable')

const PLUGIN = './plugins/with-minified-debuggable'
// SHA-256 of plugins/test-signing/couturecast-test-only.keystore. Its certificate SHA-256 is
// 8C:35:E1:F3:08:46:6C:E8:DF:4C:E0:C9:C4:06:93:55:CF:6D:35:4C:DC:15:A6:98:79:EC:70:1A:BA:DA:B8:28.
// A changed key breaks every paid over-install between debuggable builds (TEA-19).
const PINNED_KEYSTORE_SHA256 =
  'bb0e9edef61334bbc98c133a85200ad218f1eebfd9828cceaf7d71dddcf87df3'

function prebuild(t, { withPlugin }) {
  const root = createExpoPrebuildFixture(t, {
    prefix: `couture-minified-debuggable-${withPlugin ? 'on' : 'off'}-`,
  })
  const appJson = path.join(root, 'app.json')
  const app = JSON.parse(fs.readFileSync(appJson, 'utf8'))
  if (!withPlugin) {
    app.expo.plugins = app.expo.plugins.filter((plugin) => plugin !== PLUGIN)
    fs.writeFileSync(appJson, JSON.stringify(app, null, 2))
  } else assert.ok(app.expo.plugins.includes(PLUGIN), 'app.json registers the plugin')
  assertCommand(runExpoPrebuild(root, { platform: 'android' }), 'Android prebuild failed')
  const appDir = path.join(root, 'android/app')
  return {
    gradle: fs.readFileSync(path.join(appDir, 'build.gradle'), 'utf8'),
    appDir,
  }
}

const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// Written out here, independently of the plugin, so a plugin edit cannot move both sides.
const SIGNING = `        pinnedTest {
            storeFile file('couturecast-test-only.keystore')
            storePassword 'couturecast-test-only'
            keyAlias 'couturecast-test-only'
            keyPassword 'couturecast-test-only'
        }
`
const BUILD_TYPE = `        minifiedDebuggable {
            initWith release
            debuggable true
            minifyEnabled true
            shrinkResources true
            signingConfig signingConfigs.pinnedTest
            matchingFallbacks = ['release']
            externalNativeBuild {
                cmake {
                    arguments "-DCMAKE_BUILD_TYPE=Release"
                }
            }
        }
`
const SOURCE_SET = `    sourceSets {
        minifiedDebuggable {
            manifest.srcFile 'src/debug/AndroidManifest.xml'
        }
    }
`
const VARIANTS =
  '    debuggableVariants = ["debug", "debugOptimized", "minifiedDebuggable"]\n'

function replaceUnique(text, anchor, replacement) {
  const at = text.indexOf(anchor)
  assert.ok(at >= 0, `anchor present: ${JSON.stringify(anchor)}`)
  assert.equal(
    text.indexOf(anchor, at + 1),
    -1,
    `anchor unique: ${JSON.stringify(anchor)}`
  )
  return text.slice(0, at) + replacement + text.slice(at + anchor.length)
}

/** The exact build.gradle the plugin must produce from `control`. */
function expectedGradle(control) {
  let next = replaceUnique(control, 'react {\n', `react {\n${VARIANTS}`)
  next = replaceUnique(next, '    signingConfigs {\n', `    signingConfigs {\n${SIGNING}`)
  next = replaceUnique(
    next,
    '    buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n',
    '    buildTypes {\n        debug {\n            signingConfig signingConfigs.pinnedTest\n'
  )
  const releaseStart = next.indexOf('        release {\n')
  assert.ok(releaseStart >= 0, 'control has a release build type')
  const releaseEnd = next.indexOf('\n        }\n', releaseStart) + '\n        }\n'.length
  assert.equal(
    next.slice(releaseEnd, releaseEnd + 6),
    '    }\n',
    'release closes buildTypes'
  )
  return (
    next.slice(0, releaseEnd) +
    BUILD_TYPE +
    '    }\n' +
    SOURCE_SET +
    next.slice(releaseEnd + 6)
  )
}

test(
  'the prebuilt build.gradle adds exactly the minifiedDebuggable build type, its signing and its debuggable variant',
  { timeout: 180000 },
  (t) => {
    const control = prebuild(t, { withPlugin: false })
    const candidate = prebuild(t, { withPlugin: true })
    assert.doesNotMatch(control.gradle, /minifiedDebuggable/)
    assert.doesNotMatch(control.gradle, /^\s*debuggableVariants\s*=/m)
    assert.equal(candidate.gradle, expectedGradle(control.gradle))

    // Each fact on its own, so a failure names the one that broke.
    const block = /\n {8}minifiedDebuggable \{\n([\s\S]*?)\n {8}\}\n/.exec(
      candidate.gradle
    )
    assert.ok(block, 'build type present')
    for (const line of [
      'initWith release',
      'debuggable true',
      'minifyEnabled true',
      'shrinkResources true',
      'signingConfig signingConfigs.pinnedTest',
      "matchingFallbacks = ['release']",
      'arguments "-DCMAKE_BUILD_TYPE=Release"',
    ])
      assert.ok(block[1].includes(line), `minifiedDebuggable has ${line}`)
    assert.ok(
      candidate.gradle.indexOf('        release {') < block.index,
      'declared after release, so initWith copies its proguard files'
    )
    assert.match(
      candidate.gradle,
      /^ {4}debuggableVariants = \[[^\]]*"minifiedDebuggable"[^\]]*\]$/m
    )
    assert.match(
      candidate.gradle,
      /^ {8}release \{\n[\s\S]*?signingConfig signingConfigs\.debug\n/m,
      'release keeps the template signing config'
    )
    assert.match(
      candidate.gradle,
      /proguardFiles getDefaultProguardFile\("proguard-android\.txt"\), "proguard-rules\.pro"/
    )

    const copied = path.join(candidate.appDir, 'couturecast-test-only.keystore')
    assert.equal(sha256(copied), PINNED_KEYSTORE_SHA256)
    assert.ok(fs.existsSync(path.join(candidate.appDir, 'src/debug/AndroidManifest.xml')))
    assert.equal(
      fs.existsSync(path.join(control.appDir, 'couturecast-test-only.keystore')),
      false
    )
  }
)

test('the committed keystore is the pinned one', () => {
  assert.equal(sha256(withMinifiedDebuggable.KEYSTORE_SOURCE), PINNED_KEYSTORE_SHA256)
})

const TEMPLATE = `react {
    autolinkLibrariesWithApp()
}

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
`

test('the edit matches the independent expectation, is idempotent and refuses an unknown template', () => {
  const { addMinifiedDebuggable } = withMinifiedDebuggable
  const once = addMinifiedDebuggable(TEMPLATE)
  assert.equal(once, expectedGradle(TEMPLATE))
  assert.equal(addMinifiedDebuggable(once), once)
  assert.throws(
    () =>
      addMinifiedDebuggable(
        TEMPLATE.replace('react {\n', 'react {\n    debuggableVariants = ["debug"]\n')
      ),
    /debuggableVariants is already set/
  )
  assert.throws(
    () => addMinifiedDebuggable(TEMPLATE.replace('    signingConfigs {\n', '')),
    /expected one signingConfigs block, found 0/
  )
  assert.throws(
    () =>
      addMinifiedDebuggable(
        TEMPLATE.replace(
          '        debug {\n            signingConfig signingConfigs.debug\n',
          '        debug {\n'
        )
      ),
    /expected one debug build type/
  )
  assert.throws(
    () =>
      addMinifiedDebuggable(TEMPLATE.replace('        release {', '        staging {')),
    /expected one release build type, found 0/
  )
})
