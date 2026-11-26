// Story CC-7.9 D1 owner: the one design token set web and native both read.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
/**
 * Story CC-7.9 D1, D2, D4, D5: color roles for light and dark, the type, spacing, radius and
 * elevation scales, the shell sizes and the premium palettes, published once.
 *
 * Web reads these through `apps/web/tailwind.config.ts`, whose plugin emits each color as a
 * `--cc-<role>` channel triple (`255 255 255`) for `:root`, the dark media query and every
 * `[data-theme]` palette in both schemes (`buildDesignTokenCssRules` below). Native reads them
 * through `useTokens()` in `apps/mobile/src/theme/tokens.ts`. `scripts/check-design-tokens.mjs`
 * fails on any raw color, palette class or off-scale value in either app, so this module is the
 * only place a color value is written down.
 *
 * Gold (D3) lives only in `primary`, `focus`, `tabActive`, `premium` and `premiumInk`. A selected
 * chip, a pressed reaction or an active toggle uses `inverse`/`ink`; a decorative border uses
 * `line`; a warning uses the `notice*` roles. `design-tokens.spec.ts` pins that rule and every
 * contrast pairing, so a value nudged here fails there before it ships.
 */
import { srgbChannels } from './contrast'

export type ColorScheme = 'light' | 'dark'

/** D2: one role list, the same names on web (kebab-cased) and native. */
export const COLOR_ROLE_NAMES = [
  'page',
  'card',
  'cardMuted',
  'ink',
  'inkSoft',
  'inkMuted',
  'line',
  'lineStrong',
  'inverse',
  'onInverse',
  'primary',
  'onPrimary',
  'focus',
  'focusEssential',
  'tabActive',
  'premium',
  'premiumInk',
  'noticeSurface',
  'noticeLine',
  'noticeInk',
  'danger',
  'onDanger',
  'dangerSurface',
  'dangerLine',
  'dangerInk',
  'successInk',
  'merlotInk',
  'scrim',
] as const

export type ColorRole = (typeof COLOR_ROLE_NAMES)[number]
export type ColorRoles = Readonly<Record<ColorRole, string>>

/** The roles allowed to carry gold (D3). Every other role must stay off the gold hue. */
export const GOLD_COLOR_ROLES = [
  'primary',
  'focus',
  'tabActive',
  'premium',
  'premiumInk',
] as const satisfies readonly ColorRole[]

/** Text roles: each meets 4.5:1 on `page`, `card` and `cardMuted` of its scheme. */
export const TEXT_COLOR_ROLES = [
  'ink',
  'inkSoft',
  'inkMuted',
  'premiumInk',
  'noticeInk',
  'dangerInk',
  'successInk',
  'merlotInk',
] as const satisfies readonly ColorRole[]

/**
 * Icon and line roles that carry meaning: each meets 3:1 on `page`, `card` and `cardMuted`.
 * `line` is a decorative rule and is not one of them; a field, button or chip outline that a
 * reader needs to find uses `lineStrong`.
 */
export const MEANING_LINE_COLOR_ROLES = [
  'lineStrong',
  'tabActive',
  'focus',
  'focusEssential',
  'inverse',
] as const satisfies readonly ColorRole[]

/** Text on a filled role: each pair meets 4.5:1. */
export const FILL_TEXT_PAIRS = [
  ['onInverse', 'inverse'],
  ['onPrimary', 'primary'],
  ['onPrimary', 'premium'],
  ['onDanger', 'danger'],
  ['noticeInk', 'noticeSurface'],
  ['dangerInk', 'dangerSurface'],
] as const satisfies readonly (readonly [ColorRole, ColorRole])[]

const GOLD_FILL = '#C9A14A'

