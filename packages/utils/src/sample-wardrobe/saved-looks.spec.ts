// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import { DEFAULT_SAMPLE_COMFORT, selectSampleOutfit } from './selector'
import { stylePieceLooks } from './style-one-piece'
import {
  buildHomeSampleSavedLookInput,
  buildStylePieceSavedLookInput,
  createIdempotencyKey,
  savedLookMatchesHomeSample,
  savedLookMatchesStylePiece,
  savedLookToSampleBookmark,
  savedLookToStylePieceRecipe,
  type SavedLookLike,
} from './saved-looks'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('saved-looks helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates RFC 4122 UUID v4 keys via randomUUID, getRandomValues, and fallback', () => {
    expect(createIdempotencyKey()).toMatch(UUID_V4)

    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i += 1) arr[i] = i + 1
        return arr
      },
    })
    expect(createIdempotencyKey()).toMatch(UUID_V4)

    vi.stubGlobal('crypto', undefined)
    expect(createIdempotencyKey()).toMatch(UUID_V4)
  })

  it('builds and matches Style this piece saved look inputs preserving slot order and swaps', () => {
    const garment = { id: 'g-1', category: 'top' as const, comfortRange: 'mild' as const }
    const looks = stylePieceLooks(garment, 'mild-dry', SAMPLE_CATALOG).looks
    expect(looks.length).toBeGreaterThan(0)
    const baseLook = looks[0]!
    const swappedLook = {
      ...baseLook,
      recipe: {
        ...baseLook.recipe,
        swaps: { shoes: baseLook.companions.find((c) => c.category === 'shoes')!.id },
      },
    }

    const payload = buildStylePieceSavedLookInput(garment, swappedLook)
    expect(payload.source).toBe('style_piece')
    expect(payload.anchorGarmentId).toBe('g-1')
    expect(payload.anchorSnapshot).toEqual({
      garmentId: 'g-1',
      category: 'top',
      comfortRange: 'mild',
    })
    expect(payload.composition[0]).toEqual({
      slotIndex: 0,
      category: 'top',
      kind: 'garment',
      itemId: 'g-1',
    })
    expect(payload.composition.slice(1).map((s) => s.slotIndex)).toEqual(
      swappedLook.companions.map((_, i) => i + 1)
    )
    expect(payload.composition.slice(1).every((s) => s.kind === 'catalog')).toBe(true)

    const savedRow: SavedLookLike = {
      id: 'sl-1',
      source: 'style_piece',
      lookId: payload.lookId,
      weather: payload.weather,
      anchorGarmentId: 'g-1',
      swaps: payload.swaps,
      collection: null,
      comfort: null,
    }

    expect(savedLookMatchesStylePiece(savedRow, 'g-1', swappedLook)).toBe(true)
    expect(savedLookMatchesStylePiece(savedRow, 'g-other', swappedLook)).toBe(false)
    expect(savedLookMatchesStylePiece(savedRow, 'g-1', baseLook)).toBe(false)
    expect(
      savedLookMatchesStylePiece(
        { ...savedRow, swaps: { shoes: 'sample:g:different' } },
        'g-1',
        swappedLook
      )
    ).toBe(false)
    expect(
      savedLookMatchesStylePiece(
        { ...savedRow, swaps: undefined as unknown as SavedLookLike['swaps'] },
        'g-1',
        baseLook
      )
    ).toBe(true)

    expect(savedLookToStylePieceRecipe(savedRow)).toEqual(swappedLook.recipe)
    expect(savedLookToStylePieceRecipe({ ...savedRow, source: 'home_sample' })).toBeNull()
    expect(savedLookToStylePieceRecipe({ ...savedRow, weather: 'unknown' })).toBeNull()
  })

  it('builds, converts, and matches Home sample saved look inputs', () => {
    const result = selectSampleOutfit(
      {
        weather: 'mild-dry',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        votes: {},
        swaps: {},
      },
      SAMPLE_CATALOG
    )
    expect(result.look).toBeTruthy()
    const lookId = result.look!.id
    const shoe = result.garments.find((g) => g.category === 'shoes')!
    const withSwap = selectSampleOutfit(
      {
        weather: 'mild-dry',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        selectedLookId: lookId,
        votes: {},
        swaps: { [lookId]: { shoes: shoe.id } },
      },
      SAMPLE_CATALOG
    )

    const payload = buildHomeSampleSavedLookInput(withSwap)
    expect(payload).not.toBeNull()
    expect(payload?.source).toBe('home_sample')
    expect(payload?.swaps).toEqual({ shoes: shoe.id })
    expect(
      payload?.composition.every(
        (slot, i) => slot.slotIndex === i && slot.kind === 'catalog'
      )
    ).toBe(true)

    const savedRow: SavedLookLike = {
      id: 'sl-home-1',
      source: 'home_sample',
      lookId: payload!.lookId,
      weather: payload!.weather,
      anchorGarmentId: null,
      swaps: payload!.swaps,
      collection: payload!.collection ?? null,
      comfort: payload!.comfort ?? null,
    }

    expect(savedLookMatchesHomeSample(savedRow, withSwap)).toBe(true)
    expect(
      savedLookMatchesHomeSample({ ...savedRow, collection: 'womenswear' }, withSwap)
    ).toBe(false)
    expect(
      savedLookMatchesHomeSample(savedRow, {
        ...withSwap,
        look: null,
      } as unknown as typeof withSwap)
    ).toBe(false)

    expect(savedLookToSampleBookmark(savedRow)).toEqual({
      lookId: payload!.lookId,
      weather: 'mild-dry',
      collection: 'all',
      comfort: DEFAULT_SAMPLE_COMFORT,
      swaps: { shoes: shoe.id },
    })

    // Edge cases returning null
    expect(buildHomeSampleSavedLookInput({ ...withSwap, look: null })).toBeNull()
    expect(
      buildHomeSampleSavedLookInput({
        ...withSwap,
        input: { ...withSwap.input, weather: 'invalid-weather' as 'mild-dry' },
      })
    ).toBeNull()
    expect(savedLookToSampleBookmark({ ...savedRow, source: 'style_piece' })).toBeNull()
    expect(savedLookToSampleBookmark({ ...savedRow, weather: 'bad' })).toBeNull()
    expect(savedLookToSampleBookmark({ ...savedRow, collection: 'bad' })).toBeNull()
    expect(savedLookToSampleBookmark({ ...savedRow, comfort: null })).toBeNull()
  })
})
