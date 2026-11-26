// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Home on a shared device: member A loads today's ritual, then member B signs in within the
// 15-minute cache window. The identity reload must fetch B's ritual. A's cached location,
// outfit and alert data are A's personal data and must never render for B.
import type * as FocusEffectModule from '@/src/test-utils/focus-effect'
import React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'
import TabOneScreen from '@/app/(tabs)/index'
import {
  mobileApplicationUserId,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import { notifyWardrobeChanged } from '@/src/lib/wardrobe-changes'
import i18n, { initI18n } from '@/src/lib/i18n'
import { noLocationResponse } from '@/src/test-utils/locations'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import { createSavedLooksMswHandlers } from '@/src/test-utils/saved-looks-msw'
import { SaveFeedbackProvider } from '@/components/save-feedback'

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
    const { handlers: savedLooksHandlers } = createSavedLooksMswHandlers()
    server.use(
      http.get('*/api/v1/ritual', ({ request }) => {
        const isMemberB = request.headers.get('Authorization') === 'Bearer token-b'
        ritualRequestsBy.push(isMemberB ? 'member-b' : 'member-a')
        return HttpResponse.json(isMemberB ? memberBRitual : mockRitualResponse)
      }),
      ...savedLooksHandlers
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

  it.each([
    {
      status: 400,
      message: 'No location preferences found for user',
      action: 'hero-add-location',
    },
    { status: 503, message: 'Unavailable', action: 'hero-retry' },
  ])(
    'shows only member B’s recovery action after a $status ritual response',
    async ({ status, message, action }) => {
      setMobileApplicationUserId('member-a')
      await render(<TabOneScreen />)
      await waitFor(() => {
        expect(screen.getByTestId('current-temperature').textContent).toBe('70°F')
      })
      server.use(
        http.get('*/api/v1/ritual', () => HttpResponse.json({ message }, { status }))
      )

      act(() => setMobileApplicationUserId('member-b'))
      expect(screen.queryByTestId('current-temperature')).toBeNull()
      await waitFor(() => expect(screen.getByTestId(action)).toBeVisible())
      await waitFor(() =>
        expect(screen.getByTestId('member-sample-outfit')).toBeVisible()
      )
      expect(screen.queryByTestId('weather-header')).toBeNull()
    }
  )

  it('restores an edited sample only for the member who saved it on this device', async () => {
    server.use(http.get('*/api/v1/ritual', noLocationResponse))
    setMobileApplicationUserId('member-a')
    const home = await render(<TabOneScreen />)
    const savedLookId = 'sample-open-sample:l:office-oxford'

    await userEvent.click(await screen.findByTestId('guest-preview-swap-shoes'))
    await userEvent.click(
      await screen.findByTestId('guest-preview-swap-option-white-sneakers')
    )
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-garment-white-sneakers')).toBeVisible()
    )
    await userEvent.click(await screen.findByTestId('sample-save-look'))
    await waitFor(() => expect(screen.getByTestId(savedLookId)).toBeVisible())

    act(() => setMobileApplicationUserId('member-b'))
    await waitFor(() => expect(screen.getByTestId('sample-save-look')).toBeVisible())
    expect(screen.queryByTestId('sample-saved-looks')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-garment-loafers')).toBeVisible()
    )

    act(() => setMobileApplicationUserId('member-a'))
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-garment-loafers')).toBeVisible()
    )
    await userEvent.click(await screen.findByTestId(savedLookId))
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-garment-white-sneakers')).toBeVisible()
    )
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-undo-swaps')).toBeVisible()
    )

    await userEvent.click(screen.getByTestId('sample-remove-sample:l:office-oxford'))
    await waitFor(() => expect(screen.queryByTestId('sample-saved-looks')).toBeNull())
    await home.unmount()
    await render(<TabOneScreen />)
    await waitFor(() => expect(screen.getByTestId('sample-save-look')).toBeVisible())
    expect(screen.queryByTestId('sample-saved-looks')).toBeNull()
  })

  it('shows retryable failure after removing a saved sample fails and succeeds on retry', async () => {
    const { store, handlers } = createSavedLooksMswHandlers()
    server.use(http.get('*/api/v1/ritual', noLocationResponse), ...handlers)
    setMobileApplicationUserId('member-a')
    await render(
      <SaveFeedbackProvider>
        <TabOneScreen />
      </SaveFeedbackProvider>
    )
    const save = await screen.findByTestId('sample-save-look')
    await userEvent.click(save)
    const remove = await screen.findByTestId('sample-remove-sample:l:office-oxford')
    expect(store.items).toHaveLength(1)

    let failOnce = true
    store.nextDeleteError = () => {
      if (!failOnce) return null
      failOnce = false
      return HttpResponse.json({ message: 'Server unavailable' }, { status: 503 })
    }
    await userEvent.click(remove)
    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent(
      'Could not save. Try again.'
    )
    expect(store.items).toHaveLength(1)

    await userEvent.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() => expect(screen.queryByTestId('sample-saved-looks')).toBeNull())
    expect(store.items).toHaveLength(0)

    // Committed DELETE with lost response: Retry hits 404 and reconciles cleanly without affecting other looks.
    await userEvent.click(screen.getByTestId('sample-save-look'))
    await screen.findByTestId('sample-remove-sample:l:office-oxford')
    expect(store.items).toHaveLength(1)
    let simulateLostDeleteResponse = true
    store.onDelete = (_request, id) => {
      if (!simulateLostDeleteResponse) return
      simulateLostDeleteResponse = false
      const target = store.items.find((item) => item.id === id)
      if (target) {
        store.deletedItems.set(id, { ...target, revision: target.revision + 1 })
        store.items = store.items.filter((item) => item.id !== id)
      }
      store.nextDeleteError = () => {
        store.nextDeleteError = undefined
        return HttpResponse.json({ message: 'Response lost' }, { status: 503 })
      }
    }
    await userEvent.click(screen.getByTestId('sample-remove-sample:l:office-oxford'))
    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent(
      'Could not save. Try again.'
    )
    expect(store.items).toHaveLength(0)
    await userEvent.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() => expect(screen.queryByTestId('sample-saved-looks')).toBeNull())
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

  it('refetches the mounted Home after a garment is confirmed', async () => {
    setMobileApplicationUserId('member-a')
    await render(<TabOneScreen />)
    await waitFor(() => expect(screen.getByTestId('current-temperature')).toBeVisible())
    const reads = ritualRequestsBy.length

    act(() => notifyWardrobeChanged())

    await waitFor(() => expect(ritualRequestsBy).toHaveLength(reads + 1))
    await waitFor(() => expect(screen.getByTestId('current-temperature')).toBeVisible())
  })
})
