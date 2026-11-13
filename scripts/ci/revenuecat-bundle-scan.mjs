#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Proves a release bundle carries no RevenueCat Test Store key (story 6.15 D15, TEA-20). Expo
// inlines EXPO_PUBLIC_ values at export, and `.env.local`, which holds the Test Store key, is also
// loaded for laptop production builds, so each export runs with that key present in the
// environment and every exported file is searched for it and for any `test_`-prefixed RevenueCat
// key. Findings name files only; the key itself is never printed.
//
// Two release exports are scanned, as D15 names them:
// - production: `NODE_ENV=production`, so app.config.ts loads `.env.prod`, with the `production`
//   EAS profile's env; every platform the app exports.
// - preview: a non-production NODE_ENV, so app.config.ts loads `.env.preview`, with the `preview`
//   EAS profile's env once that profile exists; the two native platforms a preview build ships.
//   `expo export` without `--dev` still builds a minified bundle with `__DEV__` false.
// Each runs with `--clear`, because the transform cache keys do not follow every inlined value.
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
  profileEnvBlocks,
  readEnvEntries,
  resolveBuildProfile,
} from './revenuecat-key-hygiene.mjs'

export { TEST_STORE_KEY_VARIABLE }

/** The release exports the scan proves, in the order it runs them. */
export const EXPORT_SHAPES = [
  {
    name: 'production',
    nodeEnv: 'production',
    profile: 'production',
    platforms: ['all'],
  },
  {
    name: 'preview',
    nodeEnv: 'preview',
    profile: 'preview',
    platforms: ['ios', 'android'],
  },
]

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

/** The `expo export` arguments and environment of one export shape. */
export function exportCommand(shape, { eas, key, out, env = process.env }) {
  const profile = resolveBuildProfile(eas, shape.profile)
  const profileEnv = Object.assign(
    {},
    ...(profile ? profileEnvBlocks(profile).map(([, block]) => block) : [])
  )
  return {
    args: [
      'expo',
      'export',
      ...shape.platforms.flatMap((platform) => ['--platform', platform]),
      '--output-dir',
      out,
      '--clear',
    ],
    env: {
      ...env,
      ...profileEnv,
      NODE_ENV: shape.nodeEnv,
      EAS_BUILD_PROFILE: shape.profile,
      [TEST_STORE_KEY_VARIABLE]: key,
    },
  }
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
  const mobile = path.join(root, 'apps/mobile')
  const eas = JSON.parse(fs.readFileSync(path.join(mobile, 'eas.json'), 'utf8'))
  let failed = false
  for (const shape of EXPORT_SHAPES) {
    const out = fs.mkdtempSync(
      path.join(os.tmpdir(), `couture-revenuecat-${shape.name}-`)
    )
    try {
      const { args, env } = exportCommand(shape, { eas, key, out })
      const result = spawnSync('npx', args, {
        cwd: mobile,
        env,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      })
      if (result.status !== 0) {
        console.error(
          `revenuecat-bundle-scan: ${shape.name} expo export failed\n${result.stderr.slice(-4000)}`
        )
        process.exit(1)
      }
      const hits = scanExport(out, key)
      console.log(
        hits.length
          ? `revenuecat-bundle-scan: ${shape.name}: Test Store key found in ${hits.join(', ')}`
          : `revenuecat-bundle-scan: ${shape.name}: no Test Store key in ${[...files(out)].length} exported files`
      )
      if (hits.length) failed = true
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  }
  process.exit(failed ? 1 : 0)
}
