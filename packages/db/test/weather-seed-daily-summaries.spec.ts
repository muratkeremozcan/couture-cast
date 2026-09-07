// Story 6.1 deferred-work: the seeded daily forecast the community feed's
// climate band is resolved from.
//
// `CommunityService.resolveViewerBand` reads `WeatherSnapshot.daily_summaries`
// and nothing else in the snapshot. Until this column was seeded, every seeded
// location resolved `viewerBand: null`, the `auto` feed silently served every
// region, and the mobile end-to-end suite could not reach a resolved band at
// all. These assertions exist so that cannot regress silently: the failure mode
// is not an exception anywhere, it is a feed that quietly stops being filtered.
//
// The entries are asserted here rather than through the seed runner because
// `seedWeather` needs a live PostgreSQL, while the shape and the classification
// are pure. What a database adds over this is only that the column was written,
// which `community-schema.spec.ts` and the integration tier already cover.
import { describe, expect, it } from 'vitest'
import { classifyClimateBand, type ClimateBandDay } from '@couture/utils'

import { buildDailySummaries, weatherSeeds } from '../prisma/seeds/weather.ts'

const FROM = new Date('2026-09-06T12:00:00.000Z')

/**
 * The bands each seeded location is expected to classify into, spelled out
 * rather than recomputed from `buildDailySummaries`.
 *
 * Deriving the expectation from the same function under test would assert only
 * that the code equals itself: the temperature could move a location across the
 * 10C or 22C boundary and this table would follow it silently. Chicago matters
 * most of the ten, because `scripts/run-maestro.mjs` gives the mobile end-to-end
 * user the `chicago-il` location, so this row is what the Maestro flow's
 * band-resolved assertion actually depends on.
 */
const EXPECTED_BANDS: Record<string, string> = {
  'san-francisco-ca': 'temperate_dry',
  'new-york-ny': 'cold_wet',
  'austin-tx': 'warm_dry',
  'chicago-il': 'cold_wet',
  'seattle-wa': 'temperate_wet',
  'miami-fl': 'warm_dry',
  'denver-co': 'cold_wet',
  'portland-or': 'temperate_dry',
  'toronto-on': 'cold_wet',
  'phoenix-az': 'warm_dry',
}

describe('seeded weather daily summaries', () => {
  it('6.1-DB-050 builds an eight-day window of consecutive local dates', () => {
    const entries = buildDailySummaries(weatherSeeds[0], FROM)

    // Eight, because both providers' `extractDaily` truncate to eight ("today"
    // plus a seven-day window, Story 5.5 Decision 3) and `classifyClimateBand`
    // caps its averaging window at the same number.
    expect(entries).toHaveLength(8)
    expect(entries.map((entry) => entry.localDate)).toEqual([
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ])
  })

  it('6.1-DB-051 emits only values NormalizedDailyWeatherEntrySchema accepts', () => {
    // `parseDailySummaries` validates every entry on read and DISCARDS the ones
    // that fail, logging rather than throwing. So a malformed entry does not
    // surface as an error anywhere: it silently shrinks the usable-day count
    // until the band stops resolving. These bounds are that schema's, restated
    // here because `packages/db` must not import from `apps/api`.
    for (const seed of weatherSeeds) {
      for (const entry of buildDailySummaries(seed, FROM)) {
        expect(entry.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(typeof entry.condition).toBe('string')
        expect(Number.isFinite(entry.temperatureMin)).toBe(true)
        expect(Number.isFinite(entry.temperatureMax)).toBe(true)
        expect(entry.temperatureMin as number).toBeLessThanOrEqual(
          entry.temperatureMax as number
        )
        expect(entry.precipitationProbability as number).toBeGreaterThanOrEqual(0)
        expect(entry.precipitationProbability as number).toBeLessThanOrEqual(1)
        expect(entry.precipitationAmount as number).toBeGreaterThanOrEqual(0)
        expect(entry.windSpeed as number).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('6.1-DB-052 reads rain and snow as wet and everything else as dry', () => {
    const snow = buildDailySummaries(
      weatherSeeds.find((seed) => seed.locationKey === 'chicago-il')!,
      FROM
    )
    const clear = buildDailySummaries(
      weatherSeeds.find((seed) => seed.locationKey === 'phoenix-az')!,
      FROM
    )

    // Above the classifier's 0.4 probability threshold on every day, so the wet
    // ratio is 1.0 and cannot depend on which day the seed ran.
    expect(snow.every((entry) => (entry.precipitationProbability as number) >= 0.4)).toBe(
      true
    )
    // And below it on every day, not merely on average.
    expect(clear.every((entry) => (entry.precipitationProbability as number) < 0.4)).toBe(
      true
    )
  })

  it('6.1-DB-053 gives every seeded location a resolvable climate band', () => {
    for (const seed of weatherSeeds) {
      const entries = buildDailySummaries(seed, FROM) as unknown as ClimateBandDay[]
      const band = classifyClimateBand(entries)

      // Null is the state this seeding exists to eliminate. A location that
      // stops classifying takes the `auto` feed back to every region for anyone
      // whose saved location is that city, with no error anywhere.
      expect(band, `${seed.locationKey} must resolve a band`).not.toBeNull()
      expect(band, `${seed.locationKey} band`).toBe(EXPECTED_BANDS[seed.locationKey])
    }
  })

  it('6.1-DB-054 keeps every seeded temperature in a plausible Celsius range', () => {
    // The regression this pins is a unit swap, not a typo. `baseTempCelsius` held
    // Fahrenheit until 2026-09-06 (Miami 82, Phoenix 88, Chicago 42 with snow),
    // and because it was written into a Celsius column nothing failed: the values
    // looked reasonable to a reader and merely classified the wrong band. Any
    // Fahrenheit value for a populated city lands outside this range.
    for (const seed of weatherSeeds) {
      expect(seed.baseTempCelsius, `${seed.locationKey} baseTempCelsius`).toBeLessThan(45)
      expect(seed.baseTempCelsius, `${seed.locationKey} baseTempCelsius`).toBeGreaterThan(
        -40
      )
    }
    // And the specific shape that started it: a snowbound city cannot be warm.
    const chicago = weatherSeeds.find((seed) => seed.locationKey === 'chicago-il')!
    expect(chicago.condition).toBe('snow')
    expect(chicago.baseTempCelsius).toBeLessThan(10)
  })
})
