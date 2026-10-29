import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NATIVE_JOURNEY_FEELS_LIKE_C,
  NATIVE_JOURNEY_LOCATION_KEY,
  NATIVE_JOURNEY_TEMPERATURE_C,
} from '../../../../../scripts/lib/native-journey-weather.mjs'
import { createWeatherSnapshot } from '../../../../../packages/testing/src/factories/weather.factory'
import {
  generateRitualScenarios,
  hourlySegmentToScenarioInput,
  matchHourlyScenarioSegments,
  resolveRitualAnchorDate,
} from './ritual-generation.engine'

/**
 * The native journeys hard-code the Home morning outfit as top, bottom and shoes. The ritual adds
 * outerwear when the morning segment feels below 15 degrees. The journey database is seeded with
 * packages/db/prisma/seeds/weather.ts, which ramps the harness location's feels-like from 14
 * degrees by half a degree per hour from the next full hour, so the outfit depended on when the
 * run seeded (run 40878814608: every lane that seeded between 13:00 and 14:59 UTC got outerwear).
 * These tests replay the seed and the ritual's anchor, matcher and engine over a pinned clock.
 */
// The seed module imports its factory with a .ts extension, which this project cannot import
// as a module, so the seed is read as text: the location's entry and the ramp formula the
// replay below copies. A change to either breaks this spec on purpose.
const SEED_SOURCE = readFileSync(
  resolve(__dirname, '../../../../../packages/db/prisma/seeds/weather.ts'),
  'utf8'
)
const seedEntry = new RegExp(
  `id: '(wx-\\d+)',\\s+location: '([^']+)',\\s+locationKey: '${NATIVE_JOURNEY_LOCATION_KEY}',\\s+latitude: ([-\\d.]+),\\s+longitude: ([-\\d.]+),\\s+timezone: '([^']+)',\\s+baseTempCelsius: (\\d+),\\s+condition: '([^']+)'`
).exec(SEED_SOURCE)
if (!seedEntry) throw new Error('seed entry for the journey location not found')
const SEED = {
  id: seedEntry[1]!,
  location: seedEntry[2]!,
  locationKey: NATIVE_JOURNEY_LOCATION_KEY,
  latitude: Number(seedEntry[3]),
  longitude: Number(seedEntry[4]),
  timezone: seedEntry[5]!,
  baseTempCelsius: Number(seedEntry[6]),
  condition: seedEntry[7] as 'clear' | 'cloudy' | 'rain' | 'snow',
}
const BASE = Date.UTC(2026, 9, 29, 0, 0, 0)
const HALF_HOUR = 30 * 60_000

/** The segments seedWeather writes for the location, as of `seededAt`, optionally pinned. */
function seededSegments(seededAt: Date, pinned: boolean) {
  const fixture = createWeatherSnapshot({
    id: SEED.id,
    location: SEED.location,
    locationKey: SEED.locationKey,
    latitude: SEED.latitude,
    longitude: SEED.longitude,
    timezone: SEED.timezone,
    provider: 'openweather',
    providerUpdatedAt: new Date(seededAt.getTime() - 30 * 60_000),
    timestamp: seededAt,
    temperature: SEED.baseTempCelsius,
    feelsLike: SEED.baseTempCelsius,
    conditions: SEED.condition,
  })
  return fixture.segments.map((segment, offset) => ({
    id: `${SEED.id}-seg-${offset}`,
    forecast_at: segment.forecastAt,
    // seedWeather: feels_like = base + offset * 0.5
    feels_like: pinned ? NATIVE_JOURNEY_FEELS_LIKE_C : fixture.feelsLike + offset * 0.5,
    wind_speed: fixture.windSpeed,
    precipitation_probability: segment.precipitationProbability,
    precipitation_amount: segment.precipitationAmount,
    condition: segment.conditions,
  }))
}

/** Outfits the ritual generates when it runs at `at` against a snapshot seeded at `seededAt`. */
function outfits(seededAt: Date, at: Date, pinned: boolean) {
  const segments = seededSegments(seededAt, pinned)
  const target = resolveRitualAnchorDate(at, SEED.timezone)
  const matched = matchHourlyScenarioSegments(segments, SEED.timezone, target)
  if (!matched) return null
  const result = generateRitualScenarios({
    userId: 'u',
    targetLocalDate: matched.resolvedLocalDate,
    locale: 'en-US',
    comfortPreferences: {
      runsColdWarm: 'neutral',
      windTolerance: 'medium',
      precipPreparedness: 'medium',
    },
    eligibleGarments: [],
    eligibleCapsules: [],
    weather: {
      status: 'available',
      scenarios: [
        hourlySegmentToScenarioInput('morning', matched.morning),
        hourlySegmentToScenarioInput('midday', matched.midday),
        hourlySegmentToScenarioInput('evening', matched.evening),
      ],
    },
  })
  return result.scenarios.map((scenario) =>
    scenario.garmentIds.map((id) => id.replace('default-', '')).join('+')
  )
}

/** Every half-hour seed time of two days; the ritual runs at the seed and up to 90 minutes later. */
function sweep(pinned: boolean) {
  const seen = new Map<string, string[] | null>()
  for (let step = 0; step < 96; step++) {
    const seededAt = new Date(BASE + step * HALF_HOUR)
    for (const later of [0, 15, 30, 45, 60, 75, 90]) {
      const at = new Date(seededAt.getTime() + later * 60_000)
      seen.set(`${seededAt.toISOString()} +${later}m`, outfits(seededAt, at, pinned))
    }
  }
  return seen
}

describe('the outfit the native journeys expect does not depend on the clock', () => {
  it('replays the seed as it is written: a ramp of half a degree per hour from the base', () => {
    expect(SEED_SOURCE).toContain('feels_like: fixture.feelsLike + offset * 0.5')
    expect(SEED_SOURCE).toContain('feelsLike: seed.baseTempCelsius')
    expect(SEED.baseTempCelsius).toBe(14)
  })

  it('gives top, bottom and shoes for every scenario at every seed time with the pin', () => {
    const seen = sweep(true)
    expect(seen.size).toBe(96 * 7)
    for (const [when, result] of seen)
      expect(result, when).toEqual(Array(3).fill('top+bottom+shoes'))
  })

  it('reproduces the failure without the pin: outerwear exactly when the seed lands 13:00 to 14:59 UTC', () => {
    const cold = new Set<number>()
    for (let step = 0; step < 96; step++) {
      const seededAt = new Date(BASE + step * HALF_HOUR)
      const morning = outfits(seededAt, seededAt, false)?.[0] ?? ''
      if (morning.includes('outerwear'))
        cold.add(seededAt.getUTCHours() + (seededAt.getUTCDate() - 29) * 24)
    }
    // The ramp starts at 14 degrees: segment 0 and 1 (14.0 and 14.5) are below the 15 line.
    expect([...cold].sort((a, b) => a - b)).toEqual([13, 14, 37, 38])
  })

  it('keeps the pinned value above the ritual line with room to spare', () => {
    expect(NATIVE_JOURNEY_FEELS_LIKE_C).toBe(NATIVE_JOURNEY_TEMPERATURE_C - 1)
    expect(NATIVE_JOURNEY_FEELS_LIKE_C).toBeGreaterThanOrEqual(15)
  })
})
