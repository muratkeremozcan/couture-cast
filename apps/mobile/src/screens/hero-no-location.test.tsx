// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
// Home without a saved location: GET /ritual answers 400 "No location preferences found for
// user". Home presents a labeled sample and a localized city setup action. A transient
// or unexpected failure presents a separate recovery action.
import type * as FocusEffectModule from '@/src/test-utils/focus-effect'
import React from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { GUEST_PREVIEW_LOCALES, GUEST_PREVIEW_STRINGS } from '@couture/utils'
import TabOneScreen from '@/app/(tabs)/index'
import {
  deleteLocationFromMobile,
  saveLocationFromSearchFromMobile,
  setPrimaryLocationFromMobile,
} from '@/src/lib/locations'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  noLocationEnvelope,
  noLocationResponse,
  officeLocation,
  savedLocation,
} from '@/src/test-utils/locations'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import { server } from '@/src/test-utils/msw/server'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('expo-router', async () => ({
  router: { push: routerPush },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: routerPush }),
  useFocusEffect: (
    await vi.importActual<typeof FocusEffectModule>('@/src/test-utils/focus-effect')
  ).useFocusEffect,
}))

vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock()
)

function answerRitualWithNoLocation() {
  server.use(http.get('*/api/v1/ritual', noLocationResponse))
}

// The same Nest 400 envelope with any other message.
function answerRitualWithBadRequest(message: string) {
  server.use(
    http.get('*/api/v1/ritual', () =>
      HttpResponse.json({ ...noLocationEnvelope(), message }, { status: 400 })
    )
  )
}

describe('TabOneScreen without a saved location', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
  })

  beforeEach(async () => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it.each([
    ['en-US', 'Set your city'],
    ['fr-FR', 'Choisir ta ville'],
  ])(
    '6.5-MOB-POLISH-04 shows a labeled sample and localized city action without Retry in %s',
    async (locale, cityAction) => {
      await i18n.changeLanguage(locale)
      answerRitualWithNoLocation()

      await render(<TabOneScreen />)

      const city = await screen.findByRole('button', { name: cityAction })
      const sample = screen.getByTestId('member-sample-outfit')
      expect(within(sample).getByTestId('member-sample-label')).toBeVisible()
      expect(within(sample).getByTestId('home-set-city')).toBe(city)
      expect(screen.queryByTestId('hero-error-state')).toBeNull()
      expect(screen.queryByTestId('hero-retry')).toBeNull()
    }
  )

  it('6.5-MOB-POLISH-05 keeps the generic load error and Retry for any other 400', async () => {
    answerRitualWithBadRequest('Invalid locale')

    await render(<TabOneScreen />)

    const sample = await screen.findByTestId('member-sample-outfit')
    const retry = await within(sample).findByRole('button', { name: 'Try again' })
    expect(retry).toHaveAttribute('data-testid', 'hero-retry')
    expect(within(sample).getByTestId('home-set-city')).toBeVisible()
  })

  it('6.5-MOB-POLISH-06 defines the sample disclosure and city action in all 10 catalogs', () => {
    for (const locale of GUEST_PREVIEW_LOCALES) {
      expect(
        GUEST_PREVIEW_STRINGS[locale].firstUse.setCity.trim(),
        `${locale} city action`
      ).not.toBe('')
      expect(
        GUEST_PREVIEW_STRINGS[locale].chrome.sampleLabel.trim(),
        `${locale} disclosure`
      ).not.toBe('')
    }
  })

  it('1.2b-MOB-HERO-01 opens Locations from the no-location state', async () => {
    answerRitualWithNoLocation()

    await render(<TabOneScreen />)

    const action = await screen.findByTestId('home-set-city')
    expect(action).toHaveAccessibleName('Set your city')
    // WCAG 2.5.8 and the platform guidance: a 44pt minimum touch target.
    expect(action.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await userEvent.click(action)
    expect(routerPush).toHaveBeenCalledWith('/locations?guided=1')
  })

  it('1.2b-MOB-HERO-02 shows a ritual as soon as a location is saved, with no manual reload', async () => {
    let hasLocation = false
    server.use(
      http.get('*/api/v1/ritual', () =>
        hasLocation ? HttpResponse.json(mockRitualResponse) : noLocationResponse()
      ),
      http.post('*/api/v1/locations/from-search', () => {
        hasLocation = true
        return HttpResponse.json({ data: savedLocation() }, { status: 201 })
      })
    )

    await render(<TabOneScreen />)
    await screen.findByTestId('member-sample-outfit')

    await saveLocationFromSearchFromMobile('candidate.signature', 'Home')

    await screen.findByTestId('today-primary-action')
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()
  })

  it.each([
    [
      'deleting the last location answers no-location',
      () => deleteLocationFromMobile('loc-1'),
      noLocationResponse,
      'home-set-city',
    ],
    [
      'switching to a primary without weather answers unavailable',
      () => setPrimaryLocationFromMobile('loc-2'),
      () =>
        HttpResponse.json(
          {
            message: 'Weather unavailable',
            error: 'Service Unavailable',
            statusCode: 503,
          },
          { status: 503 }
        ),
      'hero-retry',
    ],
  ])(
    '1.2b-MOB-HERO-03 never restores the previous primary ritual after %s',
    async (_name, change, answerAfterChange, expectedState) => {
      let changed = false
      server.use(
        http.get('*/api/v1/ritual', () =>
          changed ? answerAfterChange() : HttpResponse.json(mockRitualResponse)
        ),
        http.delete('*/api/v1/locations/:locationId', () => {
          changed = true
          return HttpResponse.json({ data: { deleted: true } })
        }),
        http.post('*/api/v1/locations/:locationId/primary', () => {
          changed = true
          return HttpResponse.json({ data: officeLocation({ isPrimary: true }) })
        })
      )

      const first = await render(<TabOneScreen />)
      await screen.findByTestId('outfit-recommendation-card')

      await change()

      await waitFor(() => {
        expect(screen.getByTestId(expectedState)).toBeTruthy()
      })
      expect(screen.queryByTestId('outfit-recommendation-card')).toBeNull()
      expect(screen.queryByTestId('stale-cache-banner')).toBeNull()

      // A fresh mount inside the fifteen-minute window reads the device cache
      // first; the previous primary's ritual is gone from it too.
      await first.unmount()
      clearRitualMemoryCache()
      await render(<TabOneScreen />)
      await waitFor(() => {
        expect(screen.getByTestId(expectedState)).toBeTruthy()
      })
      expect(screen.queryByTestId('outfit-recommendation-card')).toBeNull()
    }
  )
})
