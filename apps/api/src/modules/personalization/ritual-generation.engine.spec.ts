import { describe, expect, it } from 'vitest'
import type { GarmentItem } from '@prisma/client'
import type { CapsuleWithJoins } from './capsule-recommendation.engine.js'
import {
  dailyProjectionToScenarioInputs,
  generateRitualScenarios,
  hourlySegmentToScenarioInput,
  matchHourlyScenarioSegments,
  resolvePlannerDateWindow,
  resolveRitualAnchorDate,
  toDatabaseDate,
  type EngineWeatherInput,
  type RitualGenerationEngineInput,
} from './ritual-generation.engine.js'

function buildGarment(overrides: Partial<GarmentItem> = {}): GarmentItem {
  return {
    id: 'garment-1',
    user_id: 'user-1',
    category: 'top',
    comfort_range: 'mild',
    upload_status: 'ready',
    retention_status: 'active',
    updated_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as GarmentItem
}

const noCapsules: CapsuleWithJoins[] = []

const baseInput: Omit<RitualGenerationEngineInput, 'weather'> = {
  userId: 'user-1',
  targetLocalDate: '2026-07-16',
  locale: 'en-US',
  comfortPreferences: {
    runsColdWarm: 'neutral',
    windTolerance: 'medium',
    precipPreparedness: 'medium',
  },
  eligibleGarments: [
    buildGarment({ id: 'top-1', category: 'top' }),
    buildGarment({ id: 'bottom-1', category: 'bottom' }),
    buildGarment({ id: 'shoes-1', category: 'shoes' }),
  ],
  eligibleCapsules: noCapsules,
}

function availableWeather(
  overrides: {
    feelsLike?: number
    windSpeed?: number
    precipitationProbability?: number
    precipitationAmount?: number
    condition?: string
  } = {}
): EngineWeatherInput {
  const shared = {
    windSpeed: 1,
    precipitationProbability: 0,
    precipitationAmount: 0,
    condition: 'clear',
    source: 'hourly' as const,
    ...overrides,
  }
  return {
    status: 'available',
    scenarios: [
      { scenario: 'morning', feelsLike: overrides.feelsLike ?? 18, ...shared },
      { scenario: 'midday', feelsLike: overrides.feelsLike ?? 18, ...shared },
      { scenario: 'evening', feelsLike: overrides.feelsLike ?? 18, ...shared },
    ],
  }
}

describe('resolveRitualAnchorDate', () => {
  it('stays on today before the 08:00 local cutoff', () => {
    expect(
      resolveRitualAnchorDate(new Date('2026-07-16T12:59:00Z'), 'America/Chicago')
    ).toBe('07/16/2026')
  })

  it('rolls to tomorrow at and after the 08:00 local cutoff', () => {
    expect(
      resolveRitualAnchorDate(new Date('2026-07-16T13:00:00Z'), 'America/Chicago')
    ).toBe('07/17/2026')
  })

  it('is stable across a DST spring-forward boundary', () => {
    // 2026-03-08 is US spring-forward (America/Chicago: 2am -> 3am). The
    // cutoff must not skip or duplicate a day because of the missing hour.
    const beforeCutoff = resolveRitualAnchorDate(
      new Date('2026-03-08T07:00:00Z'),
      'America/Chicago'
    )
    const afterCutoff = resolveRitualAnchorDate(
      new Date('2026-03-09T13:01:00Z'),
      'America/Chicago'
    )
    expect(beforeCutoff).toBe('03/08/2026')
    expect(afterCutoff).toBe('03/10/2026')
  })
})

describe('resolvePlannerDateWindow', () => {
  it('returns seven unique consecutive dates', () => {
    const window = resolvePlannerDateWindow('2026-07-16')
    expect(window).toHaveLength(7)
    expect(window).toEqual([
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
    ])
    expect(new Set(window).size).toBe(7)
  })

  it('rolls across a month end', () => {
    expect(resolvePlannerDateWindow('2026-01-28')).toEqual([
      '2026-01-28',
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
      '2026-02-03',
    ])
  })

  it('rolls across a year end', () => {
    expect(resolvePlannerDateWindow('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ])
  })

  it('handles a leap day correctly', () => {
    // 2028 is a leap year: Feb has 29 days.
    expect(resolvePlannerDateWindow('2028-02-27')).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
      '2028-03-02',
      '2028-03-03',
      '2028-03-04',
    ])
  })

  it('skips February 29 in a non-leap year', () => {
    // 2027 is not a leap year: Feb has 28 days.
    expect(resolvePlannerDateWindow('2027-02-27')).toEqual([
      '2027-02-27',
      '2027-02-28',
      '2027-03-01',
      '2027-03-02',
      '2027-03-03',
      '2027-03-04',
      '2027-03-05',
    ])
  })

  it('is unaffected by any local DST transition (pure UTC date-part arithmetic)', () => {
    // 2026-11-01 is US fall-back (America/Chicago) -- irrelevant here since
    // the window never constructs a local-timezone Date.
    expect(resolvePlannerDateWindow('2026-10-30')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ])
  })

  it('rejects a malformed date string', () => {
    expect(() => resolvePlannerDateWindow('not-a-date')).toThrow()
    expect(() => resolvePlannerDateWindow('2026-02-30')).toThrow()
  })
})

