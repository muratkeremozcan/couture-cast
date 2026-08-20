// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
/**
 * Story 5.3 AC 2: the premium palettes' contrast is proven, not eyeballed.
 *
 * The six fixtures below are the Decision 2 table, pinned as regression fixtures so a
 * designer nudging a hex value fails here rather than shipping an illegible pairing.
 * Ratios are floating-point results running to four-plus decimals, so they are asserted
 * with `toBeCloseTo(ratio, 2)` against the two-decimal figures; `toBe` against a rounded
 * literal fails immediately.
 *
 * `5.3-UTIL-007` is deliberately absent from this file. It is the "both entry points
 * agree" test for `playwright/support/helpers/accessibility.ts`'s `rgb()` signature
 * delegating to this module, and it lives in
 * `playwright/support/helpers/accessibility.spec.ts` instead: `packages/utils` is an
 * isolated npm workspace package whose `tsconfig.typecheck.json` pins `rootDir` to this
 * package directory, so a relative import reaching out to the Playwright tier would
 * both violate that rootDir and pull `@playwright/test` types into a package that has
 * no reason to depend on Playwright. The id is not reused for something else here so a
 * reader grepping for it lands on the real test rather than a gap.
 */
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  meetsWcagAA,
  WCAG_AA_LARGE_TEXT_RATIO,
  WCAG_AA_NORMAL_TEXT_RATIO,
} from './contrast'

/**
 * Hex values are the `refs/ux/ux-color-themes.html` Color Theme Explorer's, which
 * Decision 2 designates as the engineering source over the UX spec's prose. Winter
 * Metallic's card background is the flattened solid Ice end of its two-stop gradient
 * (also Decision 2), which is the darker stop and therefore the worst case here.
 */
const PALETTE_CONTRAST_FIXTURES = [
  {
    id: '5.3-UTIL-001',
    theme: 'Jewel Radiance',
    pairing: 'Sapphire #1F4E79 body text on Pearl #F4F6FB card preview',
    foreground: '#1F4E79',
    background: '#F4F6FB',
    ratio: 8.01,
    passesNormalText: true,
  },
  {
    id: '5.3-UTIL-002',
    theme: 'Autumn Umber',
    pairing: 'Cocoa #3E2A23 body text on Frost #F3EDE6 card preview',
    foreground: '#3E2A23',
    background: '#F3EDE6',
    ratio: 11.58,
    passesNormalText: true,
  },
  {
    id: '5.3-UTIL-003',
    theme: 'Winter Metallic',
    pairing: 'Gunmetal #2F333D body text on Ice #E9EDF6 card preview',
    foreground: '#2F333D',
    background: '#E9EDF6',
    ratio: 10.78,
    passesNormalText: true,
  },
  {
    id: '5.3-UTIL-004',
    theme: 'Jewel Radiance',
    pairing: 'white text on the Emerald #0D6F62 primary fill',
    foreground: '#FFFFFF',
    background: '#0D6F62',
    ratio: 6.06,
    passesNormalText: true,
  },
  {
    id: '5.3-UTIL-005',
    theme: 'Autumn Umber',
    pairing: 'white text on the Maple #B1683A primary fill',
    foreground: '#FFFFFF',
    background: '#B1683A',
    ratio: 4.28,
    passesNormalText: false,
  },
  {
    id: '5.3-UTIL-006',
    theme: 'Winter Metallic',
    pairing: 'white text on the Steel #7E889A primary fill',
    foreground: '#FFFFFF',
    background: '#7E889A',
    ratio: 3.57,
    passesNormalText: false,
  },
] as const

