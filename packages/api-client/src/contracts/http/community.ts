// Story 6.1 Task 3 owner: community HTTP contracts and schemas.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  conflictHttpErrorSchema,
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
  trackedResponseSchema,
} from './common'
import { communitySponsorshipSchema } from './commerce'
import { supportedLocaleSchema } from './localization'

// --- Error message constants ------------------------------------------------

export const COMMUNITY_FEED_DISABLED_MESSAGE =
  'Community feed is temporarily unavailable.'

export const COMMUNITY_CURSOR_INVALID_MESSAGE = 'Invalid pagination cursor.'

export const COMMUNITY_POST_NOT_FOUND_MESSAGE = 'Community post not found.'

export const COMMUNITY_POST_RATE_LIMITED_MESSAGE =
  'You have reached the daily post limit. Please try again tomorrow.'

/**
 * Reporting has its own rolling cap and its own copy. The publish message was
 * being reused for a reporting 429, which told someone who had reported too many
 * posts that they had run out of posts.
 */
export const COMMUNITY_REPORT_RATE_LIMITED_MESSAGE =
  'You have reached the daily report limit. Please try again tomorrow.'

export const COMMUNITY_CHALLENGE_OVERLAP_MESSAGE =
  'An active challenge already exists for this climate band and window.'

export const COMMUNITY_CHALLENGE_NOT_FOUND_MESSAGE = 'Community challenge not found.'

export const COMMUNITY_AGE_GATE_DENIED_MESSAGE =
  'You must be at least 13 years old to post to the community feed.'

export const COMMUNITY_REPORT_REASON_CHANGED_MESSAGE =
  'You already reported this post for a different reason.'

export const COMMUNITY_SELF_REPORT_MESSAGE = 'You cannot report your own post.'

export const COMMUNITY_COMMENT_REPORT_REASON_CHANGED_MESSAGE =
  'You already reported this comment for a different reason.'

export const COMMUNITY_COMMENT_SELF_REPORT_MESSAGE = 'You cannot report your own comment.'

export const COMMUNITY_COMMENT_SUBMISSION_RATE_LIMITED_MESSAGE =
  'Comment submission limit reached.'

export const COMMUNITY_ALT_TEXT_UNCONFIRMED_MESSAGE =
  'Alt text must be reviewed and confirmed before publishing.'

export const COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE =
  'Upload session does not match this post.'

export const COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE =
  'Challenge window must run from midnight on a Monday to midnight on the following Monday in its time zone.'

export const COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE =
  'Idempotency key was reused with a different payload.'

/**
 * A published row whose stored object cannot be signed is a storage inconsistency on
 * our side, so it is reported as an outage rather than as a missing resource. A post
 * the caller genuinely may not see still answers 404, which keeps the two apart.
 */
export const COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE =
  'This post is temporarily unavailable. Please try again shortly.'

/**
 * Publishing before the bytes are uploaded. Checked ahead of the quota transaction so a
 * failed publish does not consume a slot from the rolling 24-hour cap.
 */
export const COMMUNITY_UPLOAD_NOT_COMPLETED_MESSAGE =
  'Upload the image before publishing this post.'

export const COMMUNITY_CONSENT_SUSPENDED_MESSAGE =
  'Guardian consent is no longer active for this post.'

/**
 * Withdrawal's two refusals. Both were bare string literals thrown from the
 * service, the only conditions in the module without an exported constant, so
 * neither client could match them and both rendered a generic failure.
 */
export const COMMUNITY_NOT_POST_AUTHOR_MESSAGE =
  'Only the author of a post can withdraw it.'

export const COMMUNITY_POST_NOT_WITHDRAWABLE_MESSAGE =
  'This post is not in a state that can be withdrawn.'

// --- Platform & Headers -----------------------------------------------------

export const communityPlatformSchema = z.enum(['web', 'mobile'])
export type CommunityPlatform = z.infer<typeof communityPlatformSchema>

export const communityHeadersSchema = z.object({
  'x-couture-platform': communityPlatformSchema.describe(
    'Which client is calling. Required on community operations; drives server-trusted analytics.'
  ),
})
export type CommunityHeaders = z.infer<typeof communityHeadersSchema>

// --- Enums & Nullable Published Arrays --------------------------------------

export const climateBandSchema = z.enum(CLIMATE_BANDS)
export type ClimateBand = z.infer<typeof climateBandSchema>

/**
 * Nullable publication of climateBand. Following nullablePremiumThemeKeySchema,
 * provides explicit enum array with null so preserveNullableEnumValues does not mutate shared ZodEnum.
 */
export const nullableClimateBandSchema = (description: string) =>
  climateBandSchema.nullable().openapi({
    type: ['string', 'null'],
    enum: [...climateBandSchema.options, null],
    description,
  })

/**
 * Post lifecycle. Mirrors the Prisma `CommunityPostStatus` enum member-for-member and
 * in the same order; `packages/db/test/community-schema.spec.ts` asserts that parity.
 *
 * draft -> uploading -> pending_review -> published | flagged | review_failed -> withdrawn
 *
 * `consent_suspended` is reached out of band: it hides an already published post when
 * guardian consent lapses, and the author must resubmit after fresh consent to leave it.
 */
export const communityPostStatusSchema = z.enum([
  'draft',
  'uploading',
  'pending_review',
  'published',
  'flagged',
  'review_failed',
  'withdrawn',
  'consent_suspended',
])
export type CommunityPostStatus = z.infer<typeof communityPostStatusSchema>

/**
 * Feed filter mode. `auto` resolves the viewer's own band from recent weather, `all`
 * returns every region, and a band literal pins the feed to that band. The beta
 * experiment assigns viewers between `auto` and `all`, so both must be requestable.
 */
export const communityFeedModeSchema = z.enum(['auto', 'all', ...CLIMATE_BANDS])
export type CommunityFeedMode = z.infer<typeof communityFeedModeSchema>

/** Why the viewer's band could not be resolved. Drives a localized client banner. */
export const communityBandUnresolvedReasonSchema = z.enum([
  'no_location',
  'weather_unavailable',
  'weather_stale',
  'weather_malformed',
  'insufficient_usable_days',
])
export type CommunityBandUnresolvedReason = z.infer<
  typeof communityBandUnresolvedReasonSchema
>

/** Stable 50/50 assignment recorded on the feed response so analytics can split arms. */
export const communityExperimentVariantSchema = z.enum(['auto', 'all'])
export type CommunityExperimentVariant = z.infer<typeof communityExperimentVariantSchema>

export const communityReportReasonSchema = z.enum([
  'spam',
  'harassment',
  'inappropriate_content',
  'hate_speech',
  'violence',
  'other',
])
export type CommunityReportReason = z.infer<typeof communityReportReasonSchema>

/**
 * What an author is told about a post the pipeline held. Each member is one
 * localized sentence under `community.moderationReason.*`, so a member reads
 * "change the wording" and never a raw `text_policy_match`.
 */
export const communityModerationReasonCategorySchema = z.enum([
  'language',
  'textUnreadable',
  'photo',
  'photoUnconfirmed',
  'incomplete',
  'upload',
])
export type CommunityModerationReasonCategory = z.infer<
  typeof communityModerationReasonCategorySchema
>

/**
 * The codes the moderation worker persists when the stored upload fails
 * verification before anything screens it: a missing declaration, a size, type
 * or checksum that differs from the declaration, dimensions outside the
 * accepted range, or bytes that do not decode. The API's community image
 * validation throws only these, and the processor persists the one it caught
 * (Story 6.2b review, RF12). Each is the author's to fix by uploading again.
 */
export const communityImageValidationCodeSchema = z.enum([
  'IMAGE_DECLARATION_MISSING',
  'IMAGE_SIZE_MISMATCH',
  'UNSUPPORTED_IMAGE_TYPE',
  'IMAGE_CHECKSUM_MISMATCH',
  'IMAGE_DIMENSIONS_INVALID',
  'IMAGE_DECODE_FAILED',
])
export type CommunityImageValidationCode = z.infer<
  typeof communityImageValidationCodeSchema
>

/**
 * Every stable code the moderation pipeline persists on `moderationReason`,
 * mapped to the category the author sees. The codes come from
 * `apps/api/policies/community-screening` (`reasonCodes.image` and
 * `reasonCodes.text`), the image validation codes, and the three the pipeline
 * writes on its own;
 * `apps/api/integration/community-moderation-reason-codes.spec.ts` fails when
 * the API can emit a code this map does not name.
 */
export const COMMUNITY_MODERATION_REASON_CATEGORY: Readonly<
  Record<string, CommunityModerationReasonCategory>
> = Object.freeze({
  text_policy_match: 'language',
  text_input_truncated: 'textUnreadable',
  locale_unscreenable: 'textUnreadable',
  script_mixed: 'textUnreadable',
  script_unsupported: 'textUnreadable',
  unsafe_class: 'photo',
  low_confidence: 'photoUnconfirmed',
  output_invalid: 'photoUnconfirmed',
  class_mismatch: 'photoUnconfirmed',
  probability_sum_invalid: 'photoUnconfirmed',
  image_disposition_conflict: 'photoUnconfirmed',
  inference_timeout: 'incomplete',
  screening_unavailable: 'incomplete',
  flagged_by_screening: 'incomplete',
  moderation_stalled: 'incomplete',
  ...Object.fromEntries(
    communityImageValidationCodeSchema.options.map((code) => [code, 'upload' as const])
  ),
})