describe('toDatabaseDate', () => {
  it('stores the local calendar label as UTC midnight', () => {
    const date = toDatabaseDate('2026-07-16')
    expect(date.toISOString()).toBe('2026-07-16T00:00:00.000Z')
  })

  it('rejects an invalid calendar date', () => {
    expect(() => toDatabaseDate('2026-13-01')).toThrow()
  })
})

describe('matchHourlyScenarioSegments', () => {
  const timezone = 'America/Chicago'
  function segment(hourUtc: string, id: string) {
    return {
      id,
      forecast_at: new Date(hourUtc),
      feels_like: 18,
      wind_speed: 1,
      precipitation_probability: 0,
      precipitation_amount: 0,
      condition: 'clear',
    }
  }

  it('matches the exact 08:00/13:00/19:00 local segments for the target date', () => {
    const segments = [
      segment('2026-07-16T13:00:00Z', 'morning'), // 08:00 CDT
      segment('2026-07-16T18:00:00Z', 'midday'), // 13:00 CDT
      segment('2026-07-17T00:00:00Z', 'evening'), // 19:00 CDT
    ]
    const result = matchHourlyScenarioSegments(segments, timezone, '07/16/2026')
    expect(result?.resolvedLocalDate).toBe('07/16/2026')
    expect(result?.morning.id).toBe('morning')
    expect(result?.midday.id).toBe('midday')
    expect(result?.evening.id).toBe('evening')
  })

  it('falls back to the most recent fully covered date', () => {
    const segments = [
      segment('2026-07-15T13:00:00Z', 'morning-prev'),
      segment('2026-07-15T18:00:00Z', 'midday-prev'),
      segment('2026-07-16T00:00:00Z', 'evening-prev'),
    ]
    const result = matchHourlyScenarioSegments(segments, timezone, '07/16/2026')
    expect(result?.resolvedLocalDate).toBe('07/15/2026')
  })

  it('returns null when no date has full coverage', () => {
    const segments = [segment('2026-07-16T13:00:00Z', 'morning-only')]
    expect(matchHourlyScenarioSegments(segments, timezone, '07/16/2026')).toBeNull()
  })
})

describe('hourlySegmentToScenarioInput', () => {
  it('maps a segment into a ScenarioWeatherInput tagged as hourly', () => {
    const input = hourlySegmentToScenarioInput('morning', {
      id: 's1',
      forecast_at: new Date(),
      feels_like: 12,
      wind_speed: 3,
      precipitation_probability: 0.2,
      precipitation_amount: 1,
      condition: 'rain',
    })
    expect(input).toMatchObject({
      scenario: 'morning',
      feelsLike: 12,
      windSpeed: 3,
      precipitationProbability: 0.2,
      precipitationAmount: 1,
      condition: 'rain',
      source: 'hourly',
    })
  })
})

