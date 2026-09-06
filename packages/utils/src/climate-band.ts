/**
 * Story 6.1 Task 1: Canonical climate band vocabulary and classifier.
 *
 * Why this is NOT resolveComfortRangeFromTemperature:
 * resolveComfortRangeFromTemperature in ritual-generation.engine.ts and
 * capsule-recommendation.engine.ts answers "how warm should this one garment
 * be at this instant" for a single moment in time. In contrast, a climate band
 * answers "what weather pattern does this region sit in across the week" based
 * on aggregate daily forecasts (temperature midpoint mean and precipitation
 * frequency). The axes and the inputs differ: comfort ranges map a single hourly
 * temperature to a clothing warmth tier, whereas climate bands classify multi-day
 * regional weather into one of six canonical regional climates.
 *
 * Thresholds (Decision 1):
 * - Temperature axis: mean of per-day midpoints in Celsius.
 *   - cold: mean < 10
 *   - temperate: 10 <= mean < 22
 *   - warm: mean >= 22
 * - Moisture axis: wet when >= 40% of usable days have precipitationProbability >= 0.4
 *   or precipitationAmount >= 1.0 mm. Otherwise dry.
 * - Usability: a usable day needs finite temperatureMin <= temperatureMax AND at least
 *   one usable precipitation signal: a finite precipitationProbability within the
 *   inclusive range 0..1, or a finite precipitationAmount >= 0. Out-of-range or
 *   non-finite precipitation is treated as absent, so legacy rows carrying no usable
 *   precipitation are excluded rather than inferred dry (they must not inflate the
 *   wet-ratio denominator). Classification requires at least 3 usable unique days
 *   after localDate deduplication; fewer than 3 returns null. Null is a first-class
 *   state everywhere and is never a silent fallback to temperate_dry.
 */

export const CLIMATE_BANDS = [
  'cold_wet',
  'cold_dry',
  'temperate_wet',
  'temperate_dry',
  'warm_wet',
  'warm_dry',
] as const

export type ClimateBand = (typeof CLIMATE_BANDS)[number]

/**
 * Ordered band list for UI selectors, filter chips, and navigation.
 */
export const ORDERED_CLIMATE_BANDS: readonly ClimateBand[] = CLIMATE_BANDS

export interface ClimateBandDay {
  temperatureMin: number
  temperatureMax: number
  precipitationProbability?: number | null
  precipitationAmount?: number | null
  localDate?: string
}

const MINIMUM_USABLE_DAYS = 3
const COLD_TEMPERATURE_UPPER_BOUND = 10
const TEMPERATE_TEMPERATURE_UPPER_BOUND = 22
const WET_DAY_PRECIPITATION_PROBABILITY_THRESHOLD = 0.4
const WET_DAY_PRECIPITATION_AMOUNT_THRESHOLD_MM = 1.0
const WET_RATIO_THRESHOLD = 0.4

/**
 * A probability is only a usable moisture signal when it is finite and expressed
 * on the canonical 0..1 scale (inclusive). Percent-scale values (40), impossible
 * values (1.5), and non-finite values are treated as absent rather than as a hard
 * error, so a legacy row simply carries no probability signal.
 */
function usablePrecipitationProbability(day: ClimateBandDay): number | null {
  const prob = day.precipitationProbability
  if (prob == null || typeof prob !== 'number' || !Number.isFinite(prob)) {
    return null
  }
  return prob >= 0 && prob <= 1 ? prob : null
}

/**
 * An amount is only a usable moisture signal when it is finite and non-negative.
 * Negative or non-finite amounts are treated as absent, never as zero rainfall.
 */
function usablePrecipitationAmount(day: ClimateBandDay): number | null {
  const amount = day.precipitationAmount
  if (amount == null || typeof amount !== 'number' || !Number.isFinite(amount)) {
    return null
  }
  return amount >= 0 ? amount : null
}

function hasUsablePrecipitation(day: ClimateBandDay): boolean {
  return (
    usablePrecipitationProbability(day) != null || usablePrecipitationAmount(day) != null
  )
}

/**
 * A day is usable only when it carries both a valid temperature range and at least
 * one usable precipitation signal. Days missing usable precipitation are excluded
 * entirely: they are never counted as dry, because inferring wetness (in either
 * direction) for legacy rows would silently skew the wet ratio denominator.
 */
function isUsableDay(day: ClimateBandDay): boolean {
  return (
    day != null &&
    typeof day.temperatureMin === 'number' &&
    Number.isFinite(day.temperatureMin) &&
    typeof day.temperatureMax === 'number' &&
    Number.isFinite(day.temperatureMax) &&
    day.temperatureMin <= day.temperatureMax &&
    hasUsablePrecipitation(day)
  )
}

function isWetDay(day: ClimateBandDay): boolean {
  const prob = usablePrecipitationProbability(day)
  const amount = usablePrecipitationAmount(day)

  const probWet = prob != null && prob >= WET_DAY_PRECIPITATION_PROBABILITY_THRESHOLD
  const amountWet = amount != null && amount >= WET_DAY_PRECIPITATION_AMOUNT_THRESHOLD_MM

  return probWet || amountWet
}

/**
 * Pure function classifying normalized daily weather entries into one of six
 * canonical climate bands, or null if fewer than 3 usable days exist.
 */
export function classifyClimateBand(days: readonly ClimateBandDay[]): ClimateBand | null {
  if (!days || days.length === 0) {
    return null
  }

  const rawUsableDays = days.filter(isUsableDay)

  // Deduplicate by localDate when present
  const seenDates = new Set<string>()
  const usableDays: ClimateBandDay[] = []
  for (const day of rawUsableDays) {
    if (day.localDate) {
      if (seenDates.has(day.localDate)) {
        continue
      }
      seenDates.add(day.localDate)
    }
    usableDays.push(day)
  }

  if (usableDays.length < MINIMUM_USABLE_DAYS) {
    return null
  }

  let totalMidpoint = 0
  let wetDaysCount = 0

  for (const day of usableDays) {
    const midpoint = (day.temperatureMin + day.temperatureMax) / 2
    totalMidpoint += midpoint

    if (isWetDay(day)) {
      wetDaysCount += 1
    }
  }

  const meanTemperature = totalMidpoint / usableDays.length
  const wetRatio = wetDaysCount / usableDays.length

  const isWet = wetRatio >= WET_RATIO_THRESHOLD

  let temperatureCategory: 'cold' | 'temperate' | 'warm'
  if (meanTemperature < COLD_TEMPERATURE_UPPER_BOUND) {
    temperatureCategory = 'cold'
  } else if (meanTemperature < TEMPERATE_TEMPERATURE_UPPER_BOUND) {
    temperatureCategory = 'temperate'
  } else {
    temperatureCategory = 'warm'
  }

  const moistureCategory = isWet ? 'wet' : 'dry'
  return `${temperatureCategory}_${moistureCategory}`
}
