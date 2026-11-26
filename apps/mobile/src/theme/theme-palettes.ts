// Story 5.3 Task 6 owner: the mobile premium palette table.
// Story CC-7.9 D5: the palettes come from the shared design tokens
// (`packages/utils/src/design-tokens.ts`), the same values web emits as `[data-theme]` blocks, and
// each has a dark variant so a palette follows the system setting. Contrast for both schemes is
// pinned once in `design-tokens.spec.ts`.
//
// - **Every field is a plain color string, `cardBg` included.** Winter Metallic's card preview is
//   flattened to its Ice stop (Story 5.3 Decision 2), which keeps one table for web and native.
// - **This is a different axis from `constants/colors.ts`.** Those are the OS light/dark roles.
//   A premium palette is the reader's own paid choice and rides on top of the active scheme.
import type { PremiumThemeKey } from '@couture/api-client/contracts/http'
import {
  premiumPalettes,
  type ColorScheme,
  type PremiumPaletteColors,
} from '@couture/utils'

/**
 * The five carriers a palette defines.
 *
 * `primary` and `secondary` never carry text: on both surfaces they render as swatch dots ringed
 * in `cardText`; every string in a themed card renders in `cardText` on `cardBg`.
 */
export type ThemePalette = PremiumPaletteColors

/**
 * The implicit Default palette in the light scheme: the system every reader has before they
 * choose. `theme: null` on the wire IS this palette (contract Decision 1).
 */
export const DEFAULT_THEME_PALETTE: ThemePalette = premiumPalettes.default.light

/** The three shipped palettes in the light scheme, exhaustive over the contract enum. */
export const PREMIUM_THEME_PALETTES: Record<PremiumThemeKey, ThemePalette> =
  Object.freeze({
    jewel_radiance: premiumPalettes.jewel_radiance.light,
    autumn_umber: premiumPalettes.autumn_umber.light,
    winter_metallic: premiumPalettes.winter_metallic.light,
  })

/**
 * The palette for a stored key in a scheme, or Default for `null`.
 *
 * Narrowing an arbitrary stored value stays the job of `resolvePremiumThemeKey` in
 * `src/lib/premium-theme.ts`, so one place decides what an unrecognized key means (AC 6).
 */
export function resolveThemePalette(
  key: PremiumThemeKey | null,
  scheme: ColorScheme = 'light'
): ThemePalette {
  return premiumPalettes[key ?? 'default'][scheme]
}