/**
 * Reads a persisted `moderationReason` (one code, or several joined by `, `)
 * into the categories to show its author, in schema order and without
 * repeats. Returns `null` when any part is not a known code, which is the
 * free-text reason a human moderator wrote on a takedown; the caller shows that
 * verbatim instead.
 */
export function communityModerationReasonCategories(
  reason: string | null | undefined
): CommunityModerationReasonCategory[] | null {
  const codes = (reason ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
  if (codes.length === 0) return null
  const found = new Set<CommunityModerationReasonCategory>()
  for (const code of codes) {
    // This module also loads under Hermes, where older builds lack `Object.hasOwn`.
    const category = Object.prototype.hasOwnProperty.call(
      COMMUNITY_MODERATION_REASON_CATEGORY,
      code
    )
      ? COMMUNITY_MODERATION_REASON_CATEGORY[code]
      : undefined
    if (category === undefined) return null
    found.add(category)
  }
  return communityModerationReasonCategorySchema.options.filter((category) =>
    found.has(category)
  )
}

// --- Validation helpers: Cursor, Caption, Alt-text --------------------------

/**
 * Public keyset cursor. Keyed on `published_at,id` because moderation stamps
 * `published_at` long after `created_at`; ordering on creation time inserts a
 * newly published post behind a cursor the reader already consumed, and the post
 * is never seen. `mode` binds the cursor to the filter it was minted under so a
 * client that changes filters cannot page one feed with another feed's cursor.
 *
 * `band` carries the RESOLVED band, which is a different value from `mode` and
 * has to travel separately. Under `auto` the band is derived per request from
 * weather that is only guaranteed fresh within 60 minutes, so it can change
 * between two pages of one scroll while `mode` stays `auto` throughout. Without
 * it, page two applies page one's keyset to a differently filtered set and
 * everything newer in the new band is skipped, or resolution fails and page two
 * silently becomes the unfiltered all-regions feed under the same cursor. `null`
 * means the page was served unfiltered, which is a state a reader can legitimately
 * page through and must be distinguishable from a band that has since resolved.
 */
export const communityFeedCursorPayloadSchema = z
  .object({
    publishedAt: isoTimestampSchema,
    id: nonEmptyStringSchema,
    mode: communityFeedModeSchema,
    band: climateBandSchema.nullable(),
  })
  .strict()

export type CommunityFeedCursorPayload = z.infer<typeof communityFeedCursorPayloadSchema>

export function encodeCommunityFeedCursor(payload: CommunityFeedCursorPayload): string {
  const validated = communityFeedCursorPayloadSchema.parse(payload)
  return Buffer.from(JSON.stringify(validated), 'utf8').toString('base64url')
}

export function decodeCommunityFeedCursor(cursor: string): CommunityFeedCursorPayload {
  try {
    const rawJson = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsedJson: unknown = JSON.parse(rawJson)
    return communityFeedCursorPayloadSchema.parse(parsedJson)
  } catch {
    throw new Error(COMMUNITY_CURSOR_INVALID_MESSAGE)
  }
}

/**
 * Decodes without throwing. Pass `expectedMode` and `expectedBand` on the read
 * path: a cursor minted under a different filter, or under a band that has since
 * changed, is rejected with the same stable message a malformed cursor produces,
 * so the client restarts paging. Omit `expectedBand` to skip the band check;
 * passing `null` asserts the cursor was minted on an unfiltered page.
 */
export function safeDecodeCommunityFeedCursor(
  cursor: string,
  expectedMode?: CommunityFeedMode,
  expectedBand?: ClimateBand | null
):
  | { success: true; data: CommunityFeedCursorPayload }
  | { success: false; error: string } {
  try {
    const rawJson = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsedJson: unknown = JSON.parse(rawJson)
    const result = communityFeedCursorPayloadSchema.safeParse(parsedJson)
    if (!result.success) {
      return { success: false, error: COMMUNITY_CURSOR_INVALID_MESSAGE }
    }
    if (expectedMode !== undefined && result.data.mode !== expectedMode) {
      return { success: false, error: COMMUNITY_CURSOR_INVALID_MESSAGE }
    }
    // Rejected the same way a mode mismatch is, so a viewer whose band moved
    // between pages restarts paging rather than silently reading a different
    // filtered set from page one's keyset.
    if (expectedBand !== undefined && result.data.band !== expectedBand) {
      return { success: false, error: COMMUNITY_CURSOR_INVALID_MESSAGE }
    }
    return { success: true, data: result.data }
  } catch {
    return { success: false, error: COMMUNITY_CURSOR_INVALID_MESSAGE }
  }
}

const URL_REGEX =
  /(?:https?:\/\/|www\.)\S+|[a-zA-Z0-9.-]+\.(?:com|org|net|io|co|app|dev|ai|me|tv|info|biz|uk|ca|de|fr|tr)\b/i
const EMAIL_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/

export const communityPostCaptionSchema = z
  .string()
  .max(280, 'Caption must be at most 280 characters.')
  .refine((val) => !URL_REGEX.test(val), {
    message: 'Caption must not contain URLs or web links.',
  })
  .refine((val) => !EMAIL_REGEX.test(val), {
    message: 'Caption must not contain email addresses.',
  })
  .openapi({
    description:
      'Caption of at most 280 characters. Applies a best-effort denylist. Anything carrying an http://, https:// or www. prefix is refused whatever its TLD, and so is anything matching a generic email pattern, again whatever its TLD. The fixed TLD list (com, org, net, io, co, app, dev, ai, me, tv, info, biz, uk, ca, de, fr, tr) governs only bare domain-like values carrying no such prefix, so a bare domain outside that list (example.xyz) passes unblocked. Ordinary prose that merely contains a listed TLD as a substring is refused even when it is not actually a URL or email. Nothing downstream re-checks this field, so it should not be treated as a complete boundary control.',
  })

export const communityPostAltTextSchema = z
  .string()
  .min(1, 'Alt text must be at least 1 character.')
  .max(200, 'Alt text must be at most 200 characters.')

// --- Challenge Copy & Schemas -----------------------------------------------

export const communityChallengeCopyItemSchema = z
  .object({
    title: nonEmptyStringSchema,
    body: nonEmptyStringSchema,
  })
  .strict()

/**
 * Keys are supported locale tags. The OpenAPI projection is overridden to a free-form
 * map because zod-to-openapi renders `z.record` over an enum key as a fixed-property
 * object, one optional property per locale, and the generator then camelCases those
 * property names. That produced a `CommunityChallengeCopy` model with `enUS`, `enCA`,
 * `es419` and `frCA` keys, every one optional, so a client following the generated
 * type sent `{ enUS: ... }` and the API rejected it, and the required `en-US` fallback
 * could not be expressed at all. `additionalProperties` keeps the wire shape honest;
 * the locale-tag keys and the fallback rule are enforced by the Zod schema below and
 * stated in the description, which is where the generated SDK surfaces them.
 */
export const communityChallengeCopySchema = z
  .record(supportedLocaleSchema, communityChallengeCopyItemSchema)
  .refine((copy) => 'en-US' in copy, {
    message: 'Community challenge copy must include an en-US fallback.',
  })
  .openapi({
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        body: { type: 'string', minLength: 1 },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
    description:
      'Localized challenge copy keyed by supported IETF locale tag, for example "en-US". Keys are the tags themselves, hyphenated and case-sensitive. An en-US entry is required as the fallback.',
  })

export const embeddedCommunityChallengeSchema = z
  .object({
    id: nonEmptyStringSchema,
    slug: nonEmptyStringSchema,
    climateBand: nullableClimateBandSchema(
      'The climate band this challenge is restricted to, or null if unrestricted.'
    ),
    title: nonEmptyStringSchema,
    body: nonEmptyStringSchema,
    startsAt: isoTimestampSchema,
    endsAt: isoTimestampSchema,
    timeZone: nonEmptyStringSchema,
  })
  .strict()
export type EmbeddedCommunityChallenge = z.infer<typeof embeddedCommunityChallengeSchema>

export const communityChallengeSchema = z
  .object({
    id: nonEmptyStringSchema,
    slug: nonEmptyStringSchema,
    climateBand: nullableClimateBandSchema(
      'The climate band this challenge is restricted to, or null if unrestricted.'
    ),
    startsAt: isoTimestampSchema,
    endsAt: isoTimestampSchema,
    timeZone: nonEmptyStringSchema,
    copy: communityChallengeCopySchema,
    isActive: z.boolean(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
export type CommunityChallenge = z.infer<typeof communityChallengeSchema>

// Story 6.3 owner: opt-in reactions preserve strict installed client projections.
export const communityReactionSelectionSchema = z.enum([
  'applause',
  'love',
  'inspiration',
])
export type CommunityReactionSelection = z.infer<typeof communityReactionSelectionSchema>
export const communityReactionSummarySchema = z
  .object({
    counts: z
      .object({
        applause: z.number().int().nonnegative(),
        love: z.number().int().nonnegative(),
        inspiration: z.number().int().nonnegative(),
      })
      .strict(),
    total: z.number().int().nonnegative(),
    viewerReaction: communityReactionSelectionSchema.nullable(),
    revision: z.number().int().nonnegative(),
    generation: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (summary) =>
      summary.total ===
      summary.counts.applause + summary.counts.love + summary.counts.inspiration,
    { message: 'Reaction total must equal its palette counts.' }
  )
  .openapi({
    description:
      'An authoritative single-snapshot reaction summary. total must equal the sum of applause, love and inspiration counts. revision persists after removal; generation advances on reactions, visibility and erasure changes.',
  })
export type CommunityReactionSummary = z.infer<typeof communityReactionSummarySchema>
export const setCommunityReactionInputSchema = z
  .object({
    selection: communityReactionSelectionSchema.nullable(),
    mutationId: z.string().uuid(),
    baseRevision: z.number().int().nonnegative(),
  })
  .strict()
export type SetCommunityReactionInput = z.infer<typeof setCommunityReactionInputSchema>
export const communityReactionResponseSchema = z
  .object({ data: communityReactionSummarySchema })
  .strict()
export type CommunityReactionResponse = z.infer<typeof communityReactionResponseSchema>
export const communityReactionConflictResponseSchema = conflictHttpErrorSchema
  .extend({ data: communityReactionSummarySchema })
  .strict()
export const COMMUNITY_REACTION_CONFLICT_MESSAGE =
  'Reaction changed. Refresh and try again.'
export const COMMUNITY_REACTION_RATE_LIMITED_MESSAGE =
  'Too many reactions. Please try again in a minute.'
/**
 * Story 6.6: the privacy model's spotlight read limit. Every page counts, so
 * replaying a cursor is no unmetered way to probe the cohort.
 */
export const COMMUNITY_SPOTLIGHT_READS_PER_MINUTE = 30
export const COMMUNITY_SPOTLIGHT_RATE_LIMITED_MESSAGE =
  'Too many spotlight reads. Please try again in a minute.'

// --- Feed Read Schemas ------------------------------------------------------

export const communityFeedAuthorSchema = z
  .object({
    displayName: nonEmptyStringSchema,
    isSelf: z.boolean(),
  })
  .strict()
export type CommunityFeedAuthor = z.infer<typeof communityFeedAuthorSchema>

export const communityImageAccessSchema = z
  .object({
    url: z.string().url(),
    expiresAt: isoTimestampSchema,
  })
  .strict()
export type CommunityImageAccess = z.infer<typeof communityImageAccessSchema>

/**
 * The public projection. Every field here is served to every viewer, so it carries
 * no author user id, no storage object path, and no moderation internals. The signed
 * URL lives only in `imageAccess`; there is no second copy of it to keep in sync.
 */
export const communityFeedItemSchema = z
  .object({
    id: nonEmptyStringSchema,
    caption: z.string().nullable(),
    altText: z.string().nullable(),
    climateBand: nullableClimateBandSchema(
      'The climate band stamped when the post was published, or null if unclassified.'
    ),
    imageAccess: communityImageAccessSchema,
    publishedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    status: communityPostStatusSchema,
    challengeId: z.string().nullable(),
    author: communityFeedAuthorSchema,
  })
  .strict()
export type CommunityFeedItem = z.infer<typeof communityFeedItemSchema>

/**
 * The author's own posts that are not published. These are kept out of `items`
 * because they have no `published_at` to keyset on, so mixing them in would perturb
 * the viewer's page boundaries and consume the page limit. This section is
 * unpaginated and only ever contains rows belonging to the caller.
 */
export const communityAuthorPostStateSchema = z
  .object({
    id: nonEmptyStringSchema,
    caption: z.string().nullable(),
    altText: z.string().nullable(),
    climateBand: nullableClimateBandSchema(
      'The climate band stamped when the post was classified, or null if unclassified.'
    ),
    imageAccess: communityImageAccessSchema.nullable(),
    createdAt: isoTimestampSchema,
    publishedAt: isoTimestampSchema.nullable(),
    status: communityPostStatusSchema,
    challengeId: z.string().nullable(),
    moderationReason: z.string().nullable(),
  })
  .strict()
export type CommunityAuthorPostState = z.infer<typeof communityAuthorPostStateSchema>

export const communityFeedSchema = z
  .object({
    items: z.array(communityFeedItemSchema),
    authorStates: z.array(communityAuthorPostStateSchema),
    nextCursor: z.string().nullable(),
    mode: communityFeedModeSchema,
    viewerBand: nullableClimateBandSchema(
      'The climate band resolved for the viewer, or null if unresolvable.'
    ),
    bandResolved: z.boolean(),
    bandUnresolvedReason: communityBandUnresolvedReasonSchema.nullable().openapi({
      type: ['string', 'null'],
      enum: [...communityBandUnresolvedReasonSchema.options, null],
      description:
        'Why the viewer band could not be resolved, or null when it resolved. Clients render a localized banner from this.',
    }),
    experimentVariant: communityExperimentVariantSchema,
    activeChallenge: embeddedCommunityChallengeSchema.nullable(),
  })
  .strict()
export type CommunityFeed = z.infer<typeof communityFeedSchema>

export const communityFeedResponseSchema = z
  .object({
    data: communityFeedSchema,
  })
  .strict()
export type CommunityFeedResponse = z.infer<typeof communityFeedResponseSchema>

export const communityFeedQuerySchema = z
  .object({
    mode: communityFeedModeSchema.default('auto'),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(30).default(12),
  })
  .strict()
export type CommunityFeedQuery = z.infer<typeof communityFeedQuerySchema>

export const communityPostResponseSchema = z
  .object({
    data: communityFeedItemSchema,
  })
  .strict()
export type CommunityPostResponse = z.infer<typeof communityPostResponseSchema>

export const communityReactionFeedItemSchema = communityFeedItemSchema
  .extend({ reactions: communityReactionSummarySchema.optional() })
  .strict()
export type CommunityReactionFeedItem = z.infer<typeof communityReactionFeedItemSchema>
/** Older HTTP responses cannot overwrite a confirmed mutation or newer snapshot. */
export function reconcileCommunityReactionItem(
  incoming: CommunityReactionFeedItem,
  previous?: CommunityReactionFeedItem | null
): CommunityReactionFeedItem {
  if (
    previous?.id === incoming.id &&
    previous.reactions &&
    incoming.reactions &&
    (previous.reactions.revision > incoming.reactions.revision ||
      previous.reactions.generation > incoming.reactions.generation)
  )
    return { ...incoming, reactions: previous.reactions }
  return incoming
}
export const communityReactionFeedSchema = communityFeedSchema
  .extend({ items: z.array(communityReactionFeedItemSchema) })
  .strict()
export type CommunityReactionFeed = z.infer<typeof communityReactionFeedSchema>
export const communityReactionFeedResponseSchema = z
  .object({ data: communityReactionFeedSchema })
  .strict()
export const communityReactionPostResponseSchema = z
  .object({ data: communityReactionFeedItemSchema })
  .strict()

/**
 * Story 6.7b: sponsorship blocks are opt-in per request with this header, set
 * to `1`, exactly like the Story 6.3 reactions header. Installed clients that
 * do not send it keep parsing today's strict shapes, which have no
 * `sponsorship` field. The opted-in variants below extend the reaction variants,
 * whose `reactions` field is itself optional, so one variant serves a request
 * with or without `x-couture-reactions`.
 */
export const COMMUNITY_SPONSORSHIP_HEADER = 'x-couture-sponsorship'

export const communitySponsoredFeedItemSchema = communityReactionFeedItemSchema
  .extend({
    sponsorship: communitySponsorshipSchema.optional().openapi({
      description:
        'Present only when this post has an eligible sponsorship for this viewer right now. Absent means no CTA.',
    }),
  })
  .strict()
export type CommunitySponsoredFeedItem = z.infer<typeof communitySponsoredFeedItemSchema>
export const communitySponsoredFeedSchema = communityFeedSchema
  .extend({ items: z.array(communitySponsoredFeedItemSchema) })
  .strict()
export type CommunitySponsoredFeed = z.infer<typeof communitySponsoredFeedSchema>
export const communitySponsoredFeedResponseSchema = z
  .object({ data: communitySponsoredFeedSchema })
  .strict()
export type CommunitySponsoredFeedResponse = z.infer<
  typeof communitySponsoredFeedResponseSchema
>
export const communitySponsoredPostResponseSchema = z
  .object({ data: communitySponsoredFeedItemSchema })
  .strict()
export type CommunitySponsoredPostResponse = z.infer<
  typeof communitySponsoredPostResponseSchema
>

// --- Post Upload & Creation Schemas -----------------------------------------

export const allocateCommunityPostInputSchema = z
  .object({
    /** Locale used to generate the alt-text suggestion returned with the session. */
    locale: supportedLocaleSchema,
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
    sha256: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/, {
        message: 'sha256 must be a 64-character lowercase hex string.',
      }),
    widthPx: z.number().int().min(256).max(4096),
    heightPx: z.number().int().min(256).max(4096),
  })
  .strict()
export type AllocateCommunityPostInput = z.infer<typeof allocateCommunityPostInputSchema>

export const allocateCommunityPostSessionSchema = z
  .object({
    postId: nonEmptyStringSchema,
    uploadSessionId: nonEmptyStringSchema,
    uploadUrl: z.string().url(),
    uploadToken: nonEmptyStringSchema,
    requiredHeaders: z
      .object({
        'content-type': z.string(),
      })
      .strict(),
    expiresAt: isoTimestampSchema,
    /**
     * Server-generated starting point for alt text, in the locale the caller
     * requested. The author edits it and must confirm it; publishing rejects
     * unconfirmed alt text, so this is a suggestion and never a default.
     */
    altTextSuggestion: communityPostAltTextSchema,
    altTextSuggestionLocale: supportedLocaleSchema,
  })
  .strict()
export type AllocateCommunityPostSession = z.infer<
  typeof allocateCommunityPostSessionSchema
>

export const allocateCommunityPostResponseSchema = z
  .object({
    data: allocateCommunityPostSessionSchema,
  })
  .strict()
export type AllocateCommunityPostResponse = z.infer<
  typeof allocateCommunityPostResponseSchema
>

export const publishCommunityPostInputSchema = z
  .object({
    postId: nonEmptyStringSchema,
    uploadSessionId: nonEmptyStringSchema,
    altText: communityPostAltTextSchema,
    /**
     * The author confirmed the alt text they are publishing. Typed as a literal so
     * the contract itself rejects an unconfirmed publish; the spec forbids
     * publishing unconfirmed alt text, and a boolean would let `false` through to
     * a server check that a direct API caller could simply omit.
     */
    altTextConfirmed: z.literal(true),
    caption: communityPostCaptionSchema.nullable().optional(),
    /** Locale the caption and alt text are screened in. */
    locale: supportedLocaleSchema,
    /** Optional challenge to associate this submission with. */
    challengeId: nonEmptyStringSchema.optional(),
  })
  .strict()
export type PublishCommunityPostInput = z.infer<typeof publishCommunityPostInputSchema>

export const publishCommunityPostResponseSchema = z
  .object({
    data: communityFeedItemSchema,
  })
  .strict()
export type PublishCommunityPostResponse = z.infer<
  typeof publishCommunityPostResponseSchema
>

// --- Post Reporting Schemas -------------------------------------------------

export const reportCommunityPostInputSchema = z
  .object({
    reason: communityReportReasonSchema,
    details: z.string().max(500).optional(),
  })
  .strict()
export type ReportCommunityPostInput = z.infer<typeof reportCommunityPostInputSchema>

export const reportCommunityPostResponseSchema = trackedResponseSchema
export type ReportCommunityPostResponse = z.infer<
  typeof reportCommunityPostResponseSchema
>

/**
 * Records that a viewer opened a card. The beta gate's advance condition is a
 * non-self card-open lift, so this is the one event AC7 cannot be measured
 * without, and it needs a route because only the server can be trusted to say
 * whether the opener is the author.
 */
export const openCommunityFeedPostInputSchema = z
  .object({
    /**
     * The arm the client was serving when the card was opened. Sent rather than
     * re-derived so the event is attributed to the feed the viewer actually saw,
     * which matters when an assignment changes between a feed read and an open.
     */
    experimentVariant: communityExperimentVariantSchema,
  })
  .strict()
export type OpenCommunityFeedPostInput = z.infer<typeof openCommunityFeedPostInputSchema>

/** Story 6.6: the snapshot rank range, matching the 60-post spotlight cap. */
export const COMMUNITY_SPOTLIGHT_MAX_RANK = 60

/** Story 6.6: the levels a served spotlight can carry; `none` serves no cards. */
export const communityServedSpotlightLevelSchema = z.enum(['city', 'region', 'country'])
export type CommunityServedSpotlightLevel = z.infer<
  typeof communityServedSpotlightLevelSchema
>

/**
 * Story 6.7: where a spotlight entry was opened from. `spotlight` is the City
 * Spotlight module on Community; `home_teaser` is the Home teaser.
 */
export const communitySpotlightOpenSurfaceSchema = z.enum(['spotlight', 'home_teaser'])
export type CommunitySpotlightOpenSurface = z.infer<
  typeof communitySpotlightOpenSurfaceSchema
>

/**
 * Story 6.6: an open from the City Spotlight module. It carries the card's rank
 * and the level the module was served at, and never an experiment arm, because
 * the spotlight is outside the feed experiment; this branch records only
 * `community_spotlight_opened`. Story 6.7 adds the Home teaser as a surface.
 */
export const openCommunitySpotlightPostInputSchema = z
  .object({
    surface: communitySpotlightOpenSurfaceSchema,
    rank: z.number().int().min(1).max(COMMUNITY_SPOTLIGHT_MAX_RANK),
    level: communityServedSpotlightLevelSchema,
  })
  .strict()
export type OpenCommunitySpotlightPostInput = z.infer<
  typeof openCommunitySpotlightPostInputSchema
>

export type OpenCommunityPostInput =
  | OpenCommunityFeedPostInput
  | OpenCommunitySpotlightPostInput

/**
 * Discriminated by the presence of `surface`. A body without it is exactly the
 * installed clients' feed open and keeps today's `community_card_opened`
 * behavior byte for byte.
 *
 * One strict object with optional members, refined to exactly one branch,
 * rather than a schema union: the published request body only widens, so an
 * installed client's body stays valid under the same object schema.
 */
const OPEN_COMMUNITY_POST_INPUT_DESCRIPTION =
  'Either a feed open with experimentVariant, or a spotlight open with surface spotlight or home_teaser, a rank from 1 to 60 and the served level. The two forms never mix.'

export const openCommunityPostInputSchema = z
  .object({
    experimentVariant: communityExperimentVariantSchema.optional(),
    surface: communitySpotlightOpenSurfaceSchema.optional(),
    rank: z.number().int().min(1).max(COMMUNITY_SPOTLIGHT_MAX_RANK).optional(),
    level: communityServedSpotlightLevelSchema.optional(),
  })
  .strict()
  .superRefine((body, context) => {
    const spotlight =
      body.surface !== undefined || body.rank !== undefined || body.level !== undefined
    const valid = spotlight
      ? openCommunitySpotlightPostInputSchema.safeParse(body).success
      : openCommunityFeedPostInputSchema.safeParse(body).success
    if (!valid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: spotlight
          ? 'A spotlight open needs surface spotlight or home_teaser, a rank and the served level, and no experiment variant.'
          : 'A feed open needs the served experiment variant.',
      })
  })
  .openapi({ description: OPEN_COMMUNITY_POST_INPUT_DESCRIPTION })
  .transform(
    (body): OpenCommunityPostInput =>
      body.surface !== undefined
        ? { surface: body.surface, rank: body.rank!, level: body.level! }
        : { experimentVariant: body.experimentVariant! }
  )
  .openapi({ description: OPEN_COMMUNITY_POST_INPUT_DESCRIPTION })

export function isSpotlightOpenInput(
  input: OpenCommunityPostInput
): input is OpenCommunitySpotlightPostInput {
  return 'surface' in input
}

export const openCommunityPostResponseSchema = trackedResponseSchema
export type OpenCommunityPostResponse = z.infer<typeof openCommunityPostResponseSchema>

// --- City Spotlight (Story 6.6) ----------------------------------------------

/**
 * The area level a spotlight was ranked at. `none` means no level met the
 * privacy cohort and the response carries no items.
 */
export const communitySpotlightLevelSchema = z.enum(['city', 'region', 'country', 'none'])
export type CommunitySpotlightLevel = z.infer<typeof communitySpotlightLevelSchema>

export const COMMUNITY_SPOTLIGHT_DEFAULT_LIMIT = 6
export const COMMUNITY_SPOTLIGHT_MAX_LIMIT = 12

const communitySpotlightRankSchema = z
  .number()
  .int()
  .min(1)
  .max(COMMUNITY_SPOTLIGHT_MAX_RANK)
  .openapi({ description: 'One-based position of the post in the ranked snapshot.' })

export const communitySpotlightItemSchema = communityFeedItemSchema
  .extend({ rank: communitySpotlightRankSchema })
  .strict()
export type CommunitySpotlightItem = z.infer<typeof communitySpotlightItemSchema>

export const communitySpotlightSchema = z
  .object({
    level: communitySpotlightLevelSchema,
    label: z.string().nullable().openapi({
      description:
        "The viewer's own place name at the ranked level, or null for none. Never derived from authors.",
    }),
    items: z.array(communitySpotlightItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict()
export type CommunitySpotlight = z.infer<typeof communitySpotlightSchema>

export const communitySpotlightResponseSchema = z
  .object({ data: communitySpotlightSchema })
  .strict()
export type CommunitySpotlightResponse = z.infer<typeof communitySpotlightResponseSchema>

export const communityReactionSpotlightItemSchema = communityReactionFeedItemSchema
  .extend({ rank: communitySpotlightRankSchema })
  .strict()
export type CommunityReactionSpotlightItem = z.infer<
  typeof communityReactionSpotlightItemSchema
>

export const communityReactionSpotlightSchema = communitySpotlightSchema
  .extend({ items: z.array(communityReactionSpotlightItemSchema) })
  .strict()
export type CommunityReactionSpotlight = z.infer<typeof communityReactionSpotlightSchema>

export const communityReactionSpotlightResponseSchema = z
  .object({ data: communityReactionSpotlightSchema })
  .strict()
export type CommunityReactionSpotlightResponse = z.infer<
  typeof communityReactionSpotlightResponseSchema
>

/** Story 6.7b: the spotlight's opted-in variant; see `COMMUNITY_SPONSORSHIP_HEADER`. */
export const communitySponsoredSpotlightItemSchema = communitySponsoredFeedItemSchema
  .extend({ rank: communitySpotlightRankSchema })
  .strict()
export type CommunitySponsoredSpotlightItem = z.infer<
  typeof communitySponsoredSpotlightItemSchema
>
export const communitySponsoredSpotlightSchema = communitySpotlightSchema
  .extend({ items: z.array(communitySponsoredSpotlightItemSchema) })
  .strict()
export type CommunitySponsoredSpotlight = z.infer<
  typeof communitySponsoredSpotlightSchema
>
export const communitySponsoredSpotlightResponseSchema = z
  .object({ data: communitySponsoredSpotlightSchema })
  .strict()
export type CommunitySponsoredSpotlightResponse = z.infer<
  typeof communitySponsoredSpotlightResponseSchema
>

/**
 * Story 6.7: which surface asked for the spotlight. It changes only the
 * `surface` property of `community_spotlight_viewed`; ranking, level, cursor
 * and caching are the same for both.
 */
export const communitySpotlightSurfaceSchema = z.enum(['community', 'home_teaser'])
export type CommunitySpotlightSurface = z.infer<typeof communitySpotlightSurfaceSchema>

export const communitySpotlightQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    surface: communitySpotlightSurfaceSchema.default('community').openapi({
      description:
        'The surface reading the spotlight: community (default) or home_teaser. Affects analytics only.',
    }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(COMMUNITY_SPOTLIGHT_MAX_LIMIT)
      .default(COMMUNITY_SPOTLIGHT_DEFAULT_LIMIT),
  })
  .strict()
export type CommunitySpotlightQuery = z.infer<typeof communitySpotlightQuerySchema>

/** The refusal the spotlight shares with every other read-authorized community route. */
export const communitySpotlightInvalidCursorResponseSchema = z
  .object({
    statusCode: z.literal(400),
    code: z.literal('invalid_cursor'),
    message: nonEmptyStringSchema,
  })
  .strict()
export const communitySpotlightDeniedResponseSchema = z
  .object({
    statusCode: z.literal(403),
    code: z.string().optional(),
    message: nonEmptyStringSchema,
    error: z.string().optional(),
  })
  .strict()
export const communitySpotlightUnavailableResponseSchema = z
  .object({
    statusCode: z.literal(503),
    code: z.literal('unavailable'),
    retryAfterSeconds: z.number().int().min(1),
    message: nonEmptyStringSchema,
    error: z.string().optional(),
  })
  .strict()

export const withdrawCommunityPostResponseSchema = trackedResponseSchema
export type WithdrawCommunityPostResponse = z.infer<
  typeof withdrawCommunityPostResponseSchema
>

// --- Challenge Admin Schemas ------------------------------------------------

/** IANA zone identifier. Validated against the host's own tz database. */
export const ianaTimeZoneSchema = nonEmptyStringSchema
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value })
        return true
      } catch {
        return false
      }
    },
    { message: 'Time zone must be a valid IANA zone identifier.' }
  )
  .openapi({
    description:
      'IANA time zone identifier, for example Europe/Istanbul. Validated against the host tz database; an unknown zone is rejected.',
  })

