// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

import { readEnvValue, scanExport } from './revenuecat-bundle-scan.mjs'

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
