// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

import {
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
