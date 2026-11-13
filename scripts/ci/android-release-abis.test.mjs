// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 TEA-11: the all-ABI release check. The dex fixtures are real d8 output from
// fixtures/android-release-abis/build-dex.sh; the archives around them are built here.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

import {
  SHIPPED_ABIS,
  checkArtifact,
  configuredAbiProblems,
  gradleArchitectures,
  installedReactNativeVersion,
  readReactNativeVersion,
  readTarEntry,
} from './android-release-abis.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const fixtures = new URL('./fixtures/android-release-abis/', import.meta.url)
const dex = (name) => fs.readFileSync(new URL(`${name}.dex`, fixtures))
const LIBRARIES = [
  'libreactnative.so',
  'libhermes.so',
  'libworklets.so',
  'libappmodules.so',
]

/** An APK or AAB holding the given dex files and libraries per ABI. */
function artifact({
  kind = 'aab',
  abis = SHIPPED_ABIS,
  libraries = LIBRARIES,
  dexes = {
    classes: dex('version-reader-only'),
    classes2: dex('react-native-version-0.81.5'),
  },
  drop = [],
}) {
  const base = kind === 'aab' ? 'base/' : ''
  const files = kind === 'aab' ? { 'BundleConfig.pb': new Uint8Array([8, 1]) } : {}
  for (const [name, bytes] of Object.entries(dexes))
    files[`${base}${kind === 'aab' ? 'dex/' : ''}${name}.dex`] = [
      new Uint8Array(bytes),
      { level: 6 },
    ]
  for (const abi of abis)
    for (const library of libraries)
      if (!drop.includes(`${abi}/${library}`))
        files[`${base}lib/${abi}/${library}`] = [
          new Uint8Array([0x7f, 0x45, 0x4c, 0x46]),
          { level: 0 },
        ]
  return Buffer.from(zipSync(files))
}

test('a complete all-ABI bundle and universal APK pass, naming the bundled version', () => {
  for (const kind of ['aab', 'apk']) {
    const report = checkArtifact(artifact({ kind }), '0.81.5')
    assert.deepEqual(report.problems, [], kind)
    assert.equal(report.kind, kind)
    assert.deepEqual([...report.abis.keys()].sort(), [...SHIPPED_ABIS].sort())
    assert.equal(report.bundled.version, '0.81.5')
  }
})

test('libhermesvm.so counts as the Hermes library, as React Native 0.82 and later name it', () => {
  const libraries = ['libreactnative.so', 'libhermesvm.so', 'libworklets.so']
  assert.deepEqual(checkArtifact(artifact({ libraries }), '0.81.5').problems, [])
})

