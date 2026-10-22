// Weather alert banner localization: known alert categories render a localized title, a
// description that only restates the event renders a localized sentence, and provider
// free text (which the client cannot translate) stays as sent.
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WeatherAlert } from '@couture/api-client/contracts/http'
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
import i18n, { initI18n } from '@/src/lib/i18n'
import { WEATHER_ALERT_EVENTS, WeatherAlertBanner } from './weather-alert-banner'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const announcer = vi.hoisted(() => ({ announce: vi.fn() }))
vi.mock('@/src/hooks/use-accessibility-announcer', () => ({
  useAccessibilityAnnouncer: () => announcer,
}))

function alert(overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    event: 'winter-storm',
    description: 'winter-storm warning for local area',
    start: '2026-10-22T00:00:00.000Z',
    end: '2026-10-22T06:00:00.000Z',
    severity: 'high',
    ...overrides,
  }
}

describe('WeatherAlertBanner localization', () => {
  beforeAll(async () => {
    await initI18n()
  })

  afterEach(async () => {
    announcer.announce.mockClear()
    await i18n.changeLanguage('en-US')
  })

  it.each([
    ['en-US', 'Winter storm warning', 'A weather warning is in effect for your area.'],
    [
      'fr-FR',
      'Alerte tempête hivernale',
      'Une alerte météo est en vigueur dans votre zone.',
    ],
  ])(
    'localizes a known alert category and its restating description in %s',
    async (locale, title, body) => {
      await i18n.changeLanguage(locale)
      render(<WeatherAlertBanner alerts={[alert()]} />)

      expect(screen.getByText(title)).toBeTruthy()
      expect(screen.getByText(body)).toBeTruthy()
      expect(screen.queryByText('winter-storm')).toBeNull()
      expect(screen.getByTestId('weather-alert-banner').getAttribute('aria-label')).toBe(
        `${title}: ${body}`
      )
      expect(announcer.announce).toHaveBeenCalledWith('alert', `${title}: ${body}`)
    }
  )

  it('keeps provider free text, which the client cannot translate, as sent', () => {
    render(
      <WeatherAlertBanner
        alerts={[
          alert({
            event: 'Severe Wind Advisory',
            description: 'High winds expected up to 50mph.',
          }),
        ]}
      />
    )

    expect(screen.getByText('Severe Wind Advisory')).toBeTruthy()
    expect(screen.getByText('High winds expected up to 50mph.')).toBeTruthy()
  })

  it('humanizes an unknown category slug instead of showing it raw', () => {
    render(
      <WeatherAlertBanner
        alerts={[alert({ event: 'dust-storm', description: 'dust-storm warning' })]}
      />
    )

    expect(screen.getByText('Dust storm')).toBeTruthy()
    expect(screen.getByText('A weather warning is in effect for your area.')).toBeTruthy()
  })

  it('defines every alert string in all 10 catalogs', () => {
    const catalogs = { deDE, enCA, enUS, es419, frCA, frFR, itIT, ptBR, ptPT, trTR }
    for (const [name, catalog] of Object.entries(catalogs)) {
      const alertStrings = (catalog.hero as { alert?: Record<string, unknown> }).alert
      expect(alertStrings?.body_generic, `${name} body_generic`).toEqual(
        expect.any(String)
      )
      for (const event of WEATHER_ALERT_EVENTS) {
        expect(
          (alertStrings?.events as Record<string, unknown> | undefined)?.[event],
          `${name} events.${event}`
        ).toEqual(expect.any(String))
      }
    }
  })
})
