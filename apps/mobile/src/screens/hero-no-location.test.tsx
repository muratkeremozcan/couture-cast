// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
/* eslint-disable @typescript-eslint/await-thenable */
// Home without a saved location: GET /ritual answers 400 "No location preferences found for
// user". That is a setup gap, so Home shows a localized hint with no Retry (retrying cannot
// succeed). Every other failure keeps the generic load error and its Retry.
import type * as FocusEffectModule from '@/src/test-utils/focus-effect'
import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import TabOneScreen from '@/app/(tabs)/index'
import deDE from '@/assets/locales/de-DE.json'
import enCA from '@/assets/locales/en-CA.json'
import enUS from '@/assets/locales/en-US.json'
import es419 from '@/assets/locales/es-419.json'
import frCA from '@/assets/locales/fr-CA.json'
import frFR from '@/assets/locales/fr-FR.json'
import itIT from '@/assets/locales/it-IT.json'
import ptBR from '@/assets/locales/pt-BR.json'
import ptPT from '@/assets/locales/pt-PT.json'
import trTR from '@/assets/locales/tr-TR.json'
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
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: routerPush }),
  useFocusEffect: (
    await vi.importActual<typeof FocusEffectModule>('@/src/test-utils/focus-effect')
  ).useFocusEffect,
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: vi.fn(),
    getDistinctId: () => 'test-user-id',
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))

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
    ['en-US', 'Add your location to get daily outfits'],
    ['fr-FR', 'Ajoutez votre position pour recevoir vos tenues du jour'],
  ])(
    '6.5-MOB-POLISH-04 shows the localized add-location hint without Retry in %s',
    async (locale, hint) => {
      await i18n.changeLanguage(locale)
      answerRitualWithNoLocation()

      await render(<TabOneScreen />)

      await waitFor(() => {
        expect(screen.getByTestId('hero-no-location-state')).toBeTruthy()
      })
      expect(screen.getByText(hint)).toBeTruthy()
      expect(screen.queryByTestId('hero-error-state')).toBeNull()
      expect(screen.queryByRole('button', { name: i18n.t('hero.retry') })).toBeNull()
      expect(
        screen.getByRole('button', { name: i18n.t('locations.guided.add') })
      ).toBeTruthy()
      expect(screen.queryByText(i18n.t('hero.load_error'))).toBeNull()
    }
  )

  it('6.5-MOB-POLISH-05 keeps the generic load error and Retry for any other 400', async () => {
    answerRitualWithBadRequest('Invalid locale')

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('hero-error-state')).toBeTruthy()
    })
    expect(screen.getByText('Unable to load daily recommendations')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByTestId('hero-no-location-state')).toBeNull()
  })

  it('6.5-MOB-POLISH-06 defines the add-location hint in all 10 catalogs', () => {
    const catalogs = { deDE, enCA, enUS, es419, frCA, frFR, itIT, ptBR, ptPT, trTR }
    for (const [name, catalog] of Object.entries(catalogs)) {
      expect(
        (catalog.hero as { no_location?: unknown }).no_location,
        `${name} hero.no_location`
      ).toEqual(expect.any(String))
    }
  })

  it('1.2b-MOB-HERO-01 opens the guided add-location screen from the no-location state', async () => {
    answerRitualWithNoLocation()

    await render(<TabOneScreen />)

    const action = await screen.findByTestId('hero-add-location')
    expect(action.textContent).toBe('Add a location')
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
    await screen.findByTestId('hero-no-location-state')

    await saveLocationFromSearchFromMobile('candidate.signature', 'Home')

    await waitFor(() => {
      expect(screen.getByTestId('outfit-recommendation-card')).toBeTruthy()
    })
    expect(screen.queryByTestId('hero-no-location-state')).toBeNull()
  })

  it.each([
    [
      'deleting the last location answers no-location',
      () => deleteLocationFromMobile('loc-1'),
      noLocationResponse,
      'hero-no-location-state',
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
      'hero-error-state',
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
