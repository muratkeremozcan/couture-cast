/**
 * Story 5.3 Decision 3 owner: canonical WCAG 2.2 AA contrast math over hex colors.
 *
 * SC 1.4.3 (contrast minimum) and SC 1.4.11 (non-text contrast) are byte-identical
 * between WCAG 2.1 and 2.2, so the linearization and the 4.5/3.0 floors are the same
 * either way. 2.2 is cited because that is the level the PRD's accessibility NFR
 * targets.
 *
 * Two earlier copies of this maths already live in the Playwright suite, both over CSS
 * `rgb()` strings rather than hex: the exported helper in
 * `playwright/support/helpers/accessibility.ts` and an inline duplicate in
 * `playwright/tests/accessibility-hardening.spec.ts`. Neither is touched here. The
 * Playwright tier is out of scope for this change, so the adapter rewrite Decision 3
 * planned for the exported helper is deferred alongside the inline copy that its own
 * docblock already explains was left alone. Both therefore remain outstanding
 * duplicates and belong in this story's `deferred-work.md` ledger entry rather than
 * being left unowned; `5.3-UTIL-007` in `contrast.spec.ts` is reserved for the
 * both-entry-points-agree test that rewrite would carry. The channel linearization and
 * the ratio below match theirs exactly, so folding either into a thin `rgb()`-to-hex
 * adapter over this module is a pure delegation with no behavior change.
 *
 * Palette hex values live with the surface that renders them (web CSS custom properties,
 * mobile palette table). This module stays pure maths so both surfaces can prove their
 * own pairings against one implementation instead of eyeballing them.
 *
 * Story 5.4 Task 2 owner: `srgbChannels` and `linearizeSrgbChannel` are exported
 * (and `relativeLuminance` refactored to compose them, no behavior change) so
 * `skin-tone.ts` can reuse the exact same sRGB parsing and gamma-expansion
 * rather than a third copy. `skin-tone.ts` inherits this module's input
 * contract exactly: `#RGB`/`#RRGGBB` with or without the leading `#`, and a
 * thrown error on anything else, including eight-digit `#RRGGBBAA`.
 */

const HEX_COLOR_PATTERN = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** SC 1.4.3 contrast-minimum floor for normal-size text. */
export const WCAG_AA_NORMAL_TEXT_RATIO = 4.5

/**
 * SC 1.4.3's large-text floor, which is also SC 1.4.11's non-text floor for icons,
 * borders, and other UI components carrying meaning.
 */
export const WCAG_AA_LARGE_TEXT_RATIO = 3

export interface WcagContrastOptions {
  /**
   * Large text is at least 18pt/24px regular or 14pt/18.66px bold, per SC 1.4.3.
   * Icon-only and other non-text UI share the same 3:1 floor via SC 1.4.11.
   */
  largeText?: boolean
}

/**
 * Expands `#abc` to `abc` -> `aabbcc` and returns the three 0-255 sRGB channels.
 *
 * The `typeof` guard comes before `.trim()` on purpose. Callers scrape these values
 * out of CSS text (`premium-theme-section.test.tsx` parses `globals.css` into a
 * property map), so a renamed or missing custom property arrives as `undefined`. Left
 * to `.trim()` that surfaces as `Cannot read properties of undefined`, which reads as
 * a crash in the maths rather than what it is: a missing token at the call site.
 *
 * Eight-digit `#RRGGBBAA` is rejected rather than truncated. This module cannot
 * composite alpha against an unknown backdrop, and silently dropping the alpha channel
 * would report a contrast ratio for a color that is never painted. `--theme-card-border`
 * is declared as `rgba()` for the same reason and is never passed through here.
 */
export function srgbChannels(value: string): [number, number, number] {
  if (typeof value !== 'string') {
    throw new Error(
      `Expected a 3- or 6-digit hex color with no alpha channel, received ${String(value)}`
    )
  }

  const trimmed = value.trim()
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new Error(
      `Expected a 3- or 6-digit hex color with no alpha channel, received ${value}`
    )
  }

  const digits = trimmed.replace('#', '')
  const expanded =
    digits.length === 3 ? digits.replace(/./g, (digit) => `${digit}${digit}`) : digits

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ]
}

/**
 * WCAG/sRGB gamma-expansion of one 0-255 sRGB channel to linear [0, 1].
 *
 * Averaging or weighting must happen AFTER this step, never before: the mean
 * of two gamma-encoded byte values is not the colour halfway between them.
 * `skin-tone.ts`'s pixel pipeline depends on this ordering (linearize each
 * channel, then average in linear space or in Lab).
 */
export function linearizeSrgbChannel(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance: gamma-correct sRGB linearization, then the 709 weights. */
function relativeLuminance(hex: string): number {
  const channels = srgbChannels(hex).map(linearizeSrgbChannel)
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

/**
 * WCAG contrast ratio between two hex colors, from 1 (identical) to 21 (black on
 * white). Symmetric: the lighter color is always the numerator, so argument order
 * carries no meaning. Accepts `#RRGGBB`, `#RGB`, and either form without the `#`;
 * anything else throws rather than silently scoring as black.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * Whether a foreground/background pairing clears the WCAG 2.2 AA floor: 4.5:1 for
 * normal text, or 3:1 with `largeText: true` for large/bold text and non-text UI.
 * The comparison is inclusive, matching the standard's "at least" wording.
 */
export function meetsWcagAA(
  foregroundHex: string,
  backgroundHex: string,
  opts?: WcagContrastOptions
): boolean {
  const threshold = opts?.largeText ? WCAG_AA_LARGE_TEXT_RATIO : WCAG_AA_NORMAL_TEXT_RATIO
  return contrastRatio(foregroundHex, backgroundHex) >= threshold
}
