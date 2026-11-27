// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5: after a native cold start, Home's first load can run before the stored
// session is restored. It must load once the identity is ready rather than leave the
// "unable to load" state up for good.
import type * as FocusEffectModule from '@/src/test-utils/focus-effect'
import React from 'react'
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import { act, configure, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: vi.fn() }),
  useFocusEffect: (
    await vi.importActual<typeof FocusEffectModule>('@/src/test-utils/focus-effect')
  ).useFocusEffect,
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
    // Pure key derivation, not storage: kept real so the screen keys exactly as shipped.
    ritualCacheOwner: actual.ritualCacheOwner,
    readLatestRitualCache: vi.fn().mockResolvedValue(null),
    saveRitualCache: vi.fn().mockResolvedValue(undefined),
    clearRitualMemoryCache: () => undefined,
    forgetLatestRitual: vi.fn().mockResolvedValue(undefined),
  }
})

import TabOneScreen from '@/app/(tabs)/index'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'

describe('Home after a native cold start', () => {
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
    await i18n.changeLanguage('en-US')
    // The API refuses a request that carries no bearer, as it does before restore.
    server.use(
      http.get('*/api/v1/ritual', ({ request }) =>
        request.headers.get('authorization') === 'Bearer restored-token'
          ? HttpResponse.json(mockRitualResponse)
          : HttpResponse.json(
              { statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' },
              { status: 401 }
            )
      )
    )
  })
  afterEach(() => {
    restore?.()
    setMobileApplicationUserId(null)
  })

  // Story 6.16 D1: a signed-out launch shows the welcome card and sends no ritual
  // request; the restored identity then loads the ritual.
  it('loads the ritual once the restored session identity is ready', async () => {
    const ritualRequests: (string | null)[] = []
    server.use(
      http.get('*/api/v1/ritual', ({ request }) => {
        const authorization = request.headers.get('authorization')
        ritualRequests.push(authorization)
        return authorization === 'Bearer restored-token'
          ? HttpResponse.json(mockRitualResponse)
          : HttpResponse.json({ statusCode: 401 }, { status: 401 })
      })
    )
    await render(
      <AccessibilityAnnouncerProvider>
        <TabOneScreen />
      </AccessibilityAnnouncerProvider>
    )
    await screen.findByTestId('home-signed-out-welcome')
    expect(screen.queryByTestId('hero-error-state')).toBeNull()
    expect(ritualRequests).toEqual([])
    // Session restore completes after the first load already failed.
    await act(async () => {
      token = 'restored-token'
      setMobileApplicationUserId('restored-member')
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(screen.getByTestId('today-outfit-slot-0')).toHaveAccessibleName(
        /trench coat/i
      )
    )
    expect(screen.queryByTestId('hero-error-state')).toBeNull()
    expect(screen.queryByTestId('home-signed-out-welcome')).toBeNull()
    expect(ritualRequests).toEqual(['Bearer restored-token'])
  })

  // PR 249: the Android network-timeout flow now runs as a member, so the signed-out side of
  // Story 6.16 D1 is held here. On an API that never answers, a signed-out Home still shows the
  // welcome card and sends nothing, so no timeout and no error state can follow.
  it('a signed-out Home on a hung network shows the welcome card and sends no ritual request', async () => {
    let ritualRequests = 0
    server.use(
      http.get('*/api/v1/ritual', async () => {
        ritualRequests += 1
        await new Promise(() => undefined)
        return HttpResponse.json(mockRitualResponse)
      })
    )
    await render(
      <AccessibilityAnnouncerProvider>
        <TabOneScreen />
      </AccessibilityAnnouncerProvider>
    )
    await screen.findByTestId('home-signed-out-welcome')
    // Long enough for a ritual request sent on mount to reach the handler.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(ritualRequests).toBe(0)
    expect(screen.getByTestId('home-signed-out-welcome')).toBeTruthy()
    expect(screen.queryByTestId('weather-header-skeleton')).toBeNull()
    expect(screen.queryByTestId('hero-error-state')).toBeNull()
  })
})