/**
 * D2 values. Light page `#FFFFFF`, card `#F5F5F7`; dark page `#121214`, card `#1C1C21`; the rest
 * carried from the lookbook and native tokens, darkened where a pairing missed its floor: the
 * light gold ink and active tab are `#7A5C14` (the lookbook's `#8A691F` measured 4.29:1 on
 * `cardMuted`) and the light focus halo is `#9A7A2A` (the fill gold is 2.4:1 on white).
 */
export const colorRoles: Readonly<Record<ColorScheme, ColorRoles>> = Object.freeze({
  light: Object.freeze({
    page: '#FFFFFF',
    card: '#F5F5F7',
    cardMuted: '#EBEBEF',
    ink: '#111111',
    inkSoft: '#36363D',
    inkMuted: '#5C5C66',
    line: '#E6E6ED',
    lineStrong: '#7E7E88',
    inverse: '#111111',
    onInverse: '#FFFFFF',
    primary: GOLD_FILL,
    onPrimary: '#111111',
    focus: '#9A7A2A',
    focusEssential: '#111111',
    tabActive: '#7A5C14',
    premium: GOLD_FILL,
    premiumInk: '#7A5C14',
    noticeSurface: '#FFF4ED',
    noticeLine: '#C2410C',
    noticeInk: '#9A3412',
    danger: '#B42318',
    onDanger: '#FFFFFF',
    dangerSurface: '#FEE4E2',
    dangerLine: '#F04438',
    dangerInk: '#991B1B',
    successInk: '#276749',
    merlotInk: '#7A1F2D',
    scrim: '#000000',
  }),
  dark: Object.freeze({
    page: '#121214',
    card: '#1C1C21',
    cardMuted: '#26262C',
    ink: '#F5F5F7',
    inkSoft: '#D4D4D8',
    inkMuted: '#A1A1AA',
    line: '#2E2E36',
    lineStrong: '#75757F',
    inverse: '#F5F5F7',
    onInverse: '#111111',
    primary: GOLD_FILL,
    onPrimary: '#111111',
    focus: GOLD_FILL,
    focusEssential: '#FFFFFF',
    tabActive: '#D9B75E',
    premium: GOLD_FILL,
    premiumInk: '#D9B75E',
    noticeSurface: '#2B1A10',
    noticeLine: '#EA580C',
    noticeInk: '#FDBA74',
    danger: '#B42318',
    onDanger: '#FFFFFF',
    dangerSurface: '#3B1416',
    dangerLine: '#B4474A',
    dangerInk: '#FFB4AB',
    successInk: '#7EE2A8',
    merlotInk: '#F0A3AE',
    scrim: '#000000',
  }),
})

/** The opacity a scrim paints at over the page (web `bg-scrim/50`, native `withAlpha`). */
export const SCRIM_OPACITY = 0.5

/**
 * D4 type scale in px (web `text-xs` to `text-3xl`; body 16; the top bar title is `lg`
 * semibold). Web font is Geist Sans; native uses the system font.
 */
export const typeScale = Object.freeze({
  xs: Object.freeze({ fontSize: 12, lineHeight: 16 }),
  sm: Object.freeze({ fontSize: 14, lineHeight: 20 }),
  base: Object.freeze({ fontSize: 16, lineHeight: 24 }),
  lg: Object.freeze({ fontSize: 18, lineHeight: 28 }),
  xl: Object.freeze({ fontSize: 20, lineHeight: 28 }),
  '2xl': Object.freeze({ fontSize: 24, lineHeight: 32 }),
  '3xl': Object.freeze({ fontSize: 30, lineHeight: 36 }),
})
export type TypeScaleKey = keyof typeof typeScale

