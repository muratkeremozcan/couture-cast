// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import type * as ReactNativeModule from 'react-native'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
const loadMocks = vi.hoisted(() => {
  // Expo packages read process.env.EXPO_OS when they load; the suite default is 'web'.
  process.env.EXPO_OS = 'ios'
  return () =>
    import('./share-card-composer.test-boundary.js').then(
      ({ composerMocks }) => composerMocks
    )
})
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
// The Android status-bar stack is a native window concern; Story 6.9 cases simulate Android.
vi.mock('@/src/lib/use-share-card-status-bar', () => ({
  useShareCardStatusBar: (open: boolean) => open,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
// Every mock below reads the shared boundary in share-card-composer.test-boundary.ts.
vi.mock('@/src/lib/mobile-auth', async () => (await loadMocks()).mobileAuth())
vi.mock('@/src/lib/share-cards', async () => (await loadMocks()).shareCards())
// Story 6.9: the real share flow runs against a mocked file system, digest and module.
vi.mock('@/src/lib/share-card-share', () =>
  vi.importActual('../src/lib/share-card-share.native')
)
vi.mock('../modules/share-card-native-share', async () =>
  (await loadMocks()).nativeShare()
)
vi.mock('@/src/analytics/mobile-analytics', async () => (await loadMocks()).analytics())
vi.mock('expo-file-system/legacy', async () => (await loadMocks()).fileSystem())
vi.mock('expo-crypto', async () => (await loadMocks()).crypto())
vi.mock('@/src/lib/share-card-save', async () => (await loadMocks()).save())
vi.mock('@/src/lib/accessibility-focus', async () =>
  (await loadMocks()).accessibilityFocusHandles()
)
vi.mock('../modules/accessibility-focus', async () =>
  (await loadMocks()).accessibilityFocusModule()
)
vi.mock('react-native', async (original) =>
  (await loadMocks()).reactNative(await original<typeof ReactNativeModule>())
)
import { Harness, installComposerHooks, ready } from './share-card-composer.test-support'
import { liveFontMarkerPlacement } from '@/src/test-utils/edge-to-edge-modal'

installComposerHooks()

// Story 6.15 review P3-1, with the real EdgeToEdgeModal (the lifecycle suite mocks it): the
// composer's sheet sets accessibilityViewIsModal, which on iOS hides every other view from the
// XCUITest hierarchy, so the modal's live-font marker must sit inside the sheet.
describe('share-card composer live-font marker', () => {
  it('puts the marker inside the sheet that is the accessibility modal', async () => {
    render(<Harness />)
    await ready()
    expect(liveFontMarkerPlacement().markerInside).toBe(true)
  })
})
