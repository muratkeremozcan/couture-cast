// Story 5.5: premium 7-day outfit planner.
import { describe, expect, it } from 'vitest'
import {
  plannerHeadersSchema,
  plannerQueryParamsSchema,
  plannerResponseSchema,
  plannerReshuffleInputSchema,
  plannerReshufflePathParamsSchema,
  plannerReshuffleResponseSchema,
} from '../src/contracts/http'

function buildScenarioOutfit(scenario: 'morning' | 'midday' | 'evening') {
  return {
    id: `outfit-${scenario}`,
    scenario,
    garmentIds: ['garment-1', 'garment-2'],
    reasoningBadges: [
      { key: 'daily_base', label: 'Daily base', bullets: ['Standard top and bottom.'] },
    ],
    comfortNotes: 'Layer up; it will feel cooler than it reads.',
    capsuleId: null,
    capsuleName: null,
    autoFilledGarmentIds: [],
    displayGarments: [
      { id: 'garment-1', category: 'top', imageAccess: null },
      { id: 'garment-2', category: 'bottom', imageAccess: null },
    ],
    shopThisLook: null,
  }
}

function buildReadyDay(planDate: string, version = 1) {
  return {
    status: 'ready' as const,
    planDate,
    version,
    weather: {
      confidence: 'hourly',
      freshness: 'fresh',
      condition: 'clear',
      temperatureLow: 15,
      temperatureHigh: 22,
    },
    isStarterWardrobe: false,
    outfits: [
      buildScenarioOutfit('morning'),
      buildScenarioOutfit('midday'),
      buildScenarioOutfit('evening'),
    ],
  }
}

function buildErrorDay(planDate: string) {
  return {
    status: 'error' as const,
    planDate,
    errorCode: 'generation_failed',
    retryable: true,
  }
}

const SEVEN_DATES = [
  '2026-07-16',
  '2026-07-17',
  '2026-07-18',
  '2026-07-19',
  '2026-07-20',
  '2026-07-21',
  '2026-07-22',
]

function buildResponse(days: readonly unknown[]) {
  const readyCount = days.filter(
    (day) =>
      typeof day === 'object' &&
      day !== null &&
      (day as { status?: unknown }).status === 'ready'
  ).length
  return {
    data: {
      locationId: 'saved-location-1',
      timezone: 'America/Chicago',
      anchorDate: '2026-07-16',
      daysReady: readyCount,
      days,
    },
  }
}

describe('planner response days collection', () => {
  it('accepts seven ready days across consecutive dates', () => {
    const parsed = plannerResponseSchema.parse(
      buildResponse(SEVEN_DATES.map((date) => buildReadyDay(date)))
    )
    expect(parsed.data.days).toHaveLength(7)
    expect(parsed.data.daysReady).toBe(7)
  })

  it('accepts a partial week with isolated error days interleaved', () => {
    const days = SEVEN_DATES.map((date, index) =>
      index === 3 ? buildErrorDay(date) : buildReadyDay(date)
    )
    const parsed = plannerResponseSchema.parse(buildResponse(days))
    expect(parsed.data.days[3]?.status).toBe('error')
    expect(parsed.data.days.filter((day) => day.status === 'ready')).toHaveLength(6)
  })

  it('rejects fewer or more than seven days', () => {
    expect(
      plannerResponseSchema.safeParse(
        buildResponse(SEVEN_DATES.slice(0, 6).map((date) => buildReadyDay(date)))
      ).success
    ).toBe(false)
    expect(
      plannerResponseSchema.safeParse(
        buildResponse([...SEVEN_DATES, '2026-07-23'].map((date) => buildReadyDay(date)))
      ).success
    ).toBe(false)
  })

  it('rejects a duplicate date even when the count is seven', () => {
    const dates = [...SEVEN_DATES.slice(0, 6), SEVEN_DATES[5]!]
    const result = plannerResponseSchema.safeParse(
      buildResponse(dates.map((date) => buildReadyDay(date)))
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'days must be exactly seven unique, consecutive local dates in chronological order.'
      )
    }
  })

  it('rejects dates that are not chronologically consecutive', () => {
    const dates = [...SEVEN_DATES]
    // Swap two dates so the sequence is no longer strictly consecutive.
    const swapped = [dates[1]!, dates[0]!, ...dates.slice(2)]
    const result = plannerResponseSchema.safeParse(
      buildResponse(swapped.map((date) => buildReadyDay(date)))
    )
    expect(result.success).toBe(false)
  })

  it('rejects an out-of-order (non-chronological) week even with unique consecutive dates present', () => {
    const reversed = [...SEVEN_DATES].reverse()
    const result = plannerResponseSchema.safeParse(
      buildResponse(reversed.map((date) => buildReadyDay(date)))
    )
    expect(result.success).toBe(false)
  })

  it('rejects an invalid calendar date', () => {
    const days = [...SEVEN_DATES.slice(0, 6), '2026-02-30']
    expect(
      plannerResponseSchema.safeParse(
        buildResponse(days.map((date) => buildReadyDay(date)))
      ).success
    ).toBe(false)
  })

  it('rejects a malformed date shape', () => {
    const days = [...SEVEN_DATES.slice(0, 6), '07/22/2026']
    expect(
      plannerResponseSchema.safeParse(
        buildResponse(days.map((date) => buildReadyDay(date)))
      ).success
    ).toBe(false)
  })
})