const MONDAY_WEEKDAY = 'Mon'
const CHALLENGE_WINDOW_DAYS = 7

interface ZonedWallClock {
  weekday: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * The wall-clock reading of an instant in a zone, or null for a zone Intl rejects.
 *
 * A failed field-level `.refine()` marks the value dirty rather than aborting, so
 * this object-level refinement still runs with whatever the caller sent; formatting
 * an unknown zone would throw a RangeError out of `safeParse` and surface as a 500
 * where the spec requires a 400.
 *
 * `hourCycle: 'h23'` rather than `hour12: false` is load-bearing. Under `hour12:
 * false` the en-US formatter renders local midnight as hour `24`, so a comparison
 * against `0` silently never matches and every window is rejected for the wrong
 * reason.
 */
function zonedWallClock(isoTimestamp: string, timeZone: string): ZonedWallClock | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(isoTimestamp))
    // formatToParts yields every requested part for a valid zone and timestamp.
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const read = (type: Intl.DateTimeFormatPartTypes): string => value[type]!
    return {
      weekday: read('weekday'),
      year: Number(read('year')),
      month: Number(read('month')),
      day: Number(read('day')),
      hour: Number(read('hour')),
      minute: Number(read('minute')),
      second: Number(read('second')),
    }
  } catch {
    return null
  }
}

