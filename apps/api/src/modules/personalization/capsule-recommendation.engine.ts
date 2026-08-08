import type { GarmentItem, OutfitCapsule, OutfitCapsuleGarment } from '@prisma/client'

export type CapsuleWithJoins = OutfitCapsule & {
  garment_joins: (OutfitCapsuleGarment & {
    garment: GarmentItem
  })[]
}

export type CapsuleRecommendationCandidate = {
  capsule: CapsuleWithJoins
  score: number
  completeness: 'complete' | 'partial'
  garmentIds: string[]
  autoFilledGarmentIds: string[]
}

/** Ordered comfort scale. Adjacency is measured as distance along this scale. */
const COMFORT_RANGES = ['cold', 'cool', 'mild', 'warm', 'hot'] as const

/**
 * Canonical slot order. Auto-filled garments are appended in this order so the
 * same capsule and wardrobe always produce the same garment sequence.
 */
const CANONICAL_SLOT_ORDER = ['dress', 'top', 'bottom', 'shoes', 'outerwear'] as const

/** Below this adjusted feels-like temperature an outerwear slot is required. */
const OUTERWEAR_THRESHOLD_CELSIUS = 15

const COMPLETE_CAPSULE_MULTIPLIER = 1.15
const FAVORITE_CAPSULE_BONUS = 0.1

/** Exact range scores 1, an adjacent range scores 0.5, anything further scores 0. */
function getComfortScore(garmentRange: string | null, targetRange: string): number {
  if (!garmentRange) return 0
  const garmentIdx = COMFORT_RANGES.indexOf(
    garmentRange as (typeof COMFORT_RANGES)[number]
  )
  const targetIdx = COMFORT_RANGES.indexOf(targetRange as (typeof COMFORT_RANGES)[number])
  if (garmentIdx === -1 || targetIdx === -1) return 0
  const distance = Math.abs(garmentIdx - targetIdx)
  if (distance === 0) return 1
  if (distance === 1) return 0.5
  return 0
}

function resolveTargetComfortRange(adjustedFeelsLike: number): string {
  if (adjustedFeelsLike < 10) return 'cold'
  if (adjustedFeelsLike < 15) return 'cool'
  if (adjustedFeelsLike < 20) return 'mild'
  if (adjustedFeelsLike < 25) return 'warm'
  return 'hot'
}

/**
 * A garment may only participate in a recommendation while it is fully uploaded
 * and retained. Checking retention alone would let a `processing` or `failed`
 * garment into a recommended outfit.
 */
function isRecommendable(garment: GarmentItem | null | undefined): boolean {
  return (
    garment !== null &&
    garment !== undefined &&
    garment.upload_status === 'ready' &&
    garment.retention_status === 'active'
  )
}

/**
 * Required category slots for a capsule.
 *
 * A capsule containing a dress needs `dress + shoes`; otherwise it needs
 * `top + bottom + shoes`. Cold weather *adds* an outerwear slot rather than
 * replacing the dress rule, so a dress capsule stays a dress capsule at 12°C.
 */
function resolveRequiredCategories(
  capsuleGarments: GarmentItem[],
  adjustedFeelsLike: number
): string[] {
  const hasDress = capsuleGarments.some((garment) => garment.category === 'dress')
  const required = hasDress ? ['dress', 'shoes'] : ['top', 'bottom', 'shoes']

  if (adjustedFeelsLike < OUTERWEAR_THRESHOLD_CELSIUS) {
    required.push('outerwear')
  }

  return [...required].sort(
    (a, b) =>
      CANONICAL_SLOT_ORDER.indexOf(a as (typeof CANONICAL_SLOT_ORDER)[number]) -
      CANONICAL_SLOT_ORDER.indexOf(b as (typeof CANONICAL_SLOT_ORDER)[number])
  )
}

/**
 * Averages the constituent comfort scores, or returns null when any garment
 * scores below 0.5. A capsule is weather-eligible only when every garment
 * clears that bar, so one failing garment disqualifies the whole capsule.
 */
function scoreCapsuleComfort(
  capsuleGarments: GarmentItem[],
  targetComfortRange: string
): number | null {
  let totalComfortScore = 0

  for (const garment of capsuleGarments) {
    const score = getComfortScore(garment.comfort_range, targetComfortRange)
    if (score < 0.5) {
      return null
    }
    totalComfortScore += score
  }

  return totalComfortScore / capsuleGarments.length
}

/**
 * Fills each missing required slot from the owner's eligible wardrobe. Returns
 * null when any slot cannot be filled, which excludes the capsule entirely
 * rather than recommending an incomplete outfit.
 */
