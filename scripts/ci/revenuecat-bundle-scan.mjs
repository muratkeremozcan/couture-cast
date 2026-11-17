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
// Story 6.17 D10 rides on the same exports: the real-session lane's OAuth stand-in variable
// (EXPO_PUBLIC_E2E_OAUTH_PROVIDER) is read only inside `__DEV__`, so each export runs with it set
// to a sentinel and a release bundle that still contains the sentinel fails the scan.
//
// The E2E member token rides on them too. Development harnesses bake a member token into the
// Metro bundle (EXPO_PUBLIC_E2E_ACCESS_TOKEN from scripts/run-maestro.mjs,
// scripts/run-test-store-journey.mjs and scripts/ci/android-network-timeout.sh, or
// EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE for a sharded run) with EXPO_PUBLIC_E2E_AUTH_MODE other
// than 'real'. apps/mobile/src/lib/mobile-auth.ts and native-session.ts read them only inside
// `__DEV__`, so each export runs in member mode with both token keys set to sentinels, and a
// release bundle holding either sentinel, or the network-timeout placeholder, fails the scan.
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

/** Story 6.17 D10: the development-only OAuth stand-in switch and the value the scan plants. */
export const E2E_OAUTH_PROVIDER_VARIABLE = 'EXPO_PUBLIC_E2E_OAUTH_PROVIDER'
export const E2E_OAUTH_PROVIDER_SENTINEL = 'couturecast-oauth-standin-sentinel'

/** The development-only member mode switch and token keys, with the values the scan plants. */
export const E2E_AUTH_MODE_VARIABLE = 'EXPO_PUBLIC_E2E_AUTH_MODE'
export const E2E_ACCESS_TOKEN_VARIABLE = 'EXPO_PUBLIC_E2E_ACCESS_TOKEN'
export const E2E_ACCESS_TOKEN_BY_DEVICE_VARIABLE =
  'EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE'
export const E2E_ACCESS_TOKEN_SENTINEL = 'couturecast-e2e-member-token-sentinel'
export const E2E_DEVICE_TOKEN_SENTINEL = 'couturecast-e2e-device-token-sentinel'
/** The member token scripts/ci/android-network-timeout.sh bakes into its development bundle. */
export const NETWORK_TIMEOUT_MEMBER_TOKEN = 'network-timeout-member-placeholder'

/** Every marker a release export must not contain. */
export const RELEASE_MARKERS = [
  E2E_OAUTH_PROVIDER_SENTINEL,
  E2E_ACCESS_TOKEN_SENTINEL,
  E2E_DEVICE_TOKEN_SENTINEL,
  NETWORK_TIMEOUT_MEMBER_TOKEN,
]

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

/**
 * Every exported file that holds the given key, a `test_` RevenueCat key, or one of the planted
 * development-only markers.
 */
export function scanExport(root, key, markers = []) {
  const hits = []
  for (const file of files(root)) {
    const text = fs.readFileSync(file).toString('latin1')
    if (
      (key && text.includes(key)) ||
      TEST_KEY_PATTERN.test(text) ||
      markers.some((marker) => text.includes(marker))
    )
      hits.push(path.relative(root, file))
  }
  return hits
}

/**
 * The per-shape release check the CLI loop runs on each export: the Test Store key, any `test_`
 * RevenueCat key, the planted OAuth stand-in sentinel (Story 6.17 D10) and the planted member
 * token sentinels.
 */
export function scanReleaseExport(out, key) {
  return scanExport(out, key, RELEASE_MARKERS)
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
      [E2E_OAUTH_PROVIDER_VARIABLE]: E2E_OAUTH_PROVIDER_SENTINEL,
      [E2E_AUTH_MODE_VARIABLE]: 'member',
      [E2E_ACCESS_TOKEN_VARIABLE]: E2E_ACCESS_TOKEN_SENTINEL,
      [E2E_ACCESS_TOKEN_BY_DEVICE_VARIABLE]: JSON.stringify({
        'couture-e2e-1': E2E_DEVICE_TOKEN_SENTINEL,
      }),
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
      const hits = scanReleaseExport(out, key)
      console.log(
        hits.length
          ? `revenuecat-bundle-scan: ${shape.name}: Test Store key, OAuth stand-in or E2E member token found in ${hits.join(', ')}`
          : `revenuecat-bundle-scan: ${shape.name}: no Test Store key, OAuth stand-in or E2E member token in ${[...files(out)].length} exported files`
      )
      if (hits.length) failed = true
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  }
  process.exit(failed ? 1 : 0)
}
