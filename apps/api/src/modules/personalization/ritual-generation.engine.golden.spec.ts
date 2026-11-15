import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { GarmentItem } from '@prisma/client'
import type { CapsuleWithJoins } from './capsule-recommendation.engine.js'
import {
  generateRitualScenarios,
  getRainAmountThreshold,
  getRainProbThreshold,
  getWindThreshold,
  type ComfortPreferencesInput,
  type EngineWeatherInput,
} from './ritual-generation.engine.js'

// Story 6.16 U-ENGINE-GOLDEN: the comfort rules move into @couture/utils so the guest
// sample policy can share them. This golden file is recorded from the engine before the
// move, and the engine must reproduce it byte for byte after the move.

const COMFORT_RUNS = ['cold', 'neutral', 'warm'] as const
const TOLERANCES = ['low', 'medium', 'high'] as const
const LOCALES = ['en-US', 'tr-TR'] as const

type WeatherCase = {
  feelsLike: number
  windSpeed: number
  precipitationProbability: number
  precipitationAmount: number
}

// Boundary weather: each value sits on or next to a threshold the rules compare against.
const WEATHER_CASES: readonly WeatherCase[] = [
  { feelsLike: 6, windSpeed: 2, precipitationProbability: 0, precipitationAmount: 0 },
  { feelsLike: 9, windSpeed: 6.5, precipitationProbability: 0.1, precipitationAmount: 0 },
  {
    feelsLike: 9.9,
    windSpeed: 3,
    precipitationProbability: 0.2,
    precipitationAmount: 0.1,
  },
  {
    feelsLike: 10,
    windSpeed: 3.1,
    precipitationProbability: 0.21,
    precipitationAmount: 0.11,
  },
  {
    feelsLike: 12,
    windSpeed: 4,
    precipitationProbability: 0.3,
    precipitationAmount: 0.3,
  },
  {
    feelsLike: 14.9,
    windSpeed: 5,
    precipitationProbability: 0.4,
    precipitationAmount: 0.5,
  },
  {
    feelsLike: 15,
    windSpeed: 5.1,
    precipitationProbability: 0.41,
    precipitationAmount: 0.55,
  },
  { feelsLike: 16, windSpeed: 2, precipitationProbability: 0, precipitationAmount: 0 },
  {
    feelsLike: 19.9,
    windSpeed: 8,
    precipitationProbability: 0.7,
    precipitationAmount: 2,
  },
  {
    feelsLike: 20,
    windSpeed: 8.1,
    precipitationProbability: 0.71,
    precipitationAmount: 2.04,
  },
  {
    feelsLike: 22,
    windSpeed: 3,
    precipitationProbability: 0.6,
    precipitationAmount: 1.2,
  },
  {
    feelsLike: 24.9,
    windSpeed: 1,
    precipitationProbability: 0.8,
    precipitationAmount: 2.1,
  },
  { feelsLike: 25, windSpeed: 0, precipitationProbability: 0, precipitationAmount: 0 },
  { feelsLike: 31, windSpeed: 9, precipitationProbability: 0.9, precipitationAmount: 5 },
  // Raw and rounded comparisons disagree (TEA): the comfort note compares raw probability,
  // the rain badge compares rounded percent and rounded millimetres, and the outerwear
  // cutoff compares the unrounded temperature (evening row 14.5 rounds to 15).
  {
    feelsLike: 15.5,
    windSpeed: 2,
    precipitationProbability: 0.204,
    precipitationAmount: 0.14,
  },
  {
    feelsLike: 13,
    windSpeed: 4.5,
    precipitationProbability: 0.404,
    precipitationAmount: 0.54,
  },
  {
    feelsLike: 18,
    windSpeed: 1,
    precipitationProbability: 0.704,
    precipitationAmount: 0,
  },
]

function garment(id: string, category: string, comfortRange: string): GarmentItem {
  return {
    id,
    user_id: 'golden-user',
    category,
    comfort_range: comfortRange,
    upload_status: 'ready',
    retention_status: 'active',
    updated_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
  } as GarmentItem
}

