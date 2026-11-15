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

  // Antigravity r50 P2-1: a URL of another scheme could turn the origin into another host.
  test('resolves a relative launch asset and refuses one that is not http or https', () => {
    assert.equal(
      manifestBundleUrl(
        '{"launchAsset":{"url":"/apps/mobile/index.ts.bundle?platform=android"}}',
        'http://127.0.0.1:8081'
      ),
      'http://127.0.0.1:8081/apps/mobile/index.ts.bundle?platform=android'
    )
    for (const url of [
      'x:.evil.com/pwn.bundle?a=1',
      'javascript:alert(1)',
      'file:///etc/passwd',
    ])
      assert.throws(
        () =>
          manifestBundleUrl(
            JSON.stringify({ launchAsset: { url } }),
            'http://127.0.0.1:8081'
          ),
        /expo_manifest_launch_asset_not_http/
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
