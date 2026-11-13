// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// P3-1 (Antigravity r8): `expo config` gets exactly the minimal environment, whatever the shell
// holds; scripts/ci/android-release-abis.test.mjs shows the ABI verdict holds against a seeded
// shell variable and .env.local.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveEnv, resolvedGradleProperties } from './resolved-app-config.mjs'

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