/** Whether a wall-clock reading is exactly midnight at the start of a Monday. */
function isMondayMidnight(clock: ZonedWallClock): boolean {
  return (
    clock.weekday === MONDAY_WEEKDAY &&
    clock.hour === 0 &&
    clock.minute === 0 &&
    clock.second === 0
  )
}

/** The `YYYY-MM-DD` of a wall-clock reading, for calendar comparison. */
function calendarDate(clock: ZonedWallClock): string {
  const month = String(clock.month).padStart(2, '0')
  const day = String(clock.day).padStart(2, '0')
  return `${clock.year}-${month}-${day}`
}

/**
 * The calendar date `days` after a wall-clock reading.
 *
 * `Date.UTC` on the wall-clock year, month and day is deliberate: this is pure
 * calendar arithmetic on a date that has already been resolved in its own zone, so
 * no offset applies and a DST transition inside the span cannot shift it.
 */
function calendarDatePlusDays(clock: ZonedWallClock, days: number): string {
  const shifted = new Date(Date.UTC(clock.year, clock.month - 1, clock.day))
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

const communityChallengeWindowShape = {
  startsAt: isoTimestampSchema,
  endsAt: isoTimestampSchema,
  timeZone: ianaTimeZoneSchema.describe(
    'IANA zone the Monday boundary and the seven-day span are evaluated in.'
  ),
}

/**
 * A challenge window runs Monday to Monday in its own zone. Validating it here
 * rather than in the service keeps the rule in one place for the API, the
 * generated SDK and both clients.
 */
function refineChallengeWindow(
  value: { startsAt: string; endsAt: string; timeZone: string },
  ctx: z.RefinementCtx
) {
  const { startsAt, endsAt, timeZone } = value
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  if (end <= start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    })
    return
  }

  const startClock = zonedWallClock(startsAt, timeZone)
  const endClock = zonedWallClock(endsAt, timeZone)
  if (startClock === null || endClock === null) {
    // ianaTimeZoneSchema already raised the zone issue; adding a second one here
    // would report a window problem the caller does not have.
    return
  }

  if (!isMondayMidnight(startClock)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startsAt'],
      message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    })
  }

  if (!isMondayMidnight(endClock)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    })
    return
  }

  // The span is seven LOCAL days, never a fixed number of absolute hours. A
  // Monday-to-Monday week is 167 hours across a spring transition and 169 across
  // an autumn one, so the previous `end - start === 7 * 24h` check rejected every
  // legitimate window in a DST-observing zone and accepted only the ones landing an
  // hour off the local boundary, which is the boundary `timeZone` exists to pin.
  if (
    calendarDate(endClock) !== calendarDatePlusDays(startClock, CHALLENGE_WINDOW_DAYS)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    })
  }
}

