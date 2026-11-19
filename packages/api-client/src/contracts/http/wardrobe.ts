// Story 4.4 Task 2 step 1 owner: define onboarding-state and silhouette HTTP contracts and Zod schemas in packages/api-client/src/contracts/http/wardrobe.ts
// Story 4.3 Task 2 step 1 owner: define Outfit Capsule HTTP contracts and Zod schemas in packages/api-client/src/contracts/http/wardrobe.ts
import { withRequestDeadline } from '../../request-deadline'
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
// Story 4.1 Task 4 step 1 owner: define Zod request and response envelope schemas and uploadGarmentBytes helper
// Story 4.2 Task 4 step 1 owner: define suggestGarmentTags and updateGarmentTags HTTP contracts and Zod schemas in packages/api-client/src/contracts/http/wardrobe.ts
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'

export const garmentCategoryEnum = z.enum([
  'top',
  'bottom',
  'outerwear',
  'dress',
  'shoes',
  'accessory',
])

export const garmentMaterialEnum = z.enum([
  'cotton',
  'wool',
  'linen',
  'leather',
  'denim',
  'fleece',
  'synthetic',
  'down',
  'silk',
])

export const garmentComfortRangeEnum = z.enum(['cold', 'cool', 'mild', 'warm', 'hot'])

export const capsuleOccasionEnum = z.enum([
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
])

export const GARMENT_TAGGING_ANALYSIS_VERSION =
  'fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1' as const

export const garmentTagSuggestionSnapshotSchema = z
  .object({
    analysisVersion: z.literal(GARMENT_TAGGING_ANALYSIS_VERSION),
    category: z
      .object({
        value: garmentCategoryEnum,
        confidence: z.number().min(0).max(1),
        isConfident: z.boolean(),
      })
      .strict(),
    material: z
      .object({
        value: garmentMaterialEnum,
        confidence: z.number().min(0).max(1),
        isConfident: z.boolean(),
      })
      .strict(),
    comfortRange: z
      .object({
        value: garmentComfortRangeEnum,
        confidence: z.number().min(0).max(1),
        isConfident: z.boolean(),
      })
      .strict(),
  })
  .strict()

export const createGarmentUploadUrlInputSchema = z
  .object({
    fileSizeBytes: z.number().int().min(1).max(10_485_760),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
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

export const garmentUploadSessionSchema = z
  .object({
    garmentId: nonEmptyStringSchema,
    uploadSessionId: nonEmptyStringSchema,
    uploadUrl: z.string().url(),
    uploadToken: nonEmptyStringSchema,
    requiredHeaders: z
      .object({
        'content-type': z.string(),
      })
      .strict(),
    expiresAt: isoTimestampSchema,
  })
  .strict()

export const createGarmentUploadUrlResponseSchema = z
  .object({
    data: garmentUploadSessionSchema,
  })
  .strict()

export const createGarmentItemInputSchema = z
  .object({
    garmentId: nonEmptyStringSchema,
    uploadSessionId: nonEmptyStringSchema,
    hasCropping: z.boolean(),
    hasBgCleanup: z.boolean(),
  })
  .strict()

export const garmentImageAccessSchema = z
  .object({
    url: z.string().url(),
    expiresAt: isoTimestampSchema,
  })
  .strict()

export const garmentItemSchema = z
  .object({
    id: nonEmptyStringSchema,
    status: z
      .enum([
        'pending_upload',
        'bytes_uploaded',
        'processing',
        'awaiting_tags',
        'ready',
        'failed',
      ])
      // Exempt from `request and response property enums` and from that rule
      // only; every other breaking-change rule still gates this property. The
      // garment lifecycle is deliberately an open set, because the tagging and
      // moderation pipeline is expected to gain states, and gating that would
      // put routine additions behind a breaking-change override. The price is
      // that consumers must tolerate values they do not recognize, so that
      // expectation is published below instead of living as folklore.
      .openapi({
        'x-optic-exemptions': 'request and response property enums',
        description: [
          'Open set. New lifecycle states are added as the tagging and moderation',
          'pipeline evolves, and this property is intentionally exempt from',
          'breaking-change enforcement for enum values. Treat an unrecognized status',
          'as pass-through rather than an error, and do not exhaustively switch on it',
          'without a default branch.',
        ].join(' '),
      }),
    category: garmentCategoryEnum.nullable(),
    material: garmentMaterialEnum.nullable(),
    comfortRange: garmentComfortRangeEnum.nullable(),
    tagsConfirmedAt: isoTimestampSchema.nullable(),
    fileSizeBytes: z.number().int().min(1).max(10_485_760).nullable(),
    mimeType: z
      .enum(['image/jpeg', 'image/png', 'image/webp'])
      .nullable()
      // Same single-rule exemption as `status` above. The accepted image
      // formats track what the upload and moderation pipeline can decode, which
      // changes independently of this contract.
      .openapi({
        'x-optic-exemptions': 'request and response property enums',
        description: [
          'Open set. Supported image formats track what the upload pipeline can',
          'decode and may gain values, so this property is intentionally exempt from',
          'breaking-change enforcement for enum values. Treat an unrecognized MIME',
          'type as pass-through rather than an error.',
        ].join(' '),
      }),
    retentionStatus: z.enum(['active', 'deletion_pending', 'legal_hold']),
    createdAt: isoTimestampSchema,
    committedAt: isoTimestampSchema.nullable(),
    imageAccess: garmentImageAccessSchema.nullable(),
  })
  .strict()

export const createGarmentItemResponseSchema = z
  .object({
    data: garmentItemSchema,
  })
  .strict()

export const garmentListResponseSchema = z
  .object({
    data: z.array(garmentItemSchema),
  })
  .strict()

export const garmentIdPathParamsSchema = z
  .object({
    garmentId: nonEmptyStringSchema.max(128).describe('Unique garment item ID.'),
  })
  .strict()

export const suggestGarmentTagsDataSchema = z
  .object({
    garmentId: nonEmptyStringSchema.max(128),
    analysisVersion: z.literal(GARMENT_TAGGING_ANALYSIS_VERSION),
    suggestions: z
      .object({
        category: z
          .object({
            value: garmentCategoryEnum,
            confidence: z.number().min(0).max(1),
            isConfident: z.boolean(),
          })
          .strict(),
        material: z
          .object({
            value: garmentMaterialEnum,
            confidence: z.number().min(0).max(1),
            isConfident: z.boolean(),
          })
          .strict(),
        comfortRange: z
          .object({
            value: garmentComfortRangeEnum,
            confidence: z.number().min(0).max(1),
            isConfident: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

export const suggestGarmentTagsResponseSchema = z
  .object({
    data: suggestGarmentTagsDataSchema,
  })
  .strict()

export const updateGarmentTagsInputSchema = z
  .object({
    category: garmentCategoryEnum,
    material: garmentMaterialEnum.nullable().optional(),
    comfortRange: garmentComfortRangeEnum,
  })
  .strict()

export const updateGarmentTagsResponseSchema = z
  .object({
    data: garmentItemSchema,
  })
  .strict()

const garmentIdBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.string().startsWith('Invalid garment id'),
    error: z.literal('Bad Request'),
  })
  .strict()

const garmentTagsBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.union([
      z.string().startsWith('Invalid garment id'),
      z.string().startsWith('Invalid garment tags'),
    ]),
    error: z.literal('Bad Request'),
  })
  .strict()

const garmentTaggingUnauthorizedErrorSchema = z
  .object({
    statusCode: z.literal(401),
    message: z.enum(['Missing or invalid bearer token', 'Invalid access token']),
    error: z.literal('Unauthorized'),
  })
  .strict()

const garmentTaggingForbiddenErrorSchema = z
  .object({
    statusCode: z.literal(403),
    message: z.enum([
      'Guardian consent required before continuing',
      'GUARDIAN_CONSENT_REQUIRED',
    ]),
    error: z.literal('Forbidden'),
  })
  .strict()

const garmentTaggingNotFoundErrorSchema = z
  .object({
    statusCode: z.literal(404),
    message: z.literal('GARMENT_NOT_FOUND'),
    error: z.literal('Not Found'),
  })
  .strict()

const garmentSuggestionConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum(['GARMENT_ANALYSIS_PENDING', 'GARMENT_NOT_TAGGABLE']),
    error: z.literal('Conflict'),
  })
  .strict()

const garmentUpdateConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum([
      'GARMENT_ANALYSIS_PENDING',
      'GARMENT_NOT_TAGGABLE',
      'CONCURRENT_TAG_UPDATE',
    ]),
    error: z.literal('Conflict'),
  })
  .strict()

const garmentTaggingUnavailableErrorSchema = z
  .object({
    statusCode: z.literal(503),
    message: z.literal('TAGGING_INFERENCE_UNAVAILABLE'),
    error: z.literal('Service Unavailable'),
  })
  .strict()

export const ownerUserIdPathParamsSchema = z
  .object({
    ownerUserId: nonEmptyStringSchema.max(128).describe('Unique owner user ID.'),
  })
  .strict()

export const capsuleIdPathParamsSchema = z
  .object({
    ownerUserId: nonEmptyStringSchema.max(128).describe('Unique owner user ID.'),
    capsuleId: nonEmptyStringSchema.max(128).describe('Unique outfit capsule ID.'),
  })
  .strict()

