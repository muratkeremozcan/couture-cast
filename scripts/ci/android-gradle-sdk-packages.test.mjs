// The SDK packages android-sdk-install.sh --gradle installs come from the sources Gradle reads,
// so a React Native, Expo or native-module upgrade moves them without a second copy to edit.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { AGP_DEFAULT_CMAKE, gradleSdkPackages } from './android-gradle-sdk-packages.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

const CATALOG = `[versions]
minSdk = "24"
targetSdk = "36"
compileSdk = "36"
buildTools = "36.0.0"
ndkVersion = "27.1.12297006"
agp = "8.11.0"
`

/** A fake app with a hoisted node_modules; `modules` maps a package name to its build.gradle. */
function fixture(t, { catalog = CATALOG, modules = {}, appModules = {} } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-sdk-packages-'))
  t.after(() => fs.rmSync(work, { recursive: true, force: true }))
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  const app = path.join(work, 'apps/mobile')
  write(path.join(app, 'package.json'), '{"name":"app"}')
  const nodeModules = path.join(work, 'node_modules')
  write(path.join(nodeModules, 'react-native/package.json'), '{"name":"react-native"}')
  write(path.join(nodeModules, 'react-native/gradle/libs.versions.toml'), catalog)
  for (const [name, gradle] of Object.entries(modules))
    write(path.join(nodeModules, name, 'android/build.gradle'), gradle)
  for (const [name, gradle] of Object.entries(appModules))
    write(path.join(app, 'node_modules', name, 'android/build.gradle'), gradle)
  return app
}

const native = (cmake) => `android {
  externalNativeBuild {
    cmake {
      ${cmake}
      path "CMakeLists.txt"
    }
  }
}
`

test('the installed app resolves to the catalog versions and its modules CMake', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/ci/android-gradle-sdk-packages.mjs')],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  const packages = result.stdout.trim().split(' ')

  const require = createRequire(path.join(root, 'apps/mobile/package.json'))
  const catalog = fs.readFileSync(
    path.join(
      path.dirname(require.resolve('react-native/package.json')),
      'gradle/libs.versions.toml'
    ),
    'utf8'
  )
  const version = (name) => catalog.match(new RegExp(`^${name} = "([^"]+)"`, 'm'))[1]
  assert.equal(packages[0], `ndk;${version('ndkVersion')}`)
  assert.ok(packages.includes(`build-tools;${version('buildTools')}`), result.stdout)
  assert.ok(
    packages.includes(`platforms;android-${version('compileSdk')}`),
    result.stdout
  )

  // Reanimated builds its own CMake project and names the version; the build needs that one.
  const reanimated = fs.readFileSync(
    path.join(
      path.dirname(require.resolve('react-native-reanimated/package.json')),
      'android/build.gradle'
    ),
    'utf8'
  )
  const named = reanimated.match(/CMAKE_VERSION"\) \?: "([^"]+)"/)[1]
  assert.ok(packages.includes(`cmake;${named}`), result.stdout)
})

test('each named CMake version and the plugin default for an unnamed one', (t) => {
  const app = fixture(t, {
    modules: {
      'named-assign': native('version = "3.30.5"'),
      'named-env': native('version = System.getenv("CMAKE_VERSION") ?: "3.31.1"'),
      '@scope/named-call': native('version "3.30.5"'),
      unnamed: native(''),
      'no-native': 'android { compileSdk 36 }\n',
    },
  })
  assert.deepEqual(gradleSdkPackages({ appDirectory: app }), [
    'ndk;27.1.12297006',
    `cmake;${AGP_DEFAULT_CMAKE[8]}`,
    'cmake;3.30.5',
    'cmake;3.31.1',
    'build-tools;36.0.0',
    'platforms;android-36',
  ])
})

test('a module beside the app counts like a hoisted one', (t) => {
  const app = fixture(t, { appModules: { local: native('version = "3.28.0"') } })
  assert.ok(gradleSdkPackages({ appDirectory: app }).includes('cmake;3.28.0'))
})

test('no native module means no CMake', (t) => {
  const app = fixture(t, { modules: { plain: 'android { compileSdk 36 }\n' } })
  assert.deepEqual(gradleSdkPackages({ appDirectory: app }), [
    'ndk;27.1.12297006',
    'build-tools;36.0.0',
    'platforms;android-36',
  ])
})

test('a plugin major with no known CMake default fails instead of guessing', (t) => {
  const app = fixture(t, {
    catalog: CATALOG.replace('agp = "8.11.0"', 'agp = "9.0.0"'),
    modules: { unnamed: native('') },
  })
  assert.throws(
    () => gradleSdkPackages({ appDirectory: app }),
    /android_sdk_packages_unknown_agp_cmake_default: Android Gradle plugin 9\.0\.0/
  )
})

test('a catalog without the NDK version fails instead of installing nothing', (t) => {
  const app = fixture(t, {
    catalog: CATALOG.replace('ndkVersion = "27.1.12297006"\n', ''),
  })
  assert.throws(
    () => gradleSdkPackages({ appDirectory: app }),
    /android_sdk_packages_missing_version: ndkVersion/
  )
})
