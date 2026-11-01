// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Home on a shared device: member A loads today's ritual, then member B signs in within the
// 15-minute cache window. The identity reload must fetch B's ritual. A's cached location,
// outfit and alert data are A's personal data and must never render for B.
import type * as FocusEffectModule from '@/src/test-utils/focus-effect'
import React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import TabOneScreen from '@/app/(tabs)/index'
import {
  mobileApplicationUserId,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: vi.fn() }),
  useFocusEffect: (
    await vi.importActual<typeof FocusEffectModule>('@/src/test-utils/focus-effect')
  ).useFocusEffect,
}))

// One analytics identity for the device, whoever is signed in: the cache must not key on it.
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock({
    getDistinctId: () => 'shared-device-distinct-id',
  })
)

// Member B lives somewhere 10°C (50°F); member A's mock ritual is 21°C (70°F).
const memberBRitual = {
  ...mockRitualResponse,
  data: {
    ...mockRitualResponse.data,
    weather: {
      ...mockRitualResponse.data.weather,
      locationKey: 'member-b-location',
      current: { ...mockRitualResponse.data.weather.current, temperature: 10 },
    },
  },
}

describe('TabOneScreen identity change on a shared device', () => {
  let restoreAccessTokenResolver: (() => void) | undefined
  const ritualRequestsBy: string[] = []

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
  })

  beforeEach(async () => {
    // Reset after the auto-cleanup unmounted the previous screen; changing identity while a
    // screen is mounted reloads it and leaks a request into this test.
    setMobileApplicationUserId(null)
    ritualRequestsBy.length = 0
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() =>
      mobileApplicationUserId() === 'member-b' ? 'token-b' : 'token-a'
    )
    server.use(
      http.get('*/api/v1/ritual', ({ request }) => {
        const isMemberB = request.headers.get('Authorization') === 'Bearer token-b'
        ritualRequestsBy.push(isMemberB ? 'member-b' : 'member-a')
        return HttpResponse.json(isMemberB ? memberBRitual : mockRitualResponse)
      })
    )
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it('6.5-MOB-HERO-ID-01 fetches and renders member B after B signs in, never A’s cached ritual', async () => {
    setMobileApplicationUserId('member-a')
    await render(<TabOneScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('current-temperature').textContent).toBe('70°F')
    })
    const requestsBeforeSwitch = ritualRequestsBy.length

    act(() => {
      setMobileApplicationUserId('member-b')
    })

    await waitFor(() => {
      expect(screen.getByTestId('current-temperature').textContent).toBe('50°F')
    })
    expect(ritualRequestsBy.slice(requestsBeforeSwitch)).toContain('member-b')
    expect(ritualRequestsBy.slice(requestsBeforeSwitch)).not.toContain('member-a')
  })

  it('6.5-MOB-HERO-ID-03 never stores a member ritual under the signed-out owner on a cold start', async () => {
    // R9-1 on Home: the first load starts before the stored session restores, so the
    // render-time owner is signed-out, and the token resolver restores member A mid-load.
    // A's ritual must land under A's key only; the signed-out bucket is what a signed-out
    // Home or another member's first load reads.
    setMobileAccessTokenResolver(() => {
      setMobileApplicationUserId('member-a')
      return 'token-a'
    })

    await render(<TabOneScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('current-temperature').textContent).toBe('70°F')
    })
    await waitFor(() => {
      expect(
        Object.keys(localStorage).some((key) => key.startsWith('ritual:member:member-a:'))
      ).toBe(true)
    })

    expect(
      Object.keys(localStorage).filter((key) => key.startsWith('ritual:signed-out:'))
    ).toEqual([])
  })

  it('6.5-MOB-HERO-ID-02 still serves a member their own ritual from the cache', async () => {
    setMobileApplicationUserId('member-a')
    const first = await render(<TabOneScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('current-temperature').textContent).toBe('70°F')
    })
    await first.unmount()
    const requestsBeforeRemount = ritualRequestsBy.length

    await render(<TabOneScreen />)
    await waitFor(() => {
      expect(screen.getByTestId('current-temperature').textContent).toBe('70°F')
    })
    expect(ritualRequestsBy.length).toBe(requestsBeforeRemount)
  })
})
