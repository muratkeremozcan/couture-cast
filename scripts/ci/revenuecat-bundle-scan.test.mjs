// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

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
