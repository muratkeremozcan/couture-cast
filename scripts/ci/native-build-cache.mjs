#!/usr/bin/env node
/**
 * The cache key of the Story 6.8 native development client.
 *
 * Every lane used to build the same Debug development client on every run: 15 minutes on iOS and 8
 * to 10 minutes in each of the Android jobs (main run 41246754892). The development client loads
 * its JavaScript from the job's own Metro server, so its binary depends only on native inputs. The
 * key covers all of them:
 *
 * - the Expo fingerprint of apps/mobile for the platform: config, config plugins, autolinked native
 *   modules (the local modules/ directory included), react-native and the package scripts;
 * - apps/mobile/targets, which the widget and watchOS config plugins copy into the native projects;
 * - the harness files that decide how the client is built, this file included;
 * - the toolchain that compiles it.
 *
 * The fingerprint leaves out the config's `extra` section. It carries the runtime's anon key, which
 * differs on every runtime, and the development client reads `extra` from Metro's manifest at
 * runtime: the iOS shards already ran the ios-build binary against their own Supabase stacks, each
 * with its own JWT secret. Same key, same binary, so a job that restores it tests the same client it
 * would have built, with the JavaScript of its own commit.
 *
 *   node scripts/ci/native-build-cache.mjs key --platform ios|android >> "$GITHUB_OUTPUT"
 *
 * prints `key=` and `path=` lines; the diagnostics go to stderr.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { story68PublicBuildEnv } from '../lib/story68-public-build-env.mjs'
import { nativeDevClientPath } from '../lib/story68-native-build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const mobileRoot = path.join(root, 'apps/mobile')

/** Bump to drop every cached client at once. */
export const CACHE_VERSION = 'v1'

/** Harness files whose content decides the binary, beyond what the fingerprint sees. */
export const HARNESS_BUILD_FILES = Object.freeze([
  'scripts/ci/native-build-cache.mjs',
  'scripts/ci/native-ios-app-secret-scan.mjs',
  'scripts/lib/story68-native-build.mjs',
  'scripts/lib/story68-public-build-env.mjs',
  'scripts/lib/story68-worklets-staging.mjs',
])

/**
 * Files the config plugins turn into native content at prebuild that the fingerprint does not hash
 * itself: the widget and watch target sources, the localized permission strings `locales` maps to,
 * and the notification icon expo-notifications receives as an option.
 */
export const PLUGIN_SOURCE_DIRECTORIES = Object.freeze([
  'apps/mobile/targets',
  'apps/mobile/locales',
])
export const PLUGIN_SOURCE_FILES = Object.freeze([
  'apps/mobile/assets/images/notification-icon.png',
])
/** The font the widget and watchOS plugins copy into their targets, resolved as they resolve it. */
export const PLUGIN_PACKAGE_FILES = Object.freeze([
  '@expo-google-fonts/space-grotesk/400Regular/SpaceGrotesk_400Regular.ttf',
])

export const PLATFORMS = Object.freeze(['ios', 'android'])

function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`native_build_toolchain_unreadable:${binary}`)
  return `${result.stdout}${result.stderr}`.trim()
}

/** The Java major version from `java -version`, whose patch updates do not change the APK. */
export const javaMajor = (versionOutput) => {
  const match = /version "(\d+)/.exec(versionOutput)
  if (!match) throw new Error('native_build_java_version_unreadable')
  return match[1]
}

/** What compiles the client on this host. */
export function toolchain(platform, read = command, arch = process.arch) {
  if (platform === 'ios')
    return {
      arch,
      xcode: read('xcodebuild', ['-version']),
      cocoapods: read('pod', ['--version']),
    }
  if (platform === 'android') return { arch, java: javaMajor(read('java', ['-version'])) }
  throw new Error('native_build_platform_required')
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/** The key from the fingerprint hash, the harness file contents and the toolchain. */
export function cacheKey({ platform, fingerprint, harnessFiles, tools }) {
  if (!PLATFORMS.includes(platform)) throw new Error('native_build_platform_required')
  if (!/^[a-f0-9]{40}$/.test(String(fingerprint)))
    throw new Error('native_build_fingerprint_required')
  const inputs = JSON.stringify({ fingerprint, harnessFiles, tools })
  return `cc68-native-${platform}-${CACHE_VERSION}-${sha256(inputs).slice(0, 40)}`
}

/** @expo/fingerprint, resolved through the installed expo package that pins it. */
export function expoFingerprint() {
  const requireFromExpo = createRequire(
    createRequire(import.meta.url).resolve('expo/package.json', { paths: [mobileRoot] })
  )
  return requireFromExpo('@expo/fingerprint')
}

/**
 * The Expo fingerprint of the project under the harness build environment. app.config.ts reads
 * that environment (the isolated app name, scheme and bundle id come from it), and the config
 * loader inherits process.env, so the build environment is applied here with the given anon key.
 */
export async function fingerprintOf(platform, anonKey = 'cc68-fingerprint-placeholder') {
  const { createFingerprintAsync, SourceSkips } = expoFingerprint()
  Object.assign(process.env, story68PublicBuildEnv(anonKey))
  return createFingerprintAsync(mobileRoot, {
    platforms: [platform],
    sourceSkips: SourceSkips.ExpoConfigExtraSection,
    extraSources: [
      ...PLUGIN_SOURCE_DIRECTORIES.map((directory) => ({
        type: 'dir',
        filePath: path.relative(mobileRoot, path.join(root, directory)),
        reasons: ['story68ConfigPluginSources'],
      })),
      ...PLUGIN_SOURCE_FILES.map((file) => ({
        type: 'file',
        filePath: path.relative(mobileRoot, path.join(root, file)),
        reasons: ['story68ConfigPluginSources'],
      })),
      ...PLUGIN_PACKAGE_FILES.map((request) => ({
        type: 'contents',
        id: request,
        contents: sha256(
          fs.readFileSync(
            createRequire(import.meta.url).resolve(request, { paths: [mobileRoot] })
          )
        ),
        reasons: ['story68ConfigPluginSources'],
      })),
    ],
  })
}

export async function resolveCacheKey(platform, read = command) {
  if (!PLATFORMS.includes(platform)) throw new Error('native_build_platform_required')
  const fingerprint = await fingerprintOf(platform)
  const harnessFiles = Object.fromEntries(
    HARNESS_BUILD_FILES.map((file) => [
      file,
      sha256(fs.readFileSync(path.join(root, file))),
    ])
  )
  const tools = toolchain(platform, read)
  return {
    key: cacheKey({ platform, fingerprint: fingerprint.hash, harnessFiles, tools }),
    path: nativeDevClientPath(platform, root),
    fingerprint: fingerprint.hash,
    sources: fingerprint.sources.length,
    tools,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const [action, flag, platform] = process.argv.slice(2)
  try {
    if (action !== 'key' || flag !== '--platform')
      throw new Error('native_build_cache_usage: key --platform ios|android')
    const resolved = await resolveCacheKey(platform)
    console.error(
      JSON.stringify({
        nativeBuildCache: {
          platform,
          key: resolved.key,
          fingerprint: resolved.fingerprint,
          sources: resolved.sources,
          tools: resolved.tools,
        },
      })
    )
    console.log(`key=${resolved.key}`)
    console.log(`path=${resolved.path}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
