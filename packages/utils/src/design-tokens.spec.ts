// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
/**
 * Story CC-7.9 UNIT-001..005: the token set's contrast, gold and scale rules.
 *
 * These pins replace the per-app copies (`apps/mobile/constants/colors.test.ts` and the
 * `globals.css` parsing in `premium-theme-section.test.tsx`): both apps now read these values,
 * so proving them once here proves every surface that paints them.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio, srgbChannels } from './contrast'
import {
  boxShadowFor,
  buildDesignTokenCssRules,
  COLOR_ROLE_NAMES,
  colorRoles,
  elevation,
  FILL_TEXT_PAIRS,
  GOLD_COLOR_ROLES,
  hexToChannels,
  kebabTokenName,
  MEANING_LINE_COLOR_ROLES,
  PREMIUM_PALETTE_FIELDS,
  PREMIUM_PALETTE_KEYS,
  premiumPalettes,
  radius,
  shell,
  space,
  SPACE_SCALE_PX,
  TEXT_COLOR_ROLES,
  typeScale,
  withAlpha,
  type ColorScheme,
} from './design-tokens'

const SCHEMES: readonly ColorScheme[] = ['light', 'dark']
const SURFACES = ['page', 'card', 'cardMuted'] as const

/**
 * Gold, as the D3 rule means it: a saturated yellow-orange hue between 35 and 55 degrees.
 * The notice roles sit at 15 to 31 degrees (orange), so a warning never reads as gold.
 */
function isGold(hex: string): boolean {
  const [red, green, blue] = srgbChannels(hex).map((channel) => channel / 255) as [
    number,
    number,
    number,
  ]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  if (max === 0 || delta / max < 0.35 || max < 0.3 || max !== red) return false
  const hue = (60 * ((green - blue) / delta) + 360) % 360
  return hue >= 35 && hue <= 55
}

