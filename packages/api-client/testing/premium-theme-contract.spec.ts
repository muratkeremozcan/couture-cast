// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import { describe, expect, it } from 'vitest'
import {
  badRequestHttpErrorSchema,
  forbiddenHttpErrorSchema,
  generateHttpOpenApiDocument,
  premiumThemeKeySchema,
  premiumThemeResponseSchema,
  premiumThemeSchema,
  serviceUnavailableHttpErrorSchema,
  updatePremiumThemeInputSchema,
  updatePremiumThemeResponseSchema,
  PREMIUM_REQUIRED_MESSAGE,
  PREMIUM_THEMES_DISABLED_MESSAGE,
} from '../src/contracts/http'

/**
 * Story 5.3 Task 3: the consumer-side contract for the premium theme switcher.
 *
 * This suite asserts the PUBLISHED SHAPES only. Entitlement resolution, the
 * upsert-never-delete reset, and the 403-before-503 precedence are business
 * rules proven in the API suites. What is proven here is what every surface
 * depends on and no runtime test would catch: that the palette enum is closed
 * around exactly the three shipped palettes, that `theme` is nullable and never
 * optional so the key is always on the wire, that neither payload can widen,
 * and that the route carries no id parameter to authorize against.
 */

const THEME_KEYS = ['jewel_radiance', 'autumn_umber', 'winter_metallic'] as const

const defaultState = {
  theme: null,
  isEntitled: true,
  themesEnabled: true,
}

describe('premium theme response', () => {
  it('5.3-CONTRACT-01 carries the resolved palette with its entitlement and flag state', () => {
    const parsed = premiumThemeResponseSchema.parse({
      data: { ...defaultState, theme: 'jewel_radiance' },
    })

    expect(parsed.data).toEqual({
      theme: 'jewel_radiance',
      isEntitled: true,
      themesEnabled: true,
    })
  })

  it('5.3-CONTRACT-02 serializes a null theme rather than omitting the key', () => {
    // `.nullable()` semantics, never `.optional()`: Default has to be an
    // explicit value on the wire, or a client cannot tell "Default" from
    // "this response predates the field".
    expect(premiumThemeResponseSchema.parse({ data: defaultState }).data).toEqual(
      defaultState
    )
    expect(
      premiumThemeSchema.safeParse({ isEntitled: false, themesEnabled: true }).success
    ).toBe(false)
  })

  it('5.3-CONTRACT-03 refuses a response that smuggles anything past the three fields', () => {
    // `.strict()` is what keeps palette hex values out of the contract: they
    // live in each app's styling layer, so a designer tweak is not a contract
    // change.
    expect(
      premiumThemeSchema.safeParse({
        ...defaultState,
        cardBg: '#E9EDF6',
      }).success
    ).toBe(false)
  })

  it('5.3-CONTRACT-04 returns the same shape from the write path as from the read path', () => {
    const state = {
      theme: 'winter_metallic' as const,
      isEntitled: true,
      themesEnabled: true,
    }

    expect(updatePremiumThemeResponseSchema.parse({ data: state })).toEqual(
      premiumThemeResponseSchema.parse({ data: state })
    )
  })
})

describe('premium theme palette enum', () => {
  it.each(THEME_KEYS)('5.3-CONTRACT-05 accepts the shipped palette %s', (theme) => {
    expect(premiumThemeKeySchema.parse(theme)).toBe(theme)
    expect(updatePremiumThemeInputSchema.parse({ theme })).toEqual({ theme })
  })

  it('5.3-CONTRACT-06 does not carry Spring Bloom, which the UX spec marks future', () => {
    // A fourth palette is a deliberate contract change, not a UI change.
    expect(premiumThemeKeySchema.safeParse('spring_bloom').success).toBe(false)
    expect([...premiumThemeKeySchema.options]).toEqual([...THEME_KEYS])
  })

  it.each(['default', 'none'])(
    '5.3-CONTRACT-07 has no %s member, because null already spells Default',
    (member) => {
      // Two spellings of the same fact is exactly the trap 5.2 named for
      // PremiumEntitlementStatus. Null is the only spelling here.
      expect(premiumThemeKeySchema.safeParse(member).success).toBe(false)
    }
  )
})

describe('premium theme update input', () => {
  it('5.3-CONTRACT-08 accepts null as the reset-to-Default instruction', () => {
    expect(updatePremiumThemeInputSchema.parse({ theme: null })).toEqual({ theme: null })
  })

  it('5.3-CONTRACT-09 requires the theme key rather than treating absence as a reset', () => {
    // An omitted key would make a truncated request body indistinguishable from
    // a deliberate reset, which is a silent data loss the schema can rule out.
    expect(updatePremiumThemeInputSchema.safeParse({}).success).toBe(false)
  })

  it('5.3-CONTRACT-10 rejects an unknown palette and any extra property', () => {
    expect(
      updatePremiumThemeInputSchema.safeParse({ theme: 'midnight_noir' }).success
    ).toBe(false)
    expect(
      updatePremiumThemeInputSchema.safeParse({ theme: null, userId: 'user-1' }).success
    ).toBe(false)
  })
})

