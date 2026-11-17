#!/usr/bin/env node
// The Android SDK packages a Gradle build of the generated app (apps/mobile/android) needs, as
// sdkmanager names on one line, for scripts/ci/android-sdk-install.sh --gradle.
//
// Gradle installs a missing NDK or CMake itself, in the middle of a build, with one download and
// no retry. Main run 43927343722 lost android36-controls that way: dl.google.com answered 429 and
// the build died with "Failed to install the following SDK components: ndk;27.1.12297006". No
// runner image ships that NDK, and free-runner-disk deletes the ones it does ship, so every
// Android build downloaded it. The CI install step now fetches these packages first, with retries.
//
// Every version comes from the installed sources Gradle itself reads:
//   ndk, build-tools, platforms  React Native's version catalog
//                                (react-native/gradle/libs.versions.toml), which Expo's root
//                                project plugin copies into ndkVersion, buildToolsVersion and
//                                compileSdkVersion.
//   cmake                        each native module's externalNativeBuild: the version its cmake
//                                block names, or the Android Gradle plugin's default when it
//                                names none.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The CMake version the Android Gradle plugin uses for a cmake block that names none, by the
 * plugin's major version (its SdkConstants default). A new major fails here until it is checked.
 */
export const AGP_DEFAULT_CMAKE = { 8: '3.22.1' }

/** One `name = "value"` entry of the catalog's [versions] table. */
function catalogVersion(catalog, name, file) {
  const value = catalog.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm'))?.[1]
  if (!value) throw new Error(`android_sdk_packages_missing_version: ${name} in ${file}`)
  return value
}

/** Each module directory under node_modules, scoped ones included. */
function moduleDirectories(nodeModules) {
  if (!fs.existsSync(nodeModules)) return []
  const directories = []
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name.startsWith('.')) continue
    const directory = path.join(nodeModules, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(directory))
        directories.push(path.join(directory, scoped))
    } else directories.push(directory)
  }
  return directories
}

/**
 * The CMake versions the app's native modules build with. A module's cmake block may name its
 * version as `version "x"`, `version = "x"` or `version = System.getenv("CMAKE_VERSION") ?: "x"`.
 */
export function cmakeVersions(gradleFiles, agpVersion) {
  const versions = new Set()
  const major = Number(agpVersion.split('.')[0])
  for (const file of gradleFiles) {
    const text = fs.readFileSync(file, 'utf8')
    if (!/\bexternalNativeBuild\b/.test(text)) continue
    const named = [
      ...text.matchAll(
        /\bcmake\s*\{[^{}]*?\bversion\s*=?\s*(?:System\.getenv\(\s*["']CMAKE_VERSION["']\s*\)\s*\?:\s*)?["'](\d+(?:\.\d+)+)["']/g
      ),
    ].map((match) => match[1])
    if (named.length > 0) {
      for (const version of named) versions.add(version)
      continue
    }
    const fallback = AGP_DEFAULT_CMAKE[major]
    if (!fallback)
      throw new Error(
        `android_sdk_packages_unknown_agp_cmake_default: Android Gradle plugin ${agpVersion} (${file})`
      )
    versions.add(fallback)
  }
  return [...versions].sort()
}

/** The sdkmanager package names, in install order. */
export function gradleSdkPackages({
  appDirectory = path.join(repository, 'apps/mobile'),
} = {}) {
  const require = createRequire(path.join(appDirectory, 'package.json'))
  const reactNative = path.dirname(require.resolve('react-native/package.json'))
  const catalogFile = path.join(reactNative, 'gradle/libs.versions.toml')
  const catalog = fs.readFileSync(catalogFile, 'utf8')
  const ndk = catalogVersion(catalog, 'ndkVersion', catalogFile)
  const buildTools = catalogVersion(catalog, 'buildTools', catalogFile)
  const compileSdk = catalogVersion(catalog, 'compileSdk', catalogFile)
  const agp = catalogVersion(catalog, 'agp', catalogFile)

  // Hoisted modules sit in the root node_modules, the rest beside the app.
  const searched = new Set()
  const gradleFiles = []
  for (const nodeModules of [
    path.join(appDirectory, 'node_modules'),
    path.dirname(reactNative),
  ]) {
    const resolved = fs.existsSync(nodeModules)
      ? fs.realpathSync(nodeModules)
      : nodeModules
    if (searched.has(resolved)) continue
    searched.add(resolved)
    for (const directory of moduleDirectories(nodeModules)) {
      const file = path.join(directory, 'android/build.gradle')
      if (fs.existsSync(file)) gradleFiles.push(file)
    }
  }

  return [
    `ndk;${ndk}`,
    ...cmakeVersions(gradleFiles, agp).map((version) => `cmake;${version}`),
    `build-tools;${buildTools}`,
    `platforms;android-${compileSdk}`,
  ]
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  process.stdout.write(`${gradleSdkPackages().join(' ')}\n`)
}
