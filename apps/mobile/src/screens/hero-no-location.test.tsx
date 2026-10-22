/* eslint-disable @typescript-eslint/await-thenable */
// Home without a saved location: GET /ritual answers 400 "No location preferences found for
// user". That is a setup gap, so Home shows a localized hint with no Retry (retrying cannot
// succeed). Every other failure keeps the generic load error and its Retry.
import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
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
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: vi.fn(),
    getDistinctId: () => 'test-user-id',
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))

// The API's Nest error envelope for a user with no saved location.
function answerRitualWith(status: number, message: string) {
  server.use(
    http.get('*/api/v1/ritual', () =>
      HttpResponse.json({ message, error: 'Bad Request', statusCode: status }, { status })
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
      answerRitualWith(400, 'No location preferences found for user')

      await render(<TabOneScreen />)

      await waitFor(() => {
        expect(screen.getByTestId('hero-no-location-state')).toBeTruthy()
      })
      expect(screen.getByText(hint)).toBeTruthy()
      expect(screen.queryByTestId('hero-error-state')).toBeNull()
      expect(screen.queryByRole('button', { name: i18n.t('hero.retry') })).toBeNull()
      expect(screen.queryByText(i18n.t('hero.load_error'))).toBeNull()
    }
  )

  it('6.5-MOB-POLISH-05 keeps the generic load error and Retry for any other 400', async () => {
    answerRitualWith(400, 'Invalid locale')

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
})
