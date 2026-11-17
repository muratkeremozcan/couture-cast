// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { parse } from 'yaml'

import { profileEnvBlocks } from './revenuecat-key-hygiene.mjs'

import {
  E2E_ACCESS_TOKEN_BY_DEVICE_VARIABLE,
  E2E_ACCESS_TOKEN_SENTINEL,
  E2E_ACCESS_TOKEN_VARIABLE,
  E2E_AUTH_MODE_VARIABLE,
  E2E_DEVICE_TOKEN_SENTINEL,
  E2E_OAUTH_PROVIDER_SENTINEL,
  E2E_OAUTH_PROVIDER_VARIABLE,
  NETWORK_TIMEOUT_MEMBER_TOKEN,
  EXPORT_SHAPES,
  TEST_STORE_KEY_VARIABLE,
  exportCommand,
  readEnvValue,
  scanExport,
} from './revenuecat-bundle-scan.mjs'

function exportTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-scan-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return root
}

test('finds the configured key and any test_ RevenueCat key, naming files only', (t) => {
  const root = exportTree(t, {
    '_expo/static/js/ios/entry.hbc': 'var k="secretvalue123";',
    '_expo/static/js/android/entry.hbc': 'x="test_AbCdEfGhIjKlMnOpQr"',
    'metadata.json': '{}',
  })
  assert.deepEqual(scanExport(root, 'secretvalue123').sort(), [
    '_expo/static/js/android/entry.hbc',
    '_expo/static/js/ios/entry.hbc',
  ])
})

test('a clean export has no hits, and short test_ identifiers are not keys', (t) => {
  const root = exportTree(t, { 'entry.js': 'function test_case(){}; var test_id = 1' })
  assert.deepEqual(scanExport(root, 'test_never_shipped_value'), [])
})

// Hermes packs its string table without separators, so a key inlined into a release bundle can
// follow any character. A preview-only test_ key in a platform slot is not the configured key, so
// only the pattern can find it.
test('finds a test_ key packed against the previous string in a Hermes string table', (t) => {
  const root = exportTree(t, {
    'entry.hbc': 'Invalid timing functionsubscribetest_previewonly0key00000Cannot set',
  })
  assert.deepEqual(scanExport(root, 'test_ci0synthetic0key0000'), ['entry.hbc'])
})

// Learning path Step 57: Google sign-in. Story 6.17 D10: the OAuth stand-in switch is
// development-only, so a release bundle holding its planted sentinel fails.
test('finds the planted OAuth stand-in sentinel, and only when it was inlined', (t) => {
  const root = exportTree(t, {
    'leaky.hbc': `provider${E2E_OAUTH_PROVIDER_SENTINEL}keycloak`,
    'clean.hbc': 'provider google signInWithOAuth keycloak',
  })
  assert.deepEqual(scanExport(root, undefined, [E2E_OAUTH_PROVIDER_SENTINEL]), [
    'leaky.hbc',
  ])
  assert.deepEqual(scanExport(root, undefined), [])
})

// Story 6.17 TEA sign-off, U-SEAM-BUNDLE: the CLI's per-shape check is what CI runs, and it must
// look for the planted sentinel as well as the key. Read through a dynamic import so a missing
// export fails this test alone.
// RED until the scan exports `scanReleaseExport(out, key)`, the per-shape check its CLI loop calls.
test('the per-shape release check reports the planted sentinel and the Test Store key', async (t) => {
  const bundleScan = await import('./revenuecat-bundle-scan.mjs')
  assert.equal(
    typeof bundleScan.scanReleaseExport,
    'function',
    'revenuecat-bundle-scan.mjs must export scanReleaseExport(out, key), used by its CLI loop'
  )
  const root = exportTree(t, {
    '_expo/static/js/ios/entry.hbc': `provider${E2E_OAUTH_PROVIDER_SENTINEL}`,
    '_expo/static/js/android/entry.hbc': 'var k="secretvalue123";',
    'metadata.json': '{}',
  })
  assert.deepEqual(bundleScan.scanReleaseExport(root, 'secretvalue123').sort(), [
    '_expo/static/js/android/entry.hbc',
    '_expo/static/js/ios/entry.hbc',
  ])
  const clean = exportTree(t, { 'entry.hbc': 'provider google signInWithOAuth' })
  assert.deepEqual(bundleScan.scanReleaseExport(clean, 'secretvalue123'), [])
})

