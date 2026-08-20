import type { RitualService } from '../../../../apps/api/src/modules/personalization/ritual.service'
import type { UserService } from '../../../../apps/api/src/modules/user/user.service'

/**
 * Provider doubles for the ritual surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createRitualDoubles() {
  // Story 2.3 Task 3 step 2 owner: update provider mock responses
  const mockRitualService = {
    getOrCreateRitual: (
      _userId: string,
      _locationId?: string,
      acceptLanguage?: string,
      localeOverride?: string
    ) => {
      const selectedLocale = localeOverride ?? acceptLanguage
      const isTurkish = selectedLocale?.toLowerCase().startsWith('tr') ?? false
      const outfits = isTurkish
        ? [
            {
              id: 'rec-morning-1',
              scenario: 'morning',
              garmentIds: ['g-1'],
              reasoningBadges: [
                {
                  key: 'wind_layer',
                  label: 'Rüzgarlık',
                  bullets: ['Yüksek rüzgar nedeniyle rüzgar kesici bir katman önerilir'],
                },
              ],
              comfortNotes: 'Hafif rüzgarlı serin sabah. Trençkot önerilir.',
              shopThisLook: null,
            },
            {
              id: 'rec-midday-1',
              scenario: 'midday',
              garmentIds: ['g-2'],
              reasoningBadges: [
                { key: 'light_layers', label: 'Hafif Katmanlar', bullets: ['Ilık gün'] },
              ],
              comfortNotes: 'Ilık ve keyifli bir öğleden sonra.',
              shopThisLook: null,
            },
            {
              id: 'rec-evening-1',
              scenario: 'evening',
              garmentIds: ['g-3'],
              reasoningBadges: [
                {
                  key: 'evening_chill',
                  label: 'Akşam Serinliği',
                  bullets: ['Serin akşam'],
                },
              ],
              comfortNotes: 'Serin akşam.',
              shopThisLook: null,
            },
          ]
        : [
            {
              id: 'rec-morning-1',
              scenario: 'morning',
              garmentIds: ['g-1'],
              reasoningBadges: [
                { key: 'wind_layer', label: 'Wind layer', bullets: ['Wind is high'] },
              ],
              comfortNotes: 'Chilly morning',
              shopThisLook: null,
            },
            {
              id: 'rec-midday-1',
              scenario: 'midday',
              garmentIds: ['g-2'],
              reasoningBadges: [
                { key: 'light_layers', label: 'Light layers', bullets: ['Mild day'] },
              ],
              comfortNotes: 'Pleasant midday',
              shopThisLook: null,
            },
            {
              id: 'rec-evening-1',
              scenario: 'evening',
              garmentIds: ['g-3'],
              reasoningBadges: [
                {
                  key: 'evening_chill',
                  label: 'Evening chill',
                  bullets: ['Cool evening'],
                },
              ],
              comfortNotes: 'Cool evening',
              shopThisLook: null,
            },
          ]

      const badges = isTurkish ? ['Rüzgarlık'] : ['Wind layer', 'Mild', 'Evening']

      return Promise.resolve({
        weather: {
          locationKey: 'chicago-il',
          latitude: 41.878,
          longitude: -87.63,
          timezone: 'America/Chicago',
          provider: 'weatherapi',
          providerUpdatedAt: '2026-07-16T12:00:00.000Z',
          fetchedAt: '2026-07-16T12:00:00.000Z',
          current: {
            temperature: 16,
            condition: 'clear',
          },
          hourly: Array.from({ length: 48 }, (_, i) => ({
            forecastAt: new Date(
              new Date('2026-07-16T12:00:00.000Z').getTime() + i * 3600 * 1000
            ).toISOString(),
            temperature: 16,
            feelsLike: 15,
            precipitationProbability: 0.1,
            precipitationAmount: 0.0,
            windSpeed: 5.0,
            windGust: null,
            condition: 'clear',
            providerWeatherCode: '1000',
          })),
          alerts: [],
        },
        outfits,
        badges,
      })
    },
  } as unknown as RitualService

  const mockComfortService = {
    getComfortPreferences: (_userId: string) => {
      return Promise.resolve({
        runsColdWarm: 'neutral',
        windTolerance: 'medium',
        precipPreparedness: 'medium',
      })
    },
    updateComfortPreferences: (
      _userId: string,
      input: {
        runsColdWarm: 'cold' | 'neutral' | 'warm'
        windTolerance: 'low' | 'medium' | 'high'
        precipPreparedness: 'low' | 'medium' | 'high'
      }
    ) => {
      return Promise.resolve({
        runsColdWarm: input.runsColdWarm,
        windTolerance: input.windTolerance,
        precipPreparedness: input.precipPreparedness,
      })
    },
  }

  const mockUserService = {
    updatePreferences: (_userId: string, _input: { locale: string }) =>
      Promise.resolve({ success: true }),
  } as unknown as UserService

  return { mockRitualService, mockComfortService, mockUserService }
}