/**
 * Capsule text limits are expressed in extended grapheme clusters, which is what
 * a user perceives as a character. Counting UTF-16 code units would reject a
 * five-emoji name and accept a 120-character combining-mark name.
 *
 * `Intl.Segmenter` is optional under ECMA-402 and Hermes ships without it, so
 * the segmenter is resolved lazily behind a feature detect. Constructing it at
 * module scope threw `TypeError: Cannot read property 'prototype' of undefined`
 * while merely *importing* this module under React Native, which took the whole
 * mobile app down at launch even though only the API ever calls the grapheme
 * validators. Same shape as the `Intl.ListFormat` fallback in
 * `@couture/utils/accessibility`.
 */
let graphemeSegmenter: Intl.Segmenter | undefined
let graphemeSegmenterResolved = false

function getGraphemeSegmenter(): Intl.Segmenter | undefined {
  if (!graphemeSegmenterResolved) {
    graphemeSegmenterResolved = true
    const segmenter = (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter })
      .Segmenter
    if (segmenter) {
      graphemeSegmenter = new segmenter(undefined, { granularity: 'grapheme' })
    }
  }

  return graphemeSegmenter
}

function countGraphemes(value: string): number {
  const segmenter = getGraphemeSegmenter()
  if (segmenter) {
    return [...segmenter.segment(value)].length
  }

  // No ICU segmentation in this runtime. Code points still beat UTF-16 code
  // units: an astral-plane emoji counts once instead of twice. Combining marks
  // and ZWJ sequences over-count, which can only reject input the server would
  // have accepted, never accept input the server would reject.
  return [...value].length
}

/** PostgreSQL `text` cannot store a NUL byte, so it is invalid input, not a 500. */
const hasNullByte = (value: string): boolean => value.includes('\u0000')

/**
 * Trims Unicode whitespace and applies NFC before validating, so that a
 * whitespace-only name fails `min(1)` instead of being accepted and persisted as
 * an empty string that later breaks response parsing.
 */
function graphemeBoundedText(maxGraphemes: number, minGraphemes = 0) {
  return z
    .string()
    .transform((value) => value.trim().normalize('NFC'))
    .superRefine((value, ctx) => {
      if (hasNullByte(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must not contain a null byte',
        })
        return
      }
      const length = countGraphemes(value)
      if (length < minGraphemes) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: minGraphemes,
          type: 'string',
          inclusive: true,
          message: `must be at least ${minGraphemes} characters after normalization`,
        })
      }
      if (length > maxGraphemes) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: maxGraphemes,
          type: 'string',
          inclusive: true,
          message: `must be at most ${maxGraphemes} characters after normalization`,
        })
      }
    })
    .openapi({
      description: [
        'Trimmed and NFC-normalized before validation, then bounded to',
        `${minGraphemes}-${maxGraphemes} extended grapheme clusters (user-perceived`,
        'characters), not UTF-16 code units. A JSON Schema maxLength cannot express',
        'this: an emoji with a skin-tone modifier counts as one here and as four',
        'code units there. Null bytes are rejected because PostgreSQL text cannot',
        'store them.',
      ].join(' '),
    })
}

const capsuleNameSchema = graphemeBoundedText(60, 1)

/** An empty normalized description is `null`, never `''`. */
const capsuleDescriptionSchema = graphemeBoundedText(280)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()

const capsuleGarmentIdsSchema = z
  .array(nonEmptyStringSchema.max(128))
  .min(2)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'garmentIds must not contain duplicates',
  })
  .openapi({
    description: [
      'Collection invariant enforced at runtime and NOT expressible in this schema:',
      'garmentIds must contain no duplicates. JSON Schema uniqueItems would express',
      'this for a plain string array, but it is not emitted here, so the rule is only',
      'visible in this description and in the 400 returned when it is violated.',
    ].join(' '),
  })

export const createOutfitCapsuleInputSchema = z
  .object({
    name: capsuleNameSchema,
    description: capsuleDescriptionSchema.optional(),
    occasions: z.array(capsuleOccasionEnum).min(1).max(8),
    garmentIds: capsuleGarmentIdsSchema,
    isFavorite: z.boolean().optional().default(false),
  })
  .strict()

export const capsuleGarmentSchema = z
  .object({
    id: nonEmptyStringSchema,
    category: garmentCategoryEnum.nullable(),
    material: garmentMaterialEnum.nullable(),
    comfortRange: garmentComfortRangeEnum.nullable(),
    imageAccess: garmentImageAccessSchema.nullable(),
    availabilityStatus: z.enum(['ready', 'needs_repair']),
    garmentOrder: z.number().int().min(0).max(9),
  })
  .strict()

export const outfitCapsuleSchema = z
  .object({
    id: nonEmptyStringSchema,
    ownerUserId: nonEmptyStringSchema,
    name: z.string().min(1).max(60),
    description: z.string().max(280).nullable(),
    occasions: z.array(capsuleOccasionEnum).min(1).max(8),
    isFavorite: z.boolean(),
    revision: z.number().int().min(0),
    availabilityStatus: z.enum(['ready', 'needs_repair']),
    unavailableGarmentCount: z.number().int().min(0),
    garments: z.array(capsuleGarmentSchema),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const outfitCapsuleResponseSchema = z
  .object({
    data: outfitCapsuleSchema,
  })
  .strict()

export const listOutfitCapsulesQuerySchema = z
  .object({
    q: graphemeBoundedText(120)
      .transform((value) => (value.length === 0 ? undefined : value))
      .optional(),
    occasion: capsuleOccasionEnum.optional(),
    isFavorite: z.preprocess((val) => {
      if (typeof val === 'string') {
        if (val === 'true') return true
        if (val === 'false') return false
      }
      return val
    }, z.boolean().optional()),
    garmentId: nonEmptyStringSchema.max(128).optional(),
    comfortRange: garmentComfortRangeEnum.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict()

export const outfitCapsuleListResponseSchema = z
  .object({
    data: z.array(outfitCapsuleSchema),
    total: z.number().int().min(0),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0).max(10000),
  })
  .strict()

export const updateOutfitCapsuleInputSchema = z
  .object({
    name: capsuleNameSchema.optional(),
    description: capsuleDescriptionSchema.optional(),
    occasions: z.array(capsuleOccasionEnum).min(1).max(8).optional(),
    garmentIds: capsuleGarmentIdsSchema.optional(),
    isFavorite: z.boolean().optional(),
  })
  .strict()

export const favoriteOutfitCapsuleInputSchema = z
  .object({
    isFavorite: z.boolean(),
  })
  .strict()

const capsuleBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.string(),
    error: z.literal('Bad Request'),
  })
  .strict()

const capsuleForbiddenErrorSchema = z
  .object({
    statusCode: z.literal(403),
    message: z.enum(['GUARDIAN_READ_ONLY', 'GUARDIAN_CONSENT_REQUIRED']),
    error: z.literal('Forbidden'),
  })
  .strict()

const capsuleNotFoundErrorSchema = z
  .object({
    statusCode: z.literal(404),
    message: z.literal('NOT_FOUND'),
    error: z.literal('Not Found'),
  })
  .strict()

const capsuleConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum(['GARMENT_NOT_CAPSULE_ELIGIBLE', 'IDEMPOTENCY_KEY_REUSED']),
    error: z.literal('Conflict'),
  })
  .strict()

const capsulePreconditionFailedErrorSchema = z
  .object({
    statusCode: z.literal(412),
    message: z.literal('CAPSULE_REVISION_MISMATCH'),
    error: z.literal('Precondition Failed'),
  })
  .strict()

const capsulePreconditionRequiredErrorSchema = z
  .object({
    statusCode: z.literal(428),
    message: z.literal('PRECONDITION_REQUIRED'),
    error: z.literal('Precondition Required'),
  })
  .strict()

export type GarmentCategory = z.infer<typeof garmentCategoryEnum>
export type GarmentMaterial = z.infer<typeof garmentMaterialEnum>
export type GarmentComfortRange = z.infer<typeof garmentComfortRangeEnum>
export type CapsuleOccasion = z.infer<typeof capsuleOccasionEnum>
export type GarmentTagSuggestionSnapshot = z.infer<
  typeof garmentTagSuggestionSnapshotSchema
>
export type CreateGarmentUploadUrlInput = z.infer<
  typeof createGarmentUploadUrlInputSchema
>
export type CreateGarmentUploadUrlResponse = z.infer<
  typeof createGarmentUploadUrlResponseSchema
>
export type CreateGarmentItemInput = z.infer<typeof createGarmentItemInputSchema>
export type GarmentItemResponse = z.infer<typeof createGarmentItemResponseSchema>
export type GarmentItemContract = z.infer<typeof garmentItemSchema>
export type GarmentListResponse = z.infer<typeof garmentListResponseSchema>
export type SuggestGarmentTagsData = z.infer<typeof suggestGarmentTagsDataSchema>
export type SuggestGarmentTagsResponse = z.infer<typeof suggestGarmentTagsResponseSchema>
export type UpdateGarmentTagsInput = z.infer<typeof updateGarmentTagsInputSchema>
export type UpdateGarmentTagsResponse = z.infer<typeof updateGarmentTagsResponseSchema>
export type CreateOutfitCapsuleInput = z.infer<typeof createOutfitCapsuleInputSchema>
export type CapsuleGarmentContract = z.infer<typeof capsuleGarmentSchema>
export type OutfitCapsuleContract = z.infer<typeof outfitCapsuleSchema>
export type OutfitCapsuleResponse = z.infer<typeof outfitCapsuleResponseSchema>
export type ListOutfitCapsulesQuery = z.infer<typeof listOutfitCapsulesQuerySchema>
export type OutfitCapsuleListResponse = z.infer<typeof outfitCapsuleListResponseSchema>
export type UpdateOutfitCapsuleInput = z.infer<typeof updateOutfitCapsuleInputSchema>
export type FavoriteOutfitCapsuleInput = z.infer<typeof favoriteOutfitCapsuleInputSchema>

