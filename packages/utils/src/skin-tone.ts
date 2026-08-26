/**
 * Story 5.4 Decision 3 owner: skin-tone (undertone + depth) classification
 * over closed-form CIELAB colour science. No model, no colour library
 * (`culori`, `chroma-js`, ...): the classification is standard published
 * maths implemented as pure functions, the same home and the same reasoning
 * `contrast.ts` uses.
 *
 * Two pipelines feed this module (both live outside it, per Decision 3):
 *
 *   - The selfie pipeline (`palette-analysis.engine.ts`) crops, gates
 *     survivors through the Chai-Ngan YCbCr skin-chroma bounds, and takes the
 *     MEDIAN of the survivors' Lab `a*`/`b*` before calling `classifyDepth`
 *     and `classifyUndertone` here.
 *   - The wardrobe pipeline (the advisor service) reads `PaletteInsights.hex_codes`,
 *     discards near-achromatic entries, and takes the median of the
 *     survivors' Lab `a*`/`b*` the same way, with `depth` forced to `null`
 *     (clothing colour is not evidence of skin depth).
 *
 * Both call `srgbToLab`/`linearRgbToLab` from this module and never average
 * gamma-encoded sRGB bytes directly: `linearizeSrgbChannel` (from
 * `contrast.ts`) must run first, and averaging/medianing happens on the
 * linearized channels or on the resulting Lab values, never on the raw bytes.
 */

import { linearizeSrgbChannel, srgbChannels } from './contrast'

export type SkinUndertone = 'warm' | 'cool' | 'neutral' | 'olive'
export type SkinDepth = 'fair' | 'light' | 'medium' | 'tan' | 'deep'

export type Lab = { L: number; a: number; b: number }

// ---------------------------------------------------------------------------
// sRGB -> linear RGB -> CIEXYZ (D65) -> CIELAB
// ---------------------------------------------------------------------------

/** CIE standard D65 white point (2-degree observer), the same illuminant sRGB is defined against. */
const D65_WHITE_X = 0.95047
const D65_WHITE_Y = 1.0
const D65_WHITE_Z = 1.08883

/** The CIE 1976 L*a*b* linear-to-nonlinear breakpoint: (6/29)^3. */
const LAB_EPSILON = 216 / 24389
/** The corresponding slope for the linear segment below LAB_EPSILON: 1/(3*(6/29)^2). */
const LAB_KAPPA = 24389 / 27

function labForwardTransform(t: number): number {
  return t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116
}

/**
 * Linear sRGB (each channel in [0, 1], already gamma-expanded) to CIELAB
 * under the D65 white point. This is the entry point the pixel pipelines use:
 * averaging/medianing the survivors happens on linear values or on the
 * resulting Lab, never on gamma-encoded bytes, or the answer is biased toward
 * the darker input.
 */