export const createCommunityChallengeInputSchema = z
  .object({
    slug: nonEmptyStringSchema,
    climateBand: nullableClimateBandSchema(
      'The climate band this challenge is restricted to, or null if unrestricted.'
    ).optional(),
    ...communityChallengeWindowShape,
    copy: communityChallengeCopySchema,
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine(refineChallengeWindow)
  .openapi({
    description:
      'Creates a community challenge. startsAt must fall on a Monday in the given timeZone, and endsAt must be exactly seven days after startsAt. A window that fails either rule is rejected.',
  })
export type CreateCommunityChallengeInput = z.infer<
  typeof createCommunityChallengeInputSchema
>

export const updateCommunityChallengeInputSchema = z
  .object({
    slug: nonEmptyStringSchema.optional(),
    climateBand: nullableClimateBandSchema(
      'The climate band this challenge is restricted to, or null if unrestricted.'
    ).optional(),
    startsAt: isoTimestampSchema.optional(),
    endsAt: isoTimestampSchema.optional(),
    timeZone: ianaTimeZoneSchema.optional(),
    copy: communityChallengeCopySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Update must change at least one field.',
  })
  .superRefine((value, ctx) => {
    // A partial update that moves either edge of the window has to restate the
    // whole window, otherwise the Monday and seven-day rules cannot be checked.
    const touchesWindow =
      value.startsAt !== undefined ||
      value.endsAt !== undefined ||
      value.timeZone !== undefined
    if (!touchesWindow) {
      return
    }
    if (
      value.startsAt === undefined ||
      value.endsAt === undefined ||
      value.timeZone === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Changing the challenge window requires startsAt, endsAt and timeZone together.',
      })
      return
    }
    refineChallengeWindow(
      { startsAt: value.startsAt, endsAt: value.endsAt, timeZone: value.timeZone },
      ctx
    )
  })
  .openapi({
    description:
      'Updates a community challenge. At least one field must be present. Moving the window requires startsAt, endsAt and timeZone together, and the result must start on a Monday in that zone and span exactly seven days.',
  })