describe('premium theme error envelopes', () => {
  it('5.3-CONTRACT-11 exposes both refusals as messages, never machine codes', () => {
    expect(PREMIUM_THEMES_DISABLED_MESSAGE.length).toBeGreaterThan(0)
    expect(PREMIUM_THEMES_DISABLED_MESSAGE).not.toBe(PREMIUM_REQUIRED_MESSAGE)

    expect(
      forbiddenHttpErrorSchema.parse({
        statusCode: 403,
        message: PREMIUM_REQUIRED_MESSAGE,
        error: 'Forbidden',
      }).message
    ).toBe(PREMIUM_REQUIRED_MESSAGE)
    expect(
      serviceUnavailableHttpErrorSchema.parse({
        statusCode: 503,
        message: PREMIUM_THEMES_DISABLED_MESSAGE,
        error: 'Service Unavailable',
      }).message
    ).toBe(PREMIUM_THEMES_DISABLED_MESSAGE)

    // The shared envelopes are `.strict()`, so a THEME_* code cannot be added
    // to a response body even by accident.
    expect(
      badRequestHttpErrorSchema.safeParse({
        statusCode: 400,
        message: 'Invalid input payload',
        error: 'Bad Request',
        code: 'THEME_INVALID',
      }).success
    ).toBe(false)
  })
})

describe('premium theme published operations', () => {
  const document = generateHttpOpenApiDocument()
  const themePath = document.paths?.['/api/v1/commerce/premium/theme']

  it('5.3-CONTRACT-12 publishes both operations inside the commerce prefix', () => {
    // The prefix is load-bearing: CommerceCacheHeadersMiddleware is bound to
    // `/api/v1/commerce{/*path}`, so a route moved out of it would silently
    // ship a per-user response without its private/no-store header.
    expect(themePath?.get).toBeDefined()
    expect(themePath?.put).toBeDefined()
    expect(themePath?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(themePath?.put?.security).toEqual([{ bearerAuth: [] }])
  })

  it('5.3-CONTRACT-13 exposes no id parameter to authorize against', () => {
    // The acting user is the only subject; there is no path, query, or body
    // field naming another user, so cross-user access is unrepresentable rather
    // than merely rejected.
    // Scoped to the theme path specifically, not the shared
    // /api/v1/commerce/premium prefix: Story 5.4 published eight more
    // operations under that same prefix for the palette advisor.
    const premiumThemePaths = Object.keys(document.paths ?? {}).filter((path) =>
      path.startsWith('/api/v1/commerce/premium/theme')
    )

    expect(premiumThemePaths).toEqual(['/api/v1/commerce/premium/theme'])
    expect(themePath?.get?.parameters ?? []).toEqual([])
    expect(themePath?.put?.parameters ?? []).toEqual([])
  })

  it('5.3-CONTRACT-14 documents the gated statuses on the write path only', () => {
    // The read path answers every signed-in caller, entitled or not, so it has
    // neither a 403 nor a 503 to document.
    expect(themePath?.put?.responses?.['403']).toBeDefined()
    expect(themePath?.put?.responses?.['503']).toBeDefined()
    expect(themePath?.get?.responses?.['403']).toBeUndefined()
    expect(themePath?.get?.responses?.['503']).toBeUndefined()
  })

  it('5.3-CONTRACT-15 publishes the palette enum nullable on the wire and closed standalone', () => {
    // The regression guard for `nullablePremiumThemeKeySchema`. Drop the
    // explicit `enum` array it supplies and `preserveNullableEnumValues` appends
    // `null` in place, into the array zod-to-openapi hands out by reference from
    // the ZodEnum itself, so the standalone component and the SDK enum generated
    // from it would both gain a `null` member no code path accepts. Both
    // functions carry the note on why that post-pass is not corrected here.
    type EnumNode = { enum?: unknown[] }
    const schemas = document.components?.schemas as
      | Record<string, EnumNode & { properties?: Record<string, EnumNode> }>
      | undefined

    expect(schemas?.PremiumThemeKey?.enum).toEqual([...THEME_KEYS])
    expect(schemas?.PremiumTheme?.properties?.theme?.enum).toEqual([...THEME_KEYS, null])
    expect(schemas?.UpdatePremiumThemeInput?.properties?.theme?.enum).toEqual([
      ...THEME_KEYS,
      null,
    ])
  })
})