// PR 249: the network-timeout harness bakes a placeholder member token into its development
// bundle. Each release export runs in member mode with both token keys planted, so a release
// bundle that inlined either one, or the harness placeholder, fails the scan.
test('the per-shape release check reports a seeded E2E member token leak', async (t) => {
  const { scanReleaseExport } = await import('./revenuecat-bundle-scan.mjs')
  for (const leak of [
    E2E_ACCESS_TOKEN_SENTINEL,
    E2E_DEVICE_TOKEN_SENTINEL,
    NETWORK_TIMEOUT_MEMBER_TOKEN,
  ]) {
    const root = exportTree(t, {
      '_expo/static/js/android/entry.hbc': `bearer${leak}authorization`,
      '_expo/static/js/ios/entry.hbc': 'bearer authorization',
    })
    assert.deepEqual(
      scanReleaseExport(root, 'secretvalue123'),
      ['_expo/static/js/android/entry.hbc'],
      leak
    )
  }
})

// Member mode reaches a bundle only through the env Metro starts with, so no EAS build profile
// may set it, and only the development harnesses write the member token.
test('no EAS build profile sets member mode or a member token', () => {
  const eas = JSON.parse(fs.readFileSync('apps/mobile/eas.json', 'utf8'))
  const variables = [
    E2E_AUTH_MODE_VARIABLE,
    E2E_ACCESS_TOKEN_VARIABLE,
    E2E_ACCESS_TOKEN_BY_DEVICE_VARIABLE,
  ]
  const leaks = (config) =>
    Object.entries(config.build).flatMap(([name, profile]) =>
      profileEnvBlocks(profile).flatMap(([where, block]) =>
        variables
          .filter((variable) => variable in block)
          .map((v) => `${name}.${where}: ${v}`)
      )
    )
  assert.deepEqual(leaks(eas), [])
  // The check finds a seeded leak.
  assert.deepEqual(
    leaks({
      build: {
        production: { android: { env: { [E2E_ACCESS_TOKEN_VARIABLE]: 'leak' } } },
      },
    }).length,
    1
  )
})

test('only the development harnesses write the E2E member token', () => {
  const tracked = spawnSync(
    'git',
    ['ls-files', '-z', '--', 'apps', 'scripts', '.github', 'packages'],
    {
      encoding: 'utf8',
    }
  )
    .stdout.split('\0')
    .filter(Boolean)
  const writes = new RegExp(
    `(${E2E_ACCESS_TOKEN_VARIABLE}(_BY_DEVICE)?(=|:\\s)|env\\.${E2E_ACCESS_TOKEN_VARIABLE}(_BY_DEVICE)?\\s*=[^=])`
  )
  const writers = tracked.filter(
    (file) =>
      // Tests and their fixtures write nothing a build reads.
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) &&
      !/(^|\/)test\/fixtures\//.test(file) &&
      fs.existsSync(file) &&
      fs.statSync(file).isFile() &&
      writes.test(fs.readFileSync(file, 'utf8'))
  )
  assert.deepEqual(writers.sort(), [
    // The rule that pins the harness's Metro line.
    'scripts/ci/android-native-workflow.mjs',
    'scripts/ci/android-network-timeout.sh',
    'scripts/run-maestro.mjs',
    'scripts/run-test-store-journey.mjs',
  ])
})

test('reads one variable from a dotenv file, quoted or not', (t) => {
  const root = exportTree(t, {
    '.env.local':
      'OTHER=1\nEXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY="test_quoted"\nexport X=2\n',
  })
  assert.equal(
    readEnvValue(
      path.join(root, '.env.local'),
      'EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY'
    ),
    'test_quoted'
  )
  assert.equal(readEnvValue(path.join(root, '.env.local'), 'MISSING'), undefined)
})

