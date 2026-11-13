#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Proves a release bundle carries no RevenueCat Test Store key (story 6.15 D15, TEA-20). Expo
// inlines EXPO_PUBLIC_ values at export, and `.env.local`, which holds the Test Store key, is also
// loaded for laptop production builds, so the export runs with that key present in the
// environment and every exported file is searched for it and for any `test_`-prefixed RevenueCat
// key. Findings name files only; the key itself is never printed.
//
// Usage: node scripts/ci/revenuecat-bundle-scan.mjs [--env-file <path with the Test Store key>]
import { spawnSync } from 'node:child_process'
import fs, { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TEST_KEY_PATTERN,
  TEST_STORE_KEY_VARIABLE,
  readEnvEntries,
} from './revenuecat-key-hygiene.mjs'

export { TEST_STORE_KEY_VARIABLE }

function* files(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) yield* files(full)
    else yield full
  }
}

/** Every exported file that holds the given key or a `test_` RevenueCat key. */
export function scanExport(root, key) {
  const hits = []
  for (const file of files(root)) {
    const text = fs.readFileSync(file).toString('latin1')
    if ((key && text.includes(key)) || TEST_KEY_PATTERN.test(text))
      hits.push(path.relative(root, file))
  }
  return hits
}

/** Reads one variable from a dotenv file without exposing the rest. */
export function readEnvValue(file, name) {
  return readEnvEntries(file).find(([entry]) => entry === name)?.[1]
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--env-file')
  const key =
    index > -1
      ? readEnvValue(process.argv[index + 1], TEST_STORE_KEY_VARIABLE)
      : process.env[TEST_STORE_KEY_VARIABLE]
  if (!key) {
    console.error(
      `revenuecat-bundle-scan: ${TEST_STORE_KEY_VARIABLE} is not set; nothing to prove`
    )
    process.exit(2)
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-revenuecat-scan-'))
  try {
    const result = spawnSync(
      'npx',
      ['expo', 'export', '--platform', 'all', '--output-dir', out, '--clear'],
      {
        cwd: path.join(root, 'apps/mobile'),
        env: { ...process.env, NODE_ENV: 'production', [TEST_STORE_KEY_VARIABLE]: key },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      }
    )
    if (result.status !== 0) {
      console.error(
        `revenuecat-bundle-scan: expo export failed\n${result.stderr.slice(-4000)}`
      )
      process.exit(1)
    }
    const hits = scanExport(out, key)
    console.log(
      hits.length
        ? `revenuecat-bundle-scan: Test Store key found in ${hits.join(', ')}`
        : `revenuecat-bundle-scan: no Test Store key in ${[...files(out)].length} exported files`
    )
    process.exit(hits.length ? 1 : 0)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
}
