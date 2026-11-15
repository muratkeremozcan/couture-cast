#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 (android-native run 43653227338): the bundle URL an Expo manifest's launch asset
// names, on another origin. The nightly network-timeout job warms Metro with exactly the request
// the development client will make, so the app's first load finds the bundle built. Reads the
// manifest JSON on stdin, prints `<origin><path and query of launchAsset.url>`, and fails on a
// manifest without one.
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

/**
 * @param {string} manifestText
 * @param {string} origin
 * @returns {string}
 */
export function manifestBundleUrl(manifestText, origin) {
  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    throw new Error('expo_manifest_not_json')
  }
  const named = manifest?.launchAsset?.url
  if (typeof named !== 'string' || named === '')
    throw new Error('expo_manifest_no_launch_asset_url')
  const url = new URL(named)
  return `${new URL(origin).origin}${url.pathname}${url.search}`
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(
      `${manifestBundleUrl(fs.readFileSync(0, 'utf8'), process.argv[2])}\n`
    )
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
