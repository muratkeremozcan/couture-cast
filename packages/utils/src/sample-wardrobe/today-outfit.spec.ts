// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import { describe, expect, it, vi } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import * as selector from './selector'
import {
  applyTodaySlotEdits,
  buildTodaySaveAttempt,
  buildTodaySlots,
  todayCatalogSlot,
  todayForecastPeriods,
  todayLocalDate,
  todayLookNameKey,
  todayRitualAnchorDate,
  todayScenarioWeather,
  todaySlotCatalogItem,
  todaySlotSignature,
  todaySwapOptions,
} from './today-outfit'

const mild = {
  feelsLike: 18,
  windSpeed: 0,
  precipitationAmount: 0,
  precipitationProbability: 0,
}
const imageAccess = {
  url: 'https://storage.example.test/private-top.png',
  expiresAt: '2026-11-20T15:15:00Z',
}
const top = SAMPLE_CATALOG.garments.find(({ id }) => id === 'sample:g:cotton-tee')!
const base = todayCatalogSlot(top)
const closet = {
  id: 'closet-top',
  category: 'top',
  status: 'ready',
  retentionStatus: 'active',
  comfortRange: 'mild',
  imageAccess,
} as const

const forecast = (forecastAt: string, temperature: number, condition = 'clear') => ({
  ...mild,
  forecastAt,
  temperature,
  condition,
})
const weather = {
  timezone: 'UTC',
  current: { temperature: 9, condition: 'clouds' },
  hourly: [
    forecast('2026-11-20T08:00:00Z', 11),
    forecast('2026-11-20T13:00:00Z', 17),
    forecast('2026-11-20T13:30:00Z', 99),
    forecast('2026-11-20T16:00:00Z', 18),
    forecast('2026-11-20T19:00:00Z', 13, 'rain'),
    forecast('2026-11-21T08:00:00Z', 10),
  ],
}

function timestamp(value: string) {
  return Date.parse(value)
}

describe('Today outfit slots and saved composition', () => {
  it('uses a category illustration when the weather ranking returns no compatible catalog piece', () => {
    const candidates = vi.spyOn(selector, 'sampleSwapCandidates').mockReturnValueOnce([])
    try {
      const slots = buildTodaySlots(
        { id: 'fixture', garmentIds: ['default-outerwear'] },
        mild,
        []
      )
      expect(slots).toMatchObject([
        { itemId: 'sample:g:fleece-zip', category: 'outerwear', kind: 'catalog' },
      ])
    } finally {
      candidates.mockRestore()
    }
  })

  it('keeps ordered owned photos and resolves starter placeholders to catalog art', () => {
    const slots = buildTodaySlots(
      {
        id: 'fixture',
        garmentIds: ['owned', 'default-bottom', top.id],
        displayGarments: [{ id: 'owned', category: 'top', imageAccess }],
      },
      mild,
      []
    )

    expect(slots).toMatchObject([
      { itemId: 'owned', category: 'top', kind: 'garment', imageAccess },
      { category: 'bottom', kind: 'catalog' },
      { itemId: top.id, category: 'top', kind: 'catalog', art: top.art },
    ])
    expect(todaySlotCatalogItem(slots[0]!)).toBeUndefined()
    expect(todaySlotCatalogItem(slots[2]!)).toEqual(top)
    expect(todaySlotSignature(slots)).toBe(
      JSON.stringify(slots.map(({ category, kind, itemId }) => [category, kind, itemId]))
    )
  })

  it('uses the category from the closet and falls back to catalog when unavailable', () => {
    const slots = buildTodaySlots(
      {
        id: 'fixture',
        garmentIds: ['closet-top', 'untagged'],
        displayGarments: [{ id: 'untagged', category: null, imageAccess }],
      },
      mild,
      [closet]
    )

    expect(slots[0]).toMatchObject({
      itemId: 'closet-top',
      category: 'top',
      kind: 'garment',
    })
    expect(slots[1]).toMatchObject({ category: 'top', kind: 'catalog' })
    expect(slots[1]?.imageAccess).toBeUndefined()
  })

  it('only offers compatible same-category pieces, with the current piece first', () => {
    const options = todaySwapOptions(
      [base],
      0,
      [
        { ...closet, id: 'wrong-category', category: 'shoes' },
        { ...closet, id: 'not-ready', status: 'processing' },
        { ...closet, id: 'archived', retentionStatus: 'deleted' },
        { ...closet, id: 'too-warm', comfortRange: 'hot' },
        { ...closet, id: top.id },
        closet,
        { ...closet, id: 'unrated', comfortRange: null },
      ],
      mild
    )

    expect(options[0]).toEqual(base)
    expect(
      options.filter(({ kind }) => kind === 'garment').map(({ itemId }) => itemId)
    ).toEqual(['closet-top', 'unrated'])
    expect(
      options
        .slice(1)
        .every(({ category, itemId }) => category === 'top' && itemId !== top.id)
    ).toBe(true)
    expect(todaySwapOptions([base], 1, [], mild)).toEqual([])
  })

  it('keeps a compatible edit on refresh and drops missing, mismatched or unavailable edits', () => {
    const edited = todaySwapOptions([base], 0, [closet], mild)[1]!
    const catalog = todaySwapOptions([base], 0, [], mild)[1]!
    const edits = { 0: edited }
    expect(applyTodaySlotEdits([base], undefined, [], mild)).toEqual([base])
    expect(applyTodaySlotEdits([base, base], edits, [closet], mild)).toEqual([
      edited,
      base,
    ])
    expect(applyTodaySlotEdits([base], { 0: base }, [], mild)).toEqual([base])
    expect(
      applyTodaySlotEdits([base], { 0: { ...edited, category: 'shoes' } }, [closet], mild)
    ).toEqual([base])
    expect(applyTodaySlotEdits([base], { 0: catalog }, [], mild)).toEqual([catalog])
    expect(applyTodaySlotEdits([base], edits, [], mild)).toEqual([base])
    expect(
      applyTodaySlotEdits([base], edits, [{ ...closet, status: 'failed' }], mild)
    ).toEqual([base])
    expect(
      applyTodaySlotEdits([base], edits, [{ ...closet, comfortRange: 'hot' }], mild)
    ).toEqual([base])
  })

  it('writes the selected condition, date and ordered slots without photo access', () => {
    const slots = buildTodaySlots(
      {
        id: 'fixture',
        garmentIds: ['owned', top.id],
        displayGarments: [{ id: 'owned', category: 'top', imageAccess }],
      },
      mild,
      []
    )
    const attempt = buildTodaySaveAttempt(
      'a'.repeat(80),
      'rain',
      slots,
      '2026-11-20',
      'Rain-ready look'
    )
    expect(attempt.payload).toEqual({
      source: 'today',
      wornOn: '2026-11-20',
      lookId: `today:2026-11-20:${'a'.repeat(47)}`,
      weather: 'rain',
      title: 'Rain-ready look',
      swaps: {},
      composition: [
        { slotIndex: 0, itemId: 'owned', kind: 'garment', category: 'top' },
        { slotIndex: 1, itemId: top.id, kind: 'catalog', category: 'top' },
      ],
    })
    expect(attempt.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/)
    expect(
      buildTodaySaveAttempt('fixture', 'rain', slots, '2026-11-20', 'Rain-ready look')
        .idempotencyKey
    ).not.toBe(attempt.idempotencyKey)
  })
})