describe('dailyProjectionToScenarioInputs', () => {
  it('maps morning=min, midday=max, evening=midpoint using feels-like bounds when present', () => {
    const [morning, midday, evening] = dailyProjectionToScenarioInputs({
      temperatureMin: 10,
      temperatureMax: 20,
      feelsLikeMin: 8,
      feelsLikeMax: 22,
      precipitationProbability: 0.3,
      precipitationAmount: 2,
      windSpeed: 4,
      condition: 'cloudy',
    })
    expect(morning).toMatchObject({ scenario: 'morning', feelsLike: 8, source: 'daily' })
    expect(midday).toMatchObject({ scenario: 'midday', feelsLike: 22, source: 'daily' })
    expect(evening).toMatchObject({ scenario: 'evening', feelsLike: 15, source: 'daily' })
    // Wind and precipitation are shared across all three scenarios.
    for (const scenarioInput of [morning, midday, evening]) {
      expect(scenarioInput.windSpeed).toBe(4)
      expect(scenarioInput.precipitationProbability).toBe(0.3)
      expect(scenarioInput.precipitationAmount).toBe(2)
      expect(scenarioInput.condition).toBe('cloudy')
    }
  })

  it('falls back to temperature bounds when feels-like bounds are absent', () => {
    const [morning, midday, evening] = dailyProjectionToScenarioInputs({
      temperatureMin: 5,
      temperatureMax: 15,
      precipitationProbability: 0,
      precipitationAmount: 0,
      windSpeed: 1,
      condition: 'clear',
    })
    expect(morning.feelsLike).toBe(5)
    expect(midday.feelsLike).toBe(15)
    expect(evening.feelsLike).toBe(10)
  })

  it('labels daily-sourced badges with a summary-evidence note', () => {
    const result = generateRitualScenarios({
      ...baseInput,
      weather: {
        status: 'available',
        scenarios: dailyProjectionToScenarioInputs({
          temperatureMin: 20,
          temperatureMax: 20,
          precipitationProbability: 0,
          precipitationAmount: 0,
          windSpeed: 20, // well above every wind-tolerance threshold
          condition: 'clear',
        }),
      },
    })
    const windBadge = result.scenarios[0].reasoningBadges.find(
      (b) => b.key === 'wind_layer'
    )
    expect(windBadge?.bullets[0]).toContain('summary forecast')
  })
})

describe('generateRitualScenarios: unavailable weather', () => {
  it('produces a wardrobe-and-comfort-preference baseline with zero weather badges', () => {
    const result = generateRitualScenarios({
      ...baseInput,
      weather: { status: 'unavailable' },
    })
    expect(result.scenarios).toHaveLength(3)
    for (const scenario of result.scenarios) {
      expect(scenario.reasoningBadges).toEqual([])
      expect(scenario.capsuleId).toBeNull()
      expect(scenario.comfortNotes).toBe(
        "Weather isn't available for this date, so we picked a versatile everyday outfit."
      )
    }
  })

  it('marks starter wardrobe when a required category has no eligible garment', () => {
    const result = generateRitualScenarios({
      ...baseInput,
      eligibleGarments: [],
      weather: { status: 'unavailable' },
    })
    expect(result.scenarios[0].isStarterWardrobe).toBe(true)
    expect(result.scenarios[0].garmentIds.every((id) => id.startsWith('default-'))).toBe(
      true
    )
  })

  it('nudges the all-season baseline by the run-cold/run-warm preference', () => {
    const garments = [
      buildGarment({ id: 'top-cool', category: 'top', comfort_range: 'cool' }),
      buildGarment({ id: 'top-warm', category: 'top', comfort_range: 'warm' }),
      buildGarment({ id: 'bottom-1', category: 'bottom', comfort_range: 'mild' }),
      buildGarment({ id: 'shoes-1', category: 'shoes', comfort_range: 'mild' }),
    ]
    const coldResult = generateRitualScenarios({
      ...baseInput,
      eligibleGarments: garments,
      comfortPreferences: { ...baseInput.comfortPreferences, runsColdWarm: 'cold' },
      weather: { status: 'unavailable' },
    })
    expect(coldResult.scenarios[0].garmentIds).toContain('top-cool')

    const warmResult = generateRitualScenarios({
      ...baseInput,
      eligibleGarments: garments,
      comfortPreferences: { ...baseInput.comfortPreferences, runsColdWarm: 'warm' },
      weather: { status: 'unavailable' },
    })
    expect(warmResult.scenarios[0].garmentIds).toContain('top-warm')
  })
})