export function linearRgbToLab(rgb: readonly [number, number, number]): Lab {
  const [r, g, b] = rgb

  // sRGB D65 linear-RGB -> CIEXYZ matrix (IEC 61966-2-1).
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175
  const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041

  const fx = labForwardTransform(x / D65_WHITE_X)
  const fy = labForwardTransform(y / D65_WHITE_Y)
  const fz = labForwardTransform(z / D65_WHITE_Z)

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

/**
 * `#RGB`/`#RRGGBB` (with or without the leading `#`) straight to CIELAB.
 * Inherits `srgbChannels`'s input contract exactly, including the throw on
 * eight-digit `#RRGGBBAA` — this module composites no alpha either.
 */
export function srgbToLab(hex: string): Lab {
  const [r, g, b] = srgbChannels(hex)
  return linearRgbToLab([
    linearizeSrgbChannel(r),
    linearizeSrgbChannel(g),
    linearizeSrgbChannel(b),
  ])
}

// ---------------------------------------------------------------------------
// Depth: the Individual Typology Angle (ITA°)
// ---------------------------------------------------------------------------

/**
 * The Chardon Individual Typology Angle: `arctan((L* - 50) / b*) * 180 / pi`.
 * The standard instrument for skin-tone depth classification.
 *
 * Returns `null` when `b* <= 0`. The formula is undefined there (or, for a
 * literal 0, division by zero), and — the domain reason, not just the
 * arithmetic one — a mean that reads as bluish-or-neutral in `b*` is not skin
 * at all, so there is no depth band to report. A `null` ITA must terminate
 * the caller's analysis as `failed` / `low_quality`; it must never fall
 * through to a band by, say, treating `null` as 0.
 */
export function individualTypologyAngle(lab: Lab): number | null {
  if (lab.b <= 0) {
    return null
  }
  return (Math.atan((lab.L - 50) / lab.b) * 180) / Math.PI
}

/** Published ITA° depth-band upper bounds, exclusive-lower / inclusive-upper (see {@link classifyDepth}). */
export const ITA_FAIR_MIN = 55
export const ITA_LIGHT_MIN = 41
export const ITA_MEDIUM_MIN = 28
export const ITA_TAN_MIN = 10

/**
 * The published ITA° bands, with the literature's separate brown and dark
 * bands collapsed onto `deep` because {@link SkinDepth} has five members, not
 * six: `ITA > 55` fair, `41 < ITA <= 55` light, `28 < ITA <= 41` medium,
 * `10 < ITA <= 28` tan, `ITA <= 10` deep.
 *
 * Exclusive-lower, inclusive-upper is the published convention and, unlike an
 * inclusive-lower reading, is TOTAL: every real number lands in exactly one
 * band, and none of the four boundary values (55, 41, 28, 10) is orphaned
 * between two ranges or double-counted.
 */
export function classifyDepth(ita: number): SkinDepth {
  if (ita > ITA_FAIR_MIN) {
    return 'fair'
  }
  if (ita > ITA_LIGHT_MIN) {
    return 'light'
  }
  if (ita > ITA_MEDIUM_MIN) {
    return 'medium'
  }
  if (ita > ITA_TAN_MIN) {
    return 'tan'
  }
  return 'deep'
}

// ---------------------------------------------------------------------------
// Undertone: CIELAB hue angle, never a b*/a* ratio
// ---------------------------------------------------------------------------

/**
 * CIELAB chroma: `sqrt(a*^2 + b*^2)`, the distance from the achromatic axis.
 * Screens the one input `hueAngleDegrees`/`atan2` cannot answer (`a* = b* = 0`)
 * and is also the neutral-undertone gate on its own: too little colour to
 * call warm, cool, or olive.
 */
export function chroma(lab: Lab): number {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b)
}

/**
 * CIELAB hue angle in degrees, `atan2(b*, a*)` wrapped to `[0, 360)`. Defined
 * everywhere except `a* = b* = 0`, which {@link chroma} already screens before
 * any caller reaches this.
 */
export function hueAngleDegrees(lab: Lab): number {
  const degrees = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  return degrees < 0 ? degrees + 360 : degrees
}

/**
 * The interquartile spread of a set of hue angles, in degrees, measured
 * CIRCULARLY: each angle's signed deviation from the sample's mean direction,
 * wrapped into `(-180, 180]`, and the interquartile range taken over those
 * deviations. Zero for fewer than four samples, which is too few to quartile.
 *
 * Both confidence formulas that consume this — the selfie engine's and the
 * wardrobe derivation's — read it as "how much do these hues disagree", and a
 * hue angle is a point on a circle, not a position on a line. Taking the plain
 * interquartile range of `hueAngleDegrees` output treats 359 degrees and 1
 * degree as 358 apart when they are 2 apart, so a set that agrees tightly
 * across the 0/360 wrap scores as total disagreement. That is not a corner
 * case for a wardrobe: magentas and fuchsias sit just below 360 in CIELAB
 * while reds, corals and pinks sit just above 0, and a wardrobe holding both
 * would have been refused with `insufficient_wardrobe` while its colours in
 * fact agreed.
 *
 * Deviations are taken from the mean direction rather than from zero, and the
 * interquartile range is translation-invariant, so for any sample that does
 * NOT straddle the wrap this returns exactly what the naive linear range
 * returned. The fix adds no calibration change to correct data; it only stops
 * the wrap from manufacturing disagreement.
 */