// ---------------------------------------------------------------------------
// Story 4.4: wardrobe onboarding state machine and silhouette profile
// ---------------------------------------------------------------------------

export const wardrobeOnboardingStatusEnum = z.enum([
  'not_started',
  'in_progress',
  'completed',
])

export const wardrobeOnboardingStepEnum = z.enum([
  'permission',
  'capture',
  'tagging',
  'silhouette',
  'complete',
])

export const silhouetteModeEnum = z.enum(['default_mannequin', 'my_form'])

export const silhouettePhotoStatusEnum = z.enum([
  'pending_upload',
  'bytes_uploaded',
  'processing',
  'ready',
  'failed',
])

export const silhouettePhotoFailureReasonEnum = z.enum([
  'contrast',
  'privacy_violation',
  'timeout',
  'storage_error',
])

/**
 * Cross-field lifecycle invariants, grounded directly in
 * `wardrobe-onboarding.service.ts`'s `VIRTUAL_STATE` constant and its
 * `createFirstState`/`advanceExistingState` transitions rather than
 * guessed: `not_started` only ever describes the virtual, never-persisted
 * default (`currentStep: 'permission'`, `startedAt`/`completedAt: null`,
 * `revision: 0`), and `completed` is the state machine's one terminal step
 * (`currentStep: 'complete'`, `completedAt` set exactly once, never
 * cleared). Without this, `{status: 'completed', completedAt: null}` or
 * `{status: 'not_started', currentStep: 'silhouette'}` both parse
 * successfully despite violating AC1/AC3, which independent review
 * (bmad-code-review) flagged as a real gap.
 */
const wardrobeOnboardingProgressFields = {
  usedStarterWardrobe: z.boolean(),
  garmentsCapturedCount: z.number().int().min(0),
}

/** Every step except the terminal one, derived so it cannot drift from the enum. */
const wardrobeOnboardingNonTerminalStepEnum = wardrobeOnboardingStepEnum.exclude([
  'complete',
])

export const wardrobeOnboardingStateSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        status: z.literal('not_started'),
        currentStep: z.literal('permission'),
        ...wardrobeOnboardingProgressFields,
        startedAt: z.null(),
        completedAt: z.null(),
        revision: z.literal(0),
      })
      .strict(),
    z
      .object({
        status: z.literal('in_progress'),
        currentStep: wardrobeOnboardingNonTerminalStepEnum,
        ...wardrobeOnboardingProgressFields,
        startedAt: isoTimestampSchema,
        completedAt: z.null(),
        revision: z.number().int().min(0),
      })
      .strict(),
    z
      .object({
        status: z.literal('completed'),
        currentStep: z.literal('complete'),
        ...wardrobeOnboardingProgressFields,
        startedAt: isoTimestampSchema,
        completedAt: isoTimestampSchema,
        revision: z.number().int().min(0),
      })
      .strict(),
  ])
  .openapi({
    description: [
      'One variant per lifecycle status. The correlations between status,',
      'currentStep, startedAt, completedAt and revision are expressed by the',
      'variants themselves rather than enforced by an invisible runtime check, so',
      'an invalid combination such as a completed state with a null completedAt is',
      'unrepresentable in the generated types.',
    ].join(' '),
  })

export const wardrobeOnboardingStateResponseSchema = z
  .object({
    data: wardrobeOnboardingStateSchema,
  })
  .strict()

/**
 * Forward-only step transition. `usedStarterWardrobe: true` is only valid
 * paired with `targetStep: 'silhouette'` from the `capture` step (decision 2)
 * and marks capture skipped rather than adding a distinct step value.
 */
export const updateWardrobeOnboardingStateInputSchema = z
  .object({
    targetStep: wardrobeOnboardingStepEnum,
    usedStarterWardrobe: z.boolean().optional(),
  })
  .strict()

const onboardingBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.string(),
    error: z.literal('Bad Request'),
  })
  .strict()

const onboardingForbiddenErrorSchema = z
  .object({
    statusCode: z.literal(403),
    message: z.enum(['GUARDIAN_READ_ONLY', 'GUARDIAN_CONSENT_REQUIRED']),
    error: z.literal('Forbidden'),
  })
  .strict()

const onboardingConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.literal('INVALID_STEP_TRANSITION'),
    error: z.literal('Conflict'),
  })
  .strict()

const onboardingPreconditionFailedErrorSchema = z
  .object({
    statusCode: z.literal(412),
    message: z.literal('ONBOARDING_REVISION_MISMATCH'),
    error: z.literal('Precondition Failed'),
  })
  .strict()

/**
 * `error` is optional, not absent: `parseOnboardingIfMatchHeader` raises a
 * bare `HttpException('PRECONDITION_REQUIRED', 428)`, which Nest serializes
 * with no `error` reason phrase at all (confirmed against the real
 * provider), unlike every other error schema in this file, whose Nest
 * exception classes (`ConflictException`, etc.) always add one.
 */
const onboardingPreconditionRequiredErrorSchema = z
  .object({
    statusCode: z.literal(428),
    message: z.literal('PRECONDITION_REQUIRED'),
    error: z.literal('Precondition Required').optional(),
  })
  .strict()

const silhouetteSliderInputSchema = z.number().int().min(0).max(100)

/**
 * Cross-field lifecycle invariants, grounded directly in
 * `wardrobe-silhouette.service.ts`/`silhouette-photo.processor.ts` rather
 * than guessed: `committedAt` is set once, at commit
 * (`my_form_committed_at: new Date()` in `commitMyForm`), and is never
 * cleared on a later processing failure — only a full `DELETE` clears it.
 * `failureReason` is set only by the processor's terminal `failed` branch;
 * `imageAccess` is only ever populated for `ready`. Without this,
 * `{status: 'ready', failureReason: 'contrast'}` or
 * `{status: 'failed', failureReason: null}` both parsed successfully
 * despite AC2 requiring "exactly one" documented reason, which independent
 * review (bmad-code-review) flagged as a real gap.
 */
/** Before commit: nothing downstream of the upload exists yet. */
const silhouetteMyFormUncommittedVariant = (
  status: 'pending_upload' | 'bytes_uploaded'
) =>
  z
    .object({
      status: z.literal(status),
      failureReason: z.null(),
      committedAt: z.null(),
      imageAccess: z.null(),
    })
    .strict()

export const silhouetteMyFormSchema = z
  .discriminatedUnion('status', [
    silhouetteMyFormUncommittedVariant('pending_upload'),
    silhouetteMyFormUncommittedVariant('bytes_uploaded'),
    z
      .object({
        status: z.literal('processing'),
        failureReason: z.null(),
        committedAt: isoTimestampSchema,
        imageAccess: z.null(),
      })
      .strict(),
    z
      .object({
        status: z.literal('ready'),
        failureReason: z.null(),
        committedAt: isoTimestampSchema,
        imageAccess: garmentImageAccessSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal('failed'),
        failureReason: silhouettePhotoFailureReasonEnum,
        committedAt: isoTimestampSchema,
        imageAccess: z.null(),
      })
      .strict(),
  ])
  .openapi({
    description: [
      'One variant per photo status. committedAt is present exactly on the',
      'committed statuses, failureReason exactly on failed, and imageAccess exactly',
      'on ready. Expressing this as variants rather than an invisible runtime check',
      'means a combination such as a ready photo with a null imageAccess is',
      'unrepresentable in the generated types.',
    ].join(' '),
  })

