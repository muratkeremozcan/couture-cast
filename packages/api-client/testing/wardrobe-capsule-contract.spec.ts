import { describe, expect, it } from 'vitest'
import {
  createOutfitCapsuleInputSchema,
  favoriteOutfitCapsuleInputSchema,
  listOutfitCapsulesQuerySchema,
  updateOutfitCapsuleInputSchema,
} from '../src/contracts/http'

function buildCapsuleInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Rainy commute',
    occasions: ['work'],
    garmentIds: ['garment-1', 'garment-2'],
    ...overrides,
  }
}

describe('capsule name normalization', () => {
  // The name is trimmed and NFC-normalized before validation so that the stored
  // value matches what the user typed, and so that padding cannot smuggle a
  // blank name past min(1).
  it('trims surrounding whitespace before validating', () => {
    expect(
      createOutfitCapsuleInputSchema.parse(buildCapsuleInput({ name: '  Rainy  ' })).name
    ).toBe('Rainy')
  })

  // A decomposed 'e' plus a combining acute must land on the same stored
  // string as a precomposed one, or two identical-looking names differ in the
  // database.
  it('normalizes decomposed characters to NFC', () => {
    const parsed = createOutfitCapsuleInputSchema.parse(
      buildCapsuleInput({ name: 'Soire\u0301e' })
    )

    expect(parsed.name).toBe('Soir\u00e9e')
    expect(parsed.name).toHaveLength(6)
  })

  it('rejects a whitespace-only name once it normalizes to empty', () => {
    const result = createOutfitCapsuleInputSchema.safeParse(
      buildCapsuleInput({ name: ' \u3000\t ' })
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('name')
    }
  })

  // PostgreSQL `text` cannot store a NUL byte, so this has to be a 400 at the
  // contract boundary rather than a 500 from the driver.
  it('rejects a name containing a null byte', () => {
    const result = createOutfitCapsuleInputSchema.safeParse(
      buildCapsuleInput({ name: 'Rainy\u0000commute' })
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'must not contain a null byte'
      )
    }
  })

  // The limit is counted in user-perceived characters. Counting UTF-16 code
  // units instead would reject this 60-emoji name at roughly 15 emoji.
  it('accepts sixty emoji graphemes even though they span far more code units', () => {
    const name = '\u{1F44D}\u{1F3FD}'.repeat(60)
    const parsed = createOutfitCapsuleInputSchema.parse(buildCapsuleInput({ name }))

    expect(parsed.name).toBe(name)
    expect(name.length).toBeGreaterThan(60)
  })

  it('accepts exactly sixty graphemes and rejects sixty-one', () => {
    expect(
      createOutfitCapsuleInputSchema.safeParse(
        buildCapsuleInput({ name: 'a'.repeat(60) })
      ).success
    ).toBe(true)
    expect(
      createOutfitCapsuleInputSchema.safeParse(
        buildCapsuleInput({ name: 'a'.repeat(61) })
      ).success
    ).toBe(false)
  })
})

describe('capsule description normalization', () => {
  // An empty normalized description is stored as null, never as '', so that
  // response parsing and "has a description" checks agree.
  it('collapses a blank description to null', () => {
    expect(
      createOutfitCapsuleInputSchema.parse(buildCapsuleInput({ description: '   ' }))
        .description
    ).toBeNull()
  })

  it('keeps an explicit null description', () => {
    expect(
      createOutfitCapsuleInputSchema.parse(buildCapsuleInput({ description: null }))
        .description
    ).toBeNull()
  })

  it('trims a real description without nulling it', () => {
    expect(
      createOutfitCapsuleInputSchema.parse(
        buildCapsuleInput({ description: '  For wet mornings  ' })
      ).description
    ).toBe('For wet mornings')
  })

  it('accepts 280 graphemes and rejects 281', () => {
    expect(
      createOutfitCapsuleInputSchema.safeParse(
        buildCapsuleInput({ description: 'a'.repeat(280) })
      ).success
    ).toBe(true)
    expect(
      createOutfitCapsuleInputSchema.safeParse(
        buildCapsuleInput({ description: 'a'.repeat(281) })
      ).success
    ).toBe(false)
  })
})

describe('capsule garment id collection', () => {
  // JSON Schema uniqueItems is not emitted for this array, so the no-duplicates
  // rule is only enforced here and only visible in the 400 it produces.
  it('rejects duplicate garment ids', () => {
    const result = createOutfitCapsuleInputSchema.safeParse(
      buildCapsuleInput({ garmentIds: ['garment-1', 'garment-1'] })
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'garmentIds must not contain duplicates'
      )
    }
  })

  it('rejects fewer than two and more than ten garments', () => {
    expect(
      createOutfitCapsuleInputSchema.safeParse(buildCapsuleInput({ garmentIds: ['g1'] }))
        .success
    ).toBe(false)
    expect(
      createOutfitCapsuleInputSchema.safeParse(
        buildCapsuleInput({
          garmentIds: Array.from({ length: 11 }, (_, index) => `garment-${index}`),
        })
      ).success
    ).toBe(false)
  })

  it('accepts the ten garment ceiling', () => {
    expect(
      createOutfitCapsuleInputSchema.safeParse(
        buildCapsuleInput({
          garmentIds: Array.from({ length: 10 }, (_, index) => `garment-${index}`),
        })
      ).success
    ).toBe(true)
  })
})

