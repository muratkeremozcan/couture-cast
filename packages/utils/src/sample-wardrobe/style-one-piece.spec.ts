// Learning path Step 87: Style this piece with my own garments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-87-style-this-piece-with-my-own-garments
import { describe, expect, it, vi } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import { getStylePieceStrings } from './style-one-piece-strings'
import {
  applyStylePieceRecipe,
  createStylePieceRefresh,
  initialStylePieceWeather,
  MAX_STYLE_PIECE_STORAGE_BYTES,
  nextStylePiecePhotoExpiry,
  parseStylePieceRecipes,
  saveStylePieceRecipe,
  scheduleStylePiecePhotoExpiry,
  selectStylePieceAnchor,
  STYLE_PIECE_WEATHER_KEYS,
  stylePieceAnchor,
  stylePieceCompanionOptions,
  stylePieceCompanionSuitsWeather,
  stylePieceLooks,
  stylePieceOccasionLooks,
  stylePieceOwnedCompanions,
  stylePieceRecipeKey,
  stylePieceStorageKey,
  stylePieceSwapOptions,
  visibleStylePieceLooks,
  type StylePieceAnchor,
  type StylePieceOwnedCompanion,
} from './style-one-piece'

const top = { category: 'top', comfortRange: 'mild' } satisfies StylePieceAnchor

function draftLooks(anchor: StylePieceAnchor) {
  return visibleStylePieceLooks(stylePieceLooks(anchor, 'mild-dry').looks, {})
}