export const silhouetteProfileSchema = z
  .object({
    mode: silhouetteModeEnum,
    heightSlider: z.number().int().min(0).max(100).nullable(),
    buildSlider: z.number().int().min(0).max(100).nullable(),
    myForm: silhouetteMyFormSchema.nullable(),
    revision: z.number().int().min(0),
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const silhouetteProfileResponseSchema = z
  .object({
    data: silhouetteProfileSchema,
  })
  .strict()

export const updateSilhouetteSlidersInputSchema = z
  .object({
    heightSlider: silhouetteSliderInputSchema,
    buildSlider: silhouetteSliderInputSchema,
  })
  .strict()

export const createSilhouetteUploadUrlInputSchema = z
  .object({
    fileSizeBytes: z.number().int().min(1).max(10_485_760),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
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

export const silhouetteUploadSessionSchema = z
  .object({
    uploadSessionId: nonEmptyStringSchema,
    uploadUrl: z.string().url(),
    uploadToken: nonEmptyStringSchema,
    requiredHeaders: z
      .object({
        'content-type': z.string(),
      })
      .strict(),
    expiresAt: isoTimestampSchema,
  })
  .strict()

export const createSilhouetteUploadUrlResponseSchema = z
  .object({
    data: silhouetteUploadSessionSchema,
  })
  .strict()

export const commitSilhouettePhotoInputSchema = z
  .object({
    uploadSessionId: nonEmptyStringSchema,
    confirmsBasewearGuidance: z.literal(true),
  })
  .strict()

/**
 * The refusals a commit can answer now that it is the only place upload bytes are checked
 * (production follow-up 2026-11-19): the client PUTs straight to storage, and commit verifies
 * the stored object before anything else happens.
 */
export const uploadCommitConflictMessages = [
  'IDEMPOTENCY_KEY_REUSED',
  'UPLOAD_ALREADY_CLAIMED',
  'UPLOAD_BYTES_MISSING',
  'UPLOAD_SESSION_EXPIRED',
  // Round 4: another commit of the same session owns its publication right now. Nothing was
  // touched; the attempt stays open and a later retry replays that commit's outcome.
  'UPLOAD_IN_PROGRESS',
] as const

/**
 * Round 4: an upload-url replay found bytes already stored for the session. Staging keys take
 * one write only, so the URL cannot be signed again; the bytes are there to commit.
 */
export const UPLOAD_BYTES_PRESENT_MESSAGE = 'UPLOAD_BYTES_PRESENT'

export const uploadCommitUnprocessableMessages = [
  'IMAGE_SIZE_MISMATCH',
  'IMAGE_CHECKSUM_MISMATCH',
  'IMAGE_DIMENSIONS_INVALID',
  'IMAGE_NOT_PORTRAIT_FRAMED',
  'IMAGE_DECODE_FAILED',
] as const

export const uploadCommitConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum(uploadCommitConflictMessages),
    error: z.literal('Conflict'),
  })
  .strict()
  .openapi('UploadCommitConflictError')

export const uploadCommitUnsupportedMediaTypeErrorSchema = z
  .object({
    statusCode: z.literal(415),
    message: z.literal('UNSUPPORTED_IMAGE_TYPE'),
    error: z.literal('Unsupported Media Type'),
  })
  .strict()
  .openapi('UploadCommitUnsupportedMediaTypeError')

export const uploadCommitUnprocessableErrorSchema = z
  .object({
    statusCode: z.literal(422),
    message: z.enum(uploadCommitUnprocessableMessages),
    error: z.literal('Unprocessable Entity'),
  })
  .strict()
  .openapi('UploadCommitUnprocessableError')

const silhouetteCommitConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum([
      'CONFIRM_BASEWEAR_GUIDANCE_REQUIRED',
      ...uploadCommitConflictMessages,
    ]),
    error: z.literal('Conflict'),
  })
  .strict()
  .openapi('SilhouetteCommitConflictError')

const silhouetteBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.string(),
    error: z.literal('Bad Request'),
  })
  .strict()

const silhouetteForbiddenErrorSchema = z
  .object({
    statusCode: z.literal(403),
    message: z.enum(['GUARDIAN_READ_ONLY', 'GUARDIAN_CONSENT_REQUIRED']),
    error: z.literal('Forbidden'),
  })
  .strict()

const silhouetteNotFoundErrorSchema = z
  .object({
    statusCode: z.literal(404),
    message: z.literal('NOT_FOUND'),
    error: z.literal('Not Found'),
  })
  .strict()

const silhouetteConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum([
      'CONFIRM_BASEWEAR_GUIDANCE_REQUIRED',
      'IDEMPOTENCY_KEY_REUSED',
      'UPLOAD_SESSION_EXPIRED',
      UPLOAD_BYTES_PRESENT_MESSAGE,
    ]),
    error: z.literal('Conflict'),
  })
  .strict()

const silhouettePreconditionFailedErrorSchema = z
  .object({
    statusCode: z.literal(412),
    message: z.literal('SILHOUETTE_REVISION_MISMATCH'),
    error: z.literal('Precondition Failed'),
  })
  .strict()

/**
 * `error` is optional, not absent: `parseSilhouetteIfMatchHeader` raises the
 * same bare `HttpException('PRECONDITION_REQUIRED', 428)` as its onboarding
 * sibling (see `onboardingPreconditionRequiredErrorSchema`'s identical note).
 */
const silhouettePreconditionRequiredErrorSchema = z
  .object({
    statusCode: z.literal(428),
    message: z.literal('PRECONDITION_REQUIRED'),
    error: z.literal('Precondition Required').optional(),
  })
  .strict()

export type WardrobeOnboardingStatus = z.infer<typeof wardrobeOnboardingStatusEnum>
export type WardrobeOnboardingStep = z.infer<typeof wardrobeOnboardingStepEnum>
export type SilhouetteMode = z.infer<typeof silhouetteModeEnum>
export type SilhouettePhotoStatus = z.infer<typeof silhouettePhotoStatusEnum>
export type SilhouettePhotoFailureReason = z.infer<
  typeof silhouettePhotoFailureReasonEnum
>
export type WardrobeOnboardingStateContract = z.infer<
  typeof wardrobeOnboardingStateSchema
>
export type WardrobeOnboardingStateResponse = z.infer<
  typeof wardrobeOnboardingStateResponseSchema
>
export type UpdateWardrobeOnboardingStateInput = z.infer<
  typeof updateWardrobeOnboardingStateInputSchema
>
export type SilhouetteProfileContract = z.infer<typeof silhouetteProfileSchema>
export type SilhouetteProfileResponse = z.infer<typeof silhouetteProfileResponseSchema>
export type UpdateSilhouetteSlidersInput = z.infer<
  typeof updateSilhouetteSlidersInputSchema
>
export type CreateSilhouetteUploadUrlInput = z.infer<
  typeof createSilhouetteUploadUrlInputSchema
>
export type CreateSilhouetteUploadUrlResponse = z.infer<
  typeof createSilhouetteUploadUrlResponseSchema
>
export type CommitSilhouettePhotoInput = z.infer<typeof commitSilhouettePhotoInputSchema>