describe('create capsule input', () => {
  it('defaults isFavorite to false when omitted', () => {
    expect(createOutfitCapsuleInputSchema.parse(buildCapsuleInput()).isFavorite).toBe(
      false
    )
  })

  it('requires at least one occasion and rejects more than eight', () => {
    expect(
      createOutfitCapsuleInputSchema.safeParse(buildCapsuleInput({ occasions: [] }))
        .success
    ).toBe(false)
    expect(
      createOutfitCapsuleInputSchema.safeParse(
        buildCapsuleInput({
          occasions: [
            'work',
            'casual',
            'formal',
            'sport',
            'travel',
            'evening',
            'outdoor',
            'home',
            'work',
          ],
        })
      ).success
    ).toBe(false)
  })

  it('rejects an occasion outside the declared enum', () => {
    expect(
      createOutfitCapsuleInputSchema.safeParse(
        buildCapsuleInput({ occasions: ['brunch'] })
      ).success
    ).toBe(false)
  })

  // Ownership is derived from the authenticated principal and the path, so a
  // client-supplied owner must never be accepted from the body.
  it('rejects a client-injected ownerUserId', () => {
    const result = createOutfitCapsuleInputSchema.safeParse(
      buildCapsuleInput({ ownerUserId: 'other-user' })
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'unrecognized_keys', keys: ['ownerUserId'] }),
        ])
      )
    }
  })
})

describe('update capsule input', () => {
  // Every field is optional on a PATCH, but the ones that are present still go
  // through the same normalization as on create.
  it('accepts an empty patch body', () => {
    expect(updateOutfitCapsuleInputSchema.parse({})).toEqual({})
  })

  it('applies name normalization to a partial update', () => {
    expect(updateOutfitCapsuleInputSchema.parse({ name: '  Renamed  ' }).name).toBe(
      'Renamed'
    )
  })

  it('rejects duplicate garment ids on a partial update', () => {
    expect(
      updateOutfitCapsuleInputSchema.safeParse({ garmentIds: ['g1', 'g1', 'g2'] }).success
    ).toBe(false)
  })

  it('rejects unknown keys on a partial update', () => {
    expect(updateOutfitCapsuleInputSchema.safeParse({ revision: 3 }).success).toBe(false)
  })
})

describe('favorite capsule input', () => {
  it('requires an explicit boolean state', () => {
    expect(favoriteOutfitCapsuleInputSchema.parse({ isFavorite: true })).toEqual({
      isFavorite: true,
    })
    expect(favoriteOutfitCapsuleInputSchema.safeParse({}).success).toBe(false)
    expect(
      favoriteOutfitCapsuleInputSchema.safeParse({ isFavorite: 'true' }).success
    ).toBe(false)
  })
})

describe('list capsules query', () => {
  it('applies limit and offset defaults', () => {
    expect(listOutfitCapsulesQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 })
  })

  // Query strings arrive as text, so the numeric bounds only hold if coercion
  // happens before the min/max checks.
  it('coerces numeric query strings before bounding them', () => {
    expect(
      listOutfitCapsulesQuerySchema.parse({ limit: '50', offset: '10' })
    ).toMatchObject({ limit: 50, offset: 10 })
    expect(listOutfitCapsulesQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(listOutfitCapsulesQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
    expect(listOutfitCapsulesQuerySchema.safeParse({ offset: '10001' }).success).toBe(
      false
    )
    expect(listOutfitCapsulesQuerySchema.safeParse({ limit: '2.5' }).success).toBe(false)
  })

  // `?isFavorite=false` must mean false, not "any non-empty string is truthy".
  it('interprets the isFavorite query string in both directions', () => {
    expect(listOutfitCapsulesQuerySchema.parse({ isFavorite: 'true' }).isFavorite).toBe(
      true
    )
    expect(listOutfitCapsulesQuerySchema.parse({ isFavorite: 'false' }).isFavorite).toBe(
      false
    )
    expect(listOutfitCapsulesQuerySchema.parse({}).isFavorite).toBeUndefined()
  })

  it('rejects an isFavorite value that is neither true nor false', () => {
    expect(listOutfitCapsulesQuerySchema.safeParse({ isFavorite: 'maybe' }).success).toBe(
      false
    )
    expect(listOutfitCapsulesQuerySchema.safeParse({ isFavorite: '1' }).success).toBe(
      false
    )
  })

  // `?q=` with an empty value means "no search", not "search for the empty
  // string", which would otherwise match every capsule.
  it('drops a blank search term instead of filtering on it', () => {
    expect(listOutfitCapsulesQuerySchema.parse({ q: '   ' }).q).toBeUndefined()
    expect(listOutfitCapsulesQuerySchema.parse({ q: '  linen  ' }).q).toBe('linen')
  })

  it('rejects a search term longer than 120 graphemes', () => {
    expect(listOutfitCapsulesQuerySchema.safeParse({ q: 'a'.repeat(121) }).success).toBe(
      false
    )
    expect(listOutfitCapsulesQuerySchema.safeParse({ q: 'a'.repeat(120) }).success).toBe(
      true
    )
  })

  it('rejects an unknown query parameter', () => {
    expect(listOutfitCapsulesQuerySchema.safeParse({ sort: 'name' }).success).toBe(false)
  })

  it('rejects occasion and comfortRange values outside their enums', () => {
    expect(listOutfitCapsulesQuerySchema.safeParse({ occasion: 'brunch' }).success).toBe(
      false
    )
    expect(
      listOutfitCapsulesQuerySchema.safeParse({ comfortRange: 'freezing' }).success
    ).toBe(false)
  })
})
