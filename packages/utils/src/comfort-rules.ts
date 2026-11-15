/**
 * Comfort rules shared by the authenticated ritual engine
 * (`apps/api/src/modules/personalization/ritual-generation.engine.ts` and
 * `capsule-recommendation.engine.ts`) and the Story 6.16 guest sample policy.
 *
 * These values moved here verbatim from the engine so both clients and the API
 * apply one rule set. `ritual-generation.engine.golden.spec.ts` proves the
 * engine's outputs did not change with the move.
 *
 * Comparisons stay with each caller: the engine treats wind and rain as
 * exceeded only when strictly greater than the threshold.
 */

export type ComfortRun = 'cold' | 'neutral' | 'warm'
export type ComfortTolerance = 'low' | 'medium' | 'high'

export const COMFORT_RANGES = ['cold', 'cool', 'mild', 'warm', 'hot'] as const
export type ComfortRange = (typeof COMFORT_RANGES)[number]

const WIND_THRESHOLD_M_S: Record<ComfortTolerance, number> = {
  low: 3,
  medium: 5,
  high: 8,
}

const PRECIP_PROB_THRESHOLD: Record<ComfortTolerance, number> = {
  high: 0.2,
  medium: 0.4,
  low: 0.7,
}

const PRECIP_AMOUNT_THRESHOLD_MM: Record<ComfortTolerance, number> = {
  high: 0.1,
  medium: 0.5,
  low: 2.0,
}

/** Degrees Celsius a cold or warm runner shifts the felt temperature. */
export const COMFORT_RUN_OFFSET_CELSIUS = 3

/** Adjusted feels-like strictly below this needs an outerwear layer. */
export const OUTERWEAR_THRESHOLD_CELSIUS = 15

export const CLOSE_COMFORT_MATCHES: Readonly<
  Record<ComfortRange, readonly ComfortRange[]>
> = {
  cold: ['cool'],
  cool: ['mild', 'cold'],
  mild: ['cool', 'warm'],
  warm: ['mild', 'hot'],
  hot: ['warm'],
}

export function getWindThreshold(windTolerance: ComfortTolerance): number {
  return WIND_THRESHOLD_M_S[windTolerance] ?? 5.0
}

export function getRainProbThreshold(precipPreparedness: ComfortTolerance): number {
  return PRECIP_PROB_THRESHOLD[precipPreparedness] ?? 0.3
}

export function getRainAmountThreshold(precipPreparedness: ComfortTolerance): number {
  return PRECIP_AMOUNT_THRESHOLD_MM[precipPreparedness] ?? 0.1
}

export function adjustFeelsLike(feelsLike: number, runsColdWarm: ComfortRun): number {
  if (runsColdWarm === 'cold') return feelsLike - COMFORT_RUN_OFFSET_CELSIUS
  if (runsColdWarm === 'warm') return feelsLike + COMFORT_RUN_OFFSET_CELSIUS
  return feelsLike
}

export function resolveComfortRangeFromTemperature(
  adjustedFeelsLike: number
): ComfortRange {
  if (adjustedFeelsLike < 10) return 'cold'
  if (adjustedFeelsLike < 15) return 'cool'
  if (adjustedFeelsLike < 20) return 'mild'
  if (adjustedFeelsLike < 25) return 'warm'
  return 'hot'
}

export function needsOuterwear(adjustedFeelsLike: number): boolean {
  return adjustedFeelsLike < OUTERWEAR_THRESHOLD_CELSIUS
}
