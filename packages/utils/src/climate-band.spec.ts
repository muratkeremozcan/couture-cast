import { describe, expect, it } from 'vitest'
import {
  CLIMATE_BANDS,
  ORDERED_CLIMATE_BANDS,
  classifyClimateBand,
  type ClimateBandDay,
} from './climate-band.js'

describe('climate-band classifier', () => {
  it('exports canonical climate bands and ordered UI list', () => {
    expect(CLIMATE_BANDS).toEqual([
      'cold_wet',
      'cold_dry',
      'temperate_wet',
      'temperate_dry',
      'warm_wet',
      'warm_dry',
    ])
    expect(ORDERED_CLIMATE_BANDS).toEqual(CLIMATE_BANDS)
  })

  describe('3-day minimum usability requirement', () => {
    it('returns null for empty or null/undefined days array', () => {
      expect(classifyClimateBand([])).toBeNull()
      expect(classifyClimateBand(null as unknown as ClimateBandDay[])).toBeNull()
    })

    it('returns null when fewer than 3 usable days are supplied', () => {
      const oneDay: ClimateBandDay[] = [
        { temperatureMin: 15, temperatureMax: 20, precipitationAmount: 0 },
      ]
      const twoDays: ClimateBandDay[] = [
        { temperatureMin: 15, temperatureMax: 20, precipitationAmount: 0 },
        { temperatureMin: 16, temperatureMax: 22, precipitationAmount: 0 },
      ]
      expect(classifyClimateBand(oneDay)).toBeNull()
      expect(classifyClimateBand(twoDays)).toBeNull()
    })

    it('filters out unusable days (NaN, Infinity, missing) and returns null if usable count < 3', () => {
      const mixedDays: ClimateBandDay[] = [
        { temperatureMin: 15, temperatureMax: 20, precipitationAmount: 0 },
        { temperatureMin: NaN, temperatureMax: 22, precipitationAmount: 0 },
        { temperatureMin: 10, temperatureMax: Infinity, precipitationAmount: 0 },
        {
          temperatureMin: undefined as unknown as number,
          temperatureMax: 20,
          precipitationAmount: 0,
        },
        { temperatureMin: 12, temperatureMax: 18, precipitationAmount: 0 },
      ]
      // Only 2 days are usable (indices 0 and 4)
      expect(classifyClimateBand(mixedDays)).toBeNull()
    })

    it('classifies successfully when exactly 3 usable days are supplied', () => {
      const threeDays: ClimateBandDay[] = [
        { temperatureMin: 10, temperatureMax: 20, precipitationAmount: 0 }, // midpoint 15
        { temperatureMin: 12, temperatureMax: 18, precipitationAmount: 0 }, // midpoint 15
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 }, // midpoint 15
      ]
      // mean 15 -> temperate, zero wet days -> dry
      expect(classifyClimateBand(threeDays)).toBe('temperate_dry')
    })
  })

  describe('precipitation is required, never inferred for legacy rows', () => {
    it('returns null for 3 days carrying no precipitation fields at all', () => {
      const legacyDays: ClimateBandDay[] = [
        { temperatureMin: 10, temperatureMax: 20 },
        { temperatureMin: 12, temperatureMax: 18 },
        { temperatureMin: 14, temperatureMax: 16 },
      ]
      // Zero usable days: a missing precipitation signal is not "dry".
      expect(classifyClimateBand(legacyDays)).toBeNull()
    })

    it('returns null when explicitly null precipitation fields leave fewer than 3 usable days', () => {
      const legacyDays: ClimateBandDay[] = [
        {
          temperatureMin: 10,
          temperatureMax: 20,
          precipitationProbability: null,
          precipitationAmount: null,
        },
        {
          temperatureMin: 12,
          temperatureMax: 18,
          precipitationProbability: undefined,
          precipitationAmount: undefined,
        },
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 },
      ]
      expect(classifyClimateBand(legacyDays)).toBeNull()
    })

    it('treats a percent-scale precipitationProbability (40) as an absent signal', () => {
      const days: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 40 },
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 40 },
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.1 },
      ]
      // Two days lose their only signal, so only 1 usable day remains.
      expect(classifyClimateBand(days)).toBeNull()
    })

    it('treats an out-of-range precipitationProbability (1.5) as an absent signal', () => {
      const days: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 1.5 },
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 1.5 },
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.1 },
      ]
      expect(classifyClimateBand(days)).toBeNull()
    })

    it('treats a negative precipitationAmount (-5) as an absent signal', () => {
      const days: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: -5 },
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: -5 },
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 },
      ]
      expect(classifyClimateBand(days)).toBeNull()
    })

    it('keeps a day usable when one signal is out of range but the other is valid', () => {
      const days: ClimateBandDay[] = [
        {
          temperatureMin: 14,
          temperatureMax: 16,
          precipitationProbability: 40,
          precipitationAmount: 0,
        },
        {
          temperatureMin: 14,
          temperatureMax: 16,
          precipitationProbability: 40,
          precipitationAmount: 0,
        },
        {
          temperatureMin: 14,
          temperatureMax: 16,
          precipitationProbability: -0.2,
          precipitationAmount: 0,
        },
      ]
      // Out-of-range probability is absent, not an error, and never counts as wet.
      expect(classifyClimateBand(days)).toBe('temperate_dry')
    })

    it('treats precipitationAmount 0 as a usable dry signal', () => {
      const days: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 },
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 },
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 },
      ]
      expect(classifyClimateBand(days)).toBe('temperate_dry')
    })

    it('treats precipitationProbability of exactly 0 and exactly 1 as usable', () => {
      const days: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0 }, // dry
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 1 }, // wet
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.5 }, // wet
      ]
      // Non-null proves all 3 days are usable; 2/3 wet -> wet.
      expect(classifyClimateBand(days)).toBe('temperate_wet')
    })
  })

  describe('temperature axis boundaries', () => {
    // cold < 10, temperate 10 <= t < 22, warm >= 22
    it('classifies as cold when mean temperature is strictly below 10C', () => {
      const coldDays: ClimateBandDay[] = [
        { temperatureMin: 8, temperatureMax: 11.98, precipitationAmount: 0 }, // midpoint 9.99
        { temperatureMin: 9, temperatureMax: 10.98, precipitationAmount: 0 }, // midpoint 9.99
        { temperatureMin: 7, temperatureMax: 12.98, precipitationAmount: 0 }, // midpoint 9.99
      ]
      expect(classifyClimateBand(coldDays)).toBe('cold_dry')
    })

    it('classifies as temperate at the 10.0C lower boundary', () => {
      const boundaryDays: ClimateBandDay[] = [
        { temperatureMin: 5, temperatureMax: 15, precipitationAmount: 0 }, // midpoint 10.0
        { temperatureMin: 8, temperatureMax: 12, precipitationAmount: 0 }, // midpoint 10.0
        { temperatureMin: 10, temperatureMax: 10, precipitationAmount: 0 }, // midpoint 10.0
      ]
      expect(classifyClimateBand(boundaryDays)).toBe('temperate_dry')
    })

    it('classifies as temperate just below 22.0C', () => {
      const nearWarmDays: ClimateBandDay[] = [
        { temperatureMin: 20, temperatureMax: 23.98, precipitationAmount: 0 }, // midpoint 21.99
        { temperatureMin: 21, temperatureMax: 22.98, precipitationAmount: 0 }, // midpoint 21.99
        { temperatureMin: 19, temperatureMax: 24.98, precipitationAmount: 0 }, // midpoint 21.99
      ]
      expect(classifyClimateBand(nearWarmDays)).toBe('temperate_dry')
    })

    it('classifies as warm at and above 22.0C', () => {
      const warmDays: ClimateBandDay[] = [
        { temperatureMin: 20, temperatureMax: 24, precipitationAmount: 0 }, // midpoint 22.0
        { temperatureMin: 21, temperatureMax: 23, precipitationAmount: 0 }, // midpoint 22.0
        { temperatureMin: 18, temperatureMax: 26, precipitationAmount: 0 }, // midpoint 22.0
      ]
      expect(classifyClimateBand(warmDays)).toBe('warm_dry')
    })

    it('classifies hot/summer conditions as warm', () => {
      const hotDays: ClimateBandDay[] = [
        { temperatureMin: 25, temperatureMax: 35, precipitationAmount: 0 },
        { temperatureMin: 24, temperatureMax: 32, precipitationAmount: 0 },
        { temperatureMin: 28, temperatureMax: 36, precipitationAmount: 0 },
      ]
      expect(classifyClimateBand(hotDays)).toBe('warm_dry')
    })
  })

  describe('moisture axis boundaries and precipitation fields', () => {
    // wet when >= 40% of usable days have precipitationProbability >= 0.4
    // or precipitationAmount >= 1.0 mm
    it('classifies as dry when wet day ratio is strictly below 40%', () => {
      // 1 out of 5 usable days is wet = 20% (< 40%)
      const days: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.5 }, // wet
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.39 }, // dry (< 0.4)
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0.99 }, // dry (< 1.0)
        {
          temperatureMin: 14,
          temperatureMax: 16,
          precipitationProbability: 0,
          precipitationAmount: 0,
        }, // dry
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 }, // dry
      ]
      expect(classifyClimateBand(days)).toBe('temperate_dry')
    })

    it('classifies as wet at exactly 40% wet days threshold', () => {
      // 2 out of 5 usable days = 40%
      const days: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.4 }, // wet (boundary 0.4)
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 1.0 }, // wet (boundary 1.0mm)
        {
          temperatureMin: 14,
          temperatureMax: 16,
          precipitationProbability: 0.39,
          precipitationAmount: 0.99,
        }, // dry
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0 }, // dry
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 }, // dry
      ]
      expect(classifyClimateBand(days)).toBe('temperate_wet')
    })

    it('excludes precipitation-less days from the wet ratio denominator', () => {
      // 2 wet days out of 5 supplied, but 2 supplied days carry no usable signal,
      // so the ratio is 2/3 = 66.7% wet rather than 2/5 = 40%.
      const days: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.6 }, // wet
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 2.0 }, // wet
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.1 }, // dry
        { temperatureMin: 14, temperatureMax: 16 }, // excluded
        {
          temperatureMin: 14,
          temperatureMax: 16,
          precipitationProbability: null,
          precipitationAmount: null,
        }, // excluded
      ]
      expect(classifyClimateBand(days)).toBe('temperate_wet')
    })

    it('recognizes wet days by probability alone or amount alone', () => {
      // 2 out of 4 usable days = 50% (>= 40%)
      const days: ClimateBandDay[] = [
        {
          temperatureMin: 0,
          temperatureMax: 8,
          precipitationProbability: 0.6,
          precipitationAmount: 0,
        }, // prob qualifies
        {
          temperatureMin: 0,
          temperatureMax: 8,
          precipitationProbability: 0.1,
          precipitationAmount: 2.5,
        }, // amount qualifies
        {
          temperatureMin: 0,
          temperatureMax: 8,
          precipitationProbability: 0.1,
          precipitationAmount: 0,
        }, // dry
        { temperatureMin: 0, temperatureMax: 8, precipitationAmount: 0 }, // dry
      ]
      expect(classifyClimateBand(days)).toBe('cold_wet')
    })

    it('handles mixed precipitation values across usable days', () => {
      const days: ClimateBandDay[] = [
        { temperatureMin: 25, temperatureMax: 30, precipitationProbability: 0.9 },
        { temperatureMin: 25, temperatureMax: 30, precipitationAmount: 15.0 },
        {
          temperatureMin: 25,
          temperatureMax: 30,
          precipitationProbability: undefined,
          precipitationAmount: 0,
        },
      ]
      // 2 out of 3 usable days = 66.7% wet -> warm_wet
      expect(classifyClimateBand(days)).toBe('warm_wet')
    })
  })

  describe('determinism across day ordering', () => {
    it('produces identical classifications regardless of day order', () => {
      const dayA: ClimateBandDay = {
        temperatureMin: 5,
        temperatureMax: 15,
        precipitationProbability: 0.5,
      }
      const dayB: ClimateBandDay = {
        temperatureMin: 10,
        temperatureMax: 20,
        precipitationAmount: 2.0,
      }
      const dayC: ClimateBandDay = {
        temperatureMin: 15,
        temperatureMax: 25,
        precipitationProbability: 0.1,
      }
      const dayD: ClimateBandDay = {
        temperatureMin: 20,
        temperatureMax: 30,
        precipitationAmount: 0,
      }

      const order1 = [dayA, dayB, dayC, dayD]
      const order2 = [dayD, dayC, dayB, dayA]
      const order3 = [dayB, dayD, dayA, dayC]

      const result1 = classifyClimateBand(order1)
      const result2 = classifyClimateBand(order2)
      const result3 = classifyClimateBand(order3)

      expect(result1).not.toBeNull()
      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })
  })

  describe('min <= max and date deduplication invariants', () => {
    it('rejects days where temperatureMin > temperatureMax', () => {
      const invalidDays: ClimateBandDay[] = [
        { temperatureMin: 20, temperatureMax: 10, precipitationAmount: 0 }, // min > max: invalid!
        { temperatureMin: 12, temperatureMax: 18, precipitationAmount: 0 },
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 },
      ]
      // Only 2 usable days remaining -> null
      expect(classifyClimateBand(invalidDays)).toBeNull()
    })

    it('deduplicates duplicate localDate entries keeping unique dates', () => {
      const daysWithDuplicateDate: ClimateBandDay[] = [
        {
          localDate: '2026-09-05',
          temperatureMin: 12,
          temperatureMax: 18,
          precipitationAmount: 0,
        },
        {
          localDate: '2026-09-05',
          temperatureMin: 25,
          temperatureMax: 30,
          precipitationAmount: 0,
        }, // duplicate date!
        {
          localDate: '2026-09-06',
          temperatureMin: 14,
          temperatureMax: 16,
          precipitationAmount: 0,
        },
      ]
      // Only 2 unique usable dates -> null
      expect(classifyClimateBand(daysWithDuplicateDate)).toBeNull()

      const threeUniqueDays: ClimateBandDay[] = [
        ...daysWithDuplicateDate,
        {
          localDate: '2026-09-07',
          temperatureMin: 13,
          temperatureMax: 17,
          precipitationAmount: 0,
        },
      ]
      // 3 unique usable dates -> classifies
      expect(classifyClimateBand(threeUniqueDays)).toBe('temperate_dry')
    })

    it('keeps the LAST occurrence of a duplicate localDate, not the first, when the two disagree', () => {
      // Per the deferred-work note, a refreshed forecast for a date is appended
      // right after the stale row it replaces, so array order is the recency
      // signal: the second '2026-09-05' entry is the refreshed one.
      const staleFirstOccurrence: ClimateBandDay = {
        localDate: '2026-09-05',
        temperatureMin: 0,
        temperatureMax: 2, // stale midpoint 1 -> cold
        precipitationAmount: 0, // dry
      }
      const refreshedSecondOccurrence: ClimateBandDay = {
        localDate: '2026-09-05',
        temperatureMin: 28,
        temperatureMax: 32, // refreshed midpoint 30 -> warm
        precipitationProbability: 0.9, // wet
      }
      const days: ClimateBandDay[] = [
        staleFirstOccurrence,
        refreshedSecondOccurrence,
        {
          localDate: '2026-09-06',
          temperatureMin: 28,
          temperatureMax: 32,
          precipitationProbability: 0.9,
        },
        {
          localDate: '2026-09-07',
          temperatureMin: 28,
          temperatureMax: 32,
          precipitationProbability: 0.9,
        },
      ]

      // Keeping the first (stale, cold/dry) occurrence would average
      // (1 + 30 + 30) / 3 = 20.33 (temperate) with 2/3 wet -> 'temperate_wet'.
      // The correct fix keeps the last (refreshed, warm/wet) occurrence:
      // it averages 30/30/30 = 30 (warm) with 3/3 wet -> 'warm_wet'.
      expect(classifyClimateBand(days)).toBe('warm_wet')
    })
  })

  describe('MAXIMUM_USABLE_DAYS ceiling', () => {
    it('caps the averaging window at 8 days, dropping stale days from the head of an oversized array', () => {
      const keptTailDays: ClimateBandDay[] = [
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.5 }, // wet
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.5 }, // wet
        { temperatureMin: 14, temperatureMax: 16, precipitationProbability: 0.5 }, // wet
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 }, // dry
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 }, // dry
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 }, // dry
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 }, // dry
        { temperatureMin: 14, temperatureMax: 16, precipitationAmount: 0 }, // dry
      ]
      // On its own: 3/8 wet = 37.5% (< 40%) -> temperate_dry.
      expect(classifyClimateBand(keptTailDays)).toBe('temperate_dry')

      const staleHeadDay: ClimateBandDay = {
        temperatureMin: 14,
        temperatureMax: 16,
        precipitationProbability: 0.5, // wet
      }
      // 9 usable days total: one more than MAXIMUM_USABLE_DAYS, sitting at the
      // head of the array (the "oldest" position once trimmed to the most
      // recent 8).
      const oversizedDays: ClimateBandDay[] = [staleHeadDay, ...keptTailDays]

      // A naive "use everything" implementation would count 4/9 wet = 44.4%
      // (>= 40%) and return 'temperate_wet'. The ceiling must drop the head
      // day so the result is unchanged from the 8-day case above.
      expect(classifyClimateBand(oversizedDays)).toBe('temperate_dry')
    })
  })
})
