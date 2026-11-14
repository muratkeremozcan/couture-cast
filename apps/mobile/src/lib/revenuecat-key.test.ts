// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 and TEA-20: the RevenueCat Test Store key is for debuggable builds only. The
// SDK crashes on purpose when a Test Store key runs in a release build, and `.env.local`, which
// holds it, is also loaded for laptop production builds, so the selection refuses a `test_` key
// whenever the JS bundle is not a development bundle.
import { describe, expect, it } from 'vitest'

import { selectRevenueCatApiKey } from './revenuecat-key'

const env = {
  EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_platform_key',
  EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: 'goog_platform_key',
  EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: 'test_store_key',
}

describe('selectRevenueCatApiKey', () => {
  it('uses the Test Store key in a development bundle on both platforms', () => {
    expect(selectRevenueCatApiKey({ os: 'ios', dev: true, env })).toBe('test_store_key')
    expect(selectRevenueCatApiKey({ os: 'android', dev: true, env })).toBe(
      'test_store_key'
    )
  })

  it('uses the platform key in a release bundle even when the Test Store key is present', () => {
    expect(selectRevenueCatApiKey({ os: 'ios', dev: false, env })).toBe(
      'appl_platform_key'
    )
    expect(selectRevenueCatApiKey({ os: 'android', dev: false, env })).toBe(
      'goog_platform_key'
    )
  })

  it('refuses any test_ key in a release bundle, wherever it was configured', () => {
    expect(
      selectRevenueCatApiKey({
        os: 'android',
        dev: false,
        env: { EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: 'test_misplaced_key' },
      })
    ).toBeUndefined()
    expect(
      selectRevenueCatApiKey({
        os: 'ios',
        dev: false,
        env: { EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: 'test_store_key' },
      })
    ).toBeUndefined()
  })

  it('falls back to the platform key in a development bundle without a Test Store key', () => {
    expect(
      selectRevenueCatApiKey({
        os: 'ios',
        dev: true,
        env: { EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_platform_key' },
      })
    ).toBe('appl_platform_key')
  })

  it('answers nothing on web or with no keys', () => {
    expect(selectRevenueCatApiKey({ os: 'web', dev: true, env })).toBeUndefined()
    expect(selectRevenueCatApiKey({ os: 'ios', dev: false, env: {} })).toBeUndefined()
  })
})
