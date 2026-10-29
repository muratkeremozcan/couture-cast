import { afterEach, describe, expect, it } from 'vitest'
import {
  NATIVE_JOURNEY_TEMPERATURE_C,
  nativeJourneyTemperature,
  startWeatherProviderDouble,
  type WeatherProviderDouble,
} from '../../../../../scripts/weather-provider-double.mjs'
import { mapOpenWeatherCondition } from '../weather/providers/weather-condition.mapper'
import {
  generateRitualScenarios,
  hourlySegmentToScenarioInput,
  matchHourlyScenarioSegments,
  resolveRitualAnchorDate,
} from './ritual-generation.engine'

/**
 * The native journeys (Android and iOS) hard-code the Home morning outfit as top, bottom and
 * shoes. The ritual adds outerwear when the morning segment feels below 15 degrees, and the
 * weather double's default curve swings 12 to 24 degrees indexed from the request hour, so
 * which outfit a run gets used to depend on when it started (run 40878814608 saw four
 * categories on every lane that started after the morning cutoff). These tests replay the
 * ritual over a pinned clock, every half hour for two days and in every zone the harness can
 * resolve, using the forecast the double really serves.
 */
const BASE = Date.UTC(2026, 9, 29, 0, 0, 0)
const ZONES = [
  'America/Denver', // the double's zone for any place it does not know, such as San Francisco
  'America/Chicago',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
]
let double: WeatherProviderDouble | undefined
afterEach(async () => {
  await double?.close()
  double = undefined
})

type OpenWeatherHour = {
  dt: number
  feels_like: number
  wind_speed: number
  pop: number
  weather: { id: number }[]
}

async function morningCategories(zone: string, clock: { now: number }) {
  const url = `${double!.origin}/data/3.0/onecall?lat=37.7749&lon=-122.4194&appid=k`
  const body = (await (await fetch(url)).json()) as { hourly: OpenWeatherHour[] }
  const segments = body.hourly.map((hour) => ({
    id: `seg-${hour.dt}`,
    forecast_at: new Date(hour.dt * 1000),
    feels_like: hour.feels_like,
    wind_speed: hour.wind_speed,
    precipitation_probability: hour.pop,
    precipitation_amount: 0,
    condition: mapOpenWeatherCondition(hour.weather[0]!.id),
  }))
  const target = resolveRitualAnchorDate(new Date(clock.now), zone)
  const matched = matchHourlyScenarioSegments(segments, zone, target)
  expect(matched, `${zone} at ${new Date(clock.now).toISOString()}`).not.toBeNull()
  const result = generateRitualScenarios({
    userId: 'u',
    targetLocalDate: matched!.resolvedLocalDate,
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
        hourlySegmentToScenarioInput('morning', matched!.morning),
        hourlySegmentToScenarioInput('midday', matched!.midday),
        hourlySegmentToScenarioInput('evening', matched!.evening),
      ],
    },
  })
  return result.scenarios.map((scenario) =>
    scenario.garmentIds.map((id) => id.replace('default-', '')).join('+')
  )
}

async function sweep(options: Parameters<typeof startWeatherProviderDouble>[0]) {
  const clock = { now: BASE }
  double = await startWeatherProviderDouble({ ...options, now: () => clock.now })
  const seen = new Map<string, string[]>()
  for (const zone of ZONES)
    for (let minutes = 0; minutes < 48 * 60; minutes += 30) {
      clock.now = BASE + minutes * 60_000
      const outfits = await morningCategories(zone, clock)
      seen.set(`${zone} ${new Date(clock.now).toISOString()}`, outfits)
    }
  return seen
}

describe('the outfit the native journeys expect does not depend on the clock', () => {
  it('serves top, bottom and shoes for every scenario at every half hour in every zone', async () => {
    const seen = await sweep({ temperatureAt: nativeJourneyTemperature })
    expect(seen.size).toBe(ZONES.length * 96)
    for (const [when, outfits] of seen)
      expect(outfits, when).toEqual(Array(3).fill('top+bottom+shoes'))
  }, 120_000)

  it('keeps the pinned series warm enough that no layer is ever added', () => {
    // The ritual adds outerwear below 15 degrees feels-like; the pin is a degree under its
    // own temperature.
    expect(NATIVE_JOURNEY_TEMPERATURE_C - 1).toBeGreaterThanOrEqual(15)
  })

  it('reproduces the failure: the default curve adds outerwear for some start times and not for others', async () => {
    const seen = await sweep({})
    const withOuterwear = [...seen.values()].filter((outfits) =>
      outfits[0]!.includes('outerwear')
    )
    expect(withOuterwear.length).toBeGreaterThan(0)
    expect(withOuterwear.length).toBeLessThan(seen.size)
  }, 120_000)
})