describe('5.3 premium palette contrast fixtures', () => {
  it.each(PALETTE_CONTRAST_FIXTURES)(
    '$id pins $theme: $pairing',
    ({ foreground, background, ratio, passesNormalText }) => {
      expect(contrastRatio(foreground, background)).toBeCloseTo(ratio, 2)
      expect(meetsWcagAA(foreground, background)).toBe(passesNormalText)
      // Every pairing the gallery ships clears the 3:1 large-text/non-text floor, so
      // the two that fail small text stay usable as large/bold text or icon-only.
      expect(meetsWcagAA(foreground, background, { largeText: true })).toBe(true)
    }
  )

  it('restricts exactly the two primary fills Decision 2 names to large text', () => {
    // Stated as a set rather than per-row so adding a fourth palette that quietly
    // fails small text cannot pass by being asserted against its own expectation.
    const largeTextOnly = PALETTE_CONTRAST_FIXTURES.filter(
      ({ foreground, background }) => !meetsWcagAA(foreground, background)
    ).map(({ theme }) => theme)

    expect(largeTextOnly).toEqual(['Autumn Umber', 'Winter Metallic'])
  })

  it('5.3-UTIL-008 flattens Winter Metallic to the worse of its two gradient stops', () => {
    // Decision 2 collapses `linear-gradient(135deg,#F7FBFF,#E9EDF6)` to solid Ice
    // because neither carrier holds a gradient. This proves nothing was lost
    // accessibility-wise: the shipped stop is the darker, lower-contrast one.
    const ice = contrastRatio('#2F333D', '#E9EDF6')
    const glacier = contrastRatio('#2F333D', '#F7FBFF')

    expect(glacier).toBeCloseTo(12.15, 2)
    expect(ice).toBeLessThan(glacier)
  })
})

describe('contrastRatio', () => {
  it('returns 21 for black on white and 1 for a color against itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#0D6F62', '#0D6F62')).toBeCloseTo(1, 5)
  })

  it('is symmetric, so foreground/background argument order carries no meaning', () => {
    expect(contrastRatio('#1F4E79', '#F4F6FB')).toBeCloseTo(
      contrastRatio('#F4F6FB', '#1F4E79'),
      10
    )
  })

  it('accepts shorthand and hash-less hex as the same color', () => {
    const canonical = contrastRatio('#FFFFFF', '#000000')

    expect(contrastRatio('#fff', '#000')).toBeCloseTo(canonical, 10)
    expect(contrastRatio('FFFFFF', '000000')).toBeCloseTo(canonical, 10)
    expect(contrastRatio('  #FfFfFf  ', '#000')).toBeCloseTo(canonical, 10)
  })

  it.each([
    '',
    '#12345',
    'rgb(255, 255, 255)',
    '#GGGGGG',
    'white',
    // Eight-digit CSS hex. Rejected rather than truncated: this module cannot
    // composite alpha against an unknown backdrop, so dropping the channel would
    // report a ratio for a color that is never painted.
    '#11111180',
  ])('throws on %o rather than silently scoring it as black', (value) => {
    expect(() => contrastRatio(value, '#FFFFFF')).toThrow(
      /Expected a 3- or 6-digit hex color/
    )
  })

  /**
   * The callers that reach this are CSS scrapers: `premium-theme-section.test.tsx`
   * parses `globals.css` into a property map, so a renamed or deleted custom property
   * arrives here as `undefined`. Without the guard that surfaces as
   * `Cannot read properties of undefined (reading 'trim')`, which reads as a bug in the
   * luminance maths rather than a missing token at the call site.
   */
  it.each([undefined, null, 0x111111, ['#111111']])(
    'names %o as a bad input instead of dying inside trim()',
    (value) => {
      expect(() => contrastRatio(value as unknown as string, '#FFFFFF')).toThrow(
        /Expected a 3- or 6-digit hex color/
      )
    }
  )
})

describe('meetsWcagAA', () => {
  it('thresholds at 4.5 for normal text and 3 for large text', () => {
    expect(WCAG_AA_NORMAL_TEXT_RATIO).toBe(4.5)
    expect(WCAG_AA_LARGE_TEXT_RATIO).toBe(3)
  })

  it('treats an omitted or false largeText option as normal text', () => {
    // Maple + white is 4.28:1, the fixture that sits between the two floors.
    expect(meetsWcagAA('#FFFFFF', '#B1683A')).toBe(false)
    expect(meetsWcagAA('#FFFFFF', '#B1683A', {})).toBe(false)
    expect(meetsWcagAA('#FFFFFF', '#B1683A', { largeText: false })).toBe(false)
    expect(meetsWcagAA('#FFFFFF', '#B1683A', { largeText: true })).toBe(true)
  })

  it('fails a pairing with no contrast at either threshold', () => {
    expect(meetsWcagAA('#7E889A', '#7E889A')).toBe(false)
    expect(meetsWcagAA('#7E889A', '#7E889A', { largeText: true })).toBe(false)
  })
})
