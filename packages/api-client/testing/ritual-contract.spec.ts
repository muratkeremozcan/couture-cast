import { describe, expect, it } from 'vitest'
import {
  ritualQueryParamsSchema,
  ritualResponseSchema,
  type ScenarioName,
} from '../src/contracts/http'

const weather = {
  locationKey: 'new-york-ny',
  latitude: 40.713,
  longitude: -74.006,
  timezone: 'America/New_York',
  provider: 'openweather',
  providerUpdatedAt: '2026-07-07T13:00:00.000Z',
  fetchedAt: '2026-07-07T13:30:00.000Z',
  current: { temperature: 21, condition: 'rain' },
  hourly: Array.from({ length: 48 }, (_, index) => ({
    forecastAt: new Date(Date.UTC(2026, 6, 7, index)).toISOString(),
    temperature: 21,
    feelsLike: 20,
    precipitationProbability: 0.25,
    precipitationAmount: 0.4,
    windSpeed: 4,
    windGust: null,
    condition: 'rain',
    providerWeatherCode: '500',
  })),
  alerts: [],
}

function buildOutfit(scenario: ScenarioName) {
  return {
    id: `outfit-${scenario}`,
    scenario,
    garmentIds: ['garment-1', 'garment-2'],
    reasoningBadges: [
      { key: 'rain_ready', label: 'Rain ready', bullets: ['Rain is likely at 8am.'] },
    ],
    comfortNotes: 'Layer up; it will feel cooler than it reads.',
    shopThisLook: null,
  }
}

function buildResponse(scenarios: ScenarioName[]) {
  return {
    data: {
      weather,
      outfits: scenarios.map(buildOutfit),
      badges: ['rain_ready'],
    },
  }
}

describe('ritual response outfits collection', () => {
  it('accepts exactly one outfit per scenario', () => {
    const parsed = ritualResponseSchema.parse(
      buildResponse(['morning', 'midday', 'evening'])
    )

    expect(parsed.data.outfits.map((outfit) => outfit.scenario)).toEqual([
      'morning',
      'midday',
      'evening',
    ])
  })

  it('accepts the three scenarios in any order', () => {
    expect(
      ritualResponseSchema.safeParse(buildResponse(['evening', 'morning', 'midday']))
        .success
    ).toBe(true)
  })

  // Consumers key their UI on scenario without deduplicating, so a repeated
  // scenario would silently drop one of the day's three recommendations.
  it('rejects a repeated scenario even when the count is three', () => {
    const result = ritualResponseSchema.safeParse(
      buildResponse(['morning', 'morning', 'evening'])
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'Outfits must cover three distinct scenarios (morning, midday, and evening).'
      )
    }
  })

  it('rejects fewer or more than three outfits', () => {
    expect(
      ritualResponseSchema.safeParse(buildResponse(['morning', 'midday'])).success
    ).toBe(false)
    expect(
      ritualResponseSchema.safeParse(
        buildResponse(['morning', 'midday', 'evening', 'morning'])
      ).success
    ).toBe(false)
  })

  it('rejects a scenario name outside the declared enum', () => {
    const payload = buildResponse(['morning', 'midday', 'evening'])
    const outfits = payload.data.outfits as Record<string, unknown>[]
    if (outfits[0]) {
      outfits[0].scenario = 'overnight'
    }

    expect(ritualResponseSchema.safeParse(payload).success).toBe(false)
  })

  // A badge with no bullets renders as an unexplained chip, which defeats the
  // point of showing the reasoning at all.
  it('rejects a reasoning badge with no bullets', () => {
    const payload = buildResponse(['morning', 'midday', 'evening'])
    const outfits = payload.data.outfits as Record<string, unknown>[]
    if (outfits[0]) {
      outfits[0].reasoningBadges = [
        { key: 'rain_ready', label: 'Rain ready', bullets: [] },
      ]
    }

    expect(ritualResponseSchema.safeParse(payload).success).toBe(false)
  })

  it('accepts the optional capsule attribution fields', () => {
    const payload = buildResponse(['morning', 'midday', 'evening'])
    const outfits = payload.data.outfits as Record<string, unknown>[]
    if (outfits[0]) {
      outfits[0].capsuleId = 'capsule-1'
      outfits[0].capsuleName = 'Rainy commute'
      outfits[0].autoFilledGarmentIds = ['garment-9']
    }

    const parsed = ritualResponseSchema.parse(payload)

    expect(parsed.data.outfits[0]?.capsuleId).toBe('capsule-1')
    expect(parsed.data.outfits[0]?.autoFilledGarmentIds).toEqual(['garment-9'])
  })

  it('accepts a null capsule attribution for a non-capsule recommendation', () => {
    const payload = buildResponse(['morning', 'midday', 'evening'])
    const outfits = payload.data.outfits as Record<string, unknown>[]
    if (outfits[0]) {
      outfits[0].capsuleId = null
      outfits[0].capsuleName = null
    }

    expect(ritualResponseSchema.safeParse(payload).success).toBe(true)
  })
})

describe('ritual query params', () => {
  it('accepts an empty query', () => {
    expect(ritualQueryParamsSchema.parse({})).toEqual({})
  })

  it('accepts a location, locale, and occasion filter together', () => {
    expect(
      ritualQueryParamsSchema.parse({
        locationId: 'saved-location-1',
        locale: 'tr-TR',
        occasion: 'work',
      })
    ).toEqual({ locationId: 'saved-location-1', locale: 'tr-TR', occasion: 'work' })
  })

  it('rejects an empty locationId', () => {
    expect(ritualQueryParamsSchema.safeParse({ locationId: '' }).success).toBe(false)
  })

  it('rejects an occasion outside the capsule occasion enum', () => {
    expect(ritualQueryParamsSchema.safeParse({ occasion: 'brunch' }).success).toBe(false)
  })

  // A typo'd query parameter should surface as a 400 rather than being silently
  // dropped and returning an unfiltered ritual.
  it('rejects an unknown query parameter', () => {
    expect(ritualQueryParamsSchema.safeParse({ locationID: 'saved-1' }).success).toBe(
      false
    )
  })
})
