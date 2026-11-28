// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 61: Import device-saved looks for the same member.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-61-import-device-saved-looks-for-the-same-member
// Learning path Step 87: Style this piece with my own garments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-87-style-this-piece-with-my-own-garments
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import { DEFAULT_SAMPLE_COMFORT, selectSampleOutfit } from './selector'
import {
  applyStylePieceRecipe,
  stylePieceLooks,
  stylePieceStorageKey,
  type StylePieceOwnedCompanion,
} from './style-one-piece'
import {
  buildHomeSampleSavedLookInput,
  buildStylePieceSavedLookInput,
  createDeterministicIdempotencyKey,
  createIdempotencyKey,
  doesSavedLookResolve,
  memberSampleBookmarksStorageKeys,
  parseLegacyHomeSampleBookmarksForImport,
  parseLegacyStylePieceRecipesForImport,
  parseMemberSampleBookmarksStorageKey,
  parseStylePieceStorageKey,
  reopenStylePieceAnchor,
  reopenStylePieceRecipe,
  savedLookMatchesHomeSample,
  savedLookMatchesStylePiece,
  savedLookToSampleBookmark,
  savedLookToStylePieceRecipe,
  savedStylePieceEditorRecipe,
  stylePieceLookHasCurrentCompanions,
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

  it('[7.30-ACCOUNT] restores the saved mixed slots after compatible inventory grows', () => {
    const anchor = { id: 'owned-top', category: 'top', comfortRange: 'mild' } as const
    const owned = {
      id: 'owned-jeans',
      category: 'bottom',
      kind: 'garment',
      comfortRange: 'mild',
      photo: {
        url: 'https://example.test/signed-jeans',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    } satisfies StylePieceOwnedCompanion
    const alternative = { ...owned, id: 'another-pair' }
    const base = stylePieceLooks(anchor, 'mild-dry').looks.find(
      ({ recipe }) => recipe.lookId === 'sample:l:office-oxford'
    )!
    const look = applyStylePieceRecipe(
      base,
      { ...base.recipe, swaps: { bottom: owned.id } },
      SAMPLE_CATALOG,
      [owned]
    )

    const payload = buildStylePieceSavedLookInput(anchor, look)
    expect(payload.composition).toEqual([
      { slotIndex: 0, category: 'top', kind: 'garment', itemId: anchor.id },
      { slotIndex: 1, category: 'bottom', kind: 'garment', itemId: owned.id },
      { slotIndex: 2, category: 'shoes', kind: 'catalog', itemId: 'sample:g:loafers' },
    ])
    expect(payload.swaps).toEqual({})

    const saved = {
      ...payload,
      id: 'saved-mixed',
      availabilityStatus: 'ready',
      anchorGarmentId: anchor.id,
      collection: null,
      comfort: null,
    }
    const available = [alternative, { ...owned, photo: null }]
    const recipe = reopenStylePieceRecipe(saved, anchor, available)
    expect(recipe).not.toBeNull()
    const reopened = applyStylePieceRecipe(base, recipe!, SAMPLE_CATALOG, available)
    expect(buildStylePieceSavedLookInput(anchor, reopened).composition).toEqual(
      payload.composition
    )

    expect(reopenStylePieceRecipe(saved, anchor, [alternative])).toBeNull()
    expect(
      reopenStylePieceRecipe(
        { ...saved, availabilityStatus: 'needs_review' },
        anchor,
        available
      )
    ).toBeNull()
    expect(
      reopenStylePieceRecipe(saved, { ...anchor, id: 'wrong-anchor' }, available)
    ).toBeNull()
    expect(
      reopenStylePieceRecipe({ ...saved, lookId: 'sample:l:unknown' }, anchor, available)
    ).toBeNull()
    expect(
      reopenStylePieceRecipe(
        {
          ...saved,
          composition: saved.composition.slice(0, 2),
        },
        anchor,
        available
      )
    ).toBeNull()
    expect(savedStylePieceEditorRecipe({ ...saved, source: 'home_sample' })).toBeNull()
    expect(savedStylePieceEditorRecipe({ ...saved, weather: 'unknown' })).toBeNull()

    expect(savedLookMatchesStylePiece(saved, anchor.id, look)).toBe(true)
    expect(savedLookMatchesStylePiece(saved, anchor.id, base)).toBe(false)
    expect(
      savedLookMatchesStylePiece(
        { ...saved, composition: saved.composition.slice(0, 2) },
        anchor.id,
        look
      )
    ).toBe(false)
    expect(stylePieceLookHasCurrentCompanions(look, available)).toBe(true)
    expect(stylePieceLookHasCurrentCompanions(look, [alternative])).toBe(false)
    expect(
      stylePieceLookHasCurrentCompanions(look, [{ ...owned, category: 'shoes' }])
    ).toBe(false)
    expect(
      stylePieceLookHasCurrentCompanions(look, [{ ...owned, comfortRange: 'cold' }])
    ).toBe(false)
    expect(stylePieceLookHasCurrentCompanions(base, [])).toBe(true)

    const anchorItem = {
      ...anchor,
      status: 'ready',
      retentionStatus: 'active',
      imageAccess: owned.photo,
    }
    const ownedItem = {
      id: owned.id,
      category: owned.category,
      comfortRange: owned.comfortRange,
      status: 'ready',
      retentionStatus: 'active',
      imageAccess: null,
    }
    expect(reopenStylePieceAnchor(saved, [ownedItem, anchorItem])).toBe(anchorItem)
    expect(reopenStylePieceAnchor(saved, [ownedItem])).toBeNull()
    expect(
      reopenStylePieceAnchor(saved, [{ ...anchorItem, imageAccess: null }, ownedItem])
    ).toBeNull()
    expect(reopenStylePieceAnchor(saved, [anchorItem])).toBeNull()
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

  it('creates deterministic UUID v4 idempotency keys and parses legacy storage keys strictly', () => {
    const keyA1 = createDeterministicIdempotencyKey('legacy-import:v1:user-1:look-a')
    const keyA2 = createDeterministicIdempotencyKey('legacy-import:v1:user-1:look-a')
    const keyB = createDeterministicIdempotencyKey('legacy-import:v1:user-1:look-b')
    expect(keyA1).toMatch(UUID_V4)
    expect(keyA1).toBe(keyA2)
    expect(keyA1).not.toBe(keyB)

    expect(memberSampleBookmarksStorageKeys('')).toEqual([])
    expect(memberSampleBookmarksStorageKeys('bad\u0000owner')).toEqual([])
    expect(memberSampleBookmarksStorageKeys('user:1')).toEqual([
      'couturecast.member-sample-bookmarks.user:1',
      'couturecast.member-sample-bookmarks.user%3A1',
    ])

    expect(
      parseMemberSampleBookmarksStorageKey('couturecast.member-sample-bookmarks.user-1')
    ).toBe('user-1')
    expect(
      parseMemberSampleBookmarksStorageKey(
        'couturecast.member-sample-bookmarks.user%3A1.json',
        { allowJsonExtension: true }
      )
    ).toBe('user:1')
    expect(
      parseMemberSampleBookmarksStorageKey(
        'couturecast.member-sample-bookmarks.user%3A1.json'
      )
    ).toBe('user:1.json')
    expect(
      parseMemberSampleBookmarksStorageKey('couturecast.member-sample-bookmarks.%E0%A4%A')
    ).toBe('%E0%A4%A')
    expect(
      parseMemberSampleBookmarksStorageKey('couturecast.guest-preview.v1')
    ).toBeNull()
    expect(
      parseMemberSampleBookmarksStorageKey('couturecast.member-sample-bookmarks.')
    ).toBeNull()

    const styleKey = stylePieceStorageKey('member~1%a', 'garment~2')
    expect(parseStylePieceStorageKey(styleKey)).toEqual({
      owner: 'member~1%a',
      garmentId: 'garment~2',
    })
    // Browser localStorage rejects noncanonical .json suffix unless allowJsonExtension is set for native files
    expect(parseStylePieceStorageKey(`${styleKey}.json`)).toBeNull()
    expect(
      parseStylePieceStorageKey(`${styleKey}.json`, { allowJsonExtension: true })
    ).toEqual({
      owner: 'member~1%a',
      garmentId: 'garment~2',
    })
    expect(parseStylePieceStorageKey('couturecast.guest-preview.v1')).toBeNull()
    expect(parseStylePieceStorageKey('couturecast.style-piece.')).toBeNull()
    expect(parseStylePieceStorageKey('couturecast.style-piece.not-json')).toBeNull()
    expect(
      parseStylePieceStorageKey('couturecast.style-piece.%5B%22a%22%2C%22b%22%5D')
    ).toBeNull()
    expect(
      parseStylePieceStorageKey(
        `couturecast.style-piece.${encodeURIComponent(JSON.stringify(['only-one'])).replaceAll('%', '~')}`
      )
    ).toBeNull()
  })

  it('evaluates doesSavedLookResolve for style_piece, home_sample, and synthetic look IDs', () => {
    // Non-catalog synthetic look IDs stay ready
    expect(
      doesSavedLookResolve({
        source: 'style_piece',
        lookId: 'look-01',
        weather: 'mild-dry',
      })
    ).toBe(true)

    // Resolvable style_piece look
    expect(
      doesSavedLookResolve({
        source: 'style_piece',
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        anchorCategory: 'top',
        anchorComfortRange: 'mild',
        swaps: { shoes: 'sample:g:white-sneakers' },
      })
    ).toBe(true)

    // Unresolvable style_piece: missing anchor tags, protection mismatch, unknown swap category, or invalid swap candidate
    expect(
      doesSavedLookResolve({
        source: 'style_piece',
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        anchorCategory: null,
        anchorComfortRange: 'mild',
      })
    ).toBe(false)
    expect(
      doesSavedLookResolve({
        source: 'style_piece',
        lookId: 'sample:l:office-oxford',
        weather: 'warm-rainy',
        anchorCategory: 'outerwear',
        anchorComfortRange: 'cold',
      })
    ).toBe(false)
    expect(
      doesSavedLookResolve({
        source: 'style_piece',
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        anchorCategory: 'top',
        anchorComfortRange: 'mild',
        swaps: { dress: 'sample:g:wrap-dress' },
      })
    ).toBe(false)
    expect(
      doesSavedLookResolve({
        source: 'style_piece',
        lookId: 'sample:l:office-oxford',
        weather: 'cool-windy',
        anchorCategory: 'top',
        anchorComfortRange: 'cool',
        swaps: { shoes: 'sample:g:sandals' },
      })
    ).toBe(false)

    // Resolvable vs unresolvable home_sample look
    expect(
      doesSavedLookResolve({
        source: 'home_sample',
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        swaps: { shoes: 'sample:g:white-sneakers' },
      })
    ).toBe(true)
    expect(
      doesSavedLookResolve({
        source: 'home_sample',
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        collection: null,
        comfort: DEFAULT_SAMPLE_COMFORT,
      })
    ).toBe(false)
    expect(
      doesSavedLookResolve({
        source: 'home_sample',
        lookId: 'sample:l:summer-linen',
        weather: 'cool-windy',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
      })
    ).toBe(false)
    expect(
      doesSavedLookResolve({
        source: 'home_sample',
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        swaps: { shoes: 'sample:g:tailored-shorts' },
      })
    ).toBe(false)
  })

  it('parses legacy home_sample bookmarks preserving unresolved records for Needs review and rejecting tampered entries', () => {
    expect(parseLegacyHomeSampleBookmarksForImport(null, 'member-a')).toEqual({
      entries: [],
      hadInvalidEntries: false,
      malformedPayload: false,
    })
    expect(parseLegacyHomeSampleBookmarksForImport('', 'member-a').malformedPayload).toBe(
      true
    )
    expect(
      parseLegacyHomeSampleBookmarksForImport('{bad', 'member-a').malformedPayload
    ).toBe(true)
    expect(
      parseLegacyHomeSampleBookmarksForImport('{"not":"array"}', 'member-a')
        .malformedPayload
    ).toBe(true)

    const validBookmark = {
      lookId: 'sample:l:office-oxford',
      weather: 'mild-dry',
      collection: 'all',
      comfort: DEFAULT_SAMPLE_COMFORT,
      swaps: {
        shoes: 'sample:g:white-sneakers',
        bottom: 'sample:g:dark-jeans',
      },
    }
    const validBookmarkReorderedSwaps = {
      ...validBookmark,
      swaps: {
        bottom: 'sample:g:dark-jeans',
        shoes: 'sample:g:white-sneakers',
      },
    }
    const unresolvedBookmark = {
      lookId: 'sample:l:summer-linen',
      weather: 'cool-windy',
      collection: 'all',
      comfort: DEFAULT_SAMPLE_COMFORT,
      swaps: { shoes: 'sample:g:sandals' },
    }
    const retiredLookBookmark = {
      lookId: 'sample:l:retired-legacy-look',
      weather: 'mild-dry',
      collection: 'all',
      comfort: DEFAULT_SAMPLE_COMFORT,
      swaps: {},
    }
    const tamperedBookmark = {
      lookId: '../tampered-look',
      weather: 'mild-dry',
      collection: 'all',
      comfort: DEFAULT_SAMPLE_COMFORT,
      swaps: { shoes: 'javascript:alert(1)' },
    }

    const parsed = parseLegacyHomeSampleBookmarksForImport(
      JSON.stringify([
        validBookmark,
        validBookmark, // duplicate lookId should be deduplicated
        unresolvedBookmark,
        retiredLookBookmark,
        tamperedBookmark,
      ]),
      'member-a'
    )

    expect(parsed.malformedPayload).toBe(false)
    expect(parsed.hadInvalidEntries).toBe(true)
    expect(parsed.entries).toHaveLength(3)

    expect(parsed.entries[0]?.resolvesCleanly).toBe(true)
    expect(parsed.entries[0]?.idempotencyKey).toMatch(UUID_V4)
    expect(parsed.entries[0]?.payload.lookId).toBe('sample:l:office-oxford')

    // Source-only deterministic idempotency key stays identical even when swaps or weather edits change
    const reorderedParsed = parseLegacyHomeSampleBookmarksForImport(
      JSON.stringify([validBookmarkReorderedSwaps]),
      'member-a'
    )
    expect(reorderedParsed.entries[0]?.idempotencyKey).toBe(
      parsed.entries[0]?.idempotencyKey
    )

    // Arrays longer than 8 entries with invalid siblings still preserve valid entries
    const overEight = [
      validBookmark,
      { invalid: true },
      { invalid: 2 },
      { invalid: 3 },
      { invalid: 4 },
      { invalid: 5 },
      { invalid: 6 },
      { invalid: 7 },
      unresolvedBookmark,
    ]
    const parsedOverEight = parseLegacyHomeSampleBookmarksForImport(
      JSON.stringify(overEight),
      'member-a'
    )
    expect(parsedOverEight.malformedPayload).toBe(false)
    expect(parsedOverEight.hadInvalidEntries).toBe(true)
    expect(parsedOverEight.entries).toHaveLength(2)

    // Retired Home look with empty swaps on a catalog with no eligible looks still emits >= 1 fallback slot
    const minimalCatalog = {
      ...SAMPLE_CATALOG,
      looks: [],
    }
    const emptyCatalogParsed = parseLegacyHomeSampleBookmarksForImport(
      JSON.stringify([retiredLookBookmark]),
      'member-a',
      minimalCatalog
    )
    expect(emptyCatalogParsed.entries).toHaveLength(1)
    expect(
      emptyCatalogParsed.entries[0]?.payload.composition.length
    ).toBeGreaterThanOrEqual(1)

    expect(parsed.entries[1]?.resolvesCleanly).toBe(false)
    expect(parsed.entries[1]?.payload.lookId).toBe('sample:l:summer-linen')
    expect(parsed.entries[1]?.payload.swaps).toEqual({ shoes: 'sample:g:sandals' })
    expect(parsed.entries[1]?.payload.composition.length).toBeGreaterThan(0)

    expect(parsed.entries[2]?.resolvesCleanly).toBe(false)
    expect(parsed.entries[2]?.payload.lookId).toBe('sample:l:retired-legacy-look')
    expect(parsed.entries[2]?.payload.composition.length).toBeGreaterThan(0)
  })

  it('parses legacy style_piece recipes preserving unresolved records for Needs review and rejecting tampered entries', () => {
    expect(parseLegacyStylePieceRecipesForImport(null, 'member-a', 'g-1')).toEqual({
      entries: [],
      hadInvalidEntries: false,
      malformedPayload: false,
    })
    expect(
      parseLegacyStylePieceRecipesForImport('', 'member-a', 'g-1').malformedPayload
    ).toBe(true)
    expect(
      parseLegacyStylePieceRecipesForImport('{bad', 'member-a', 'g-1').malformedPayload
    ).toBe(true)
    expect(
      parseLegacyStylePieceRecipesForImport('{"not":"array"}', 'member-a', 'g-1')
        .malformedPayload
    ).toBe(true)

    const validRecipe = {
      lookId: 'sample:l:office-oxford',
      weather: 'mild-dry',
      swaps: { shoes: 'sample:g:white-sneakers' },
    }
    const unresolvedSwapRecipe = {
      lookId: 'sample:l:office-oxford',
      weather: 'cool-windy',
      swaps: { shoes: 'sample:g:sandals' },
    }
    const retiredRecipe = {
      lookId: 'sample:l:retired-piece-look',
      weather: 'warm-rainy',
      swaps: { accessory: 'sample:g:canvas-tote' },
    }
    const tamperedRecipe = {
      lookId: 'sample:l:office-oxford',
      weather: 'mild-dry',
      swaps: { shoes: '../bad-garment' },
    }

    // Case 1: anchor is ready top/mild -> validRecipe resolves cleanly, others preserve as unresolved
    const parsedWithMatchingAnchor = parseLegacyStylePieceRecipesForImport(
      JSON.stringify([
        validRecipe,
        validRecipe, // duplicate weather:lookId
        unresolvedSwapRecipe,
        retiredRecipe,
        tamperedRecipe,
      ]),
      'member-a',
      'g-1',
      { category: 'top', comfortRange: 'mild' }
    )

    expect(parsedWithMatchingAnchor.malformedPayload).toBe(false)
    expect(parsedWithMatchingAnchor.hadInvalidEntries).toBe(true)
    expect(parsedWithMatchingAnchor.entries).toHaveLength(3)

    expect(parsedWithMatchingAnchor.entries[0]?.resolvesCleanly).toBe(true)
    expect(parsedWithMatchingAnchor.entries[0]?.payload.anchorGarmentId).toBe('g-1')
    expect(parsedWithMatchingAnchor.entries[0]?.payload.composition[0]).toEqual({
      slotIndex: 0,
      category: 'top',
      kind: 'garment',
      itemId: 'g-1',
    })

    expect(parsedWithMatchingAnchor.entries[1]?.resolvesCleanly).toBe(false)
    expect(parsedWithMatchingAnchor.entries[1]?.payload.swaps).toEqual({
      shoes: 'sample:g:sandals',
    })

    expect(parsedWithMatchingAnchor.entries[2]?.resolvesCleanly).toBe(false)
    expect(parsedWithMatchingAnchor.entries[2]?.payload.lookId).toBe(
      'sample:l:retired-piece-look'
    )

    // Case 2: anchor garment tags changed to outerwear/cold -> warm-rainy recipe no longer resolves and records compatible snapshot
    const parsedWithChangedAnchor = parseLegacyStylePieceRecipesForImport(
      JSON.stringify([
        {
          lookId: 'sample:l:silk-midi',
          weather: 'warm-rainy',
          swaps: { shoes: 'sample:g:loafers' },
        },
      ]),
      'member-a',
      'g-1',
      { category: 'outerwear', comfortRange: 'cold' }
    )
    expect(parsedWithChangedAnchor.entries).toHaveLength(1)
    expect(parsedWithChangedAnchor.entries[0]?.resolvesCleanly).toBe(false)
    expect(parsedWithChangedAnchor.entries[0]?.payload.composition[0]?.category).toBe(
      'outerwear'
    )
    expect(parsedWithChangedAnchor.entries[0]?.payload.anchorSnapshot?.category).not.toBe(
      'outerwear'
    )

    // Case 3: unanchored (null currentAnchor) + empty swaps on retired look falls back to catalog garment companion
    const parsedUnanchoredRetired = parseLegacyStylePieceRecipesForImport(
      JSON.stringify([
        {
          lookId: 'sample:l:retired-empty-look',
          weather: 'mild-dry',
          swaps: {},
        },
        {
          lookId: 'sample:l:summer-linen',
          weather: 'cool-windy',
          swaps: {},
        },
      ]),
      'member-a',
      'g-unanchored',
      null
    )
    expect(parsedUnanchoredRetired.entries).toHaveLength(2)
    expect(parsedUnanchoredRetired.entries[0]?.resolvesCleanly).toBe(false)
    expect(
      parsedUnanchoredRetired.entries[0]?.payload.composition.length
    ).toBeGreaterThanOrEqual(2)
    expect(
      parsedUnanchoredRetired.entries[1]?.payload.composition.length
    ).toBeGreaterThanOrEqual(2)

    // Stable source-only idempotency key stays identical even if the anchor garment is retagged between retries
    const beforeRetag = parseLegacyStylePieceRecipesForImport(
      JSON.stringify([validRecipe]),
      'member-a',
      'g-1',
      { category: 'top', comfortRange: 'mild' }
    )
    const afterRetag = parseLegacyStylePieceRecipesForImport(
      JSON.stringify([validRecipe]),
      'member-a',
      'g-1',
      { category: 'outerwear', comfortRange: 'cold' }
    )
    expect(beforeRetag.entries[0]?.idempotencyKey).toBe(
      afterRetag.entries[0]?.idempotencyKey
    )
  })
})