export function hueAngleInterquartileSpread(hueAngles: readonly number[]): number {
  if (hueAngles.length < 4) {
    return 0
  }

  const toRadians = Math.PI / 180
  let sumSin = 0
  let sumCos = 0
  for (const angle of hueAngles) {
    sumSin += Math.sin(angle * toRadians)
    sumCos += Math.cos(angle * toRadians)
  }
  const meanDirection = (Math.atan2(sumSin, sumCos) * 180) / Math.PI

  const deviations = hueAngles
    .map((angle) => {
      // `((x % 360) + 360) % 360` first, because JavaScript's `%` keeps the
      // sign of the dividend and a negative remainder would land outside the
      // half-open window this shifts into.
      const wrapped = (((angle - meanDirection) % 360) + 360) % 360
      return wrapped > 180 ? wrapped - 360 : wrapped
    })
    .sort((a, b) => a - b)

  const q1 = deviations[Math.floor(deviations.length * 0.25)] ?? 0
  const q3 = deviations[Math.floor(deviations.length * 0.75)] ?? 0
  return q3 - q1
}

/**
 * Below this chroma, there is too little colour in the mean to call an
 * undertone at all — the median survivor is effectively grey. Real skin
 * chroma runs well above this floor (roughly 15-45 in typical daylight
 * captures); this is a conservative gate for a genuinely washed-out input.
 */
export const NEUTRAL_CHROMA_MAX = 6

/**
 * Real skin lives in CIELAB's first quadrant (`a* > 0`, `b* > 0`, hue roughly
 * 0-120 degrees) between the red axis (0 degrees) and past the yellow axis
 * (90 degrees) toward green. Going around that arc:
 *
 *   - COOL sits closest to the red axis: pink/red skin carries relatively
 *     little yellow, so its hue angle is the lowest of the three.
 *   - WARM sits in the middle: golden/peachy skin carries more yellow
 *     relative to red, pushing the hue angle up toward (and sometimes past)
 *     the yellow axis.
 *   - OLIVE is the highest band, past the yellow axis: a green-yellow cast
 *     means `a*` shrinks toward, or past, zero relative to `b*`.
 *
 * A ratio of `b*` over `a*` cannot express this ordering safely: `a*` is near zero for
 * neutral skin and genuinely negative for a wardrobe mean pulled toward green
 * or cyan, so the ratio both diverges (blows up near `a* = 0`) and silently
 * inverts the comparison exactly where olive needs to be detected. The hue
 * angle via `atan2` has neither failure mode.
 *
 * `COOL_HUE_MAX` is the boundary between the cool and warm bands (cool's
 * upper bound / warm's lower bound). `WARM_HUE_MAX` is the boundary between
 * warm and olive (warm's upper bound / `OLIVE_HUE_MIN`) — the "yellow-green
 * wedge above the warm band" Decision 3 names. Anything at or past
 * `OLIVE_HUE_MAX` (true green, cyan, blue, violet) is outside any real skin
 * or garment measurement this feature will ever see post-gate, and falls
 * back to `cool` rather than being left unclassified, which keeps the
 * function total without inventing a fifth undertone.
 */
export const COOL_HUE_MAX = 25
export const WARM_HUE_MAX = 70
export const OLIVE_HUE_MIN = WARM_HUE_MAX
export const OLIVE_HUE_MAX = 120

/**
 * `neutral` when {@link chroma} is below {@link NEUTRAL_CHROMA_MAX} (too
 * little colour to call); otherwise `olive` when the hue angle falls in
 * `[OLIVE_HUE_MIN, OLIVE_HUE_MAX)`; otherwise `cool` below
 * {@link COOL_HUE_MAX}; otherwise `warm` below {@link WARM_HUE_MAX}; anything
 * remaining (true green/cyan/blue/violet, unreachable for real skin after the
 * upstream chroma gates) falls back to `cool`, which keeps the function total.
 */
export function classifyUndertone(lab: Lab): SkinUndertone {
  if (chroma(lab) < NEUTRAL_CHROMA_MAX) {
    return 'neutral'
  }

  const hue = hueAngleDegrees(lab)

  if (hue >= OLIVE_HUE_MIN && hue < OLIVE_HUE_MAX) {
    return 'olive'
  }
  if (hue < COOL_HUE_MAX) {
    return 'cool'
  }
  if (hue < WARM_HUE_MAX) {
    return 'warm'
  }
  return 'cool'
}
