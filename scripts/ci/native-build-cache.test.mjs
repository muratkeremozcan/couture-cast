import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import {
  CACHE_VERSION,
  HARNESS_BUILD_FILES,
  PLUGIN_SOURCE_DIRECTORIES,
  cacheKey,
  expoFingerprint,
  fingerprintOf,
  generatorVersions,
  PROJECT_GENERATOR_PACKAGES,
  javaMajor,
  resolveCacheKey,
  toolchain,
} from './native-build-cache.mjs'
import { nativeDevClientPath } from '../lib/story68-native-build.mjs'

const fingerprint = 'a'.repeat(40)
const inputs = {
  platform: 'android',
  fingerprint,
  harnessFiles: { 'scripts/lib/story68-native-build.mjs': 'b'.repeat(64) },
  tools: { arch: 'x64', java: '21' },
}

describe('native development client cache key', () => {
  test('names the platform and the cache version, and is stable for the same inputs', () => {
    const key = cacheKey(inputs)
    assert.match(key, new RegExp(`^cc68-native-android-${CACHE_VERSION}-[a-f0-9]{40}$`))
    assert.equal(cacheKey({ ...inputs }), key)
  })

  test('changes with the fingerprint, any harness build file, the toolchain or the platform', () => {
    const key = cacheKey(inputs)
    for (const changed of [
      { ...inputs, fingerprint: 'c'.repeat(40) },
      {
        ...inputs,
        harnessFiles: { 'scripts/lib/story68-native-build.mjs': 'd'.repeat(64) },
      },
      { ...inputs, tools: { arch: 'x64', java: '17' } },
      { ...inputs, tools: { arch: 'arm64', java: '21' } },
      { ...inputs, platform: 'ios' },
    ])
      assert.notEqual(cacheKey(changed), key)
  })

  test('refuses an unknown platform or a missing fingerprint', () => {
    assert.throws(() => cacheKey({ ...inputs, platform: 'web' }), /platform_required/)
    for (const bad of [undefined, '', 'abc', 'g'.repeat(40)])
      assert.throws(
        () => cacheKey({ ...inputs, fingerprint: bad }),
        /fingerprint_required/
      )
  })

  test('keys Java by its major version, which is what changes the build', () => {
    assert.equal(
      javaMajor('openjdk version "21.0.13" 2026-10-21 LTS\nOpenJDK Runtime Environment'),
      '21'
    )
    assert.equal(javaMajor('java version "17.0.2"'), '17')
    assert.throws(() => javaMajor('no java here'), /java_version_unreadable/)
  })

  test('reads the iOS toolchain from Xcode and CocoaPods and the Android one from Java', () => {
    const calls = []
    const read = (binary, args) => {
      calls.push([binary, ...args].join(' '))
      return binary === 'java' ? 'openjdk version "21.0.13"' : `${binary} output`
    }
    assert.deepEqual(toolchain('ios', read, 'arm64'), {
      arch: 'arm64',
      xcode: 'xcodebuild output',
      cocoapods: 'pod output',
    })
    assert.deepEqual(toolchain('android', read, 'x64'), { arch: 'x64', java: '21' })
    assert.deepEqual(calls, ['xcodebuild -version', 'pod --version', 'java -version'])
    assert.throws(() => toolchain('web', read), /platform_required/)
  })

  test('hashes the harness files that decide the binary, all of which exist', () => {
    for (const file of HARNESS_BUILD_FILES) assert.ok(fs.existsSync(file), file)
    assert.ok(HARNESS_BUILD_FILES.includes('scripts/ci/native-build-cache.mjs'))
    assert.ok(HARNESS_BUILD_FILES.includes('scripts/lib/story68-worklets-staging.mjs'))
    for (const directory of PLUGIN_SOURCE_DIRECTORIES)
      assert.ok(fs.statSync(directory).isDirectory(), directory)
  })

  // The anon key differs on every runtime and only the config's extra section carries it, so the
  // key skips that section: without the skip each runtime would have its own fingerprint.
  test('the fingerprint ignores the runtime anon key only because it skips the extra section', async () => {
    const saved = { ...process.env }
    try {
      const one = await fingerprintOf('android', 'runtime-one')
      const two = await fingerprintOf('android', 'runtime-two')
      assert.equal(one.hash, two.hash)
      assert.ok(one.sources.length > 50, `${one.sources.length} sources`)
      assert.ok(
        one.sources.some((source) =>
          source.filePath?.endsWith('modules/modal-system-bars/android')
        ),
        'the local native modules are fingerprinted'
      )
      assert.ok(
        one.sources.some((source) => source.filePath === 'targets'),
        'the plugin target sources are fingerprinted'
      )
      const { createFingerprintAsync } = expoFingerprint()
      const unskipped = async (anonKey) => {
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = anonKey
        return (await createFingerprintAsync('apps/mobile', { platforms: ['android'] }))
          .hash
      }
      assert.notEqual(await unskipped('runtime-one'), await unskipped('runtime-two'))
    } finally {
      for (const name of Object.keys(process.env))
        if (!(name in saved)) delete process.env[name]
      Object.assign(process.env, saved)
    }
  })

  test('resolves the key, the client path and the toolchain it was keyed with', async () => {
    const saved = { ...process.env }
    try {
      const resolved = await resolveCacheKey('android', () => 'openjdk version "21.0.13"')
      assert.match(resolved.key, /^cc68-native-android-v\d+-[a-f0-9]{40}$/)
      assert.equal(resolved.path, nativeDevClientPath('android', process.cwd()))
      assert.equal(resolved.tools.java, '21')
      assert.deepEqual(resolved.tools.generators, generatorVersions())
      const other = await resolveCacheKey('android', () => 'openjdk version "17.0.2"')
      assert.notEqual(other.key, resolved.key)
      assert.equal(other.fingerprint, resolved.fingerprint)
    } finally {
      for (const name of Object.keys(process.env))
        if (!(name in saved)) delete process.env[name]
      Object.assign(process.env, saved)
    }
  })

  test('the CLI prints only the key and path on stdout and refuses other usage', () => {
    const ok = spawnSync(
      process.execPath,
      ['scripts/ci/native-build-cache.mjs', 'key', '--platform', 'android'],
      { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH } }
    )
    if (ok.status === 0) {
      const lines = ok.stdout.trim().split('\n')
      assert.equal(lines.length, 2)
      assert.match(lines[0], /^key=cc68-native-android-v\d+-[a-f0-9]{40}$/)
      assert.match(lines[1], /^path=.*\/app-debug\.apk$/)
      assert.match(ok.stderr, /"nativeBuildCache"/)
    } else assert.match(ok.stderr, /toolchain_unreadable:java/)
    for (const args of [
      [],
      ['key'],
      ['key', '--platform', 'web'],
      ['build', '--platform', 'ios'],
    ]) {
      const bad = spawnSync(
        process.execPath,
        ['scripts/ci/native-build-cache.mjs', ...args],
        {
          encoding: 'utf8',
        }
      )
      assert.equal(bad.status, 1, args.join(' '))
      assert.equal(bad.stdout, '')
    }
  })

  // Expo's fingerprint leaves its own @expo tooling out of the hash.
  test('keys the resolved version of every native project generator', () => {
    const versions = generatorVersions()
    assert.deepEqual(Object.keys(versions), [...PROJECT_GENERATOR_PACKAGES])
    for (const [name, version] of Object.entries(versions))
      assert.match(version, /^\d+\.\d+\.\d+/, name)
    assert.ok(PROJECT_GENERATOR_PACKAGES.includes('@expo/prebuild-config'))
    assert.ok(PROJECT_GENERATOR_PACKAGES.includes('@expo/config-plugins'))
  })
})
