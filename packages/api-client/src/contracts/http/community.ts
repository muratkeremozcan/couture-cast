// Story 6.1 Task 3 owner: community HTTP contracts and schemas.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
  trackedResponseSchema,
} from './common'
import { supportedLocaleSchema } from './localization'

// --- Error message constants ------------------------------------------------

export const COMMUNITY_FEED_DISABLED_MESSAGE =
  'Community feed is temporarily unavailable.'

export const COMMUNITY_CURSOR_INVALID_MESSAGE = 'Invalid pagination cursor.'

export const COMMUNITY_POST_NOT_FOUND_MESSAGE = 'Community post not found.'

export const COMMUNITY_POST_RATE_LIMITED_MESSAGE =
  'You have reached the daily post limit. Please try again tomorrow.'

export const COMMUNITY_CHALLENGE_OVERLAP_MESSAGE =
  'An active challenge already exists for this climate band and window.'

export const COMMUNITY_CHALLENGE_NOT_FOUND_MESSAGE = 'Community challenge not found.'

export const COMMUNITY_AGE_GATE_DENIED_MESSAGE =
  'You must be at least 13 years old to post to the community feed.'

export const COMMUNITY_REPORT_REASON_CHANGED_MESSAGE =
  'You already reported this post for a different reason.'

export const COMMUNITY_SELF_REPORT_MESSAGE = 'You cannot report your own post.'

export const COMMUNITY_ALT_TEXT_UNCONFIRMED_MESSAGE =
  'Alt text must be reviewed and confirmed before publishing.'

export const COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE =
  'Upload session does not match this post.'

export const COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE =
  'Challenge window must start on a Monday and span exactly seven days in its time zone.'

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

// --- Validation helpers: Cursor, Caption, Alt-text --------------------------

/**
 * Public keyset cursor. Keyed on `published_at,id` because moderation stamps
 * `published_at` long after `created_at`; ordering on creation time inserts a
 * newly published post behind a cursor the reader already consumed, and the post
 * is never seen. `mode` binds the cursor to the filter it was minted under so a
 * client that changes filters cannot page one feed with another feed's cursor.
 */
export const communityFeedCursorPayloadSchema = z
  .object({
    publishedAt: isoTimestampSchema,
    id: nonEmptyStringSchema,
    mode: communityFeedModeSchema,
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
 * Decodes without throwing. Pass `expectedMode` on the read path: a cursor minted
 * under a different filter is rejected with the same stable message a malformed
 * cursor produces, so a client that changed filters simply restarts paging.
 */
export function safeDecodeCommunityFeedCursor(
  cursor: string,
  expectedMode?: CommunityFeedMode
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
      'Caption of at most 280 characters. Must not contain URLs, web links, or email addresses.',
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
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Returns null for a zone Intl rejects. A failed field-level `.refine()` marks the
 * value dirty rather than aborting, so this object-level refinement still runs with
 * whatever the caller sent; formatting an unknown zone would throw a RangeError out
 * of `safeParse` and surface as a 500 where the spec requires a 400.
 */
function weekdayInZone(isoTimestamp: string, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
      new Date(isoTimestamp)
    )
  } catch {
    return null
  }
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
  value: { startsAt?: string; endsAt?: string; timeZone?: string },
  ctx: z.RefinementCtx
) {
  const { startsAt, endsAt, timeZone } = value
  if (startsAt === undefined || endsAt === undefined || timeZone === undefined) {
    return
  }
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
  if (end - start !== CHALLENGE_WINDOW_DAYS * MILLISECONDS_PER_DAY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    })
  }
  const startWeekday = weekdayInZone(startsAt, timeZone)
  if (startWeekday === null) {
    // ianaTimeZoneSchema already raised the zone issue; adding a second one here
    // would report a window problem the caller does not have.
    return
  }
  if (startWeekday !== MONDAY_WEEKDAY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startsAt'],
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
    refineChallengeWindow(value, ctx)
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

export function registerCommunityContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
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
          'Opaque base64url keyset pagination cursor. Bound to the mode it was minted under; presenting it under a different mode returns 400.',
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
          'application/json': { schema: registeredFeedResponse },
        },
      },
      400: {
        description:
          'Malformed cursor, cursor minted under a different filter mode, or invalid mode parameter.',
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
      429: {
        description: 'Daily posting rate limit reached. Carries a Retry-After header.',
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
          'application/json': { schema: registeredPostResponse },
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
          'Invalid caption, invalid alt text, or alt text not confirmed by the author.',
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
        description: 'Post, upload session, or referenced challenge not found.',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      409: {
        description:
          'Idempotency key reused with a different payload, or the upload session does not match the post.',
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
        description: 'Community write rollout is disabled.',
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
        description: 'Community write rollout is disabled.',
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