describe('style one piece', () => {
  it('only anchors ready, tagged items with a current authorized photo', () => {
    const expiry = 2_000
    const item = {
      ...top,
      status: 'ready',
      retentionStatus: 'active',
      imageAccess: {
        url: 'https://example.test/private',
        expiresAt: new Date(expiry).toISOString(),
      },
    }
    expect(stylePieceAnchor(item, expiry - 1)).toEqual({
      ...top,
      photo: item.imageAccess,
    })
    expect(stylePieceAnchor(item, expiry)).toBeNull()
    expect(stylePieceAnchor({ ...item, status: 'processing' }, 0)).toBeNull()
    expect(
      stylePieceAnchor({ ...item, retentionStatus: 'deletion_pending' }, 0)
    ).toBeNull()
    expect(stylePieceAnchor({ ...item, comfortRange: null }, 0)).toBeNull()
    expect(stylePieceAnchor({ ...item, category: null }, 0)).toBeNull()
    expect(stylePieceAnchor({ ...item, imageAccess: null }, 0)).toBeNull()
    expect(nextStylePiecePhotoExpiry([item], 0)).toBe(expiry)
    expect(nextStylePiecePhotoExpiry([item], expiry)).toBe(Infinity)
  })

  it('returns three distinct complete looks around a single top', () => {
    const looks = draftLooks(top)
    expect(looks).toHaveLength(3)
    for (const look of looks) {
      expect(look.companions.map(({ category }) => category)).toEqual(
        expect.arrayContaining(['bottom', 'shoes'])
      )
      expect(
        look.companions.some(({ category }) => ['top', 'dress'].includes(category))
      ).toBe(false)
      expect(stylePieceSwapOptions(look, 'top')).toEqual([])
    }
    expect(
      new Set(
        looks.map(({ companions }) =>
          companions
            .map(({ id }) => id)
            .sort()
            .join('|')
        )
      ).size
    ).toBe(3)
  })

  it('collapses recipes that become identical after substituting the anchor', () => {
    const core = SAMPLE_CATALOG.looks.find(({ id }) => id === 'sample:l:office-oxford')!
    const catalog = {
      ...SAMPLE_CATALOG,
      looks: [
        core,
        {
          ...core,
          id: 'sample:l:copy',
          core: core.core.map((id) =>
            id === 'sample:g:oxford-shirt' ? 'sample:g:cotton-tee' : id
          ),
        },
      ],
    }
    const { looks } = stylePieceLooks(top, 'mild-dry', catalog)
    expect(looks).toHaveLength(2)
    expect(visibleStylePieceLooks(looks, {}, { catalog })).toHaveLength(1)
  })

  it('keeps the latest edit when two looks have the same companions', () => {
    const bases = stylePieceLooks(top, 'mild-dry').looks
    const [first, second] = bases
    if (!first || !second) throw new Error('Expected at least two candidate looks')
    const edited = {
      ...second.recipe,
      swaps: Object.fromEntries(
        first.companions.map(({ category, id }) => [category, id])
      ),
    }
    const third = bases.find(
      (look, index) => index > 2 && look.recipe.lookId === 'sample:l:easy-chinos'
    )
    const visible = visibleStylePieceLooks(
      bases,
      { [edited.lookId]: edited },
      { editedLookId: edited.lookId }
    )
    expect(visible).toHaveLength(3)
    expect(visible.map(({ recipe }) => recipe.lookId)).not.toContain(first.recipe.lookId)
    expect(visible[0]?.recipe.lookId).toBe(edited.lookId)
    expect(visible[0]?.companions).toEqual(first.companions)
    if (!third) throw new Error('Expected a recipe outside the initial visible ideas')
    expect(
      visibleStylePieceLooks(bases, {}, { editedLookId: third.recipe.lookId }).map(
        ({ recipe }) => recipe.lookId
      )
    ).toContain(third.recipe.lookId)
  })

  it('starts with an eligible example weather for cold and hot anchors', () => {
    expect(initialStylePieceWeather(top)).toBe('mild-dry')
    expect(initialStylePieceWeather({ ...top, comfortRange: 'cold' })).toBe('cool-windy')
    expect(initialStylePieceWeather({ ...top, comfortRange: 'hot' })).toBe('warm-rainy')
    expect(
      initialStylePieceWeather({ category: 'outerwear', comfortRange: 'cold' })
    ).toBe('mild-dry')
  })

  it('returns no idea when the catalog has no structurally complete look', () => {
    const look = SAMPLE_CATALOG.looks.find(({ id }) => id === 'sample:l:office-oxford')!
    const withoutShoes = {
      ...SAMPLE_CATALOG,
      looks: [{ ...look, core: ['sample:g:oxford-shirt', 'sample:g:dark-jeans'] }],
    }
    expect(stylePieceLooks(top, 'mild-dry', withoutShoes)).toEqual({
      reason: 'no-looks',
      looks: [],
    })
    const missingReference = {
      ...withoutShoes,
      looks: [{ ...look, core: [...look.core, 'sample:g:missing'] }],
    }
    expect(stylePieceLooks(top, 'mild-dry', missingReference)).toEqual({
      reason: 'no-looks',
      looks: [],
    })
  })

  it('does not apply a draft from a different weather and keeps distinct saved weather keys', () => {
    const [base] = stylePieceLooks(top, 'mild-dry').looks
    const wrongWeather = {
      ...base!.recipe,
      weather: 'warm-rainy',
      swaps: { shoes: 'sample:g:loafers' },
    } as const
    expect(
      visibleStylePieceLooks([base!], { [base!.recipe.lookId]: wrongWeather })
    ).toEqual([base])
    expect(stylePieceRecipeKey(wrongWeather)).not.toBe(stylePieceRecipeKey(base!.recipe))
    const rain = { ...base!, recipe: wrongWeather }
    expect(saveStylePieceRecipe([rain, base!], base!)).toEqual([base, rain])
  })

  it('uses the locale for photo recovery labels and English for unsupported locales', () => {
    expect(getStylePieceStrings('es-419').refreshPhoto).toBe('Actualizar foto')
    expect(getStylePieceStrings(undefined).checkingPhoto).toBe('Checking your photo…')
    expect(getStylePieceStrings('en-GB').start).toBe('Style this piece')
  })

  it('[7.30-WEATHER] ranks compatible owned swap options ahead of catalog options', () => {
    const base = stylePieceLooks(top, 'warm-rainy').looks.find(
      ({ recipe }) => recipe.lookId === 'sample:l:silk-midi'
    )!
    const bottom = {
      id: 'midi-a',
      category: 'bottom',
      kind: 'garment',
      comfortRange: 'warm',
      subtype: 'midi-skirt',
      photo: null,
    } satisfies StylePieceOwnedCompanion
    const owned: StylePieceOwnedCompanion[] = [
      { ...bottom, id: 'cold-only', comfortRange: 'cold' },
      { ...bottom, id: 'midi-b' },
      { ...bottom, id: 'adjacent', comfortRange: 'mild' },
      { ...bottom, id: 'a-unmatched', subtype: 'mini-skirt' },
      bottom,
    ]
    const options = stylePieceCompanionOptions(base, 'bottom', owned)
    expect(options.slice(0, 4).map(({ id }) => id)).toEqual([
      'midi-a',
      'midi-b',
      'a-unmatched',
      'adjacent',
    ])
    expect(options.slice(4).every((item) => !('kind' in item))).toBe(true)
    expect(options.slice(4).map(({ id }) => id)).toContain('sample:g:midi-skirt')
    expect(stylePieceCompanionOptions(base, 'top', owned)).toEqual([])

    const jacket = { category: 'outerwear', comfortRange: 'mild' } as const
    expect(stylePieceCompanionSuitsWeather(jacket, 'mild-dry')).toBe(true)
    expect(stylePieceCompanionSuitsWeather(jacket, 'warm-rainy')).toBe(false)
    expect(
      stylePieceCompanionSuitsWeather({ ...jacket, comfortRange: 'cold' }, 'cool-windy')
    ).toBe(false)
    expect(stylePieceCompanionSuitsWeather(jacket, 'unknown')).toBe(false)
  })

  it('[7.30-WEATHER] offers three occasions and varies available owned pieces', () => {
    const { looks } = stylePieceLooks(top, 'mild-dry')
    const bottom = {
      id: 'owned-bottom-a',
      category: 'bottom',
      kind: 'garment',
      comfortRange: 'mild',
      photo: null,
    } satisfies StylePieceOwnedCompanion
    const owned: StylePieceOwnedCompanion[] = [
      bottom,
      { ...bottom, id: 'owned-bottom-b' },
      { ...bottom, id: 'owned-shoes-a', category: 'shoes' },
      { ...bottom, id: 'owned-shoes-b', category: 'shoes' },
    ]
    const ideas = stylePieceOccasionLooks(looks, {}, { owned })
    expect(ideas.map(({ occasion }) => occasion).sort()).toEqual([
      'goingOut',
      'school',
      'weekend',
    ])
    const combinations = ideas.map(({ companions }) =>
      companions.filter((item) => 'kind' in item).map(({ id }) => id)
    )
    expect(combinations.every((ids) => ids.length === 2)).toBe(true)
    expect(new Set(combinations.map((ids) => ids.join(','))).size).toBe(3)
    expect(stylePieceOccasionLooks([], {}, { owned })).toEqual([])

    const unlabeledCatalog = {
      ...SAMPLE_CATALOG,
      looks: SAMPLE_CATALOG.looks.map((look) => ({ ...look, preferences: undefined })),
    }
    const unlabeled = stylePieceOccasionLooks(looks, {}, { catalog: unlabeledCatalog })
    expect(unlabeled.map(({ occasion }) => occasion).sort()).toEqual([
      'goingOut',
      'school',
      'weekend',
    ])
  })

  it('[7.30-ACCOUNT] keeps a change back to the catalog default after another saved-slot swap', () => {
    const base = stylePieceLooks(top, 'mild-dry').looks.find(
      ({ recipe }) => recipe.lookId === 'sample:l:office-oxford'
    )!
    const reopened = {
      ...base.recipe,
      savedCompanions: { shoes: { kind: 'catalog', itemId: 'sample:g:white-sneakers' } },
      swaps: { shoes: 'sample:g:loafers' },
    } as const
    const first = applyStylePieceRecipe(base, reopened, SAMPLE_CATALOG)
    const second = applyStylePieceRecipe(
      base,
      { ...first.recipe, swaps: { ...first.recipe.swaps, bottom: 'sample:g:chinos' } },
      SAMPLE_CATALOG
    )
    expect(second.companions.map(({ id }) => id)).toEqual([
      'sample:g:chinos',
      'sample:g:loafers',
    ])
  })

  it('supports all categories with a structurally complete core', () => {
    for (const category of [
      'top',
      'bottom',
      'dress',
      'outerwear',
      'shoes',
      'accessory',
    ] as const) {
      const looks = draftLooks({ category, comfortRange: 'mild' })
      expect(looks.length).toBeGreaterThan(0)
      for (const look of looks) {
        const pieces = [category, ...look.companions.map((piece) => piece.category)]
        expect(pieces.filter((piece) => piece === category)).toHaveLength(1)
        expect(pieces).toContain('shoes')
        if (pieces.includes('dress')) {
          expect(pieces).not.toContain('top')
          expect(pieces).not.toContain('bottom')
        } else {
          expect(pieces).toContain('top')
          expect(pieces).toContain('bottom')
        }
      }
    }
  })

  it('applies comfort and protection to the anchor and required sample layers', () => {
    expect(STYLE_PIECE_WEATHER_KEYS).toEqual(['cool-windy', 'mild-dry', 'warm-rainy'])
    expect(stylePieceLooks(top, 'cool-windy').reason).toBe('comfort')
    const jacket = {
      category: 'outerwear',
      comfortRange: 'mild',
    } satisfies StylePieceAnchor
    expect(stylePieceLooks(jacket, 'warm-rainy').reason).toBe('protection')
    expect(stylePieceLooks(jacket, 'cool-windy').reason).toBe('protection')

    for (const [weather, protection] of [
      ['warm-rainy', 'waterResistant'],
      ['cool-windy', 'windResistant'],
    ] as const) {
      const result = stylePieceLooks(
        { ...top, comfortRange: weather === 'cool-windy' ? 'cool' : 'mild' },
        weather
      )
      expect(result.looks.length).toBeGreaterThan(0)
      for (const look of result.looks) {
        expect(
          look.companions.find(({ category }) => category === 'outerwear')
        ).toMatchObject({
          [protection]: true,
        })
        expect(
          stylePieceSwapOptions(look, 'outerwear').every((garment) => garment[protection])
        ).toBe(true)
      }
      const withoutProtection = {
        ...SAMPLE_CATALOG,
        garments: SAMPLE_CATALOG.garments.filter((garment) => !garment[protection]),
      }
      expect(
        stylePieceLooks(
          { ...top, comfortRange: weather === 'cool-windy' ? 'cool' : 'mild' },
          weather,
          withoutProtection
        ).looks
      ).toHaveLength(0)
    }
  })

  it('round-trips valid swaps and discards stale, incompatible, or oversized recipes', () => {
    const bases = stylePieceLooks(top, 'warm-rainy').looks
    const base = bases[0]!
    const shoes = base.companions.find(({ category }) => category === 'shoes')!
    const replacement = stylePieceSwapOptions(base, 'shoes').find(
      ({ id }) => id !== shoes.id
    )!
    const edited = {
      ...base.recipe,
      swaps: {
        shoes: replacement.id,
        top: 'sample:g:oxford-shirt',
        outerwear: 'sample:g:denim-jacket',
        bottom: 'sample:g:removed',
      },
    }
    const stored = JSON.stringify([
      edited,
      edited,
      { ...edited, lookId: 'sample:l:removed' },
      { ...edited, weather: 'optional-context' },
      { ...edited, image: 'private' },
    ])
    const saved = parseStylePieceRecipes(stored, top)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.recipe).toEqual({ ...base.recipe, swaps: { shoes: replacement.id } })
    const recipes = Object.fromEntries(saved.map(({ recipe }) => [recipe.lookId, recipe]))
    expect(
      visibleStylePieceLooks(bases, recipes, { reopenedLookId: base.recipe.lookId })[0]
    ).toEqual(saved[0])
    expect(parseStylePieceRecipes(stored, { ...top, category: 'outerwear' })).toEqual([])
    expect(parseStylePieceRecipes(JSON.stringify(Array(9).fill(edited)), top)).toEqual([])
    expect(
      parseStylePieceRecipes(' '.repeat(MAX_STYLE_PIECE_STORAGE_BYTES + 1), top)
    ).toEqual([])
    expect(parseStylePieceRecipes('{', top)).toEqual([])

    const savedRecipes = [...bases, ...stylePieceLooks(top, 'mild-dry').looks].reduce<
      ReturnType<typeof saveStylePieceRecipe>
    >((list, look) => saveStylePieceRecipe(list, look), [])
    expect(savedRecipes).toHaveLength(8)
    expect(stylePieceStorageKey('owner.a', 'piece')).not.toEqual(
      stylePieceStorageKey('owner', 'a.piece')
    )
  })

  it('accepts storage at the size limit and rejects empty or non-list values', () => {
    const [look] = draftLooks(top)
    const raw = JSON.stringify(Array.from({ length: 8 }, () => look!.recipe))
    const atLimit = raw.padEnd(MAX_STYLE_PIECE_STORAGE_BYTES)
    expect(parseStylePieceRecipes(atLimit, top)).toEqual([look])
    expect(parseStylePieceRecipes(`${atLimit} `, top)).toEqual([])
    for (const invalid of [null, '', 'null', JSON.stringify(look!.recipe)]) {
      expect(parseStylePieceRecipes(invalid, top)).toEqual([])
    }
  })
})