describe('7.9-UNIT-001 text roles meet 4.5:1 on every surface of their scheme', () => {
  const cases = SCHEMES.flatMap((scheme) =>
    TEXT_COLOR_ROLES.flatMap((role) =>
      SURFACES.map((surface) => ({ scheme, role, surface }))
    )
  )

  it.each(cases)('$scheme $role on $surface', ({ scheme, role, surface }) => {
    const roles = colorRoles[scheme]
    expect(contrastRatio(roles[role], roles[surface])).toBeGreaterThanOrEqual(4.5)
  })

  const fills = SCHEMES.flatMap((scheme) =>
    FILL_TEXT_PAIRS.map(([text, fill]) => ({ scheme, text, fill }))
  )
  it.each(fills)('$scheme $text on its $fill fill', ({ scheme, text, fill }) => {
    const roles = colorRoles[scheme]
    expect(contrastRatio(roles[text], roles[fill])).toBeGreaterThanOrEqual(4.5)
  })

  it('pins the D2 page and card values', () => {
    expect(colorRoles.light.page).toBe('#FFFFFF')
    expect(colorRoles.light.card).toBe('#F5F5F7')
    expect(colorRoles.dark.page).toBe('#121214')
    expect(colorRoles.dark.card).toBe('#1C1C21')
  })

  it('defines every role in both schemes as a six-digit hex', () => {
    for (const scheme of SCHEMES) {
      expect(Object.keys(colorRoles[scheme]).sort()).toEqual([...COLOR_ROLE_NAMES].sort())
      for (const role of COLOR_ROLE_NAMES) {
        expect(colorRoles[scheme][role]).toMatch(/^#[0-9A-F]{6}$/)
      }
    }
  })
})

describe('7.9-UNIT-002 premium palettes keep 4.5:1 text on their card in both schemes', () => {
  const cases = (['default', ...PREMIUM_PALETTE_KEYS] as const).flatMap((key) =>
    SCHEMES.map((scheme) => ({ key, scheme }))
  )

  it.each(cases)('$key $scheme cardText on cardBg', ({ key, scheme }) => {
    const palette = premiumPalettes[key][scheme]
    expect(contrastRatio(palette.cardText, palette.cardBg)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(PREMIUM_PALETTE_KEYS)('%s dark variant sits on a dark card', (key) => {
    const { dark, light } = premiumPalettes[key]
    // A dark card is darker than the dark page's ink and far from the light card.
    expect(contrastRatio(dark.cardBg, colorRoles.dark.ink)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.cardBg, light.cardBg)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the light palettes on the Story 5.3 Decision 2 reference values', () => {
    expect(premiumPalettes.jewel_radiance.light).toMatchObject({
      primary: '#0D6F62',
      cardBg: '#F4F6FB',
      cardText: '#1F4E79',
    })
    expect(premiumPalettes.autumn_umber.light).toMatchObject({
      primary: '#B1683A',
      cardBg: '#F3EDE6',
      cardText: '#3E2A23',
    })
    expect(premiumPalettes.winter_metallic.light).toMatchObject({
      primary: '#7E889A',
      cardBg: '#E9EDF6',
      cardText: '#2F333D',
    })
  })
})

describe('7.9-UNIT-003 meaning lines and icons meet 3:1', () => {
  const cases = SCHEMES.flatMap((scheme) =>
    MEANING_LINE_COLOR_ROLES.flatMap((role) =>
      SURFACES.map((surface) => ({ scheme, role, surface }))
    )
  )

  it.each(cases)('$scheme $role on $surface', ({ scheme, role, surface }) => {
    const roles = colorRoles[scheme]
    expect(contrastRatio(roles[role], roles[surface])).toBeGreaterThanOrEqual(3)
  })

  it.each(SCHEMES)('%s focus halo meets 3:1 on the page', (scheme) => {
    const roles = colorRoles[scheme]
    expect(contrastRatio(roles.focus, roles.page)).toBeGreaterThanOrEqual(3)
  })
})

describe('7.9-UNIT-004 gold lives only in the five gold roles', () => {
  it.each(SCHEMES)('%s: the gold roles are exactly D3 list', (scheme) => {
    const goldRoles = COLOR_ROLE_NAMES.filter((role) => isGold(colorRoles[scheme][role]))
    expect(goldRoles.sort()).toEqual([...GOLD_COLOR_ROLES].sort())
  })

  it('recognises the fill gold and rejects the notice orange', () => {
    expect(isGold('#C9A14A')).toBe(true)
    expect(isGold(colorRoles.light.noticeLine)).toBe(false)
    expect(isGold(colorRoles.dark.noticeInk)).toBe(false)
    expect(isGold('#FFFFFF')).toBe(false)
  })
})

describe('7.9-UNIT-005 scales equal D4 exactly', () => {
  it('type scale is 12, 14, 16, 18, 20, 24, 30', () => {
    expect(Object.values(typeScale).map(({ fontSize }) => fontSize)).toEqual([
      12, 14, 16, 18, 20, 24, 30,
    ])
    expect(Object.keys(typeScale)).toEqual(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'])
  })

  it('spacing is 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64 under the Tailwind keys', () => {
    expect(SPACE_SCALE_PX).toEqual([0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64])
    expect(Object.values(space).sort((a, b) => a - b)).toEqual([...SPACE_SCALE_PX])
    for (const [key, px] of Object.entries(space)) expect(Number(key) * 4).toBe(px)
  })

  it('radius is sm 4, md 8, lg 12, xl 16 plus none and full', () => {
    expect(radius).toEqual({ none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 })
  })

  it('elevation is none, card and overlay, rising', () => {
    expect(Object.keys(elevation)).toEqual(['none', 'card', 'overlay'])
    expect(elevation.none.opacity).toBe(0)
    expect(elevation.card.blur).toBeLessThan(elevation.overlay.blur)
  })

  it('shell sizes are 56, 56 and 44', () => {
    expect(shell).toEqual({ topBarHeight: 56, tabBarHeight: 56, touchTarget: 44 })
  })
})

describe('7.9-UNIT-007 the helpers both apps build their styles from', () => {
  it('spells a role in kebab case for the web', () => {
    expect(kebabTokenName('cardMuted')).toBe('card-muted')
    expect(kebabTokenName('onPrimary')).toBe('on-primary')
    expect(kebabTokenName('page')).toBe('page')
  })

  it('turns a hex into the channel triple a --cc-* variable carries', () => {
    expect(hexToChannels('#FFFFFF')).toBe('255 255 255')
    expect(hexToChannels('#121214')).toBe('18 18 20')
  })

  it('composites a role at an opacity for native', () => {
    expect(withAlpha('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('renders each elevation as a box-shadow, none for the flat level', () => {
    expect(boxShadowFor('none')).toBe('none')
    expect(boxShadowFor('card')).toBe('0 1px 3px rgb(0 0 0 / 0.08)')
    expect(boxShadowFor('overlay')).toBe('0 8px 24px rgb(0 0 0 / 0.18)')
  })

  it('emits every role and palette variable for :root, dark and each data-theme', () => {
    const rules = buildDesignTokenCssRules()
    const dark = rules['@media (prefers-color-scheme: dark)'] as Record<
      string,
      Record<string, string>
    >
    const root = rules[':root'] as Record<string, string>
    expect(root['color-scheme']).toBe('light')
    expect(dark[':root']!['color-scheme']).toBe('dark')
    for (const role of COLOR_ROLE_NAMES) {
      const variable = `--cc-${kebabTokenName(role)}`
      expect(root[variable]).toBe(hexToChannels(colorRoles.light[role]))
      expect(dark[':root']![variable]).toBe(hexToChannels(colorRoles.dark[role]))
    }
    for (const key of ['default', ...PREMIUM_PALETTE_KEYS] as const) {
      const selector = `[data-theme='${key}']`
      for (const field of PREMIUM_PALETTE_FIELDS) {
        const variable = `--cc-theme-${kebabTokenName(field)}`
        expect((rules[selector] as Record<string, string>)[variable]).toBe(
          hexToChannels(premiumPalettes[key].light[field])
        )
        expect(dark[selector]![variable]).toBe(
          hexToChannels(premiumPalettes[key].dark[field])
        )
      }
    }
  })
})
