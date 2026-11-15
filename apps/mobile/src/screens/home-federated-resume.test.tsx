// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA sign-off: M-RESUME and L-G-FOCUS (D3, D6). A Google identity that left the
// finish step returns to it from Home, and only while Home is focused: a Home left mounted under
// a pushed screen never navigates (the 6.16 stacked-screen rule).
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import type * as NativeSessionModule from '@/src/lib/native-session'
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import React from 'react'
import { act, configure, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({
  router: { setParams: vi.fn(), push: vi.fn() },
  resume: vi.fn<() => Promise<string | null>>(),
}))

vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => nav.router,
  // Imported, not importActual'd, so the screen and `screenFocus` share one module instance.
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('@/src/lib/native-session', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeSessionModule>()),
  federatedFinishResumeHref: nav.resume,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock()
)
vi.mock('@/src/lib/ritual-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof RitualCacheModule>()
  return {
    withoutShopThisLook: actual.withoutShopThisLook,
    ritualCacheOwner: actual.ritualCacheOwner,
    readLatestRitualCache: vi.fn().mockResolvedValue(null),
    saveRitualCache: vi.fn().mockResolvedValue(undefined),
    clearRitualMemoryCache: () => undefined,
    forgetLatestRitual: vi.fn().mockResolvedValue(undefined),
  }
})

import TabOneScreen from '@/app/(tabs)/index'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { drainMacrotask } from '@/src/test-utils/drain-macrotask'

const renderHome = () =>
  render(
    <AccessibilityAnnouncerProvider>
      <TabOneScreen />
    </AccessibilityAnnouncerProvider>
  )

describe('M-RESUME and L-G-FOCUS: Home returns a waiting Google identity to the finish step', () => {
  let restore: (() => void) | undefined
  let token: string | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
  })
  beforeEach(async () => {
    token = undefined
    restore = setMobileAccessTokenResolver(() => token)
    setMobileApplicationUserId(null)
    screenFocus.reset()
    nav.router.push.mockReset()
    nav.resume.mockReset().mockResolvedValue('/signup-finish?from=preview')
    await i18n.changeLanguage('en-US')
  })
  afterEach(() => {
    restore?.()
    setMobileApplicationUserId(null)
    screenFocus.reset()
  })

  it('M-RESUME: a signed-out, focused Home pushes the finish step the marker names', async () => {
    await renderHome()
    await screen.findByTestId('home-signed-out-welcome')
    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith('/signup-finish?from=preview')
    )
    expect(nav.router.push).toHaveBeenCalledTimes(1)
  })

  it('L-G-FOCUS: an unfocused Home never navigates, and resumes once it is focused again', async () => {
    screenFocus.set(false)
    await renderHome()
    await screen.findByTestId('home-signed-out-welcome')
    await drainMacrotask()
    await drainMacrotask()
    expect(nav.resume).not.toHaveBeenCalled()
    expect(nav.router.push).not.toHaveBeenCalled()
    act(() => screenFocus.set(true))
    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith('/signup-finish?from=preview')
    )
  })

  it('L-G-FOCUS: a resume answering after Home lost focus does not navigate', async () => {
    let answer: (href: string | null) => void = () => undefined
    nav.resume.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          answer = resolve
        })
    )
    await renderHome()
    await screen.findByTestId('home-signed-out-welcome')
    await waitFor(() => expect(nav.resume).toHaveBeenCalledTimes(1))
    act(() => screenFocus.set(false))
    await act(async () => {
      answer('/signup-finish')
      await drainMacrotask()
    })
    expect(nav.router.push).not.toHaveBeenCalled()
  })

  it('M-RESUME: no marker, no navigation', async () => {
    nav.resume.mockResolvedValue(null)
    await renderHome()
    await screen.findByTestId('home-signed-out-welcome')
    await waitFor(() => expect(nav.resume).toHaveBeenCalled())
    await drainMacrotask()
    expect(nav.router.push).not.toHaveBeenCalled()
  })

  it('M-RESUME: a member Home never asks to resume', async () => {
    token = 'member-token'
    setMobileApplicationUserId('app-member')
    await renderHome()
    await drainMacrotask()
    await drainMacrotask()
    expect(nav.resume).not.toHaveBeenCalled()
    expect(nav.router.push).not.toHaveBeenCalledWith(
      expect.stringContaining('/signup-finish')
    )
  })
})