test('a missing ABI fails, as a host-ABI CI build would', () => {
  for (const kind of ['aab', 'apk'])
    assert.deepEqual(
      checkArtifact(
        artifact({ kind, abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'] }),
        '0.81.5'
      ).problems,
      ['missing ABI x86: no native libraries under it']
    )
})

test('an ABI without a required library, or without a library another ABI ships, fails', () => {
  assert.deepEqual(
    checkArtifact(artifact({ drop: ['x86/libworklets.so'] }), '0.81.5').problems,
    [
      'ABI x86 lacks libworklets.so',
      'ABI x86 lacks libworklets.so, packaged for another ABI',
    ]
  )
  assert.deepEqual(
    checkArtifact(artifact({ drop: ['armeabi-v7a/libappmodules.so'] }), '0.81.5')
      .problems,
    ['ABI armeabi-v7a lacks libappmodules.so, packaged for another ABI']
  )
  assert.deepEqual(
    checkArtifact(
      artifact({ libraries: ['libreactnative.so', 'libworklets.so'] }),
      '0.81.5'
    ).problems,
    SHIPPED_ABIS.map((abi) => `ABI ${abi} lacks libhermes.so or libhermesvm.so`)
  )
})

test('a bundled ReactNativeVersion other than the installed react-native fails', () => {
  assert.deepEqual(checkArtifact(artifact({}), '0.88.1').problems, [
    'ReactNativeVersion 0.81.5 does not match the installed react-native 0.88.1',
  ])
})

test('a prerelease ReactNativeVersion fails even when it matches (F-00q)', () => {
  const dexes = { classes: dex('react-native-version-0.88.0-rc.0') }
  assert.deepEqual(checkArtifact(artifact({ dexes }), '0.88.0-rc.0').problems, [
    'ReactNativeVersion 0.88.0-rc.0 is a prerelease; every step ships a stable React Native',
  ])
})

test('an artifact whose dex only references ReactNativeVersion fails as unreadable', () => {
  const dexes = { classes: dex('version-reader-only') }
  assert.deepEqual(checkArtifact(artifact({ dexes }), '0.81.5').problems, [
    'ReactNativeVersion unreadable: no dex file defines ReactNativeVersion with a static initializer',
  ])
})

test('reads the version whichever order the compiler loads each key and number', () => {
  // The fixture boxes minor and patch before loading their keys, as R8 emits in a real release.
  assert.deepEqual(
    readReactNativeVersion([{ name: 'a', bytes: dex('react-native-version-0.81.5') }]),
    {
      major: 0,
      minor: 81,
      patch: 5,
      prerelease: null,
      version: '0.81.5',
    }
  )
  assert.throws(
    () =>
      readReactNativeVersion([
        { name: 'classes.dex', bytes: dex('react-native-version-0.81.5') },
        { name: 'classes2.dex', bytes: dex('react-native-version-0.88.0-rc.0') },
      ]),
    /defined in classes\.dex, classes2\.dex/
  )
})

test('reads reactNativeArchitectures from gradle.properties and from a gzipped tarball', (t) => {
  assert.deepEqual(
    gradleArchitectures('a=1\nreactNativeArchitectures=armeabi-v7a, x86\n'),
    ['armeabi-v7a', 'x86']
  )
  assert.equal(gradleArchitectures('a=1\n'), undefined)
  const body = Buffer.from('reactNativeArchitectures=x86_64\n')
  const header = Buffer.alloc(512)
  header.write('android/gradle.properties', 0)
  header.write(body.length.toString(8).padStart(11, '0'), 124)
  header.write('ustar', 257)
  header.write('package', 345)
  const tgz = zlib.gzipSync(
    Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)])
  )
  assert.equal(readTarEntry(tgz, 'package/android/gradle.properties'), body.toString())
  assert.equal(readTarEntry(tgz, 'package/missing'), undefined)
  t.diagnostic(`installed react-native ${installedReactNativeVersion(repository)}`)
})

// The expectation follows what the app ships: the Expo prebuild template's four ABIs, with
// nothing in app.json or a config plugin narrowing them.
test('the app config ships exactly the four checked ABIs', () => {
  assert.deepEqual(configuredAbiProblems(repository), [])
})

test('an app config that narrows the ABIs is reported', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-abis-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'apps/mobile/plugins'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps/mobile/android'), { recursive: true })
  fs.symlinkSync(
    path.join(repository, 'apps/mobile/node_modules'),
    path.join(root, 'apps/mobile/node_modules')
  )
  fs.symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'))
  fs.writeFileSync(path.join(root, 'apps/mobile/package.json'), '{}')
  fs.writeFileSync(
    path.join(root, 'apps/mobile/app.json'),
    JSON.stringify({
      expo: {
        plugins: [['expo-build-properties', { android: { buildArchs: ['arm64-v8a'] } }]],
      },
    })
  )
  fs.writeFileSync(
    path.join(root, 'apps/mobile/plugins/with-abis.js'),
    "gradle.properties.reactNativeArchitectures = 'arm64-v8a'"
  )
  fs.writeFileSync(
    path.join(root, 'apps/mobile/android/gradle.properties'),
    'reactNativeArchitectures=arm64-v8a,x86_64\n'
  )
  assert.deepEqual(configuredAbiProblems(root), [
    'apps/mobile/android/gradle.properties sets reactNativeArchitectures=arm64-v8a,x86_64',
    'app.json expo.plugins.0.1.android.buildArchs narrows the shipped ABIs',
    'apps/mobile/plugins/with-abis.js sets the shipped ABIs',
  ])
})
