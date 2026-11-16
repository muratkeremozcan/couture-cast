// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// P3-1 (Antigravity r8): `expo config` gets exactly the minimal environment, whatever the shell
// holds; scripts/ci/android-release-abis.test.mjs shows the ABI verdict holds against a seeded
// shell variable and .env.local.
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import {
  resolveEnv,
  resolvedAppConfig,
  resolvedGradleProperties,
} from './resolved-app-config.mjs'

test('the resolve environment drops every ambient variable and turns env files off', () => {
  assert.deepEqual(
    resolveEnv({
      PATH: '/bin',
      HOME: '/home/dev',
      STORY68_NATIVE_TEST_BUILD: '1',
      EXPO_PUBLIC_API_BASE_URL: 'http://dev.example',
      NODE_ENV: 'development',
    }),
    {
      PATH: '/bin',
      HOME: '/home/dev',
      NODE_ENV: 'production',
      EXPO_OFFLINE: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_NO_DOTENV: '1',
      COUTURE_CONFIG_NO_ENV_FILES: '1',
    }
  )
})

test('resolved gradle properties are read from the introspected mod results', () => {
  assert.deepEqual(
    resolvedGradleProperties({
      _internal: {
        modResults: {
          android: {
            gradleProperties: [
              { type: 'comment', value: 'x' },
              { type: 'property', key: 'hermesEnabled', value: 'true' },
            ],
          },
        },
      },
    }),
    { hermesEnabled: 'true' }
  )
  assert.deepEqual(resolvedGradleProperties({}), {})
})

// Device runner, leg 4: the evidence CLI passes its default root '.', and createRequire needs an
// absolute path; a relative root resolves against the working directory.
test('a relative root resolves against the working directory', async () => {
  const { resolvedAppConfig } = await import('./resolved-app-config.mjs')
  const result = resolvedAppConfig('.')
  assert.ok(result.config || result.error, JSON.stringify(Object.keys(result)))
  assert.ok(result.config, `relative root resolves the app config: ${result.error}`)
})

// Learning path Step 57: Google sign-in. Story 6.17 D7, D10 (TEA sign-off): the release config
// keeps couturecast as the primary scheme, the one `Linking.createURL` builds the OAuth redirect
// on, keeps the mobile alias, and is never an isolated build, so its development-only OAuth
// stand-in switch stays off.
test('the release config keeps the couturecast scheme first and is never an isolated build', () => {
  const result = resolvedAppConfig(path.resolve(import.meta.dirname, '../..'))
  assert.ok(result.config, `the app config resolves: ${result.error}`)
  assert.deepEqual(result.config.scheme, ['couturecast', 'mobile'])
  assert.equal(result.config.extra?.isolatedNativeBuild, false)
})