describe('planner ready day outfits collection', () => {
  it('rejects a duplicate scenario within a ready day, even when the count is three', () => {
    const day = buildReadyDay(SEVEN_DATES[0]!)
    if (day.status === 'ready') {
      day.outfits = [
        buildScenarioOutfit('morning'),
        buildScenarioOutfit('morning'),
        buildScenarioOutfit('evening'),
      ]
    }
    const days = [day, ...SEVEN_DATES.slice(1).map((date) => buildReadyDay(date))]
    const result = plannerResponseSchema.safeParse(buildResponse(days))
    expect(result.success).toBe(false)
  })

  it('rejects fewer or more than three outfits on a ready day', () => {
    const day = buildReadyDay(SEVEN_DATES[0]!) as Record<string, unknown>
    ;(day.outfits as unknown[]).pop()
    const days = [day, ...SEVEN_DATES.slice(1).map((date) => buildReadyDay(date))]
    expect(plannerResponseSchema.safeParse(buildResponse(days)).success).toBe(false)
  })

  // Story 5.5 Decision 4: planner cards never carry an affiliate CTA.
  it('rejects a non-null shopThisLook on a planner scenario outfit', () => {
    const day = buildReadyDay(SEVEN_DATES[0]!)
    if (day.status === 'ready') {
      const outfit = day.outfits[0] as unknown as Record<string, unknown>
      outfit.shopThisLook = {
        offerId: 'offer-1',
        title: 'Shop this look',
        deepLink: 'https://example.com',
      }
    }
    const days = [day, ...SEVEN_DATES.slice(1).map((date) => buildReadyDay(date))]
    const result = plannerResponseSchema.safeParse(buildResponse(days))
    expect(result.success).toBe(false)
  })
})

describe('planner error day', () => {
  it('accepts only the documented errorCode and retryable value', () => {
    const errorDay = buildErrorDay(SEVEN_DATES[0]!) as Record<string, unknown>
    errorDay.errorCode = 'timeout'
    const days = [errorDay, ...SEVEN_DATES.slice(1).map((date) => buildReadyDay(date))]
    expect(plannerResponseSchema.safeParse(buildResponse(days)).success).toBe(false)
  })
})

describe('planner headers', () => {
  it('accepts a declared platform', () => {
    expect(
      plannerHeadersSchema.parse({ 'x-couture-platform': 'web' })['x-couture-platform']
    ).toBe('web')
    expect(
      plannerHeadersSchema.parse({ 'x-couture-platform': 'mobile' })['x-couture-platform']
    ).toBe('mobile')
  })

  it('rejects a missing platform header', () => {
    expect(plannerHeadersSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an undeclared platform value', () => {
    expect(
      plannerHeadersSchema.safeParse({ 'x-couture-platform': 'desktop' }).success
    ).toBe(false)
  })
})

describe('planner query params', () => {
  it('accepts an empty query', () => {
    expect(plannerQueryParamsSchema.parse({})).toEqual({})
  })

  it('accepts a location and locale together', () => {
    expect(
      plannerQueryParamsSchema.parse({ locationId: 'saved-1', locale: 'fr-FR' })
    ).toEqual({ locationId: 'saved-1', locale: 'fr-FR' })
  })

  it('rejects an unknown query parameter', () => {
    expect(plannerQueryParamsSchema.safeParse({ locationID: 'saved-1' }).success).toBe(
      false
    )
  })
})

describe('planner reshuffle path params', () => {
  it('accepts a valid calendar date', () => {
    expect(plannerReshufflePathParamsSchema.parse({ planDate: '2026-07-16' })).toEqual({
      planDate: '2026-07-16',
    })
  })

  it('rejects an invalid calendar date', () => {
    expect(
      plannerReshufflePathParamsSchema.safeParse({ planDate: '2026-02-30' }).success
    ).toBe(false)
  })

  it('rejects a malformed date shape', () => {
    expect(
      plannerReshufflePathParamsSchema.safeParse({ planDate: 'not-a-date' }).success
    ).toBe(false)
  })
})

describe('planner reshuffle input', () => {
  it('accepts a positive expectedVersion', () => {
    expect(plannerReshuffleInputSchema.parse({ expectedVersion: 1 })).toEqual({
      expectedVersion: 1,
    })
  })

  it('rejects a zero or negative expectedVersion', () => {
    expect(plannerReshuffleInputSchema.safeParse({ expectedVersion: 0 }).success).toBe(
      false
    )
    expect(plannerReshuffleInputSchema.safeParse({ expectedVersion: -1 }).success).toBe(
      false
    )
  })

  it('rejects an unknown field', () => {
    expect(
      plannerReshuffleInputSchema.safeParse({ expectedVersion: 1, force: true }).success
    ).toBe(false)
  })
})

describe('planner reshuffle response', () => {
  it('accepts a reshuffled ready day with unchanged: false', () => {
    const parsed = plannerReshuffleResponseSchema.parse({
      data: { day: buildReadyDay('2026-07-16', 2), unchanged: false },
    })
    expect(parsed.data.unchanged).toBe(false)
    expect(parsed.data.day.status).toBe('ready')
  })

  it('accepts unchanged: true when no disjoint result exists', () => {
    expect(
      plannerReshuffleResponseSchema.safeParse({
        data: { day: buildReadyDay('2026-07-16', 1), unchanged: true },
      }).success
    ).toBe(true)
  })
})
