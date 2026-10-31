/**
 * Story 6.9 V4: the composer loads analytics with a dynamic import after a share settles and
 * checks the identity again once it resolves. The gated mock factory runs once per file, on
 * the first import, which is why this case has a file of its own.
 */
import type * as ReactNativeModule from 'react-native'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/src/lib/i18n'
const analyticsLoad = vi.hoisted(() => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  return { requested: false, ready, release }
})
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
// The SDK module stays loading until the test releases it, so an identity change can land
// between the composer's first identity check and the one inside the deferred import.
vi.mock('@/src/analytics/mobile-analytics', async () => {
  analyticsLoad.requested = true
  await analyticsLoad.ready
  return (await loadMocks()).analytics()
})
vi.mock('expo-file-system/legacy', async () => (await loadMocks()).fileSystem())
vi.mock('expo-crypto', async () => (await loadMocks()).crypto())
vi.mock('@/src/lib/share-card-save', async () => (await loadMocks()).save())
vi.mock('@/src/lib/accessibility-focus', async () =>
  (await loadMocks()).accessibilityFocusHandles()
)
vi.mock('../modules/accessibility-focus', async () =>
  (await loadMocks()).accessibilityFocusModule()
)
vi.mock('./edge-to-edge-modal', async () => (await loadMocks()).modal())
vi.mock('react-native', async (original) =>
  (await loadMocks()).reactNative(await original<typeof ReactNativeModule>())
)
import {
  boundary,
  changeIdentity,
  installComposerHooks,
  ready,
  readyShare,
  settledEvent,
  settleShareAttempt,
  tapShare,
} from './share-card-composer.test-support'

installComposerHooks()

describe('Story 6.9 composer share analytics', () => {
  it('C-COMP-SHARE-IDENTITY: an identity change while analytics loads records no event', async () => {
    await readyShare()
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
    // The attempt passed the first identity check and is waiting on the SDK module.
    await waitFor(() => expect(analyticsLoad.requested).toBe(true))
    changeIdentity('member-b')
    analyticsLoad.release()
    await settleShareAttempt()
    expect(boundary.capture).not.toHaveBeenCalled()
    // Control: with the module loaded, the new member's own share records once.
    await ready()
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    await tapShare()
    await settledEvent({ client: 'ios', target: 'instagram', outcome: 'completed' })
  })
})
