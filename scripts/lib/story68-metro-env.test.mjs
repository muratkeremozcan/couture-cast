import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { metroServerArgs, metroServerEnv } from './story68-metro-env.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('the iOS Metro runs with lazy bundling disabled and keeps the build environment', () => {
  const env = metroServerEnv(
    { STORY68_NATIVE_TEST_BUILD: '1', EXPO_NO_METRO_LAZY: '0' },
    'ios'
  )
  assert.equal(env.EXPO_NO_METRO_LAZY, '1')
  assert.equal(env.STORY68_NATIVE_TEST_BUILD, '1')
})

test('Android and unspecified platforms leave Expo lazy bundling untouched', () => {
  const build = { STORY68_NATIVE_TEST_BUILD: '1' }
  for (const platform of ['android', undefined, 'web']) {
    const env = metroServerEnv(build, platform)
    assert.equal('EXPO_NO_METRO_LAZY' in env, false, String(platform))
    assert.deepEqual(env, { ...build, EXPO_OFFLINE: '1' })
  }
  assert.notEqual(metroServerEnv(build, 'android'), build)
})

test('every owned Metro runs offline, even over a build environment that says otherwise', () => {
  for (const platform of ['ios', 'android', undefined])
    assert.equal(
      metroServerEnv({ EXPO_OFFLINE: '0' }, platform).EXPO_OFFLINE,
      '1',
      String(platform)
    )
})

test('the installed Expo CLI skips the Expo account lookup for the Expo Go manifest offline', () => {
  const signing = fs.readFileSync(
    `${root}node_modules/@expo/cli/build/src/utils/codesigning.js`,
    'utf8'
  )
  // The online branch fetches a development certificate, which needs a logged-in actor.
  assert.match(
    signing,
    /if \(!_env\d*\.env\.EXPO_OFFLINE\) \{\s*try \{\s*const newCodeSigningInfo = await fetchAndCacheNewDevelopmentCodeSigningInfoAsync/
  )
  assert.match(signing, /Offline and no cached development certificate found/)
  const user = fs.readFileSync(
    `${root}node_modules/@expo/cli/build/src/api/user/user.js`,
    'utf8'
  )
  assert.match(
    user,
    /if \(!_env\d*\.env\.EXPO_OFFLINE && !currentUser && hasCredentials\)/
  )
})

test('the installed Expo CLI still reads that variable to decide lazy bundling', () => {
  const cli = fs.readFileSync(
    `${root}node_modules/@expo/cli/build/src/start/server/metro/MetroBundlerDevServer.js`,
    'utf8'
  )
  assert.match(cli, /lazy: !_env\d*\.env\.EXPO_NO_METRO_LAZY/)
})

test('the harness passes the platform to the helper and every workflow start names one', () => {
  const harness = fs.readFileSync(`${root}scripts/run-story68-native.mjs`, 'utf8')
  assert.match(harness, /metroServerEnv\(read\('public-build-env\.json'\), platform\)/)
  const workflow = fs.readFileSync(
    `${root}.github/workflows/pr-share-card-native.yml`,
    'utf8'
  )
  const starts = workflow.match(/run-story68-native\.mjs metro\b[^\n]*/g) ?? []
  assert.ok(starts.length > 0)
  for (const start of starts)
    assert.match(start, /--platform (android|ios|\$\{\{ matrix\.platform \}\})(?=\s)/)
})

test('only the iOS Metro runs a single transform worker, and the installed Expo CLI offers the flag', () => {
  assert.deepEqual(metroServerArgs('ios'), ['--max-workers', '1'])
  for (const platform of ['android', undefined, 'web'])
    assert.deepEqual(metroServerArgs(platform), [], String(platform))
  const cli = fs.readFileSync(
    `${root}node_modules/@expo/cli/build/src/start/index.js`,
    'utf8'
  )
  assert.match(cli, /--max-workers/)
  const harness = fs.readFileSync(`${root}scripts/run-story68-native.mjs`, 'utf8')
  assert.match(harness, /\.\.\.metroServerArgs\(platform\)/)
})