describe('style piece inventory refresh', () => {
  const piece = {
    ...top,
    id: 'piece',
    status: 'ready',
    retentionStatus: 'active',
    imageAccess: {
      url: 'https://example.test/private',
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  }

  function pendingInventory() {
    let resolve!: (items: (typeof piece)[] | null) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<(typeof piece)[] | null>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    return { promise, resolve, reject }
  }

  it('selects the exact garment and cancels its expiry callback', () => {
    vi.useFakeTimers()
    try {
      const other = { ...piece, id: 'other' }
      expect(selectStylePieceAnchor([other], piece.id)).toBeNull()
      expect(selectStylePieceAnchor([other, piece], piece.id)?.photo).toBe(
        piece.imageAccess
      )
      expect(
        selectStylePieceAnchor([{ ...piece, imageAccess: null }], piece.id)
      ).toBeNull()
      const expiry = vi.fn()
      const stop = scheduleStylePiecePhotoExpiry(Date.now() + 20, expiry)
      vi.advanceTimersByTime(19)
      expect(expiry).not.toHaveBeenCalled()
      stop?.()
      vi.advanceTimersByTime(1)
      expect(expiry).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires immediately for past timestamps and reschedules waits beyond the timer limit', () => {
    vi.useFakeTimers({ now: 0 })
    try {
      const expired = vi.fn()
      const distantExpiry = vi.fn()
      expect(scheduleStylePiecePhotoExpiry(Infinity, expired)).toBeUndefined()
      expect(scheduleStylePiecePhotoExpiry(NaN, expired)).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)

      scheduleStylePiecePhotoExpiry(-1, expired)
      vi.advanceTimersByTime(0)
      expect(expired).toHaveBeenCalledOnce()

      const largestTimeout = 2_147_483_647
      scheduleStylePiecePhotoExpiry(largestTimeout + 25, distantExpiry)
      vi.advanceTimersByTime(largestTimeout + 24)
      expect(distantExpiry).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(distantExpiry).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([true, false])(
    'clears an expired photo only for the current identity (%s)',
    async (stillCurrent) => {
      vi.useFakeTimers({ now: 0 })
      const item = {
        ...piece,
        imageAccess: { ...piece.imageAccess, expiresAt: new Date(50).toISOString() },
      }
      const onAnchor = vi.fn()
      let current = true
      const inventory = createStylePieceRefresh({
        garmentId: piece.id,
        load: vi.fn().mockResolvedValue([item]),
        onAnchor,
        isCurrent: () => current,
      })
      try {
        inventory.setVisible(true)
        const anchor = await inventory.refresh()
        expect(inventory.currentAnchor()).toMatchObject({ photo: item.imageAccess })
        current = stillCurrent
        await vi.advanceTimersByTimeAsync(50)
        expect(inventory.currentAnchor()).toBeNull()
        expect(onAnchor.mock.calls).toEqual(
          stillCurrent
            ? [
                [anchor, []],
                [null, []],
              ]
            : [[anchor, []]]
        )
      } finally {
        inventory.stop()
        vi.useRealTimers()
      }
    }
  )

  it('refuses an expired cached anchor after a clock jump before the timer callback', async () => {
    vi.useFakeTimers({ now: 0 })
    const item = {
      ...piece,
      imageAccess: { ...piece.imageAccess, expiresAt: new Date(100).toISOString() },
    }
    const onAnchor = vi.fn()
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load: vi.fn().mockResolvedValue([item]),
      onAnchor,
      isCurrent: () => true,
    })
    try {
      inventory.setVisible(true)
      const anchor = await inventory.refresh()
      vi.setSystemTime(100)
      expect(inventory.currentAnchor()).toBeNull()
      expect(onAnchor.mock.calls).toEqual([[anchor, []]])
    } finally {
      inventory.stop()
      vi.useRealTimers()
    }
  })

  it('does not start queued work for a stopped or superseded session', async () => {
    const load = vi.fn().mockResolvedValue([piece])
    const onAnchor = vi.fn()
    let current = false
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load,
      onAnchor,
      isCurrent: () => current,
    })
    try {
      inventory.setVisible(true)
      expect(await inventory.refresh()).toBeNull()
      current = true
      inventory.setVisible(false)
      inventory.setVisible(true)
      const queued = inventory.refresh()
      inventory.stop()
      inventory.setVisible(true)
      expect(await queued).toBeNull()
      expect(await inventory.refresh()).toBeNull()
      expect(load).not.toHaveBeenCalled()
      expect(onAnchor).not.toHaveBeenCalled()
    } finally {
      inventory.stop()
    }
  })

  it('[7.30-PHOTO] clears an expired companion photo and keeps the tagged garment until access ends', async () => {
    vi.useFakeTimers({ now: 0 })
    const companion = {
      ...piece,
      id: 'owned-bottom',
      category: 'bottom' as const,
      imageAccess: {
        url: 'https://example.test/owned-bottom.png',
        expiresAt: new Date(100).toISOString(),
      },
    }
    const hidden = {
      ...companion,
      id: 'held-bottom',
      retentionStatus: 'deletion_pending',
    }
    const untagged = { ...companion, id: 'untagged-bottom', comfortRange: null }
    const onAnchor = vi.fn()
    let current = true
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load: () => Promise.resolve([piece, companion, hidden, untagged]),
      onAnchor,
      isCurrent: () => current,
    })
    try {
      inventory.setVisible(true)
      const anchor = await inventory.refresh()
      expect(anchor?.photo).toEqual(piece.imageAccess)
      expect(inventory.currentCompanions()).toMatchObject([
        { id: companion.id, kind: 'garment', photo: companion.imageAccess },
      ])

      await vi.advanceTimersByTimeAsync(100)
      expect(onAnchor).toHaveBeenLastCalledWith(anchor, [
        expect.objectContaining({ id: companion.id, kind: 'garment', photo: null }),
      ])
      expect(inventory.currentAnchor()).toEqual(anchor)
      expect(inventory.currentCompanions()).toMatchObject([
        { id: companion.id, kind: 'garment', photo: null },
      ])

      current = false
      expect(inventory.currentCompanions()).toEqual([])
    } finally {
      inventory.stop()
      vi.useRealTimers()
    }
  })

  it('[7.30-PHOTO] rejects an expired companion URL on read before its timer callback', async () => {
    vi.useFakeTimers({ now: 0 })
    const companion = {
      ...piece,
      id: 'clock-jump-companion',
      category: 'bottom' as const,
      imageAccess: { ...piece.imageAccess, expiresAt: new Date(100).toISOString() },
    }
    const expired = {
      ...companion,
      id: 'already-expired',
      imageAccess: { ...companion.imageAccess, expiresAt: new Date(0).toISOString() },
    }
    expect(stylePieceOwnedCompanions([piece, expired], piece.id, 0)).toMatchObject([
      { id: expired.id, photo: null },
    ])
    const onAnchor = vi.fn()
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load: () => Promise.resolve([piece, companion]),
      onAnchor,
      isCurrent: () => true,
    })
    try {
      inventory.setVisible(true)
      await inventory.refresh()
      vi.setSystemTime(100)
      expect(inventory.currentCompanions()).toMatchObject([
        { id: companion.id, photo: null },
      ])
      expect(onAnchor).toHaveBeenCalledTimes(1)
    } finally {
      inventory.stop()
      vi.useRealTimers()
    }
  })

  it('fails closed for a rejected load, null inventory and an invalid selected item', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([piece])
      .mockRejectedValueOnce(new Error('Inventory unavailable'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{ ...piece, status: 'processing' }])
    const onAnchor = vi.fn()
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load,
      onAnchor,
      isCurrent: () => true,
    })
    try {
      inventory.setVisible(true)
      const anchor = await inventory.refresh()
      expect(inventory.currentAnchor()).toBe(anchor)
      for (let attempt = 0; attempt < 3; attempt++) {
        expect(await inventory.refresh()).toBeNull()
        expect(inventory.currentAnchor()).toBeNull()
      }
      expect(onAnchor.mock.calls).toEqual([
        [anchor, []],
        [null, []],
        [null, []],
        [null, []],
      ])
    } finally {
      inventory.stop()
    }
  })

  it('ignores a paused rejection without clearing the resumed in-flight request', async () => {
    const old = pendingInventory()
    const next = pendingInventory()
    const load = vi
      .fn((_signal: AbortSignal) => next.promise)
      .mockReturnValueOnce(old.promise)
    const onAnchor = vi.fn()
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load,
      onAnchor,
      isCurrent: () => true,
    })
    try {
      inventory.setVisible(true)
      const first = inventory.refresh()
      await Promise.resolve()
      inventory.setVisible(false)
      expect(load.mock.calls[0]?.[0].aborted).toBe(true)
      inventory.setVisible(true)
      const resumed = inventory.refresh()
      await Promise.resolve()

      old.reject(new Error('Aborted inventory request'))
      expect(await first).toBeNull()
      expect(inventory.refresh()).toBe(resumed)
      expect(onAnchor.mock.calls).toEqual([[undefined, []]])
      next.resolve([piece])
      const anchor = await resumed
      expect(inventory.currentAnchor()).toMatchObject({ photo: piece.imageAccess })
      expect(onAnchor.mock.calls).toEqual([
        [undefined, []],
        [anchor, []],
      ])
      expect(load).toHaveBeenCalledTimes(2)
    } finally {
      inventory.stop()
    }
  })

  it('coalesces callers, clears a deleted anchor, and revalidates only while visible', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue([piece])
    const onAnchor = vi.fn()
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load,
      onAnchor,
      isCurrent: () => true,
    })
    try {
      expect(await inventory.refresh()).toBeNull()
      inventory.setVisible(true)
      const check = inventory.refresh()
      expect(inventory.refresh()).toBe(check)
      expect(await check).toMatchObject({ photo: piece.imageAccess })
      expect(load).toHaveBeenCalledTimes(1)

      load.mockResolvedValue([])
      await vi.advanceTimersByTimeAsync(60_000)
      expect(load).toHaveBeenCalledTimes(2)
      expect(inventory.currentAnchor()).toBeNull()
      expect(onAnchor).toHaveBeenLastCalledWith(null, [])

      inventory.setVisible(false)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(load).toHaveBeenCalledTimes(2)
      expect(onAnchor).toHaveBeenLastCalledWith(undefined, [])
      inventory.setVisible(true)
      expect(await inventory.refresh()).toBeNull()
      expect(load).toHaveBeenCalledTimes(3)
    } finally {
      inventory.stop()
      vi.useRealTimers()
    }
  })

  it('aborts an in-flight load on stop and rejects a response from a superseded identity', async () => {
    let finish: ((items: (typeof piece)[]) => void) | undefined
    const load = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<(typeof piece)[]>((resolve) => {
          finish = resolve
        })
    )
    const onAnchor = vi.fn()
    let current = true
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load,
      onAnchor,
      isCurrent: () => current,
    })
    try {
      inventory.setVisible(true)
      const first = inventory.refresh()
      await Promise.resolve()
      current = false
      finish?.([piece])
      expect(await first).toBeNull()
      expect(onAnchor).not.toHaveBeenCalled()

      current = true
      const second = inventory.refresh()
      await Promise.resolve()
      inventory.stop()
      expect(load.mock.lastCall?.[0].aborted).toBe(true)
      finish?.([piece])
      expect(await second).toBeNull()
      expect(onAnchor).not.toHaveBeenCalled()
    } finally {
      inventory.stop()
    }
  })

  it('refreshForAction preserves the anchor on transient errors and revokes on auth, deadline, expiry, or deletion', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const timedPiece = {
      ...piece,
      imageAccess: {
        url: 'https://example.test/private',
        expiresAt: new Date(60_000).toISOString(),
      },
    }
    const load = vi.fn<(_signal: AbortSignal) => Promise<(typeof timedPiece)[] | null>>()
    const onAnchor = vi.fn()
    let current = true
    const inventory = createStylePieceRefresh({
      garmentId: timedPiece.id,
      load,
      onAnchor,
      isCurrent: () => current,
    })

    try {
      // Inactive before setVisible(true)
      expect(await inventory.refreshForAction()).toEqual({ status: 'revoked' })

      // Initial mount returns empty -> no current valid anchor -> revokes cleanly
      load.mockResolvedValueOnce([])
      inventory.setVisible(true)
      expect(await inventory.refresh()).toBeNull()
      expect(await inventory.refreshForAction()).toEqual({ status: 'revoked' })
      expect(onAnchor).toHaveBeenLastCalledWith(null, [])

      // Establish valid anchor
      load.mockResolvedValueOnce([timedPiece])
      const initialAnchor = await inventory.refresh()
      expect(initialAnchor).not.toBeNull()
      onAnchor.mockClear()

      // Happy path refreshes anchor
      load.mockResolvedValueOnce([timedPiece])
      expect(await inventory.refreshForAction()).toEqual({
        status: 'ok',
        anchor: initialAnchor,
      })

      // Transient network, 5xx, primitive, and cyclic errors preserve anchor without calling onAnchor(null)
      const cyclic: { cause?: unknown } = {}
      cyclic.cause = cyclic
      for (const transientError of [
        new TypeError('Failed to fetch'),
        new Error('503 Service Unavailable'),
        'plain-string-error',
        cyclic,
      ]) {
        load.mockRejectedValueOnce(transientError)
        expect(await inventory.refreshForAction()).toEqual({
          status: 'error',
          error: transientError,
        })
        expect(inventory.currentAnchor()).toEqual(initialAnchor)
        expect(onAnchor).not.toHaveBeenCalledWith(null, [])
      }

      // Auth, response status, message, nested cause, AbortError, and TimeoutError all revoke and clear anchor
      const revokingErrors: unknown[] = [
        Object.assign(new Error('Unauthorized'), { status: 401 }),
        { response: { status: 403 } },
        new Error('Session expired — please sign in again'),
        { cause: { status: 401 } },
        Object.assign(new Error('Aborted'), { name: 'AbortError' }),
        Object.assign(new Error('Timed out'), { name: 'TimeoutError' }),
      ]
      for (const revokingError of revokingErrors) {
        load.mockResolvedValueOnce([timedPiece])
        await inventory.refresh()
        onAnchor.mockClear()
        load.mockRejectedValueOnce(revokingError)
        expect(await inventory.refreshForAction()).toEqual({ status: 'revoked' })
        expect(onAnchor).toHaveBeenLastCalledWith(null, [])
        expect(inventory.currentAnchor()).toBeNull()
      }

      // Null or empty load revokes
      load.mockResolvedValueOnce([timedPiece])
      await inventory.refresh()
      load.mockResolvedValueOnce(null)
      expect(await inventory.refreshForAction()).toEqual({ status: 'revoked' })
      expect(inventory.currentAnchor()).toBeNull()

      // Transient error after expiry while load is in-flight revokes because currentValidAnchor() is gone
      load.mockResolvedValueOnce([timedPiece])
      await inventory.refresh()
      const deferredErr = pendingInventory()
      load.mockReturnValueOnce(deferredErr.promise)
      const expiringAction = inventory.refreshForAction()
      vi.setSystemTime(61_000)
      deferredErr.reject(new Error('503 Service Unavailable'))
      expect(await expiringAction).toEqual({ status: 'revoked' })

      // Aborted/stopped in-flight refreshForAction (both resolve and reject) returns revoked without publishing
      vi.setSystemTime(2_000)
      load.mockResolvedValueOnce([timedPiece])
      await inventory.refresh()
      onAnchor.mockClear()

      const pendingResolve = pendingInventory()
      const pendingReject = pendingInventory()
      load.mockReturnValueOnce(pendingResolve.promise)
      const inFlightResolve = inventory.refreshForAction()
      load.mockReturnValueOnce(pendingReject.promise)
      const inFlightReject = inventory.refreshForAction()
      inventory.setVisible(false)
      expect(load.mock.calls.slice(-2).every(([signal]) => signal.aborted)).toBe(true)
      pendingResolve.resolve([timedPiece])
      pendingReject.reject(new Error('Aborted'))
      expect(await inFlightResolve).toEqual({ status: 'revoked' })
      expect(await inFlightReject).toEqual({ status: 'revoked' })
      expect(onAnchor).toHaveBeenCalledWith(undefined, [])
      expect(onAnchor).not.toHaveBeenCalledWith(null, [])

      // Identity switch during refreshForAction also suppresses publication
      inventory.setVisible(true)
      load.mockResolvedValueOnce([timedPiece])
      await inventory.refresh()
      const switched = pendingInventory()
      load.mockReturnValueOnce(switched.promise)
      const switchedAction = inventory.refreshForAction()
      current = false
      switched.resolve([timedPiece])
      expect(await switchedAction).toEqual({ status: 'revoked' })
    } finally {
      inventory.stop()
      vi.useRealTimers()
    }
  })

  it('orders refresh() and refreshForAction() monotonically so older in-flight loads cannot overwrite newer revocations or updates', async () => {
    const pieceV1 = {
      ...piece,
      imageAccess: {
        url: 'https://example.test/private-v1',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    }
    const pieceV2 = {
      ...piece,
      imageAccess: {
        url: 'https://example.test/private-v2',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    }
    const load = vi.fn<(_signal: AbortSignal) => Promise<(typeof pieceV1)[] | null>>()
    const onAnchor = vi.fn()
    const inventory = createStylePieceRefresh({
      garmentId: piece.id,
      load,
      onAnchor,
      isCurrent: () => true,
    })

    try {
      // Seed initial anchor
      load.mockResolvedValueOnce([pieceV1])
      inventory.setVisible(true)
      expect(await inventory.refresh()).toMatchObject({ photo: pieceV1.imageAccess })
      onAnchor.mockClear()

      // 1. Older periodic refresh() starts, then newer refreshForAction() revokes ([])
      const stalePeriodic = pendingInventory()
      const newerRevoke = pendingInventory()
      load.mockReturnValueOnce(stalePeriodic.promise)
      const periodicPromise = inventory.refresh()
      await Promise.resolve()
      load.mockReturnValueOnce(newerRevoke.promise)
      const revokePromise = inventory.refreshForAction()

      newerRevoke.resolve([])
      expect(await revokePromise).toEqual({ status: 'revoked' })
      expect(inventory.currentAnchor()).toBeNull()

      stalePeriodic.resolve([pieceV1])
      expect(await periodicPromise).toBeNull()
      expect(inventory.currentAnchor()).toBeNull()
      expect(onAnchor).toHaveBeenCalledTimes(1)
      expect(onAnchor).toHaveBeenCalledWith(null, [])

      // 2. Re-seed anchor, start older refreshForAction(), then newer periodic refresh() revokes ([])
      load.mockResolvedValueOnce([pieceV1])
      await inventory.refresh()
      onAnchor.mockClear()

      const staleActionOk = pendingInventory()
      const staleActionErr = pendingInventory()
      const newerPeriodicRevoke = pendingInventory()
      load.mockReturnValueOnce(staleActionOk.promise)
      const staleActionOkPromise = inventory.refreshForAction()
      load.mockReturnValueOnce(staleActionErr.promise)
      const staleActionErrPromise = inventory.refreshForAction()
      load.mockReturnValueOnce(newerPeriodicRevoke.promise)
      const newerPeriodicPromise = inventory.refresh()
      await Promise.resolve()

      newerPeriodicRevoke.resolve([])
      expect(await newerPeriodicPromise).toBeNull()
      expect(inventory.currentAnchor()).toBeNull()

      staleActionOk.resolve([pieceV1])
      expect(await staleActionOkPromise).toEqual({ status: 'revoked' })
      staleActionErr.reject(new TypeError('Failed to fetch'))
      expect(await staleActionErrPromise).toEqual({ status: 'revoked' })
      expect(inventory.currentAnchor()).toBeNull()
      expect(onAnchor).toHaveBeenCalledTimes(1)
      expect(onAnchor).toHaveBeenCalledWith(null, [])

      // 3. Newer refreshForAction() publishes pieceV2; older refreshForAction() (ok & error) and older refresh() (error) do not clobber pieceV2
      load.mockResolvedValueOnce([pieceV1])
      await inventory.refresh()
      onAnchor.mockClear()

      const olderPeriodicFail = pendingInventory()
      const olderActionV1 = pendingInventory()
      const olderActionErr = pendingInventory()
      const newerActionV2 = pendingInventory()
      load.mockReturnValueOnce(olderPeriodicFail.promise)
      const olderPeriodicFailPromise = inventory.refresh()
      await Promise.resolve()
      load.mockReturnValueOnce(olderActionV1.promise)
      const olderActionV1Promise = inventory.refreshForAction()
      load.mockReturnValueOnce(olderActionErr.promise)
      const olderActionErrPromise = inventory.refreshForAction()
      load.mockReturnValueOnce(newerActionV2.promise)
      const newerActionV2Promise = inventory.refreshForAction()

      newerActionV2.resolve([pieceV2])
      expect(await newerActionV2Promise).toMatchObject({
        status: 'ok',
        anchor: { photo: pieceV2.imageAccess },
      })

      olderActionV1.resolve([pieceV1])
      expect(await olderActionV1Promise).toMatchObject({
        status: 'ok',
        anchor: { photo: pieceV2.imageAccess },
      })
      const transientErr = new Error('503')
      olderActionErr.reject(transientErr)
      expect(await olderActionErrPromise).toEqual({
        status: 'error',
        error: transientErr,
      })
      olderPeriodicFail.reject(new Error('503'))
      expect(await olderPeriodicFailPromise).toBeNull()
      expect(inventory.currentAnchor()).toMatchObject({ photo: pieceV2.imageAccess })
      expect(onAnchor).toHaveBeenCalledTimes(1)
    } finally {
      inventory.stop()
    }
  })
})
