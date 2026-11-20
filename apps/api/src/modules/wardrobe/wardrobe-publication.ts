import { ConflictException } from '@nestjs/common'

/**
 * The longest one API request can run: `maxDuration` of `api/index.ts` in `apps/api/vercel.json`.
 * Vercel stops the function there, so a storage write it started cannot land later than this
 * plus the time storage takes to apply a write already received.
 */
export const API_FUNCTION_MAX_DURATION_MS = 25 * 1000

/** Room for clock skew and a write storage had already received when the function stopped. */
export const PUBLISH_CLAIM_MARGIN_MS = 5 * 60 * 1000

/**
 * How long a commit attempt owns its session's publication. Past this, the attempt has ended
 * (finished or stopped), so a retry may take the publication over, and anything it wrote to
 * storage has landed.
 */
export const PUBLISH_CLAIM_LEASE_MS =
  API_FUNCTION_MAX_DURATION_MS + PUBLISH_CLAIM_MARGIN_MS

/** A publication claim as one of the three upload rows stores it. */
export type PublicationClaim = {
  attemptId: string | null
  startedAt: Date | null
  /** True while the session can still be published: pending, or a legacy relay upload. */
  committable: boolean
  /**
   * The cleanup horizon every claim of the session recorded (claim start plus
   * {@link AMBIGUOUS_PUBLICATION_HORIZON_MS}, only ever moved later). It outlives the lease, a
   * takeover and a successful publication, because a write an earlier attempt started can still
   * land after any of them.
   */
  cleanupUntil?: Date | null
}

/** Claims started before this moment are stale and may be taken over. */
export function staleClaimCutoff(now = new Date()): Date {
  return new Date(now.getTime() - PUBLISH_CLAIM_LEASE_MS)
}

/**
 * When an unfinished publication's lease runs out, or null when none is in flight. Erasure,
 * purge and replacement that meet one defer the session's keys in the deletion outbox until
 * then, so a publish that lands late (or whose acknowledgement was lost) is removed after it
 * lands and never restores the photo.
 */
export function unfinishedPublicationDeadline(
  claim: PublicationClaim,
  now = new Date()
): Date | null {
  if (!claim.committable || !claim.attemptId || !claim.startedAt) return null
  const deadline = new Date(claim.startedAt.getTime() + PUBLISH_CLAIM_LEASE_MS)
  return deadline > now ? deadline : null
}

/**
 * How long a removal repeats after it met a publication still in flight, counted from the
 * publication's lease start. The lease bounds how long the publishing attempt owns the session;
 * it does not bound when storage finishes applying a write it had already received when the
 * function stopped. Repeating the removal until this horizon removes such a write whenever it
 * lands, without relying on a remote completion bound nobody can verify.
 */
export const AMBIGUOUS_PUBLICATION_HORIZON_MS = 24 * 60 * 60 * 1000

/** How often a repeating removal runs again until its horizon. */
export const REPEATING_REMOVAL_INTERVAL_MS = 15 * 60 * 1000

/** The cleanup horizon a claim taken at `claimedAt` records: 24 hours later. */
export function publicationCleanupHorizon(claimedAt: Date): Date {
  return new Date(claimedAt.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS)
}

/**
 * Until when a terminal removal (erasure, purge, replacement, the selfie processor's purge,
 * garment deletion) must remove the session's keys again and again, or null when no write any
 * claim started can still land. The recorded horizon counts whatever the claim says now: the
 * lease may have run out, another attempt may have taken the claim over, or the publication may
 * have succeeded, and a write the first attempt started can still land after each of those. A
 * live claim with no recorded horizon (taken by an instance from before the column existed)
 * counts from its own start.
 */
export function ambiguousPublicationHorizon(
  claim: PublicationClaim,
  now = new Date()
): Date | null {
  const recorded =
    claim.cleanupUntil && claim.cleanupUntil > now ? claim.cleanupUntil : null
  const live =
    unfinishedPublicationDeadline(claim, now) && claim.startedAt
      ? publicationCleanupHorizon(claim.startedAt)
      : null
  if (recorded && live) return recorded > live ? recorded : live
  return recorded ?? live
}

/**
 * The horizon a new claim at `now` writes: never earlier than the one already recorded, so a
 * takeover or a retry cannot shorten the window of a write an earlier attempt started.
 */
export function nextCleanupHorizon(recorded: Date | null | undefined, now: Date): Date {
  const next = publicationCleanupHorizon(now)
  return recorded && recorded > next ? recorded : next
}

/**
 * Another commit of the same session owns its publication right now. Nothing was touched, so
 * the client keeps the attempt open and its next retry replays that commit's outcome.
 */
export function uploadInProgress(): ConflictException {
  return new ConflictException('UPLOAD_IN_PROGRESS')
}
