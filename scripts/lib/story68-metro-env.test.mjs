import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { metroServerEnv } from './story68-metro-env.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('the owned Metro runs with lazy bundling disabled and keeps the build environment', () => {
  const env = metroServerEnv({ STORY68_NATIVE_TEST_BUILD: '1', EXPO_NO_METRO_LAZY: '0' })
  assert.equal(env.EXPO_NO_METRO_LAZY, '1')
  assert.equal(env.STORY68_NATIVE_TEST_BUILD, '1')
})

test('the installed Expo CLI still reads that variable to decide lazy bundling', () => {
  const cli = fs.readFileSync(
    `${root}node_modules/@expo/cli/build/src/start/server/metro/MetroBundlerDevServer.js`,
    'utf8'
  )
  assert.match(cli, /lazy: !_env\d*\.env\.EXPO_NO_METRO_LAZY/)
})

test('the harness starts Metro through the helper', () => {
  const harness = fs.readFileSync(`${root}scripts/run-story68-native.mjs`, 'utf8')
  assert.match(harness, /metroServerEnv\(read\('public-build-env\.json'\)\)/)
})