export const fontWeight = Object.freeze({
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const)

/**
 * D4 spacing in px, keyed by the Tailwind spacing key that produces it, so `p-4` on web and
 * `space[4]` on native are both 16.
 */
export const space = Object.freeze({
  0: 0,
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
} as const)
export type SpaceKey = keyof typeof space

/** D4 spacing values, ascending. */
export const SPACE_SCALE_PX = Object.freeze([
  0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64,
] as const)

/** D4 radius in px. `full` is a pill; `none` squares a corner off. */
export const radius = Object.freeze({
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const)
export type RadiusKey = keyof typeof radius

export interface ElevationLevel {
  readonly offsetY: number
  readonly blur: number
  readonly opacity: number
  /** Android `elevation`. */
  readonly androidElevation: number
}

/** D4 elevation: no shadow, a resting card and an overlay (dialog, sheet, menu). */
export const elevation: Readonly<Record<'none' | 'card' | 'overlay', ElevationLevel>> =
  Object.freeze({
    none: Object.freeze({ offsetY: 0, blur: 0, opacity: 0, androidElevation: 0 }),
    card: Object.freeze({ offsetY: 1, blur: 3, opacity: 0.08, androidElevation: 1 }),
    overlay: Object.freeze({ offsetY: 8, blur: 24, opacity: 0.18, androidElevation: 8 }),
  })
export type ElevationKey = keyof typeof elevation

/** The color every shadow is cast in, in both schemes. */
export const SHADOW_COLOR = '#000000'

/** D6 shell sizes in px (web) and pt (native). */
export const shell = Object.freeze({
  topBarHeight: 56,
  tabBarHeight: 56,
  touchTarget: 44,
} as const)

export interface PremiumPaletteColors {
  /** A swatch fill; never carries text. */
  readonly primary: string
  /** A swatch fill; never carries text. */
  readonly secondary: string
  readonly cardBg: string
  readonly cardText: string
  /** A solid card edge (the old alpha borders flattened onto `cardBg`). */
  readonly cardBorder: string
}

export type PremiumPaletteKey = 'jewel_radiance' | 'autumn_umber' | 'winter_metallic'
export const PREMIUM_PALETTE_KEYS = Object.freeze([
  'jewel_radiance',
  'autumn_umber',
  'winter_metallic',
] as const satisfies readonly PremiumPaletteKey[])

/**
 * D5: each palette in both schemes. The light values are `refs/ux/ux-color-themes.html`'s
 * (Story 5.3 Decision 2, Winter Metallic flattened to its Ice stop); each dark variant keeps the
 * palette's hue on a dark card. `default` is the Default system every member has before choosing,
 * and its gold swatch is the `premium` role's gold.
 */
export const premiumPalettes: Readonly<
  Record<
    'default' | PremiumPaletteKey,
    Readonly<Record<ColorScheme, PremiumPaletteColors>>
  >
> = Object.freeze({
  default: Object.freeze({
    light: Object.freeze({
      primary: '#111111',
      secondary: GOLD_FILL,
      cardBg: '#F5F5F7',
      cardText: '#111111',
      cardBorder: '#C7C7CB',
    }),
    dark: Object.freeze({
      primary: '#F5F5F7',
      secondary: GOLD_FILL,
      cardBg: '#1C1C21',
      cardText: '#F5F5F7',
      cardBorder: '#3A3A42',
    }),
  }),
  jewel_radiance: Object.freeze({
    light: Object.freeze({
      primary: '#0D6F62',
      secondary: '#6C3AA8',
      cardBg: '#F4F6FB',
      cardText: '#1F4E79',
      cardBorder: '#BDCBDB',
    }),
    dark: Object.freeze({
      primary: '#3FB5A3',
      secondary: '#B48EE0',
      cardBg: '#16212D',
      cardText: '#A9CBEA',
      cardBorder: '#2C4257',
    }),
  }),
  autumn_umber: Object.freeze({
    light: Object.freeze({
      primary: '#B1683A',
      secondary: '#D9B38C',
      cardBg: '#F3EDE6',
      cardText: '#3E2A23',
      cardBorder: '#D0C6BE',
    }),
    dark: Object.freeze({
      primary: '#D08A5C',
      secondary: '#D9B38C',
      cardBg: '#2A1F1A',
      cardText: '#F0DCCB',
      cardBorder: '#4A3A31',
    }),
  }),
  winter_metallic: Object.freeze({
    light: Object.freeze({
      primary: '#7E889A',
      secondary: '#C9CDD8',
      cardBg: '#E9EDF6',
      cardText: '#2F333D',
      cardBorder: '#D0D4DD',
    }),
    dark: Object.freeze({
      primary: '#9AA4B6',
      secondary: '#C9CDD8',
      cardBg: '#1E222A',
      cardText: '#DCE1EA',
      cardBorder: '#3A404C',
    }),
  }),
})

export const PREMIUM_PALETTE_FIELDS = Object.freeze([
  'primary',
  'secondary',
  'cardBg',
  'cardText',
  'cardBorder',
] as const satisfies readonly (keyof PremiumPaletteColors)[])

/** `cardMuted` -> `card-muted`: the web spelling of a role or palette field. */
export function kebabTokenName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/** `#FFFFFF` -> `255 255 255`, the channel triple a `--cc-*` variable carries. */
export function hexToChannels(hex: string): string {
  return srgbChannels(hex).join(' ')
}

/** A role color at an opacity, for the native surfaces that composite (a scrim, a pressed tint). */
export function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = srgbChannels(hex)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

/** The CSS `box-shadow` for an elevation level. */
export function boxShadowFor(level: ElevationKey): string {
  const { offsetY, blur, opacity } = elevation[level]
  if (opacity === 0) return 'none'
  const [red, green, blue] = srgbChannels(SHADOW_COLOR)
  return `0 ${offsetY}px ${blur}px rgb(${red} ${green} ${blue} / ${opacity})`
}

type CssDeclarations = Record<string, string>
export type DesignTokenCssRules = Record<
  string,
  CssDeclarations | Record<string, CssDeclarations>
>

function roleVariables(scheme: ColorScheme): CssDeclarations {
  const roles = colorRoles[scheme]
  return Object.fromEntries(
    COLOR_ROLE_NAMES.map((role) => [
      `--cc-${kebabTokenName(role)}`,
      hexToChannels(roles[role]),
    ])
  )
}

function paletteVariables(palette: PremiumPaletteColors): CssDeclarations {
  return Object.fromEntries(
    PREMIUM_PALETTE_FIELDS.map((field) => [
      `--cc-theme-${kebabTokenName(field)}`,
      hexToChannels(palette[field]),
    ])
  )
}

const DARK_MEDIA = '@media (prefers-color-scheme: dark)'

/**
 * The web base layer, in the object shape Tailwind's `addBase` takes. `:root` carries the light
 * roles and the Default palette; each `[data-theme]` block (on `<html>` from `premium-theme.ts`,
 * or on one gallery card) carries its palette. The dark media block repeats both in dark values,
 * palettes after `:root` so a palette on `<html>` still wins over the Default it restates.
 */
export function buildDesignTokenCssRules(): DesignTokenCssRules {
  const paletteSelector = (key: string) => `[data-theme='${key}']`
  const light: DesignTokenCssRules = {
    ':root': {
      'color-scheme': 'light',
      ...roleVariables('light'),
      ...paletteVariables(premiumPalettes.default.light),
    },
    [paletteSelector('default')]: paletteVariables(premiumPalettes.default.light),
  }
  const dark: Record<string, CssDeclarations> = {
    ':root': {
      'color-scheme': 'dark',
      ...roleVariables('dark'),
      ...paletteVariables(premiumPalettes.default.dark),
    },
    [paletteSelector('default')]: paletteVariables(premiumPalettes.default.dark),
  }
  for (const key of PREMIUM_PALETTE_KEYS) {
    light[paletteSelector(key)] = paletteVariables(premiumPalettes[key].light)
    dark[paletteSelector(key)] = paletteVariables(premiumPalettes[key].dark)
  }
  return { ...light, [DARK_MEDIA]: dark }
}
