// Story 6.6 owner: the deterministic City Spotlight score and its pinned constants.
import { createHash } from 'node:crypto'
import type { CommunitySpotlightLevel } from '@couture/api-client/contracts/http'

/** Distinct eligible authors a level needs before it may be shown. */
export const SPOTLIGHT_MIN_COHORT_AUTHORS = 5

/** Eligibility window: `as_of - 7 days < published_at <= as_of`. */
export const SPOTLIGHT_WINDOW_DAYS = 7

/** Gravity exponent in `reactions / (age_hours + 2)^1.5`. */
export const SPOTLIGHT_SCORE_EXPONENT = 1.5

/** Hours added to the age so a brand-new post does not divide by zero. */
export const SPOTLIGHT_AGE_OFFSET_HOURS = 2

/** Posts one snapshot holds. */
export const SPOTLIGHT_SNAPSHOT_CAP = 60

/** Seconds a snapshot and an area pointer live in Redis. */
export const SPOTLIGHT_SNAPSHOT_TTL_SECONDS = 600

export interface SpotlightRankedEntry {
  id: string
  reactions: number
  publishedAt: Date
}

/** `as_of` is the clock's time truncated to the minute. */
export function spotlightAsOf(now: Date): Date {
  const asOf = new Date(now.getTime())
  asOf.setUTCSeconds(0, 0)
  return asOf
}

export function spotlightAgeHours(asOf: Date, publishedAt: Date): number {
  return (asOf.getTime() - publishedAt.getTime()) / 3_600_000
}

/** All three palette reactions weigh the same; only non-author reactions count. */
export function spotlightScore(reactions: number, ageHours: number): number {
  return (
    reactions / Math.pow(ageHours + SPOTLIGHT_AGE_OFFSET_HOURS, SPOTLIGHT_SCORE_EXPONENT)
  )
}

/** Inclusive at `as_of`, exclusive at `as_of - 7 days`. */
export function isWithinSpotlightWindow(asOf: Date, publishedAt: Date): boolean {
  const start = asOf.getTime() - SPOTLIGHT_WINDOW_DAYS * 86_400_000
  return publishedAt.getTime() > start && publishedAt.getTime() <= asOf.getTime()
}

/** Score desc, reactions desc, `published_at` desc, `id` desc. */
export function compareSpotlightEntries(asOf: Date) {
  return (left: SpotlightRankedEntry, right: SpotlightRankedEntry): number => {
    const scoreDelta =
      spotlightScore(right.reactions, spotlightAgeHours(asOf, right.publishedAt)) -
      spotlightScore(left.reactions, spotlightAgeHours(asOf, left.publishedAt))
    if (scoreDelta !== 0) return scoreDelta
    if (right.reactions !== left.reactions) return right.reactions - left.reactions
    const timeDelta = right.publishedAt.getTime() - left.publishedAt.getTime()
    if (timeDelta !== 0) return timeDelta
    if (right.id === left.id) return 0
    return right.id > left.id ? 1 : -1
  }
}

/** The pure reference ranking the SQL statement is checked against. */
export function rankSpotlightEntries(
  asOf: Date,
  entries: readonly SpotlightRankedEntry[]
): SpotlightRankedEntry[] {
  return entries
    .filter(
      (entry) => entry.reactions > 0 && isWithinSpotlightWindow(asOf, entry.publishedAt)
    )
    .sort(compareSpotlightEntries(asOf))
    .slice(0, SPOTLIGHT_SNAPSHOT_CAP)
}

/** SHA-256 of `(as_of, level, area hash, ordered IDs)`. */
export function spotlightSnapshotId(params: {
  asOf: Date
  level: CommunitySpotlightLevel
  areaHash: string
  ids: readonly string[]
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'community-spotlight-snapshot',
        params.asOf.toISOString(),
        params.level,
        params.areaHash,
        params.ids,
      ])
    )
    .digest('hex')
}
