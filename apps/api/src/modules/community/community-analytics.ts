import { createHash, createHmac } from 'node:crypto'
import type {
  CommunityExperimentVariant,
  CommunitySpotlightSurface,
} from '@couture/api-client/contracts/http'
import { requireAnalyticsIdSecret } from '../telemetry/telemetry.service.js'

/**
 * A stable, non-reversible token for one user, used where a dedupe key needs to
 * distinguish users without naming them.
 *
 * A dedupe key travels to the analytics sink as a plain property, so putting the
 * raw user id in one would undo the HMAC pseudonymity the rest of this pipeline
 * maintains.
 */
export function communitySubjectToken(userId: string): string {
  return createHmac('sha256', requireAnalyticsIdSecret())
    .update(`community-dedupe:${userId}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * The exactly-once key every community event carries.
 *
 * These events fire from request handlers that clients retry and, for the
 * publish and challenge events, from a BullMQ job that retries on its own. A
 * redelivery that counted twice would corrupt the beta gate's own inputs, since
 * the gate is measured in card-open lift and unique published participants.
 */
export function buildCommunityDedupeKey(...parts: readonly string[]): string {
  return parts.join(':')
}

/**
 * Post-scoped events key on the post, so any number of retries of the same
 * logical transition collapse to one.
 */
export function postDedupeKey(postId: string, eventName: string): string {
  return buildCommunityDedupeKey(eventName, postId)
}

/**
 * Story 6.6: a non-reversible token for one post, so a dedupe key can tell
 * posts apart without carrying the raw id to the analytics sink.
 */
export function communityPostToken(postId: string): string {
  return createHmac('sha256', requireAnalyticsIdSecret())
    .update(`community-post:${postId}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Story 6.6: one spotlight open per post, viewer and surface. Both identity
 * components are HMAC tokens, so neither raw id leaves the server.
 */
export function spotlightOpenDedupeKey(
  userId: string,
  postId: string,
  surface: CommunitySpotlightSurface
): string {
  return buildCommunityDedupeKey(
    'community_spotlight_opened',
    communitySubjectToken(userId),
    communityPostToken(postId),
    surface
  )
}

/**
 * How coarse the feed-view dedupe bucket is, in milliseconds.
 *
 * A feed view has no post id to key on. A client retrying a dropped response
 * repeats within seconds, so a ten-second bucket collapses the retry while
 * leaving two genuine views a minute apart as two events.
 */
const FEED_VIEW_BUCKET_MS = 10_000

export function feedViewDedupeKey(params: {
  userId: string
  mode: string
  cursor?: string
  now?: number
}): string {
  const bucket = Math.floor((params.now ?? Date.now()) / FEED_VIEW_BUCKET_MS)
  return buildCommunityDedupeKey(
    'community_feed_viewed',
    communitySubjectToken(params.userId),
    params.mode,
    params.cursor
      ? createHash('sha256').update(params.cursor).digest('hex').slice(0, 12)
      : 'first',
    String(bucket)
  )
}

/**
 * Stable 50/50 assignment between the two beta arms, per the story's design
 * note. Derived from the user id rather than stored, so it survives a restart
 * and cannot drift between the feed response and the analytics event that
 * reports it.
 */
export function resolveCommunityExperimentVariant(
  userId: string
): CommunityExperimentVariant {
  // `readUInt8` rather than an index read: a sha256 digest always has a byte
  // zero, and indexing would add an unreachable `?? 0` branch to satisfy
  // `noUncheckedIndexedAccess`.
  const digest = createHash('sha256').update(`community-experiment:${userId}`).digest()
  return digest.readUInt8(0) % 2 === 0 ? 'auto' : 'all'
}

/**
 * The id prefix of the operations canary's synthetic account
 * (`scripts/community-screening-canary.mjs`). Its posts run the real pipeline
 * end to end, including publication, so its events would otherwise count as
 * member activity in the beta's own metrics.
 */
export const COMMUNITY_CANARY_USER_ID_PREFIX = 'canary-user-'

export function isCommunityCanaryUser(userId: string): boolean {
  return userId.startsWith(COMMUNITY_CANARY_USER_ID_PREFIX)
}