describe('generateRitualScenarios: exclusions', () => {
  it('excludes garment ids from generic garment matching', () => {
    const garments = [
      buildGarment({ id: 'top-1', category: 'top', comfort_range: 'mild' }),
      buildGarment({ id: 'top-2', category: 'top', comfort_range: 'mild' }),
      buildGarment({ id: 'bottom-1', category: 'bottom', comfort_range: 'mild' }),
      buildGarment({ id: 'shoes-1', category: 'shoes', comfort_range: 'mild' }),
    ]
    const withoutExclusion = generateRitualScenarios({
      ...baseInput,
      eligibleGarments: garments,
      weather: availableWeather(),
    })
    expect(withoutExclusion.scenarios[0].garmentIds).toContain('top-1')

    const withExclusion = generateRitualScenarios({
      ...baseInput,
      eligibleGarments: garments,
      weather: availableWeather(),
      exclusions: { garmentIds: ['top-1'] },
    })
    expect(withExclusion.scenarios[0].garmentIds).not.toContain('top-1')
    expect(withExclusion.scenarios[0].garmentIds).toContain('top-2')
  })

  // Story 5.5 AC 4: exclusion is a soft preference. A category with only one
  // real eligible garment must keep using it rather than degrade to a
  // starter-wardrobe placeholder just because reshuffle excluded it.
  it('falls back to an excluded garment rather than a placeholder when it is the only option', () => {
    const garments = [
      buildGarment({ id: 'top-only', category: 'top', comfort_range: 'mild' }),
      buildGarment({ id: 'bottom-1', category: 'bottom', comfort_range: 'mild' }),
      buildGarment({ id: 'shoes-1', category: 'shoes', comfort_range: 'mild' }),
    ]
    const result = generateRitualScenarios({
      ...baseInput,
      eligibleGarments: garments,
      weather: availableWeather(),
      exclusions: { garmentIds: ['top-only'] },
    })
    expect(result.scenarios[0].garmentIds).toContain('top-only')
    expect(result.scenarios[0].isStarterWardrobe).toBe(false)
  })

  it('excludes capsule ids from capsule evaluation', () => {
    const garment = buildGarment({ id: 'g1', category: 'top', comfort_range: 'mild' })
    const garment2 = buildGarment({ id: 'g2', category: 'bottom', comfort_range: 'mild' })
    const garment3 = buildGarment({ id: 'g3', category: 'shoes', comfort_range: 'mild' })
    const capsule = {
      id: 'capsule-1',
      user_id: 'user-1',
      name: 'Everyday',
      is_favorite: false,
      occasions: [],
      updated_at: new Date('2026-01-01T00:00:00Z'),
      garment_joins: [
        { garment_order: 0, garment_id: 'g1', garment },
        { garment_order: 1, garment_id: 'g2', garment: garment2 },
        { garment_order: 2, garment_id: 'g3', garment: garment3 },
      ],
    } as unknown as CapsuleWithJoins

    const withCapsule = generateRitualScenarios({
      ...baseInput,
      eligibleGarments: [garment, garment2, garment3],
      eligibleCapsules: [capsule],
      weather: availableWeather(),
    })
    expect(withCapsule.scenarios[0].capsuleId).toBe('capsule-1')

    const withoutCapsule = generateRitualScenarios({
      ...baseInput,
      eligibleGarments: [garment, garment2, garment3],
      eligibleCapsules: [capsule],
      weather: availableWeather(),
      exclusions: { capsuleIds: ['capsule-1'] },
    })
    expect(withoutCapsule.scenarios[0].capsuleId).toBeNull()
  })
})

describe('generateRitualScenarios: deterministic ids', () => {
  it('builds a stable id from the target date and scenario', () => {
    const result = generateRitualScenarios({
      ...baseInput,
      weather: availableWeather(),
    })
    expect(result.scenarios.map((s) => s.id)).toEqual([
      '2026-07-16-morning',
      '2026-07-16-midday',
      '2026-07-16-evening',
    ])
  })
})
