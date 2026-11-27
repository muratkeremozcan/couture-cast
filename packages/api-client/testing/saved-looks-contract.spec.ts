// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import { describe, expect, it } from 'vitest'
import {
  createSavedLookInputSchema,
  listSavedLooksQuerySchema,
  savedLookIdPathParamsSchema,
  savedLookListResponseSchema,
  savedLookResponseSchema,
} from '../src/contracts/http/saved-looks'

const VALID_HOME_SAMPLE_INPUT = {
  source: 'home_sample' as const,
  lookId: 'sample:l:silk-midi',
  weather: 'warm-rainy',
  title: '  Rainy midi look  ',
  anchorGarmentId: null,
  anchorSnapshot: null,
  composition: [
    {
      slotIndex: 0,
      category: 'top' as const,
      kind: 'catalog' as const,
      itemId: 'sample:g:knit-tee',
      label: 'Knit tee',
    },
    {
      slotIndex: 1,
      category: 'bottom' as const,
      kind: 'catalog' as const,
      itemId: 'sample:g:midi-skirt',
      label: null,
    },
  ],
  swaps: { shoes: 'sample:g:loafers' },
  collection: 'all',
  comfort: {
    runsColdWarm: 'neutral' as const,
    windTolerance: 'medium' as const,
    precipPreparedness: 'high' as const,
  },
}

const VALID_STYLE_PIECE_INPUT = {
  source: 'style_piece' as const,
  lookId: 'sample:l:silk-midi',
  weather: 'warm-rainy',
  title: '   ',
  anchorGarmentId: 'garment-1',
  anchorSnapshot: {
    garmentId: 'garment-1',
    category: 'top' as const,
    comfortRange: 'mild' as const,
  },
  composition: [
    {
      slotIndex: 0,
      category: 'top' as const,
      kind: 'garment' as const,
      itemId: 'garment-1',
    },
    {
      slotIndex: 1,
      category: 'bottom' as const,
      kind: 'catalog' as const,
      itemId: 'sample:g:midi-skirt',
    },
  ],
  swaps: {},
}

describe('Today saved look compatibility', () => {
  const input = {
    ...VALID_STYLE_PIECE_INPUT,
    source: 'today',
    lookId: 'today:2026-11-20:morning',
    wornOn: '2026-11-20',
    weather: 'clear',
    anchorGarmentId: null,
    anchorSnapshot: null,
  }

  it('accepts an ordered mixed composition with a matching local date', () => {
    const parsed = createSavedLookInputSchema.parse(input)

    expect(parsed.wornOn).toBe('2026-11-20')
    expect(
      parsed.composition.map(({ slotIndex, itemId }) => [slotIndex, itemId])
    ).toEqual([
      [0, 'garment-1'],
      [1, 'sample:g:midi-skirt'],
    ])
  })

  it.each([undefined, '2026-11-21', '2026-02-30'])(
    'rejects invalid Today date %s',
    (wornOn) => {
      expect(createSavedLookInputSchema.safeParse({ ...input, wornOn }).success).toBe(
        false
      )
    }
  )

  it('keeps existing list queries compatible and accepts the explicit Today opt-in', () => {
    expect(listSavedLooksQuerySchema.parse({ source: 'home_sample' })).toEqual({
      source: 'home_sample',
      limit: 50,
      offset: 0,
    })
    expect(listSavedLooksQuerySchema.parse({ includeToday: 'true' })).toEqual({
      includeToday: 'true',
      limit: 50,
      offset: 0,
    })
    expect(listSavedLooksQuerySchema.safeParse({ includeToday: 'false' }).success).toBe(
      false
    )
  })
})