describe('Today local weather and dates', () => {
  it('uses the forecast timezone and falls back to UTC for an unknown timezone', () => {
    const instant = new Date('2026-11-20T03:30:00Z')
    expect(todayLocalDate('America/Chicago', instant)).toBe('2026-11-19')
    expect(todayLocalDate('invalid', instant)).toBe('2026-11-20')
  })

  it('advances by one local calendar day after the rollover, including DST', () => {
    expect(todayRitualAnchorDate('UTC', timestamp('2026-11-20T07:59:00Z'))).toBe(
      '2026-11-20'
    )
    expect(todayRitualAnchorDate('UTC', timestamp('2026-11-20T08:00:00Z'))).toBe(
      '2026-11-21'
    )
    expect(
      todayRitualAnchorDate('America/Chicago', timestamp('2026-03-09T04:30:00Z'))
    ).toBe('2026-03-09')
  })

  it('uses the first entry in each hour and falls back to the latest complete forecast', () => {
    const periods = {
      morning: weather.hourly[0],
      midday: weather.hourly[1],
      evening: weather.hourly[4],
    }
    expect(todayForecastPeriods(weather, timestamp('2026-11-20T07:00:00Z'))).toEqual(
      periods
    )
    expect(todayForecastPeriods(weather, timestamp('2026-11-20T09:00:00Z'))).toEqual(
      periods
    )
    expect(
      todayScenarioWeather(weather, 'evening', timestamp('2026-11-20T09:00:00Z'))
    ).toBe(weather.hourly[4])
    const missing = { ...weather, hourly: [] }
    expect(
      todayForecastPeriods(missing, timestamp('2026-11-20T09:00:00Z'))
    ).toBeUndefined()
    expect(
      todayScenarioWeather(missing, 'morning', timestamp('2026-11-20T09:00:00Z'))
    ).toEqual({ ...mild, ...missing.current, feelsLike: 9 })
  })

  it.each([
    [{ condition: 'rain' }, 'rain'],
    [{ condition: 'clear', precipitationProbability: 1 }, 'rain'],
    [{ condition: 'wind' }, 'wind'],
    [{ condition: 'clear', windSpeed: 80 }, 'wind'],
    [{ condition: 'clear', feelsLike: 6 }, 'cool'],
    [{ condition: 'clear', feelsLike: 12 }, 'cool'],
    [{ condition: 'clear', feelsLike: 24 }, 'warm'],
    [{ condition: 'clear', feelsLike: 32 }, 'warm'],
    [{ condition: 'clear' }, 'mild'],
  ] as const)('selects the weather title for %j', (input, expected) => {
    expect(todayLookNameKey({ ...mild, ...input })).toBe(expected)
  })
})