// Story 6.15: the pull request job runs the scan with a synthetic key of the Test Store shape, so
// both the exact-key search and the test_ pattern apply, gated by its own lane.
test('the pull request scan job runs this script with a synthetic Test Store key', (t) => {
  const workflow = parse(fs.readFileSync('.github/workflows/pr-checks.yml', 'utf8'))
  const job = workflow.jobs['revenuecat-bundle-scan']
  assert.equal(job.if, "fromJSON(needs.lanes.outputs.plan)['revenuecat-bundle']")
  assert.equal(job['runs-on'], 'ubuntu-latest')
  assert.ok(job['timeout-minutes'] <= 20)
  const scan = job.steps.find(
    (step) => step.run === 'node scripts/ci/revenuecat-bundle-scan.mjs'
  )
  const key = scan.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY
  assert.match(key, /^test_[A-Za-z0-9]{16,}$/)
  // An export that inlined the key would be caught by both searches.
  const root = exportTree(t, { 'bundle.js': `k="${key}"` })
  assert.deepEqual(scanExport(root, key), ['bundle.js'])
  assert.deepEqual(scanExport(root, undefined), ['bundle.js'])
})

// Story 6.15 D15: the scan covers the production and the preview export. app.config.ts loads
// `.env.prod` only when NODE_ENV is production, so the preview export runs under another NODE_ENV
// to load `.env.preview`, and each export applies its EAS profile's env, so a preview profile
// added later is scanned as it would build.
test('the scan exports production and preview, each with its env files and EAS profile', () => {
  const appConfig = fs.readFileSync('apps/mobile/app.config.ts', 'utf8')
  assert.match(
    appConfig,
    /process\.env\.NODE_ENV === 'production' \? '\.env\.prod' : '\.env\.preview'/
  )
  assert.deepEqual(
    EXPORT_SHAPES.map(({ name }) => name),
    ['production', 'preview']
  )
  const eas = {
    build: {
      production: { environment: 'production', env: { EXPO_PUBLIC_FLAG: 'prod' } },
      preview: {
        extends: 'production',
        environment: 'preview',
        env: { EXPO_PUBLIC_FLAG: 'preview', [TEST_STORE_KEY_VARIABLE]: 'overridden' },
        android: { env: { EXPO_PUBLIC_ANDROID_ONLY: '1' } },
      },
    },
  }
  const key = 'test_ci0synthetic0key0000'
  const [production, preview] = EXPORT_SHAPES.map((shape) =>
    exportCommand(shape, { eas, key, out: `/out/${shape.name}`, env: { PATH: '/bin' } })
  )
  assert.deepEqual(production.args, [
    'expo',
    'export',
    '--platform',
    'all',
    '--output-dir',
    '/out/production',
    '--clear',
  ])
  assert.deepEqual(production.env, {
    PATH: '/bin',
    EXPO_PUBLIC_FLAG: 'prod',
    NODE_ENV: 'production',
    EAS_BUILD_PROFILE: 'production',
    [TEST_STORE_KEY_VARIABLE]: key,
    [E2E_OAUTH_PROVIDER_VARIABLE]: E2E_OAUTH_PROVIDER_SENTINEL,
    [E2E_AUTH_MODE_VARIABLE]: 'member',
    [E2E_ACCESS_TOKEN_VARIABLE]: E2E_ACCESS_TOKEN_SENTINEL,
    [E2E_ACCESS_TOKEN_BY_DEVICE_VARIABLE]: JSON.stringify({
      'couture-e2e-1': E2E_DEVICE_TOKEN_SENTINEL,
    }),
  })
  assert.deepEqual(preview.args, [
    'expo',
    'export',
    '--platform',
    'ios',
    '--platform',
    'android',
    '--output-dir',
    '/out/preview',
    '--clear',
  ])
  assert.notEqual(preview.env.NODE_ENV, 'production', 'loads .env.preview')
  assert.equal(preview.env.EAS_BUILD_PROFILE, 'preview')
  assert.equal(preview.env.EXPO_PUBLIC_FLAG, 'preview')
  assert.equal(preview.env.EXPO_PUBLIC_ANDROID_ONLY, '1')
  // The key stays present whatever a profile sets, so the scan always has something to find.
  assert.equal(preview.env[TEST_STORE_KEY_VARIABLE], key)
})

test('the preview export runs without a preview profile, with no profile env', () => {
  const preview = EXPORT_SHAPES.find(({ name }) => name === 'preview')
  const { env } = exportCommand(preview, {
    eas: { build: { production: { env: { EXPO_PUBLIC_FLAG: 'prod' } } } },
    key: 'test_ci0synthetic0key0000',
    out: '/out',
    env: {},
  })
  assert.equal(env.EXPO_PUBLIC_FLAG, undefined)
  assert.equal(env.EAS_BUILD_PROFILE, 'preview')
})
