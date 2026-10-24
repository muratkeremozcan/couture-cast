/* eslint-disable @typescript-eslint/await-thenable */
import { CommunitySyncState } from '@couture/api-client'
import type * as ReactNativeModule from 'react-native'
// Keep mock registration in the test entrypoint so it precedes every case import.
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn().mockResolvedValue(undefined) }))
// Passthrough spies keep community requests on the real HTTP boundary.
vi.mock('@/src/lib/community', { spy: true })
vi.mock('expo-router', async () => {
  const { routing } = await import('../test-utils/community-screen/mock-state.js')
  const { useFocusEffect } = await import('../test-utils/focus-effect.js')
  return {
    useLocalSearchParams: () => routing.params,
    useRouter: () => routing.router,
    useFocusEffect,
  }
})
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/analytics/mobile-analytics', async () => {
  const { mockAnalytics } = await import('../test-utils/community-screen/mock-state.js')
  return {
    useMobileAnalytics: () => mockAnalytics,
    MobileAnalyticsDiagnosticsPanel: () => null,
  }
})
vi.mock('expo-web-browser', async () => {
  const { webBrowser } = await import('../test-utils/community-screen/mock-state.js')
  return webBrowser
})
vi.mock('expo-image-picker', async () => {
  const { imagePicker } = await import('../test-utils/community-screen/mock-state.js')
  return imagePicker
})
vi.mock('expo-image-manipulator', async () => {
  const { imageManipulator } = await import(
    '../test-utils/community-screen/mock-state.js'
  )
  return {
    manipulateAsync: imageManipulator.manipulateAsync,
    SaveFormat: { JPEG: 'jpeg' },
  }
})
vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    bytes() {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]))
    }
  },
  Paths: { cache: 'file:///cache/' },
}))
vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))
// Retain the real RNW Image and record native onError, which DOM errors cannot reach.
vi.mock('react-native', async (importOriginal) => {
  const { imageEvents, refreshEvents } = await import(
    '../test-utils/community-screen/mock-state.js'
  )
  const actual = await importOriginal<typeof ReactNativeModule>()
  function RecordingImage(props: Record<string, unknown>) {
    if (typeof props.testID === 'string' && typeof props.onError === 'function') {
      imageEvents.errors.set(props.testID, props.onError as () => void)
    }
    return imageEvents.createElement(actual.Image as never, props)
  }
  function RecordingRefreshControl(props: Record<string, unknown>) {
    refreshEvents.onRefresh = props.onRefresh as () => void
    return imageEvents.createElement(actual.RefreshControl as never, props)
  }
  return {
    ...actual,
    Image: RecordingImage,
    RefreshControl: RecordingRefreshControl,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: vi.fn(),
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
  }
})

import {
  imagePicker,
  imageManipulator,
  imageEvents,
  feedJson,
  serveFeed,
  setMockParams,
  resetFeedUrls,
} from '../test-utils/community-screen/harness'
import { registerCommunityFeedCases } from '../test-utils/community-screen/feed.cases'
import { registerCommunityModerationCases } from '../test-utils/community-screen/moderation.cases'
import { registerCommunityPublishingCases } from '../test-utils/community-screen/publishing.cases'
import { registerCommunityReactionsCases } from '../test-utils/community-screen/reactions.cases'
import { registerCommunityRealtimeCases } from '../test-utils/community-screen/realtime.cases'
import { registerCommunityAvailabilityRestoreCases } from '../test-utils/community-screen/availability-restore.cases'
import { registerCommunityNotificationRecoveryCases } from '../test-utils/community-screen/notification-recovery.cases'
import { registerCommunityClientCases } from '../test-utils/community-screen/client.cases'
import { registerCommunitySpotlightCases } from '../test-utils/community-screen/spotlight.cases'
import { registerCommunitySpotlightReviewCases } from '../test-utils/community-screen/spotlight-review.cases'
import { registerCommunitySpotlightFocusCases } from '../test-utils/community-screen/spotlight-focus.cases'
import { registerCommunitySponsoredCases } from '../test-utils/community-screen/sponsored.cases'
import { refreshEvents } from '../test-utils/community-screen/mock-state'
import { screenFocus } from '../test-utils/focus-effect'
import { configure } from '@testing-library/react'
import { delay } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, vi } from 'vitest'
import { Platform } from 'react-native'
import i18n, { initI18n } from '@/src/lib/i18n'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'

describe('Mobile community screen (Story 6.1)', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    const apiBaseUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', apiBaseUrl)
    process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl
    // Every state here is one MSW service-worker round trip away, which can
    // outrun the 1000ms default on a loaded runner.
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    // Legacy REST journeys retain their measured request sequence. Story 6.5 cases below
    // restore the real coordinator and exercise its HTTP bootstrap/reconciliation separately.
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
    setMockParams({})
    screenFocus.reset()
    imageEvents.errors.clear()
    refreshEvents.onRefresh = undefined
    resetFeedUrls()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///community-photo.jpg', width: 1200, height: 1200 }],
    })
    imageManipulator.manipulateAsync.mockResolvedValue({
      uri: 'file:///prepared.jpg',
      width: 1200,
      height: 1200,
    })
    serveFeed(() => feedJson())
  })

  afterEach(async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    await i18n.changeLanguage('en-US')
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    // A test that publishes leaves one refresh read in flight, and MSW's service
    // worker can dispatch it to a handler a few milliseconds after the unmount
    // aborts it. Settling here keeps that request inside the test that caused it
    // rather than letting it land in the next test's request log.
    await delay(50)
  })

  registerCommunityFeedCases()
  registerCommunityModerationCases()
  registerCommunityPublishingCases()
  registerCommunityReactionsCases()
  registerCommunityRealtimeCases()
  registerCommunityAvailabilityRestoreCases()
  registerCommunityNotificationRecoveryCases()
  registerCommunitySpotlightCases()
  registerCommunitySpotlightReviewCases()
  registerCommunitySpotlightFocusCases()
  registerCommunitySponsoredCases()
})

/**
 * The client wrapper's own contract. Every one of these reasons reaches the screen as a
 * different translated string, and the mapping from an HTTP outcome onto a
 * `CommunityFailureReason` is where the SDK's untranslated wording used to leak.
 */
describe('mobile community client (Story 6.1)', () => {
  registerCommunityClientCases()
})
