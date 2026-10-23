/* eslint-disable @typescript-eslint/await-thenable */
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
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: vi.fn(),
    getDistinctId: () => 'test-user-id',
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))
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

  it('loads the ritual once the restored session identity is ready', async () => {
    await render(
      <AccessibilityAnnouncerProvider>
        <TabOneScreen />
      </AccessibilityAnnouncerProvider>
    )
    await screen.findByTestId('hero-error-state')
    // Session restore completes after the first load already failed.
    await act(async () => {
      token = 'restored-token'
      setMobileApplicationUserId('restored-member')
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByText('Classic Trench Coat')).toBeTruthy())
    expect(screen.queryByTestId('hero-error-state')).toBeNull()
  })
})
