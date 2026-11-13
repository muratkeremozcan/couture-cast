// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15, TEA-20, S4-13: no EAS profile other than `development`, no preview build and no
// Release build resolves a RevenueCat Test Store key.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  TEST_STORE_KEY_VARIABLE,
  appConfigEnvFiles,
  keyHygieneProblems,
  mobileEnvFileScope,
  resolveBuildProfile,
} from './revenuecat-key-hygiene.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const appConfig = fs.readFileSync(
  path.join(repository, 'apps/mobile/app.config.ts'),
  'utf8'
)
const TEST_KEY = 'test_AbCdEfGhIjKlMnOpQrSt'
const PRODUCTION = { environment: 'production', android: { buildType: 'app-bundle' } }

/** A repository root with the given eas.json build profiles and env files. */
function repo(
  t,
  {
    build = { production: PRODUCTION },
    development = { developmentClient: true },
    files = {},
    config = appConfig,
  }
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-key-hygiene-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const all = {
    'apps/mobile/eas.json': JSON.stringify({
      build: { development, ...build },
    }),
    'apps/mobile/app.config.ts': config,
    ...files,
  }
  for (const [file, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return root
}

test('the repository resolves no Test Store key outside the development profile', () => {
  assert.deepEqual(keyHygieneProblems(repository), [])
})

test('a profile that sets the Test Store key fails, production or any profile added later', (t) => {
  const root = repo(t, {
    build: {
      production: { ...PRODUCTION, env: { [TEST_STORE_KEY_VARIABLE]: TEST_KEY } },
      'production-simulator': {
        extends: 'production',
        ios: { simulator: true, env: { EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: TEST_KEY } },
      },
      preview: {
        distribution: 'internal',
        android: { env: { EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: 'test_short' } },
      },
    },
  })
  const problems = keyHygieneProblems(root)
  assert.deepEqual(problems, [
    `eas.json build profile production env sets ${TEST_STORE_KEY_VARIABLE}`,
    `eas.json build profile production-simulator env sets ${TEST_STORE_KEY_VARIABLE}`,
    'eas.json build profile production-simulator ios.env EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY holds a RevenueCat Test Store key',
    'eas.json build profile preview android.env EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY holds a RevenueCat Test Store key',
  ])
  assert.ok(
    problems.every((problem) => !problem.includes(TEST_KEY)),
    'never prints the key'
  )
})

test('a profile that would select the key through __DEV__ or the development environment fails', (t) => {
  const root = repo(t, {
    build: {
      preview: { extends: 'development', distribution: 'internal' },
      staging: { environment: 'development' },
      'android-debug': { android: { gradleCommand: ':app:assembleDebug' } },
      'ios-debug': { ios: { buildConfiguration: 'Debug' } },
      interpolated: {
        env: { EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: `$${TEST_STORE_KEY_VARIABLE}` },
      },
    },
  })
  assert.deepEqual(keyHygieneProblems(root), [
    'eas.json build profile preview builds a development client, where __DEV__ selects the key',
    'eas.json build profile staging pulls the EAS development environment',
    'eas.json build profile android-debug runs a Debug Gradle command, where __DEV__ selects the key',
    'eas.json build profile ios-debug builds the Debug iOS configuration, where __DEV__ selects the key',
    'eas.json build profile interpolated env EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY holds a RevenueCat Test Store key',
  ])
})

test('the development profile may hold the Test Store key', (t) => {
  const root = repo(t, {
    development: {
      developmentClient: true,
      env: { [TEST_STORE_KEY_VARIABLE]: TEST_KEY },
    },
  })
  assert.deepEqual(keyHygieneProblems(root), [])
})

test('only a release-only env file is refused the Test Store variable; platform slots never hold a test_ key', (t) => {
  const key = `${TEST_STORE_KEY_VARIABLE}=${TEST_KEY}\n`
  const clean = repo(t, {
    files: {
      '.env.local': key,
      '.env.preview': `export ${key}`,
      '.env': `OTHER=1\n# ${TEST_STORE_KEY_VARIABLE}=${TEST_KEY}\n`,
      'apps/mobile/.env.development': key,
      'apps/mobile/.env.custom': key,
    },
  })
  assert.deepEqual(keyHygieneProblems(clean), [])
  const leaking = repo(t, {
    files: {
      '.env.prod': key,
      '.env.local': `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY="${TEST_KEY}"\n`,
      '.env.example': 'EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=test_placeholder\n',
      'apps/mobile/.env.production.local': key,
    },
  })
  assert.deepEqual(keyHygieneProblems(leaking), [
    '.env.local EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY holds a RevenueCat Test Store key',
    `.env.prod sets ${TEST_STORE_KEY_VARIABLE}`,
    '.env.example EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY holds a RevenueCat Test Store key',
    `apps/mobile/.env.production.local sets ${TEST_STORE_KEY_VARIABLE}`,
  ])
})

test('every env file app.config.ts loads has a scope, so a new one cannot slip past', (t) => {
  assert.deepEqual(appConfigEnvFiles(appConfig), [
    '.env.local',
    '.env.prod',
    '.env.preview',
    '.env',
  ])
  const root = repo(t, {
    config: appConfig.replace("'.env',", "'.env.staging',\n  '.env',"),
  })
  assert.deepEqual(keyHygieneProblems(root), [
    'app.config.ts loads .env.staging, which this spec does not scope',
  ])
})

test('Expo env file scopes follow NODE_ENV', () => {
  assert.equal(mobileEnvFileScope('.env'), 'shared')
  assert.equal(mobileEnvFileScope('.env.local'), 'shared')
  assert.equal(mobileEnvFileScope('.env.production'), 'release')
  assert.equal(mobileEnvFileScope('.env.preview.local'), 'release')
  assert.equal(mobileEnvFileScope('.env.development.local'), 'debug')
  assert.equal(mobileEnvFileScope('.env.example'), undefined)
})

test('profiles resolve through extends as EAS merges them, and a cycle is refused', () => {
  const eas = {
    build: {
      base: { env: { A: '1', B: '1' }, android: { buildType: 'apk' } },
      child: { extends: 'base', env: { B: '2' }, android: { image: 'latest' } },
      loop: { extends: 'loop' },
      orphan: { extends: 'missing' },
    },
  }
  assert.deepEqual(resolveBuildProfile(eas, 'child'), {
    env: { A: '1', B: '2' },
    android: { buildType: 'apk', image: 'latest' },
  })
  assert.equal(resolveBuildProfile(eas, 'absent'), undefined)
  assert.throws(() => resolveBuildProfile(eas, 'loop'), /loop -> loop is a cycle/)
  assert.throws(() => resolveBuildProfile(eas, 'orphan'), /extends missing missing/)
})