export type UpdateCommunityChallengeInput = z.infer<
  typeof updateCommunityChallengeInputSchema
>

export const communityChallengeResponseSchema = z
  .object({
    data: communityChallengeSchema,
  })
  .strict()
export type CommunityChallengeResponse = z.infer<typeof communityChallengeResponseSchema>

// --- OpenAPI Registration ---------------------------------------------------

// Story 6.4 owner: independent screened thread contracts preserve feed projections.
export const communityCommentStatusSchema = z.enum([
  'pending_screening',
  'published',
  'held_for_review',
  'blocked',
  'screening_failed',
  'author_deleted',
  'consent_suspended',
  'erased',
])
export type CommunityCommentStatus = z.infer<typeof communityCommentStatusSchema>

export const communityCommentBodySchema = z
  .string()
  .refine(
    (value) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value),
    'Comments must be a single line.'
  )
  .refine((value) => !/[\uD800-\uDFFF]/u.test(value), 'Comment contains invalid Unicode.')
  .openapi({
    description:
      'Control characters, line separators and unpaired UTF-16 surrogates are rejected.',
  })
  .transform((value) => value.normalize('NFC').trim())
  .openapi({
    description:
      'Single-line valid Unicode. Control characters and line separators are rejected before NFC normalization and trimming.',
  })
  .pipe(
    z
      .string()
      .min(1)
      .max(280)
      .refine(
        (value) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value),
        'Comments must be a single line.'
      )
      .refine(
        (value) => /[^\s\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u.test(value),
        'Comment must contain visible text.'
      )
      .openapi({
        description:
          'NFC text trimmed to 1-280 UTF-16 units. Whitespace and Unicode format characters alone are refused; control characters and line separators are refused.',
      })
  )

export const createCommunityCommentInputSchema = z
  .object({
    mutationId: z.string().uuid(),
    body: communityCommentBodySchema,
    locale: supportedLocaleSchema,
    parentId: nonEmptyStringSchema.max(128).nullable().default(null),
  })
  .strict()
export type CreateCommunityCommentInput = z.infer<
  typeof createCommunityCommentInputSchema
>

export const communityCommentSchema = z
  .object({
    id: nonEmptyStringSchema,
    postId: nonEmptyStringSchema,
    parentId: nonEmptyStringSchema.nullable(),
    body: z.string().max(280).nullable(),
    author: nonEmptyStringSchema.nullable(),
    isOwn: z.boolean(),
    unavailable: z.boolean(),
    publicationSequence: z.number().int().positive(),
    publishedAt: isoTimestampSchema,
    replyCount: z.number().int().nonnegative(),
  })
  .strict()
export type CommunityComment = z.infer<typeof communityCommentSchema>
export const communityCommentSubmissionSchema = z
  .object({
    id: nonEmptyStringSchema,
    postId: nonEmptyStringSchema,
    parentId: nonEmptyStringSchema.nullable(),
    status: communityCommentStatusSchema,
    body: z.string().max(280).nullable(),
    createdAt: isoTimestampSchema,
    publicationSequence: z.number().int().positive().nullable(),
  })
  .strict()
export type CommunityCommentSubmission = z.infer<typeof communityCommentSubmissionSchema>
export const COMMUNITY_COMMENT_PAGE_SIZE = 20
export const communityCommentsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(COMMUNITY_COMMENT_PAGE_SIZE),
  })
  .strict()
export type CommunityCommentsQuery = z.infer<typeof communityCommentsQuerySchema>
export const communityCommentsCursorSchema = z
  .object({
    kind: z.enum(['roots', 'replies']),
    postId: nonEmptyStringSchema,
    parentId: nonEmptyStringSchema.nullable(),
    snapshot: z.number().int().nonnegative(),
    after: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) =>
      value.after <= value.snapshot &&
      (value.kind === 'roots') === (value.parentId === null),
    'Invalid comment cursor.'
  )
  .openapi({
    description:
      'Snapshot-scoped cursor. after cannot exceed snapshot. Root cursors require a null parentId; reply cursors require a parentId. The route post and parent must match the cursor scope.',
  })
export type CommunityCommentsCursor = z.infer<typeof communityCommentsCursorSchema>
export const communityCommentsPageSchema = z
  .object({
    items: z.array(communityCommentSchema).max(50),
    nextCursor: z.string().nullable(),
    snapshot: z.number().int().nonnegative(),
    hasNewer: z.boolean(),
  })
  .strict()
export type CommunityCommentsPage = z.infer<typeof communityCommentsPageSchema>
export const communityCommentsResponseSchema = z
  .object({ data: communityCommentsPageSchema })
  .strict()
export const communityCommentSubmissionResponseSchema = z
  .object({ data: communityCommentSubmissionSchema })
  .strict()
export const communityCommentSubmissionsResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(communityCommentSubmissionSchema).max(50),
        nextCursor: z.string().nullable(),
      })
      .strict(),
  })
  .strict()
export const reportCommunityCommentInputSchema = z
  .object({ reason: communityReportReasonSchema })
  .strict()
export const reportCommunityCommentResponseSchema = z
  .object({
    data: z
      .object({
        reported: z.literal(true),
        acceptedAt: isoTimestampSchema,
        routedAt: isoTimestampSchema,
        reviewDueAt: isoTimestampSchema,
      })
      .strict(),
  })
  .strict()
export type ReportCommunityCommentResponse = z.infer<
  typeof reportCommunityCommentResponseSchema
>

function registerCommunityCommentContracts(
  registry: OpenAPIRegistry,
  common: RegisteredCommonHttpSchemas
) {
  const page = registry.register(
    'CommunityCommentsResponse',
    communityCommentsResponseSchema
  )
  const submission = registry.register(
    'CommunityCommentSubmissionResponse',
    communityCommentSubmissionResponseSchema
  )
  const own = registry.register(
    'CommunityCommentSubmissionsResponse',
    communityCommentSubmissionsResponseSchema
  )
  const report = registry.register(
    'ReportCommunityCommentResponse',
    reportCommunityCommentResponseSchema
  )
  const input = registry.register(
    'CreateCommunityCommentInput',
    createCommunityCommentInputSchema
  )
  const reportInput = registry.register(
    'ReportCommunityCommentInput',
    reportCommunityCommentInputSchema
  )
  const routes = [
    {
      method: 'get',
      suffix: '/comments',
      operationId: 'getCommunityComments',
      response: page,
      query: true,
    },
    {
      method: 'get',
      suffix: '/comments/{commentId}/replies',
      operationId: 'getCommunityCommentReplies',
      response: page,
      query: true,
    },
    {
      method: 'get',
      suffix: '/comment-submissions',
      operationId: 'getCommunityCommentSubmissions',
      response: own,
      query: true,
    },
    {
      method: 'post',
      suffix: '/comments',
      operationId: 'createCommunityComment',
      response: submission,
      body: input,
    },
    {
      method: 'delete',
      suffix: '/comments/{commentId}',
      operationId: 'deleteCommunityComment',
      response: submission,
    },
    {
      method: 'post',
      suffix: '/comments/{commentId}/report',
      operationId: 'reportCommunityComment',
      response: report,
      body: reportInput,
    },
  ] as const
  for (const route of routes)
    registry.registerPath({
      method: route.method,
      path: `/api/v1/community/posts/{postId}${route.suffix}`,
      operationId: route.operationId,
      summary: route.operationId,
      tags: ['community'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
        ...(route.suffix.includes('{commentId}')
          ? [
              {
                name: 'commentId',
                in: 'path' as const,
                required: true,
                schema: { type: 'string' as const },
              },
            ]
          : []),
        {
          name: 'x-couture-platform',
          in: 'header',
          required: true,
          schema: { type: 'string', enum: ['web', 'mobile'] },
        },
      ],
      request: {
        ...('query' in route ? { query: communityCommentsQuerySchema } : {}),
        ...('body' in route
          ? {
              body: {
                required: true,
                content: { 'application/json': { schema: route.body } },
              },
            }
          : {}),
      },
      responses: {
        200: {
          description: 'Authoritative thread state.',
          content: { 'application/json': { schema: route.response } },
        },
        400: {
          description: 'Invalid request or scoped cursor.',
          content: { 'application/json': { schema: common.badRequestHttpErrorSchema } },
        },
        401: {
          description: 'Authentication required.',
          content: { 'application/json': { schema: common.unauthorizedHttpErrorSchema } },
        },
        403: {
          description: 'Participation or ownership denied.',
          content: { 'application/json': { schema: common.forbiddenHttpErrorSchema } },
        },
        404: {
          description: 'Thread unavailable.',
          content: { 'application/json': { schema: common.notFoundHttpErrorSchema } },
        },
        ...(route.method === 'post'
          ? {
              409: {
                description:
                  'Accepted mutation or report reason differs from this retry.',
                content: {
                  'application/json': { schema: common.conflictHttpErrorSchema },
                },
              },
              429: {
                description: 'Rolling submission or combined report limit reached.',
                headers: {
                  'Retry-After': {
                    description:
                      'Seconds until the member may submit this operation again.',
                    schema: { type: 'integer', minimum: 1 },
                  },
                },
                content: {
                  'application/json': { schema: common.tooManyRequestsHttpErrorSchema },
                },
              },
            }
          : {}),
        500: {
          description: 'Internal server error occurred.',
          content: {
            'application/json': { schema: common.internalServerErrorHttpErrorSchema },
          },
        },
        503: {
          description: 'Community unavailable.',
          content: {
            'application/json': { schema: common.serviceUnavailableHttpErrorSchema },
          },
        },
      },
    })
}