function selectAutoFillGarments(options: {
  missingCategories: string[]
  userGarments: GarmentItem[]
  capsuleGarmentIds: string[]
  targetComfortRange: string
}): { autoFilledGarmentIds: string[]; filledGarmentIds: string[] } | null {
  const { missingCategories, userGarments, capsuleGarmentIds, targetComfortRange } =
    options

  const autoFilledGarmentIds: string[] = []
  const filledGarmentIds = [...capsuleGarmentIds]
  const selectedIds = new Set(filledGarmentIds)

  for (const missingCategory of missingCategories) {
    const categoryCandidates = userGarments.filter(
      (garment) =>
        garment.category === missingCategory &&
        isRecommendable(garment) &&
        !selectedIds.has(garment.id) &&
        getComfortScore(garment.comfort_range, targetComfortRange) >= 0.5
    )

    /**
     * Exact comfort match first, then adjacent, then most recently updated,
     * then lowest id. Sorting by comfort alone leaves ties resolved by input
     * order, which is not stable across queries.
     */
    const chosen = [...categoryCandidates].sort((a, b) => {
      const scoreDelta =
        getComfortScore(b.comfort_range, targetComfortRange) -
        getComfortScore(a.comfort_range, targetComfortRange)
      if (scoreDelta !== 0) return scoreDelta

      const updatedDelta = b.updated_at.getTime() - a.updated_at.getTime()
      if (updatedDelta !== 0) return updatedDelta

      return a.id.localeCompare(b.id)
    })[0]

    if (!chosen) {
      return null
    }

    autoFilledGarmentIds.push(chosen.id)
    filledGarmentIds.push(chosen.id)
    selectedIds.add(chosen.id)
  }

  return { autoFilledGarmentIds, filledGarmentIds }
}

export function evaluateCapsuleForScenario(options: {
  capsules: CapsuleWithJoins[]
  userGarments: GarmentItem[]
  adjustedFeelsLike: number
  requestedOccasion?: string
}): CapsuleRecommendationCandidate | null {
  const { capsules, userGarments, adjustedFeelsLike, requestedOccasion } = options

  /**
   * A non-finite temperature carries no information about what to wear.
   * Returning null preserves the existing non-capsule recommendation path
   * instead of silently scoring everything against the `hot` branch.
   */
  if (!Number.isFinite(adjustedFeelsLike)) {
    return null
  }

  const eligibleCapsules = capsules.filter((capsule) => {
    if (capsule.garment_joins.length < 2) {
      return false
    }

    /** availabilityStatus must be `ready`: every constituent garment available. */
    if (!capsule.garment_joins.every((join) => isRecommendable(join.garment))) {
      return false
    }

    if (
      requestedOccasion &&
      !(capsule.occasions as string[]).includes(requestedOccasion)
    ) {
      return false
    }

    return true
  })

  if (eligibleCapsules.length === 0) {
    return null
  }

  const targetComfortRange = resolveTargetComfortRange(adjustedFeelsLike)
  const candidates: CapsuleRecommendationCandidate[] = []

  for (const capsule of eligibleCapsules) {
    /** Copy before sorting: the caller reuses this array across scenarios. */
    const capsuleGarments = [...capsule.garment_joins]
      .sort((a, b) => a.garment_order - b.garment_order)
      .map((join) => join.garment)

    const baseAverage = scoreCapsuleComfort(capsuleGarments, targetComfortRange)
    if (baseAverage === null) {
      continue
    }

    const requiredCategories = resolveRequiredCategories(
      capsuleGarments,
      adjustedFeelsLike
    )
    const capsuleCategories = new Set(
      capsuleGarments.map((garment) => garment.category as string)
    )
    const missingCategories = requiredCategories.filter(
      (category) => !capsuleCategories.has(category)
    )

    const autoFill = selectAutoFillGarments({
      missingCategories,
      userGarments,
      capsuleGarmentIds: capsuleGarments.map((garment) => garment.id),
      targetComfortRange,
    })

    /** A capsule whose missing slots cannot be filled is excluded entirely. */
    if (!autoFill) {
      continue
    }

    const completeness: 'complete' | 'partial' =
      missingCategories.length === 0 ? 'complete' : 'partial'

    /** Multiplier first, then the favorite bonus as an additive term. */
    let finalScore =
      completeness === 'complete'
        ? baseAverage * COMPLETE_CAPSULE_MULTIPLIER
        : baseAverage
    if (capsule.is_favorite) {
      finalScore += FAVORITE_CAPSULE_BONUS
    }

    candidates.push({
      capsule,
      score: finalScore,
      completeness,
      garmentIds: autoFill.filledGarmentIds,
      autoFilledGarmentIds: autoFill.autoFilledGarmentIds,
    })
  }

  if (candidates.length === 0) {
    return null
  }

  /**
   * Final score descending, then `updated_at` descending, then `id` ascending.
   * Favorite state already contributed to the score and must not be applied a
   * second time as a tie-break.
   */
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score

    const updatedDelta = b.capsule.updated_at.getTime() - a.capsule.updated_at.getTime()
    if (updatedDelta !== 0) return updatedDelta

    return a.capsule.id.localeCompare(b.capsule.id)
  })

  return candidates[0] ?? null
}