export function registerWardrobeContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  const registeredCreateUploadUrlInput = registry.register(
    'CreateGarmentUploadUrlInput',
    createGarmentUploadUrlInputSchema
  )
  const registeredCreateUploadUrlResponse = registry.register(
    'CreateGarmentUploadUrlResponse',
    createGarmentUploadUrlResponseSchema
  )
  const registeredCreateGarmentInput = registry.register(
    'CreateGarmentItemInput',
    createGarmentItemInputSchema
  )
  const registeredCreateGarmentResponse = registry.register(
    'CreateGarmentItemResponse',
    createGarmentItemResponseSchema
  )
  const registeredGarmentListResponse = registry.register(
    'GarmentListResponse',
    garmentListResponseSchema
  )
  const registeredSuggestGarmentTagsResponse = registry.register(
    'SuggestGarmentTagsResponse',
    suggestGarmentTagsResponseSchema
  )
  const registeredUpdateGarmentTagsInput = registry.register(
    'UpdateGarmentTagsInput',
    updateGarmentTagsInputSchema
  )
  const registeredUpdateGarmentTagsResponse = registry.register(
    'UpdateGarmentTagsResponse',
    updateGarmentTagsResponseSchema
  )
  const registeredGarmentIdBadRequestError = registry.register(
    'GarmentIdBadRequestError',
    garmentIdBadRequestErrorSchema
  )
  const registeredGarmentTagsBadRequestError = registry.register(
    'GarmentTagsBadRequestError',
    garmentTagsBadRequestErrorSchema
  )
  const registeredGarmentTaggingUnauthorizedError = registry.register(
    'GarmentTaggingUnauthorizedError',
    garmentTaggingUnauthorizedErrorSchema
  )
  const registeredGarmentTaggingForbiddenError = registry.register(
    'GarmentTaggingForbiddenError',
    garmentTaggingForbiddenErrorSchema
  )
  const registeredGarmentTaggingNotFoundError = registry.register(
    'GarmentTaggingNotFoundError',
    garmentTaggingNotFoundErrorSchema
  )
  const registeredGarmentSuggestionConflictError = registry.register(
    'GarmentSuggestionConflictError',
    garmentSuggestionConflictErrorSchema
  )
  const registeredGarmentUpdateConflictError = registry.register(
    'GarmentUpdateConflictError',
    garmentUpdateConflictErrorSchema
  )
  const registeredGarmentTaggingUnavailableError = registry.register(
    'GarmentTaggingUnavailableError',
    garmentTaggingUnavailableErrorSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/garments',
    tags: ['wardrobe'],
    summary: 'List persisted garments for the authenticated wardrobe',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Persisted wardrobe garments.',
        content: {
          'application/json': {
            schema: registeredGarmentListResponse,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent required.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/garments/{garmentId}/suggest-tags',
    tags: ['wardrobe'],
    summary:
      'Retrieve algorithmically inferred tag suggestions for an awaiting-tags garment',
    security: [{ bearerAuth: [] }],
    request: {
      params: garmentIdPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Tag suggestions retrieved successfully.',
        content: {
          'application/json': {
            schema: registeredSuggestGarmentTagsResponse,
          },
        },
      },
      400: {
        description: 'Invalid garment ID.',
        content: {
          'application/json': {
            schema: registeredGarmentIdBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingUnauthorizedError,
          },
        },
      },
      403: {
        description: 'Guardian consent required or access forbidden.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingForbiddenError,
          },
        },
      },
      404: {
        description: 'Garment not found or owned by another user.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingNotFoundError,
          },
        },
      },
      409: {
        description: 'Garment analysis pending or not taggable.',
        content: {
          'application/json': { schema: registeredGarmentSuggestionConflictError },
        },
      },
      503: {
        description: 'Tagging inference unavailable.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingUnavailableError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/wardrobe/garments/{garmentId}/tags',
    tags: ['wardrobe'],
    summary: 'Confirm or edit garment category, material, and comfort tags',
    security: [{ bearerAuth: [] }],
    request: {
      params: garmentIdPathParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateGarmentTagsInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Garment tags updated successfully.',
        content: {
          'application/json': {
            schema: registeredUpdateGarmentTagsResponse,
          },
        },
      },
      400: {
        description: 'Invalid garment tags input.',
        content: {
          'application/json': {
            schema: registeredGarmentTagsBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingUnauthorizedError,
          },
        },
      },
      403: {
        description: 'Guardian consent required or access forbidden.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingForbiddenError,
          },
        },
      },
      404: {
        description: 'Garment not found or owned by another user.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingNotFoundError,
          },
        },
      },
      409: {
        description: 'Garment analysis pending or not taggable.',
        content: {
          'application/json': { schema: registeredGarmentUpdateConflictError },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/upload-url',
    tags: ['wardrobe'],
    summary: 'Allocate a private garment upload session and signed upload URL',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z.string().uuid(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateUploadUrlInput,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Upload session created successfully.',
        content: {
          'application/json': {
            schema: registeredCreateUploadUrlResponse,
          },
        },
      },
      200: {
        description: 'Idempotent upload session replay.',
        content: {
          'application/json': {
            schema: registeredCreateUploadUrlResponse,
          },
        },
      },
      400: {
        description: 'Invalid upload declaration.',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent required or upload forbidden.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      409: {
        description:
          'Idempotency key reused, upload session expired, or bytes already stored for a replayed session (UPLOAD_BYTES_PRESENT).',
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/garments',
    tags: ['wardrobe'],
    summary: 'Commit uploaded garment bytes and initiate background processing',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z.string().uuid(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateGarmentInput,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Garment committed and moved to processing.',
        content: {
          'application/json': {
            schema: registeredCreateGarmentResponse,
          },
        },
      },
      200: {
        description: 'Idempotent garment commit replay.',
        content: {
          'application/json': {
            schema: registeredCreateGarmentResponse,
          },
        },
      },
      400: {
        description: 'Invalid garment commit payload.',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent required.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Upload session not found.',
        content: {
          'application/json': {
            schema: commonSchemas.notFoundHttpErrorSchema,
          },
        },
      },
      415: {
        description: 'The uploaded bytes are not the declared image type.',
        content: {
          'application/json': { schema: uploadCommitUnsupportedMediaTypeErrorSchema },
        },
      },
      422: {
        description:
          'The uploaded bytes do not match the declared size, checksum or dimensions, or do not decode.',
        content: {
          'application/json': { schema: uploadCommitUnprocessableErrorSchema },
        },
      },
      409: {
        description:
          'Idempotency key reused, session expired, upload claimed, no uploaded bytes yet (UPLOAD_BYTES_MISSING), or another commit of the session is publishing it (UPLOAD_IN_PROGRESS).',
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
    },
  })

  const registeredCreateOutfitCapsuleInput = registry.register(
    'CreateOutfitCapsuleInput',
    createOutfitCapsuleInputSchema
  )
  const registeredOutfitCapsuleResponse = registry.register(
    'OutfitCapsuleResponse',
    outfitCapsuleResponseSchema
  )
  const registeredOutfitCapsuleListResponse = registry.register(
    'OutfitCapsuleListResponse',
    outfitCapsuleListResponseSchema
  )
  const registeredUpdateOutfitCapsuleInput = registry.register(
    'UpdateOutfitCapsuleInput',
    updateOutfitCapsuleInputSchema
  )
  const registeredFavoriteOutfitCapsuleInput = registry.register(
    'FavoriteOutfitCapsuleInput',
    favoriteOutfitCapsuleInputSchema
  )
  const registeredCapsuleBadRequestError = registry.register(
    'CapsuleBadRequestError',
    capsuleBadRequestErrorSchema
  )
  const registeredCapsuleForbiddenError = registry.register(
    'CapsuleForbiddenError',
    capsuleForbiddenErrorSchema
  )
  const registeredCapsuleNotFoundError = registry.register(
    'CapsuleNotFoundError',
    capsuleNotFoundErrorSchema
  )
  const registeredCapsuleConflictError = registry.register(
    'CapsuleConflictError',
    capsuleConflictErrorSchema
  )
  const registeredCapsulePreconditionFailedError = registry.register(
    'CapsulePreconditionFailedError',
    capsulePreconditionFailedErrorSchema
  )
  const registeredCapsulePreconditionRequiredError = registry.register(
    'CapsulePreconditionRequiredError',
    capsulePreconditionRequiredErrorSchema
  )

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules',
    tags: ['wardrobe'],
    summary: 'Create a new outfit capsule for an owner wardrobe',
    security: [{ bearerAuth: [] }],
    request: {
      params: ownerUserIdPathParamsSchema,
      headers: z.object({
        'idempotency-key': z.string().uuid().optional(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateOutfitCapsuleInput,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Capsule created successfully.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      200: {
        description: 'Idempotent creation replay.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      400: {
        description: 'Invalid capsule creation payload.',
        content: {
          'application/json': {
            schema: registeredCapsuleBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent required or guardian read-only access.',
        content: {
          'application/json': {
            schema: registeredCapsuleForbiddenError,
          },
        },
      },
      404: {
        description: 'Owner user not found or unauthorized.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
      409: {
        description:
          'Ineligible garments or idempotency key reused with different payload.',
        content: {
          'application/json': {
            schema: registeredCapsuleConflictError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules',
    tags: ['wardrobe'],
    summary: 'List and filter outfit capsules for an owner wardrobe',
    security: [{ bearerAuth: [] }],
    request: {
      params: ownerUserIdPathParamsSchema,
      query: listOutfitCapsulesQuerySchema,
    },
    responses: {
      200: {
        description: 'List of outfit capsules.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleListResponse,
          },
        },
      },
      400: {
        description: 'Invalid query parameters.',
        content: {
          'application/json': {
            schema: registeredCapsuleBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Owner user not found or unauthorized.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
    tags: ['wardrobe'],
    summary: 'Get details of a specific outfit capsule',
    security: [{ bearerAuth: [] }],
    request: {
      params: capsuleIdPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Outfit capsule details.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Capsule or owner not found or unauthorized.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
    tags: ['wardrobe'],
    summary: 'Update metadata or constituent garments of an outfit capsule',
    security: [{ bearerAuth: [] }],
    request: {
      params: capsuleIdPathParamsSchema,
      headers: z.object({
        'if-match': z.string(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateOutfitCapsuleInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Capsule updated successfully.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      400: {
        description: 'Invalid update payload.',
        content: {
          'application/json': {
            schema: registeredCapsuleBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian read-only or consent forbidden.',
        content: {
          'application/json': {
            schema: registeredCapsuleForbiddenError,
          },
        },
      },
      404: {
        description: 'Capsule or owner not found.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
      409: {
        description: 'Ineligible garments.',
        content: {
          'application/json': {
            schema: registeredCapsuleConflictError,
          },
        },
      },
      412: {
        description: 'Stale ETag / capsule revision mismatch.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionRequiredError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}/favorite',
    tags: ['wardrobe'],
    summary: 'Set favorite status of an outfit capsule',
    security: [{ bearerAuth: [] }],
    request: {
      params: capsuleIdPathParamsSchema,
      headers: z.object({
        'if-match': z.string(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredFavoriteOutfitCapsuleInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Capsule favorite status updated.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      400: {
        description: 'Invalid request body.',
        content: {
          'application/json': {
            schema: registeredCapsuleBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian read-only or consent forbidden.',
        content: {
          'application/json': {
            schema: registeredCapsuleForbiddenError,
          },
        },
      },
      404: {
        description: 'Capsule or owner not found.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
      412: {
        description: 'Stale ETag / capsule revision mismatch.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionRequiredError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
    tags: ['wardrobe'],
    summary: 'Delete an outfit capsule and its join records',
    security: [{ bearerAuth: [] }],
    request: {
      params: capsuleIdPathParamsSchema,
      headers: z.object({
        'if-match': z.string(),
      }),
    },
    responses: {
      204: {
        description: 'Capsule deleted successfully.',
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian read-only or consent forbidden.',
        content: {
          'application/json': {
            schema: registeredCapsuleForbiddenError,
          },
        },
      },
      404: {
        description: 'Capsule or owner not found.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
      412: {
        description: 'Stale ETag / capsule revision mismatch.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionRequiredError,
          },
        },
      },
    },
  })

  // ---------------------------------------------------------------------
  // Story 4.4: wardrobe onboarding state machine
  // ---------------------------------------------------------------------

  const registeredWardrobeOnboardingStateResponse = registry.register(
    'WardrobeOnboardingStateResponse',
    wardrobeOnboardingStateResponseSchema
  )
  const registeredUpdateWardrobeOnboardingStateInput = registry.register(
    'UpdateWardrobeOnboardingStateInput',
    updateWardrobeOnboardingStateInputSchema
  )
  const registeredOnboardingBadRequestError = registry.register(
    'OnboardingBadRequestError',
    onboardingBadRequestErrorSchema
  )
  const registeredOnboardingForbiddenError = registry.register(
    'OnboardingForbiddenError',
    onboardingForbiddenErrorSchema
  )
  const registeredOnboardingConflictError = registry.register(
    'OnboardingConflictError',
    onboardingConflictErrorSchema
  )
  const registeredOnboardingPreconditionFailedError = registry.register(
    'OnboardingPreconditionFailedError',
    onboardingPreconditionFailedErrorSchema
  )
  const registeredOnboardingPreconditionRequiredError = registry.register(
    'OnboardingPreconditionRequiredError',
    onboardingPreconditionRequiredErrorSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/onboarding',
    tags: ['wardrobe'],
    summary:
      'Read wardrobe onboarding progress (virtual not_started default when absent)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Current onboarding state, real or virtual not_started default.',
        content: {
          'application/json': {
            schema: registeredWardrobeOnboardingStateResponse,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent forbidden.',
        content: {
          'application/json': {
            schema: registeredOnboardingForbiddenError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/wardrobe/onboarding',
    tags: ['wardrobe'],
    summary: 'Advance the onboarding state machine one forward-only step',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'if-match': z.string(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateWardrobeOnboardingStateInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Onboarding state advanced (or safe no-op replay).',
        content: {
          'application/json': {
            schema: registeredWardrobeOnboardingStateResponse,
          },
        },
      },
      400: {
        description: 'Invalid step transition payload.',
        content: {
          'application/json': {
            schema: registeredOnboardingBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent forbidden.',
        content: {
          'application/json': {
            schema: registeredOnboardingForbiddenError,
          },
        },
      },
      409: {
        description: 'Step transition is not forward-reachable from the current step.',
        content: {
          'application/json': {
            schema: registeredOnboardingConflictError,
          },
        },
      },
      412: {
        description: 'Stale ETag / onboarding revision mismatch.',
        content: {
          'application/json': {
            schema: registeredOnboardingPreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredOnboardingPreconditionRequiredError,
          },
        },
      },
    },
  })

  // ---------------------------------------------------------------------
  // Story 4.4: silhouette sliders and "My Form" photo pipeline
  // ---------------------------------------------------------------------

  const registeredSilhouetteProfileResponse = registry.register(
    'SilhouetteProfileResponse',
    silhouetteProfileResponseSchema
  )
  const registeredUpdateSilhouetteSlidersInput = registry.register(
    'UpdateSilhouetteSlidersInput',
    updateSilhouetteSlidersInputSchema
  )
  const registeredCreateSilhouetteUploadUrlInput = registry.register(
    'CreateSilhouetteUploadUrlInput',
    createSilhouetteUploadUrlInputSchema
  )
  const registeredCreateSilhouetteUploadUrlResponse = registry.register(
    'CreateSilhouetteUploadUrlResponse',
    createSilhouetteUploadUrlResponseSchema
  )
  const registeredCommitSilhouettePhotoInput = registry.register(
    'CommitSilhouettePhotoInput',
    commitSilhouettePhotoInputSchema
  )
  const registeredSilhouetteBadRequestError = registry.register(
    'SilhouetteBadRequestError',
    silhouetteBadRequestErrorSchema
  )
  const registeredSilhouetteForbiddenError = registry.register(
    'SilhouetteForbiddenError',
    silhouetteForbiddenErrorSchema
  )
  const registeredSilhouetteNotFoundError = registry.register(
    'SilhouetteNotFoundError',
    silhouetteNotFoundErrorSchema
  )
  const registeredSilhouetteConflictError = registry.register(
    'SilhouetteConflictError',
    silhouetteConflictErrorSchema
  )
  const registeredSilhouettePreconditionFailedError = registry.register(
    'SilhouettePreconditionFailedError',
    silhouettePreconditionFailedErrorSchema
  )
  const registeredSilhouettePreconditionRequiredError = registry.register(
    'SilhouettePreconditionRequiredError',
    silhouettePreconditionRequiredErrorSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/silhouette',
    tags: ['wardrobe'],
    summary: 'Read the silhouette profile (sliders and/or My Form photo state)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Current silhouette profile, real or virtual default.',
        content: {
          'application/json': {
            schema: registeredSilhouetteProfileResponse,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent forbidden (WardrobeUploadGuard).',
        content: {
          'application/json': {
            schema: registeredSilhouetteForbiddenError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/wardrobe/silhouette',
    tags: ['wardrobe'],
    summary: 'Upsert mannequin slider values',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'if-match': z.string(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateSilhouetteSlidersInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Sliders saved (or safe no-op replay).',
        content: {
          'application/json': {
            schema: registeredSilhouetteProfileResponse,
          },
        },
      },
      400: {
        description: 'Invalid slider values.',
        content: {
          'application/json': {
            schema: registeredSilhouetteBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent forbidden.',
        content: {
          'application/json': {
            schema: registeredSilhouetteForbiddenError,
          },
        },
      },
      412: {
        description: 'Stale ETag / silhouette revision mismatch.',
        content: {
          'application/json': {
            schema: registeredSilhouettePreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredSilhouettePreconditionRequiredError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/silhouette/my-form/upload-url',
    tags: ['wardrobe'],
    summary: 'Allocate an upload session for a "My Form" full-body photo',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z.string().uuid(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateSilhouetteUploadUrlInput,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Upload session allocated.',
        content: {
          'application/json': {
            schema: registeredCreateSilhouetteUploadUrlResponse,
          },
        },
      },
      200: {
        description: 'Replayed idempotent upload session allocation.',
        content: {
          'application/json': {
            schema: registeredCreateSilhouetteUploadUrlResponse,
          },
        },
      },
      400: {
        description: 'Invalid upload declaration.',
        content: {
          'application/json': {
            schema: registeredSilhouetteBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent forbidden.',
        content: {
          'application/json': {
            schema: registeredSilhouetteForbiddenError,
          },
        },
      },
      409: {
        description:
          'Idempotency key reused with a different payload, the session expired, or bytes already stored for a replayed session (UPLOAD_BYTES_PRESENT).',
        content: {
          'application/json': {
            schema: registeredSilhouetteConflictError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/silhouette/my-form/commit',
    tags: ['wardrobe'],
    summary: 'Commit uploaded My Form photo bytes and enqueue processing',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z.string().uuid(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCommitSilhouettePhotoInput,
          },
        },
      },
    },
    responses: {
      // Real provider verification confirmed `POST /my-form/commit` returns
      // 201 for a first commit and 200 for an idempotent replay, via the
      // controller's `res.status(result.replayed ? 200 : 201)`, matching the
      // garment-commit sibling this endpoint is documented to mirror
      // (`POST /api/v1/wardrobe/garments` also registers 201-first/200-replay).
      201: {
        description: 'Photo committed and queued for processing.',
        content: {
          'application/json': {
            schema: registeredSilhouetteProfileResponse,
          },
        },
      },
      200: {
        description: 'Replayed idempotent commit (already committed with this key).',
        content: {
          'application/json': {
            schema: registeredSilhouetteProfileResponse,
          },
        },
      },
      400: {
        description: 'Invalid commit payload.',
        content: {
          'application/json': {
            schema: registeredSilhouetteBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent forbidden.',
        content: {
          'application/json': {
            schema: registeredSilhouetteForbiddenError,
          },
        },
      },
      404: {
        description: 'Upload session not found or expired.',
        content: {
          'application/json': {
            schema: registeredSilhouetteNotFoundError,
          },
        },
      },
      409: {
        description:
          'Basewear guidance not confirmed, idempotency key reused, upload already claimed, no uploaded bytes yet, or the session expired.',
        content: {
          'application/json': {
            schema: silhouetteCommitConflictErrorSchema,
          },
        },
      },
      415: {
        description: 'The uploaded bytes are not the declared image type.',
        content: {
          'application/json': { schema: uploadCommitUnsupportedMediaTypeErrorSchema },
        },
      },
      422: {
        description:
          'The uploaded bytes do not match the declaration, do not decode, or are not portrait framed.',
        content: {
          'application/json': { schema: uploadCommitUnprocessableErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/wardrobe/silhouette/my-form',
    tags: ['wardrobe'],
    summary:
      'Immediately hard-delete the My Form photo and fall back to default_mannequin',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'if-match': z.string(),
      }),
    },
    responses: {
      200: {
        description: 'My Form photo deleted; profile reverted to default_mannequin.',
        content: {
          'application/json': {
            schema: registeredSilhouetteProfileResponse,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent forbidden.',
        content: {
          'application/json': {
            schema: registeredSilhouetteForbiddenError,
          },
        },
      },
      412: {
        description: 'Stale ETag / silhouette revision mismatch.',
        content: {
          'application/json': {
            schema: registeredSilhouettePreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredSilhouettePreconditionRequiredError,
          },
        },
      },
    },
  })
}

export interface UploadGarmentBytesOptions {
  uploadUrl: string
  uploadToken: string
  bearerToken: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  body: ArrayBuffer | Blob
  onProgress?: (bytesUploaded: number, totalBytes: number) => void
  signal?: AbortSignal
  timeoutMs?: number
  fetchFn?: typeof fetch
  /**
   * The base this client sends every other API request to ('' for the web app's own origin).
   * When set, an upload URL on the API's own path (/api/v1/...) goes there whatever host the
   * API named in it: the browser reaches the API only through the web app's /api/v1 rewrite,
   * and production once named http://localhost:3001 (tester report 2026-11-17). Upload URLs on
   * other paths, such as storage signed URLs, are used as given.
   */
  apiBaseUrl?: string
  /**
   * Sent as the object's `cache-control`. Wardrobe uploads pass `private, max-age=0`: the
   * object is a member's private photo, and storage keeps the header with the object.
   */
  cacheControl?: string
  /**
   * Treat storage's "already exists" answer as uploaded. A signed URL writes one object and
   * never overwrites, so a retry after a PUT whose answer was lost finds the object already
   * there; commit then verifies the stored bytes against the declared sha256, which makes
   * accepting it safe. Only for flows whose commit verifies the bytes.
   */
  acceptExistingObject?: boolean
}

/** The `cacheControl` every wardrobe, My Form and selfie upload sends. */
export const WARDROBE_UPLOAD_CACHE_CONTROL = 'private, max-age=0'

/** Storage's answer to a PUT whose object already exists: 409, or 400 naming 409/Duplicate. */
async function isStorageDuplicate(response: Response): Promise<boolean> {
  if (response.status === 409) return true
  if (response.status !== 400) return false
  try {
    const body = (await response.clone().json()) as {
      statusCode?: unknown
      error?: unknown
    }
    return String(body.statusCode) === '409' || body.error === 'Duplicate'
  } catch {
    return false
  }
}

const API_UPLOAD_PATH = /^\/api\/v1\//

/** The URL a client sends upload bytes to; see UploadGarmentBytesOptions.apiBaseUrl. */
export function resolveApiUploadUrl(uploadUrl: string, apiBaseUrl?: string): string {
  if (apiBaseUrl === undefined) return uploadUrl
  let named: URL
  try {
    named = new URL(uploadUrl)
  } catch {
    return uploadUrl
  }
  if (!API_UPLOAD_PATH.test(named.pathname)) return uploadUrl
  return `${apiBaseUrl.replace(/\/+$/, '')}${named.pathname}${named.search}`
}

export async function uploadGarmentBytes({
  uploadUrl,
  apiBaseUrl,
  uploadToken,
  bearerToken,
  mimeType,
  body,
  onProgress,
  signal,
  timeoutMs,
  fetchFn = globalThis.fetch,
  cacheControl,
  acceptExistingObject = false,
}: UploadGarmentBytesOptions): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    'X-Upload-Token': uploadToken,
    'Content-Type': mimeType,
  }
  if (cacheControl !== undefined) headers['Cache-Control'] = cacheControl

  const totalBytes = 'byteLength' in body ? body.byteLength : body.size

  const perform = async (requestSignal?: AbortSignal) => {
    const response = await fetchFn(resolveApiUploadUrl(uploadUrl, apiBaseUrl), {
      method: 'PUT',
      headers,
      body,
      signal: requestSignal,
    })

    if (!response.ok) {
      if (acceptExistingObject && (await isStorageDuplicate(response))) {
        return
      }
      let errorMessage = `Upload failed with HTTP ${response.status}`
      try {
        const errorJson = (await response.json()) as { error?: { message?: string } }
        if (errorJson?.error?.message) {
          errorMessage = errorJson.error.message
        }
      } catch {
        // JSON parse fallback
      }
      throw new Error(errorMessage)
    }
  }
  try {
    if (timeoutMs === undefined) await perform(signal)
    else await withRequestDeadline(timeoutMs, [signal], perform)
  } finally {
    // Fetch exposes completion only. Use XMLHttpRequest.upload for incremental web progress.
    onProgress?.(totalBytes, totalBytes)
  }
}

/**
 * One logical garment, My Form or selfie upload, kept across the member's retries of it. A
 * retry reuses both idempotency keys: a commit whose answer was lost replays the committed
 * result, and an allocation whose answer was lost replays the same session. The keys live as
 * long as the outcome is ambiguous; once the server ends the attempt (expired, rejected, or any
 * other terminal answer) it is forgotten, and the next upload of the same photo gets fresh keys.
 */
export interface DirectUploadAttempt<TAllocation> {
  readonly allocateKey: string
  readonly commitKey: string
  /** The session this attempt was given; null until an allocation answer arrives. */
  allocation: TAllocation | null
}

export interface DirectUploadSteps<TAllocation, TResult> {
  allocate(idempotencyKey: string): Promise<TAllocation>
  /** PUTs the bytes to the allocation's signed storage URL. */
  upload(allocation: TAllocation): Promise<void>
  commit(allocation: TAllocation, idempotencyKey: string): Promise<TResult>
  /** True when commit answered `UPLOAD_BYTES_MISSING`: storage holds nothing for the session. */
  isBytesMissing(error: unknown): boolean | Promise<boolean>
}

/**
 * Runs one attempt. The first run allocates, uploads and commits. A retry of an attempt that
 * already holds an allocation commits first, because the bytes or even the commit may already
 * have landed with only the answer lost; it re-uploads only when commit reports the bytes
 * missing. A staging key takes its first write only: a repeated PUT is refused as a duplicate,
 * which `uploadGarmentBytes` (with `acceptExistingObject`) reads as uploaded, and commit then
 * verifies the stored bytes against the declared sha256.
 */
export async function runDirectUploadAttempt<TAllocation, TResult>(
  attempt: DirectUploadAttempt<TAllocation>,
  steps: DirectUploadSteps<TAllocation, TResult>
): Promise<TResult> {
  let allocation = attempt.allocation
  if (allocation) {
    try {
      return await steps.commit(allocation, attempt.commitKey)
    } catch (error) {
      if (!(await steps.isBytesMissing(error))) throw error
    }
  } else {
    allocation = await steps.allocate(attempt.allocateKey)
    attempt.allocation = allocation
  }
  await steps.upload(allocation)
  return steps.commit(allocation, attempt.commitKey)
}

/**
 * The open upload attempts of one flow, keyed by the signed-in account and by what identifies a
 * retry of the same upload (the prepared image's fingerprint). An attempt is forgotten when it
 * succeeds or fails for good, so uploading the same photo again later is a new upload. Bounded,
 * oldest first, so abandoned attempts cannot accumulate; the map is the only record of which
 * attempts are open, so an evicted or cleared attempt leaves nothing behind.
 */
export class DirectUploadAttempts<TAllocation> {
  private readonly attempts = new Map<string, DirectUploadAttempt<TAllocation>>()

  constructor(
    private readonly newKey: () => string,
    private readonly limit = 8
  ) {}

  private static entryKey(account: string | null, id: string): string {
    return JSON.stringify([account, id])
  }

  /** The open attempt for `id` under `account`, or a new one with fresh keys. */
  open(account: string | null, id: string): DirectUploadAttempt<TAllocation> {
    const key = DirectUploadAttempts.entryKey(account, id)
    const existing = this.attempts.get(key)
    if (existing) return existing
    const attempt: DirectUploadAttempt<TAllocation> = {
      allocateKey: this.newKey(),
      commitKey: this.newKey(),
      allocation: null,
    }
    this.attempts.set(key, attempt)
    while (this.attempts.size > this.limit) {
      const oldest = this.attempts.keys().next().value
      if (oldest === undefined) break
      this.attempts.delete(oldest)
    }
    return attempt
  }

  /**
   * Forgets `attempt`: it succeeded, or failed in a way no retry of it can fix. Only that exact
   * attempt is removed, so a late answer for one that was already replaced leaves the newer
   * attempt open.
   */
  close(
    account: string | null,
    id: string,
    attempt: DirectUploadAttempt<TAllocation>
  ): void {
    const key = DirectUploadAttempts.entryKey(account, id)
    if (this.attempts.get(key) === attempt) this.attempts.delete(key)
  }

  /** Forgets every open attempt. */
  clear(): void {
    this.attempts.clear()
  }

  get size(): number {
    return this.attempts.size
  }
}

/** The signed-in account an upload began under, and the session epoch it began in. */
export interface UploadAttemptSession {
  readonly account: string | null
  readonly epoch: number
}

/**
 * Thrown when the signed-in session changed (sign-out, a switch to another account, or an
 * auth state change the client noticed) while an upload was under way. The attempt belonged
 * to the previous session, so nothing it learned is kept and nothing more is sent for it.
 */
export class UploadSessionChangedError extends Error {
  constructor() {
    super(
      'You signed out or switched accounts during this upload. Sign in and try again.'
    )
    this.name = 'UploadSessionChangedError'
  }
}

/** Classifies a failed step for {@link DirectUploadAttemptRegistry.run}. */
export interface DirectUploadFailureClassifier {
  /** True when commit answered `UPLOAD_BYTES_MISSING`. */
  isBytesMissing(error: unknown): boolean | Promise<boolean>
  /** True when the server ended the attempt, so no retry of it can succeed. */
  isTerminal(error: unknown): boolean
  /**
   * How the server ended the attempt, when it did so definitively: `session` for a session that
   * expired, ended or cannot be signed again, `rejected` for stored bytes commit refused. Null
   * for anything else (an ambiguous fault, or a refusal a fresh attempt cannot fix).
   */
  ending(error: unknown): UploadAttemptEnding | null
}

/**
 * Every flow's open upload attempts on one client, scoped to the signed-in account. The client
 * reports each account change (sign-in, sign-out, a switch through an auth state change); a
 * change forgets every attempt of every flow and starts a new epoch. A flow takes a
 * {@link UploadAttemptSession} before it opens a picker or camera, binds the photo it gets back
 * and anything the member confirmed for it to that session, and resolves its bearer token for
 * it with {@link bearerFor}. Every answer that arrives after the epoch moved is fenced: it is
 * discarded and the run fails with {@link UploadSessionChangedError}, so one account's photo
 * never uploads under another account and an old account's late allocation can never be found
 * by the next account's upload of the same photo.
 */
export class DirectUploadAttemptRegistry {
  private account: string | null = null
  private epoch = 0
  private readonly stores = new Set<DirectUploadAttempts<unknown>>()
  private readonly listeners = new Set<() => void>()

  /** A new flow store whose fresh keys come from `newKey`. */
  createStore<TAllocation>(newKey: () => string, limit?: number) {
    const store = new DirectUploadAttempts<TAllocation>(newKey, limit)
    this.stores.add(store as DirectUploadAttempts<unknown>)
    return store
  }

  /** The current account and epoch, taken by a flow together with its bearer token. */
  session(): UploadAttemptSession {
    return { account: this.account, epoch: this.epoch }
  }

  /** Reports the signed-in account (null when signed out); a change forgets every attempt. */
  setAccount(account: string | null): void {
    if (account === this.account) return
    this.account = account
    this.forgetAll()
  }

  /**
   * Forgets every open attempt of every flow, fences every upload still under way, and tells
   * every subscriber, so a picked photo or confirmation bound to the old epoch is dropped.
   */
  forgetAll(): void {
    this.epoch += 1
    for (const store of this.stores) store.clear()
    for (const listener of [...this.listeners]) listener()
  }

  /** Calls `listener` after every epoch change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** True while the session's account is still signed in and its epoch has not moved. */
  isCurrent(session: UploadAttemptSession): boolean {
    return session.epoch === this.epoch && session.account === this.account
  }

  private assertCurrent(session: UploadAttemptSession): void {
    if (!this.isCurrent(session)) throw new UploadSessionChangedError()
  }

  /**
   * Resolves the bearer token for the account `session` captured. Refuses with
   * {@link UploadSessionChangedError} when the session is already stale, and again when the
   * account changed while `resolve` ran (resolving can itself notice a switch to another
   * account), so an upload never pairs one account's photo with another account's token.
   */
  async bearerFor<TBearer>(
    session: UploadAttemptSession,
    resolve: () => TBearer | Promise<TBearer>
  ): Promise<TBearer> {
    this.assertCurrent(session)
    const bearer = await resolve()
    this.assertCurrent(session)
    return bearer
  }

  /**
   * Runs the attempt `id` names under the session's account: a first run allocates, uploads
   * and commits; a retry of an attempt that already holds its allocation commits first. The
   * attempt is forgotten on success and on a terminal failure; an ambiguous failure (a network
   * fault, timeout, abort, 5xx, or a commit another request is still publishing) keeps it, with
   * its allocation and keys, for the member's retry.
   */
  async run<TAllocation, TResult>(
    store: DirectUploadAttempts<TAllocation>,
    session: UploadAttemptSession,
    id: string,
    steps: Omit<DirectUploadSteps<TAllocation, TResult>, 'isBytesMissing'>,
    classify: DirectUploadFailureClassifier
  ): Promise<TResult> {
    this.assertCurrent(session)
    const attempt = store.open(session.account, id)
    // An attempt the member is retrying already holds the session an earlier run was given.
    const resumed = attempt.allocation !== null
    try {
      return await this.runAttempt(store, session, id, attempt, steps, classify)
    } catch (error) {
      if (!shouldRestartUploadAttempt(classify.ending(error), resumed)) throw error
      // The server ended the attempt for good, and runAttempt has forgotten it: the same
      // Retry or pick starts one fresh attempt (new allocation and keys, PUT, commit) at once,
      // so the member does not tap again. A failure of that fresh attempt is surfaced as is.
      store.close(session.account, id, attempt)
      this.assertCurrent(session)
      const fresh = store.open(session.account, id)
      return this.runAttempt(store, session, id, fresh, steps, classify)
    }
  }

  private async runAttempt<TAllocation, TResult>(
    store: DirectUploadAttempts<TAllocation>,
    session: UploadAttemptSession,
    id: string,
    attempt: DirectUploadAttempt<TAllocation>,
    steps: Omit<DirectUploadSteps<TAllocation, TResult>, 'isBytesMissing'>,
    classify: DirectUploadFailureClassifier
  ): Promise<TResult> {
    const fenced = <TArgs extends unknown[], TOut>(
      step: (...args: TArgs) => Promise<TOut>
    ) => {
      return async (...args: TArgs): Promise<TOut> => {
        let result: TOut
        try {
          result = await step(...args)
        } catch (error) {
          this.assertCurrent(session)
          throw error
        }
        this.assertCurrent(session)
        return result
      }
    }
    try {
      const result = await runDirectUploadAttempt(attempt, {
        allocate: fenced((key: string) => steps.allocate(key)),
        upload: fenced((allocation: TAllocation) => steps.upload(allocation)),
        commit: fenced((allocation: TAllocation, key: string) =>
          steps.commit(allocation, key)
        ),
        isBytesMissing: (error) => classify.isBytesMissing(error),
      })
      store.close(session.account, id, attempt)
      return result
    } catch (error) {
      if (classify.isTerminal(error)) store.close(session.account, id, attempt)
      throw error
    }
  }
}

/**
 * How the server ended an attempt for good: `session` when its session expired, ended or can no
 * longer be signed, `rejected` when commit refused the stored bytes.
 */
export type UploadAttemptEnding = 'session' | 'rejected'

const SESSION_ENDING_CODES: ReadonlySet<string> = new Set([
  'UPLOAD_SESSION_EXPIRED',
  'UPLOAD_SESSION_NOT_FOUND',
  'UPLOAD_ALREADY_CLAIMED',
  'IDEMPOTENCY_KEY_REUSED',
  UPLOAD_BYTES_PRESENT_MESSAGE,
])

/**
 * Round 5: the palette selfie commit answers a refusal of the stored bytes with 400 and one of
 * these codes, and ends the session (`palette-advisor.service.ts`, `mapImageValidationError`).
 * Only these codes: any other 400 (`INVALID_UPLOAD_DECLARATION`, say) is no image rejection.
 */
const BAD_REQUEST_IMAGE_REJECTION_CODES: ReadonlySet<string> = new Set([
  'IMAGE_CHECKSUM_MISMATCH',
  'IMAGE_DIMENSIONS_INVALID',
  'IMAGE_DECODE_FAILED',
])

/** Classifies a failed answer as a definitive end of its attempt, or null. */
export function uploadAttemptEnding(
  status: number | null | undefined,
  code: string | null | undefined
): UploadAttemptEnding | null {
  if (code && SESSION_ENDING_CODES.has(code)) return 'session'
  if (
    status === 415 ||
    (status === 422 && typeof code === 'string' && /^IMAGE_/.test(code)) ||
    (status === 400 &&
      typeof code === 'string' &&
      BAD_REQUEST_IMAGE_REJECTION_CODES.has(code))
  ) {
    return 'rejected'
  }
  return null
}

/**
 * Whether a run starts one fresh attempt after the server ended this one. An ended session
 * always restarts. A rejection restarts only when the attempt was resumed: its staged bytes came
 * from an earlier run, and a fresh session takes this run's own prepared bytes. A rejection of
 * bytes this run just uploaded would only be refused again.
 */
export function shouldRestartUploadAttempt(
  ending: UploadAttemptEnding | null,
  resumed: boolean
): boolean {
  return ending === 'session' || (ending === 'rejected' && resumed)
}

/**
 * Answers that leave the attempt open whatever their status. `UPLOAD_IN_PROGRESS`: another
 * commit of the same session owns its publication right now and nothing changed, so the next
 * retry commits again with the same keys and replays that commit's outcome.
 */
const AMBIGUOUS_UPLOAD_CODES: ReadonlySet<string> = new Set(['UPLOAD_IN_PROGRESS'])

/**
 * Answers that end the attempt whatever their status. `UPLOAD_BYTES_PRESENT` answers an
 * allocation replay, which the client sends only when it never received the allocation: it
 * holds no session to commit, so the next upload starts over with fresh keys.
 */
const TERMINAL_UPLOAD_CODES: ReadonlySet<string> = new Set([
  'UPLOAD_SESSION_EXPIRED',
  'UPLOAD_SESSION_NOT_FOUND',
  'IDEMPOTENCY_KEY_REUSED',
  UPLOAD_BYTES_PRESENT_MESSAGE,
])

/**
 * True when a failed request cannot succeed on a retry of the same attempt: a 4xx answer such
 * as an expired or ended session, a declaration storage refused, stored bytes commit refused
 * (the selfie's 400 image codes included, as {@link uploadAttemptEnding} reads them), or a
 * reused key. Network
 * faults, timeouts, 5xx answers, a lapsed sign-in (401), 408, 429 and `UPLOAD_IN_PROGRESS`
 * leave the attempt open.
 */
export function isTerminalUploadStatus(
  status: number | null | undefined,
  code?: string | null
): boolean {
  if (code && AMBIGUOUS_UPLOAD_CODES.has(code)) return false
  if (code && TERMINAL_UPLOAD_CODES.has(code)) return true
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  )
}

/** True for the answer that says another commit of the session is publishing it now. */
export function isUploadInProgressCode(code: string | null | undefined): boolean {
  return code === 'UPLOAD_IN_PROGRESS'
}

/** What a member reads when a commit met another commit of the same upload still publishing. */
export const UPLOAD_IN_PROGRESS_USER_MESSAGE =
  'This photo is still being saved. Try again in a moment.'