export function registerCommunityContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registerCommunityCommentContracts(registry, commonSchemas)
  const reactionInput = registry.register(
    'SetCommunityReactionInput',
    setCommunityReactionInputSchema
  )
  const reactionResponse = registry.register(
    'CommunityReactionResponse',
    communityReactionResponseSchema
  )
  registry.register('CommunityReactionSummary', communityReactionSummarySchema)
  registry.register('CommunityReactionFeedItem', communityReactionFeedItemSchema)
  registry.register('CommunityReactionFeedResponse', communityReactionFeedResponseSchema)
  registry.register('CommunityReactionPostResponse', communityReactionPostResponseSchema)
  registry.registerPath({
    method: 'put',
    path: '/api/v1/community/posts/{postId}/reaction',
    tags: ['community'],
    summary: 'Set or retract the current member reaction',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
      },
    ],
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: reactionInput } },
      },
    },
    responses: {
      200: {
        description: 'Authoritative current state, including accepted retries.',
        content: { 'application/json': { schema: reactionResponse } },
      },
      400: {
        description: 'Invalid input.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Authentication required.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'Age or guardian consent prevents participation.',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: 'Post is hidden or deleted.',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      409: {
        description:
          'Stale revision or changed receipt payload. Authoritative current state is returned.',
        content: {
          'application/json': { schema: communityReactionConflictResponseSchema },
        },
      },
      429: {
        description: '60 new mutations per member per minute.',
        headers: {
          'Retry-After': {
            description: 'Seconds until the member may react again.',
            schema: { type: 'integer', minimum: 1 },
          },
        },
        content: {
          'application/json': { schema: commonSchemas.tooManyRequestsHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description: 'Community rollout disabled.',
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
    },
  })
  registry.register('ClimateBand', climateBandSchema)
  registry.register('CommunityPostStatus', communityPostStatusSchema)
  registry.register('CommunityFeedMode', communityFeedModeSchema)
  registry.register('CommunityBandUnresolvedReason', communityBandUnresolvedReasonSchema)
  registry.register('CommunityExperimentVariant', communityExperimentVariantSchema)
  registry.register('CommunityReportReason', communityReportReasonSchema)
  registry.register('CommunityFeedAuthor', communityFeedAuthorSchema)
  registry.register('CommunityImageAccess', communityImageAccessSchema)
  registry.register('CommunityFeedItem', communityFeedItemSchema)
  registry.register('CommunityAuthorPostState', communityAuthorPostStateSchema)
  registry.register('CommunityFeed', communityFeedSchema)
  registry.register('EmbeddedCommunityChallenge', embeddedCommunityChallengeSchema)
  registry.register('CommunityChallenge', communityChallengeSchema)

  const registeredFeedResponse = registry.register(
    'CommunityFeedResponse',
    communityFeedResponseSchema
  )
  const registeredPostResponse = registry.register(
    'CommunityPostResponse',
    communityPostResponseSchema
  )
  const registeredAllocateInput = registry.register(
    'AllocateCommunityPostInput',
    allocateCommunityPostInputSchema
  )
  const registeredAllocateResponse = registry.register(
    'AllocateCommunityPostResponse',
    allocateCommunityPostResponseSchema
  )
  const registeredPublishInput = registry.register(
    'PublishCommunityPostInput',
    publishCommunityPostInputSchema
  )
  const registeredPublishResponse = registry.register(
    'PublishCommunityPostResponse',
    publishCommunityPostResponseSchema
  )
  const registeredReportInput = registry.register(
    'ReportCommunityPostInput',
    reportCommunityPostInputSchema
  )
  const registeredCreateChallengeInput = registry.register(
    'CreateCommunityChallengeInput',
    createCommunityChallengeInputSchema
  )
  const registeredChallengeResponse = registry.register(
    'CommunityChallengeResponse',
    communityChallengeResponseSchema
  )

  registry.register('CommunitySponsorship', communitySponsorshipSchema)
  const registeredSponsoredFeedResponse = registry.register(
    'CommunitySponsoredFeedResponse',
    communitySponsoredFeedResponseSchema
  )
  const registeredSponsoredPostResponse = registry.register(
    'CommunitySponsoredPostResponse',
    communitySponsoredPostResponseSchema
  )
  const registeredSponsoredSpotlightResponse = registry.register(
    'CommunitySponsoredSpotlightResponse',
    communitySponsoredSpotlightResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/community/feed',
    tags: ['community'],
    summary: 'Read community feed by climate band',
    description:
      'Returns a keyset-paginated feed of published community lookbook posts, ordered by published_at desc with id desc tiebreak. The caller\u2019s own posts that are not published are returned separately in authorStates, unpaginated.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'x-couture-reactions',
        in: 'header',
        required: false,
        schema: { type: 'string', enum: ['1'] },
        description:
          'Opt in to reaction summaries. Omission preserves the strict legacy response.',
      },
      {
        name: COMMUNITY_SPONSORSHIP_HEADER,
        in: 'header',
        required: false,
        schema: { type: 'string', enum: ['1'] },
        description:
          'Opt in to the per-viewer sponsorship block on each item. Omission preserves the response shape with no sponsorship field. Combines with x-couture-reactions.',
      },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Platform making the request.',
      },
      {
        name: 'mode',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: [...communityFeedModeSchema.options],
          default: 'auto',
        },
        description:
          'Feed filter mode. auto resolves the viewer band, all returns every region, a band literal pins the feed to that band.',
      },
      {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description:
          'Opaque base64url keyset pagination cursor. Bound both to the filter mode and to the climate band the feed resolved when it was minted. Presenting it under a different mode, or after the resolved band has changed, returns 400; discard it and restart paging from the first page.',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 30, default: 12 },
        description: 'Number of posts to return (1-30, default 12).',
      },
    ],
    responses: {
      200: {
        description: 'Community feed retrieved successfully.',
        content: {
          'application/json': {
            schema: z.union([
              registeredFeedResponse,
              communityReactionFeedResponseSchema,
              registeredSponsoredFeedResponse,
            ]),
          },
        },
      },
      400: {
        description:
          'Malformed cursor, cursor minted under a different filter mode, cursor minted under a different resolved climate band, or invalid mode parameter. Under mode=auto the resolved band is derived per request from weather guaranteed fresh for only 60 minutes, so a band that goes stale between pages produces this response during ordinary reading. Discard the cursor and restart paging from the first page.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description: 'Community read rollout is disabled.',
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
    },
  })

  registry.register('CommunitySpotlightLevel', communitySpotlightLevelSchema)
  registry.register('CommunitySpotlightItem', communitySpotlightItemSchema)
  registry.register(
    'CommunityReactionSpotlightItem',
    communityReactionSpotlightItemSchema
  )
  const registeredSpotlightResponse = registry.register(
    'CommunitySpotlightResponse',
    communitySpotlightResponseSchema
  )
  const registeredReactionSpotlightResponse = registry.register(
    'CommunityReactionSpotlightResponse',
    communityReactionSpotlightResponseSchema
  )
  registry.registerPath({
    method: 'get',
    path: '/api/v1/community/spotlight',
    tags: ['community'],
    operationId: 'getCommunitySpotlight',
    summary: 'Read the City Spotlight for the viewer area',
    description:
      'Returns recent published looks from the viewer\u2019s coarse area ranked by non-author reactions and recency. The narrowest of city, region and country with at least five distinct eligible authors is used; otherwise level is none with no items. Read authorization and rollout rules match the feed.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'x-couture-reactions',
        in: 'header',
        required: false,
        schema: { type: 'string', enum: ['1'] },
        description:
          'Opt in to live reaction summaries on each item, exactly like the feed.',
      },
      {
        name: COMMUNITY_SPONSORSHIP_HEADER,
        in: 'header',
        required: false,
        schema: { type: 'string', enum: ['1'] },
        description:
          'Opt in to the per-viewer sponsorship block on each item. Omission preserves the response shape with no sponsorship field. Combines with x-couture-reactions.',
      },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Platform making the request.',
      },
      {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description:
          'Opaque signed cursor from a previous page. It is bound to the member, level, area and ranked snapshot; a cursor that no longer matches returns 400 invalid_cursor and paging restarts from the first page.',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: COMMUNITY_SPOTLIGHT_MAX_LIMIT,
          default: COMMUNITY_SPOTLIGHT_DEFAULT_LIMIT,
        },
        description: 'Number of ranked positions to read (1-12, default 6).',
      },
      {
        name: 'surface',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: ['community', 'home_teaser'],
          default: 'community',
        },
        description:
          'The surface reading the spotlight. home_teaser is the Home teaser; it changes only analytics, never ranking, level, cursor or caching.',
      },
    ],
    responses: {
      200: {
        description: 'City Spotlight page.',
        content: {
          'application/json': {
            schema: z.union([
              registeredSpotlightResponse,
              registeredReactionSpotlightResponse,
              registeredSponsoredSpotlightResponse,
            ]),
          },
        },
      },
      400: {
        description: 'Invalid query, or a cursor that is malformed, foreign or stale.',
        content: {
          'application/json': {
            schema: z.union([
              commonSchemas.badRequestHttpErrorSchema,
              communitySpotlightInvalidCursorResponseSchema,
            ]),
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'The community read rollout or age eligibility refuses this viewer.',
        content: {
          'application/json': { schema: communitySpotlightDeniedResponseSchema },
        },
      },
      429: {
        description: `${COMMUNITY_SPOTLIGHT_READS_PER_MINUTE} spotlight reads per member per minute, first and later pages alike.`,
        headers: {
          'Retry-After': {
            description: 'Seconds until the member may read the spotlight again.',
            schema: { type: 'integer', minimum: 1 },
          },
        },
        content: {
          'application/json': { schema: commonSchemas.tooManyRequestsHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description: 'Access could not be verified within the authorization budget.',
        content: {
          'application/json': { schema: communitySpotlightUnavailableResponseSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/community/posts/allocate',
    tags: ['community'],
    summary: 'Allocate a community post upload session',
    description:
      'Initiates photo upload for a community lookbook post. Requires Idempotency-Key header.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'Client idempotency key for post creation.',
      },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Platform making the request.',
      },
    ],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredAllocateInput },
        },
      },
    },
    responses: {
      200: {
        description: 'Upload session allocated or replayed successfully.',
        content: {
          'application/json': { schema: registeredAllocateResponse },
        },
      },
      400: {
        description: 'Invalid image upload parameters or dimensions.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'Age gate requirement not satisfied.',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      409: {
        description: 'Idempotency key was reused with a different payload.',
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description: 'Community write rollout is disabled.',
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/community/posts/{postId}',
    tags: ['community'],
    summary: 'Read a single community post',
    description:
      'Resolves one post directly, for a deep link that lands outside the first feed page and for polling an owned post until it reaches a terminal moderation state. Returns 404 for any post the caller cannot see.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'x-couture-reactions',
        in: 'header',
        required: false,
        schema: { type: 'string', enum: ['1'] },
        description:
          'Opt in to reaction summaries. Omission preserves the strict legacy response.',
      },
      {
        name: COMMUNITY_SPONSORSHIP_HEADER,
        in: 'header',
        required: false,
        schema: { type: 'string', enum: ['1'] },
        description:
          'Opt in to the per-viewer sponsorship block on each item. Omission preserves the response shape with no sponsorship field. Combines with x-couture-reactions.',
      },
      {
        name: 'postId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'ID of the post to read.',
      },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Platform making the request.',
      },
    ],
    responses: {
      200: {
        description: 'Post retrieved successfully.',
        content: {
          'application/json': {
            schema: z.union([
              registeredPostResponse,
              communityReactionPostResponseSchema,
              registeredSponsoredPostResponse,
            ]),
          },
        },
      },
      400: {
        description: 'Missing or invalid x-couture-platform header.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      404: {
        description: 'Post not found or not visible to the caller.',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description:
          'Community read rollout is disabled, or the post is visible but its media could not be signed. The second case is a storage outage rather than a missing post, and the caller should retry shortly.',
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/community/posts/publish',
    tags: ['community'],
    summary: 'Publish a community post to moderation queue',
    description:
      'Finalizes upload and enqueues the post for automated moderation screening. Requires confirmed alt text. Replaying the same Idempotency-Key with the same payload replays the original result; replaying it with a different payload returns 409.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'Client idempotency key for the publish transition.',
      },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Platform making the request.',
      },
    ],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredPublishInput },
        },
      },
    },
    responses: {
      200: {
        description: 'Post queued for moderation with pending_review status.',
        content: {
          'application/json': { schema: registeredPublishResponse },
        },
      },
      400: {
        description:
          'Invalid caption, invalid alt text, alt text not confirmed by the author, or a referenced challenge that is unknown, inactive, or outside its window.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'Age gate requirement not satisfied.',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: 'Post or upload session not found.',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      409: {
        description:
          'Idempotency key reused with a different payload, the upload session does not match the post, or the image bytes were never uploaded to the allocated object path.',
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      429: {
        description:
          'Daily posting rate limit reached. Carries a Retry-After header giving the seconds until the rolling 24-hour window admits another post.',
        headers: {
          'Retry-After': {
            description: 'Seconds until the rolling 24-hour window admits another post.',
            schema: { type: 'integer', minimum: 1 },
          },
        },
        content: {
          'application/json': { schema: commonSchemas.tooManyRequestsHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description:
          'Community write rollout is disabled, or the post was accepted but its media could not be signed for the response. The second case is a storage outage rather than a rejected publish.',
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/community/posts/{postId}/report',
    tags: ['community'],
    summary: 'Report a community post for moderation review',
    description:
      'Reports a post with a closed-enum reason. Replaying the same reason is idempotent and returns 200; submitting a different reason for a post this caller already reported returns 409.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'postId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'ID of the post to report.',
      },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Platform making the request.',
      },
    ],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredReportInput },
        },
      },
    },
    responses: {
      200: {
        description: 'Report recorded successfully.',
        content: {
          'application/json': { schema: commonSchemas.trackedResponseSchema },
        },
      },
      400: {
        description: 'Invalid report reason.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'A caller cannot report their own post.',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: 'Post not found or not visible to reporter.',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      409: {
        description:
          'This caller already reported the post for a different reason. A replay of the same reason returns 200.',
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      429: {
        description:
          'Reporting abuse limit reached. Carries a Retry-After header giving the seconds until the caller may report again.',
        headers: {
          'Retry-After': {
            description: 'Seconds until the caller may report again.',
            schema: { type: 'integer', minimum: 1 },
          },
        },
        content: {
          'application/json': { schema: commonSchemas.tooManyRequestsHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description:
          'Community read rollout is disabled. Reporting follows visibility rather than posting, so closing the write rollout during an incident does not disable it.',
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/community/posts/{postId}/opened',
    tags: ['community'],
    summary: 'Record that a viewer opened a community post',
    description:
      'Records one card-open. The server decides whether the opener is the author, because a client-asserted is-self flag would let the beta gate be moved by the population it measures. Repeats within the deduplication window collapse to one event. A body with surface spotlight and a rank records only a spotlight open; a body without surface keeps the feed card-open behavior.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'postId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'ID of the post that was opened.',
      },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Platform making the request.',
      },
    ],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registry.register(
              'OpenCommunityPostInput',
              openCommunityPostInputSchema
            ),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Card open recorded.',
        content: {
          'application/json': { schema: commonSchemas.trackedResponseSchema },
        },
      },
      400: {
        description:
          'Missing or invalid x-couture-platform header, or an invalid request body, including a spotlight rank outside 1 to 60.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      404: {
        description: 'Post not found or not visible to the caller.',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description: 'Community read rollout is disabled.',
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/community/posts/{postId}/withdraw',
    tags: ['community'],
    summary: 'Withdraw a community post',
    description:
      'Allows post author to withdraw a published post from the community feed.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'postId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'ID of the post to withdraw.',
      },
      {
        name: 'x-couture-platform',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Platform making the request.',
      },
    ],
    responses: {
      200: {
        description: 'Post withdrawn successfully.',
        content: {
          'application/json': { schema: commonSchemas.trackedResponseSchema },
        },
      },
      400: {
        description: 'Missing or invalid x-couture-platform header.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'User is not the author of this post.',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: 'Post not found.',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      409: {
        description:
          'Post is not in a withdrawable state. A draft has never been submitted and an already withdrawn post has nothing left to withdraw, so both are refused rather than silently re-stamped.',
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description:
          'Community read rollout is disabled. An author must be able to retract their own post during a posting freeze, so withdrawal follows visibility rather than posting.',
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/community/challenges',
    tags: ['community'],
    summary: 'Create a community challenge (Admin)',
    description: 'Creates an editorially curated community challenge.',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredCreateChallengeInput },
        },
      },
    },
    responses: {
      200: {
        description: 'Community challenge created successfully.',
        content: {
          'application/json': { schema: registeredChallengeResponse },
        },
      },
      400: {
        description: 'Invalid challenge window or missing en-US fallback.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'Admin role required.',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      409: {
        description: 'Active challenge already exists for this climate band and window.',
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/community/challenges/{id}',
    tags: ['community'],
    summary: 'Update a community challenge (Admin)',
    description: 'Updates an editorially curated community challenge.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'ID of the challenge to update.',
      },
    ],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registry.register(
              'UpdateCommunityChallengeInput',
              updateCommunityChallengeInputSchema
            ),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Community challenge updated successfully.',
        content: {
          'application/json': { schema: registeredChallengeResponse },
        },
      },
      400: {
        description: 'Invalid challenge window.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'Admin role required.',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: 'Challenge not found.',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      409: {
        description: 'Active challenge already exists for this climate band and window.',
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred.',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
    },
  })
}