describe('saved-looks HTTP contracts', () => {
  it('accepts valid home_sample and style_piece inputs and normalizes titles', () => {
    const home = createSavedLookInputSchema.parse(VALID_HOME_SAMPLE_INPUT)
    expect(home.title).toBe('Rainy midi look')

    const style = createSavedLookInputSchema.parse(VALID_STYLE_PIECE_INPUT)
    expect(style.title).toBeNull()
    expect(style.anchorGarmentId).toBe('garment-1')
  })

  it('rejects null bytes and over-long grapheme titles', () => {
    const nullByte = createSavedLookInputSchema.safeParse({
      ...VALID_HOME_SAMPLE_INPUT,
      title: 'bad\u0000title',
    })
    expect(nullByte.success).toBe(false)

    const tooLong = createSavedLookInputSchema.safeParse({
      ...VALID_HOME_SAMPLE_INPUT,
      title: 'a'.repeat(81),
    })
    expect(tooLong.success).toBe(false)
  })

  it('rejects duplicate or non-sequential composition slotIndex values', () => {
    const duplicate = createSavedLookInputSchema.safeParse({
      ...VALID_HOME_SAMPLE_INPUT,
      composition: [
        VALID_HOME_SAMPLE_INPUT.composition[0],
        { ...VALID_HOME_SAMPLE_INPUT.composition[1], slotIndex: 0 },
      ],
    })
    expect(duplicate.success).toBe(false)

    const nonSequential = createSavedLookInputSchema.safeParse({
      ...VALID_HOME_SAMPLE_INPUT,
      composition: [
        VALID_HOME_SAMPLE_INPUT.composition[0],
        { ...VALID_HOME_SAMPLE_INPUT.composition[1], slotIndex: 2 },
      ],
    })
    expect(nonSequential.success).toBe(false)
  })

  it('enforces style_piece and home_sample anchor and garment slot invariants', () => {
    expect(
      createSavedLookInputSchema.safeParse({
        ...VALID_STYLE_PIECE_INPUT,
        anchorGarmentId: null,
        anchorSnapshot: null,
      }).success
    ).toBe(false)

    expect(
      createSavedLookInputSchema.safeParse({
        ...VALID_STYLE_PIECE_INPUT,
        anchorSnapshot: {
          ...VALID_STYLE_PIECE_INPUT.anchorSnapshot,
          garmentId: 'garment-other',
        },
      }).success
    ).toBe(false)

    expect(
      createSavedLookInputSchema.safeParse({
        ...VALID_HOME_SAMPLE_INPUT,
        anchorGarmentId: 'garment-1',
        anchorSnapshot: VALID_STYLE_PIECE_INPUT.anchorSnapshot,
      }).success
    ).toBe(false)

    expect(
      createSavedLookInputSchema.safeParse({
        ...VALID_HOME_SAMPLE_INPUT,
        composition: [
          {
            slotIndex: 0,
            category: 'top',
            kind: 'garment',
            itemId: 'garment-1',
          },
        ],
      }).success
    ).toBe(false)
  })

  it('parses query, path params, single and list responses including multi-codepoint emoji titles', () => {
    expect(listSavedLooksQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 })
    expect(
      listSavedLooksQuerySchema.parse({
        source: 'style_piece',
        anchorGarmentId: 'garment-1',
        limit: '25',
        offset: '10',
      })
    ).toEqual({
      source: 'style_piece',
      anchorGarmentId: 'garment-1',
      limit: 25,
      offset: 10,
    })
    expect(savedLookIdPathParamsSchema.parse({ savedLookId: 'sl-1' })).toEqual({
      savedLookId: 'sl-1',
    })

    const emojiTitle = '👍🏽'.repeat(41)
    const look = {
      id: 'sl-1',
      ownerUserId: 'user-1',
      source: 'home_sample' as const,
      lookId: 'sample:l:silk-midi',
      weather: 'warm-rainy',
      title: emojiTitle,
      anchorGarmentId: null,
      anchorSnapshot: null,
      composition: [
        {
          slotIndex: 0,
          category: 'top' as const,
          kind: 'catalog' as const,
          itemId: 'sample:g:knit-tee',
          label: 'Knit tee',
          missing: false,
          imageAccess: null,
        },
      ],
      swaps: {},
      collection: 'all',
      comfort: VALID_HOME_SAMPLE_INPUT.comfort,
      availabilityStatus: 'ready' as const,
      missingGarmentIds: [],
      needsReviewReasons: [],
      revision: 0,
      createdAt: '2026-11-22T01:00:00.000Z',
      updatedAt: '2026-11-22T01:00:00.000Z',
    }

    expect(savedLookResponseSchema.parse({ data: look }).data.title).toBe(emojiTitle)
    expect(
      savedLookListResponseSchema.parse({
        data: [look],
        total: 1,
        limit: 50,
        offset: 0,
      }).total
    ).toBe(1)
  })
})
