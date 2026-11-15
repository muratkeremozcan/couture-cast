// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { manifestBundleUrl } from './expo-manifest-bundle-url.mjs'

describe('manifestBundleUrl', () => {
  test('moves the launch asset path and query onto the given origin', () => {
    const manifest = JSON.stringify({
      launchAsset: {
        url: 'http://10.0.2.2:8081/apps/mobile/index.ts.bundle?platform=android&dev=true&lazy=true',
      },
    })
    assert.equal(
      manifestBundleUrl(manifest, 'http://127.0.0.1:8081'),
      'http://127.0.0.1:8081/apps/mobile/index.ts.bundle?platform=android&dev=true&lazy=true'
    )
  })

  test('refuses a manifest without a launch asset URL, or no JSON', () => {
    assert.throws(
      () => manifestBundleUrl('{}', 'http://127.0.0.1:8081'),
      /no_launch_asset_url/
    )
    assert.throws(
      () => manifestBundleUrl('{"launchAsset":{"url":""}}', 'http://127.0.0.1:8081'),
      /no_launch_asset_url/
    )
    assert.throws(() => manifestBundleUrl('<html>', 'http://127.0.0.1:8081'), /not_json/)
  })
})
