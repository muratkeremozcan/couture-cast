// Story 5.3 Task 6 owner: the mobile copy of the premium palette table.
//
// Five solid colors per palette, the same five the web surface carries as CSS custom
// properties in `apps/web/src/app/globals.css`'s `[data-theme]` blocks. Both copies are
// pinned to `refs/ux/ux-color-themes.html`, the file the UX spec designates as the
// precise-values reference, and the values here are byte-identical to the web ones on
// purpose: `packages/utils/src/contrast.spec.ts` re-pins the audited pairings as
// regression fixtures, so a drift on either surface fails that spec rather than shipping
// an unaudited contrast ratio.
//
// Three things about this file are load-bearing rather than stylistic:
//
// - **Every field is a plain color string, `cardBg` included.** Winter Metallic's card
//   preview is a two-stop gradient in the reference file
//   (`linear-gradient(135deg,#F7FBFF,#E9EDF6)`); both surfaces flatten it to the darker
//   Ice end (Decision 2). That is the worst case for contrast against Gunmetal text and
//   the value already audited at 10.78:1, and it is what lets one palette table serve a
//   CSS custom property and a `StyleSheet` color alike. Do not add
//   `expo-linear-gradient` to render a settings swatch.
// - **This is a different axis from `constants/colors.ts` and `hero-theme.ts`.** Those
//   are OS light/dark plumbing. A premium palette is the reader's own paid choice and
//   rides on top of whichever OS scheme is active, so the two must not be folded
//   together (Decision 4's trap).
// - **The duplication with the web CSS layer is deliberate and temporary.** No shared
//   token package exists — `architecture.md:85-88` describes `packages/tokens` but it
//   was never built — and the ledger entry for that consolidation names this file as one
//   of its two inputs.
import type { PremiumThemeKey } from '@couture/api-client/contracts/http'

/**
 * The five carriers a palette defines.
 *
 * `primary` and `secondary` never carry text. Two of the three `primary` fills miss the
 * 4.5:1 small-text floor against white (Decision 2), so on both surfaces they render as
 * swatch dots ringed in `cardText`; every string in a themed card renders in `cardText`
 * on `cardBg`, the pairing that measures 8.01-11.58:1 across all three palettes.
 */
export interface ThemePalette {
  primary: string
  secondary: string
  cardBg: string
  cardText: string
  cardBorder: string
}

/**
 * The implicit Default palette — the monochrome-and-gold system every reader has before
 * they choose, and the one a non-entitled or signed-out reader keeps.
 *
 * `theme: null` on the wire IS this palette (contract Decision 1): there is no `default`
 * member in `premiumThemeKeySchema`, so this table is keyed separately rather than as a
 * fourth enum entry.
 */
export const DEFAULT_THEME_PALETTE: ThemePalette = Object.freeze({
  primary: '#111111',
  secondary: '#C9A14A',
  cardBg: '#F5F5F7',
  cardText: '#111111',
  cardBorder: 'rgba(17, 17, 25, 0.2)',
})

/**
 * The three shipped palettes, exhaustive over the contract enum.
 *
 * `Record<PremiumThemeKey, ThemePalette>` rather than a partial map: a palette added to
 * `premiumThemeKeySchema` fails to typecheck here until it has colors, so the mobile
 * surface cannot silently fall behind the contract the way an index signature would let
 * it. Spring Bloom is absent because the UX spec marks it future.
 */
export const PREMIUM_THEME_PALETTES: Record<PremiumThemeKey, ThemePalette> =
  Object.freeze({
    jewel_radiance: {
      primary: '#0D6F62',
      secondary: '#6C3AA8',
      cardBg: '#F4F6FB',
      cardText: '#1F4E79',
      cardBorder: 'rgba(31, 78, 121, 0.25)',
    },
    autumn_umber: {
      primary: '#B1683A',
      secondary: '#D9B38C',
      cardBg: '#F3EDE6',
      cardText: '#3E2A23',
      cardBorder: 'rgba(62, 42, 35, 0.2)',
    },
    // Ice, the darker stop of the reference gradient (Decision 2).
    winter_metallic: {
      primary: '#7E889A',
      secondary: '#C9CDD8',
      cardBg: '#E9EDF6',
      cardText: '#2F333D',
      cardBorder: 'rgba(47, 51, 61, 0.15)',
    },
  })

/**
 * The palette for a stored key, or Default for `null`.
 *
 * Takes `PremiumThemeKey | null` rather than `string`, so narrowing an arbitrary stored
 * value stays the job of `resolvePremiumThemeKey` in `src/lib/premium-theme.ts` and
 * there is exactly one place that decides what an unrecognized key means (AC 6).
 */
export function resolveThemePalette(key: PremiumThemeKey | null): ThemePalette {
  return key === null ? DEFAULT_THEME_PALETTE : PREMIUM_THEME_PALETTES[key]
}