const RANGES = ['cold', 'cool', 'mild', 'warm', 'hot'] as const
const WARDROBE_WITH_DRESS: GarmentItem[] = [
  ...RANGES.flatMap((range) => [
    garment(`top-${range}`, 'top', range),
    garment(`bottom-${range}`, 'bottom', range),
    garment(`shoes-${range}`, 'shoes', range),
  ]),
  garment('outer-cold', 'outerwear', 'cold'),
  garment('outer-cool', 'outerwear', 'cool'),
  garment('dress-warm', 'dress', 'warm'),
]
const SPARSE_WARDROBE: GarmentItem[] = [
  garment('top-mild', 'top', 'mild'),
  garment('shoes-hot', 'shoes', 'hot'),
]
const noCapsules: CapsuleWithJoins[] = []

function weather(input: WeatherCase): EngineWeatherInput {
  const shared = { ...input, condition: 'clear', source: 'hourly' as const }
  return {
    status: 'available',
    scenarios: [
      { scenario: 'morning', ...shared },
      { scenario: 'midday', ...shared, source: 'daily' },
      { scenario: 'evening', ...shared, feelsLike: input.feelsLike - 1 },
    ],
  }
}

// One line per grid cell: the cell key and the SHA-256 of the full scenario output, so a
// change names the exact cell while the file stays small enough to review.
function recordGrid(): string[] {
  const rows: string[] = []
  for (const locale of LOCALES) {
    for (const runsColdWarm of COMFORT_RUNS) {
      for (const windTolerance of TOLERANCES) {
        for (const precipPreparedness of TOLERANCES) {
          const comfortPreferences: ComfortPreferencesInput = {
            runsColdWarm,
            windTolerance,
            precipPreparedness,
          }
          WEATHER_CASES.forEach((weatherCase, index) => {
            const wardrobe = index % 2 === 0 ? WARDROBE_WITH_DRESS : SPARSE_WARDROBE
            const result = generateRitualScenarios({
              userId: 'golden-user',
              targetLocalDate: '2026-11-15',
              locale,
              comfortPreferences,
              eligibleGarments: wardrobe,
              eligibleCapsules: noCapsules,
              weather: weather(weatherCase),
            })
            const digest = createHash('sha256')
              .update(JSON.stringify(result.scenarios))
              .digest('hex')
            rows.push(
              `${locale}|${runsColdWarm}|${windTolerance}|${precipPreparedness}|${index} ${digest}`
            )
          })
        }
      }
    }
  }
  return rows
}

describe('ritual generation golden outputs (6.16 U-ENGINE-GOLDEN)', () => {
  it('reproduces the recorded comfort-rule outputs for the boundary grid', async () => {
    const grid = recordGrid()
    expect(grid).toHaveLength(LOCALES.length * 27 * WEATHER_CASES.length)
    await expect(`${grid.join('\n')}\n`).toMatchFileSnapshot(
      './__golden__/ritual-generation-engine.golden.txt'
    )
  })

  it('reproduces the unavailable-weather outputs', async () => {
    const rows = LOCALES.map((locale) =>
      generateRitualScenarios({
        userId: 'golden-user',
        targetLocalDate: '2026-11-15',
        locale,
        comfortPreferences: {
          runsColdWarm: 'neutral',
          windTolerance: 'medium',
          precipPreparedness: 'medium',
        },
        eligibleGarments: WARDROBE_WITH_DRESS,
        eligibleCapsules: noCapsules,
        weather: { status: 'unavailable' },
      })
    )
    await expect(`${JSON.stringify(rows, null, 1)}\n`).toMatchFileSnapshot(
      './__golden__/ritual-generation-engine-unavailable.golden.json'
    )
  })

  it('keeps the threshold getters exact', () => {
    expect(TOLERANCES.map(getWindThreshold)).toEqual([3, 5, 8])
    expect(TOLERANCES.map(getRainProbThreshold)).toEqual([0.7, 0.4, 0.2])
    expect(TOLERANCES.map(getRainAmountThreshold)).toEqual([2, 0.5, 0.1])
  })
})
