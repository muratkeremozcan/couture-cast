import type { Prisma } from '@prisma/client'

/**
 * The post content a moderation audit row keeps after the post itself is gone.
 *
 * `content_snapshot` is declared on both `ModerationEvent` and
 * `CommunityPostReport` and, until this file existed, was written by nobody,
 * while `community-maintenance.service.ts` asserted in a comment that both
 * tables retain it. That gap is what makes an orphaned report meaningless:
 * erasure nulls `post_id` and anonymization nulls `caption`, `alt_text`,
 * `locale` and `location_key` on the post, so a report whose subject has been
 * erased pointed at nothing and said nothing about what was reported.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD. No user id, no email, no location key.
 * The pseudonymous `subject_alias` column answers "whose", and
 * `image_object_path` answers "which object", so duplicating identity here would
 * put a raw user id in a row that outlives erasure on purpose. `location_key` is
 * left out because it is the one anonymized field that is about the author's
 * whereabouts rather than about the content under review.
 *
 * Story 6.13: this retention ends at account erasure, which strips the user's
 * words and keeps `COMMUNITY_SNAPSHOT_METADATA_KEYS`, because AC 2 says erasure
 * removes personal content. A post's own withdrawal keeps the whole snapshot:
 * retracting a reported post must not destroy the evidence.
 */
export interface CommunityAuditSnapshotSource {
  caption: string | null
  alt_text: string | null
  locale: string | null
  climate_band: string | null
}

export function buildCommunityContentSnapshot(
  post: CommunityAuditSnapshotSource,
  capturedAt: Date
): Prisma.InputJsonValue {
  return {
    caption: post.caption,
    altText: post.alt_text,
    locale: post.locale,
    climateBand: post.climate_band,
    capturedAt: capturedAt.toISOString(),
  }
}

/** What a snapshot keeps after its subject's account erasure. */
export const COMMUNITY_SNAPSHOT_METADATA_KEYS = Object.freeze([
  'locale',
  'climateBand',
  'capturedAt',
] as const)

/** The rule the erasure SQL applies, for one value. Any other key is dropped, an unknown one included. */
export function stripCommunitySnapshot(snapshot: unknown): Prisma.InputJsonValue | null {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null
  const source = snapshot as Record<string, Prisma.InputJsonValue>
  return Object.fromEntries(
    COMMUNITY_SNAPSHOT_METADATA_KEYS.flatMap((key) =>
      key in source ? [[key, source[key]] as const] : []
    )
  )
}
