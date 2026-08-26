// Story 5.4 Task 3 owner: color palette & beauty/accessory advisor HTTP contracts.
//
// Design decisions that are load-bearing and easy to undo by accident:
//
// 1. Status is a discriminated union, mirroring `silhouetteMyFormSchema`
//    (`wardrobe.ts`). `failureReason` is present exactly on `failed`; the
//    derived scalars (`source`, `undertone`, `depth`, `confidence`,
//    `analysisVersion`, `analyzedAt`) are present exactly on `ready`, with
//    `depth` nullable WITHIN `ready` (null for a wardrobe-sourced palette,
//    since clothing colour is not evidence of skin depth). This makes
//    `{status: 'ready', failureReason: 'no_face'}` unrepresentable in the
//    generated types rather than merely unlikely.
//
// 2. No selfie bytes and no signed URL ever reach the wire. The selfie is
//    purged the moment analysis terminates (Decision 8); only the derived
//    scalars persist. There is no `imageAccess` block anywhere in this file.
//
// 3. `ADVISOR_RULES` is data, not prose. Every `labelKey` is a locale key
//    resolved by the client's i18n catalog; no English shade name is ever
//    hardcoded in a component. `itemKey` is the stable identity used by
//    save/dismiss, by analytics, and by offer matching — never a translated
//    string or an array index.
//
// 4. Sponsored offers carry no URL. Exactly like `shopThisLookSchema`
//    (`commerce.ts`), the outbound link is minted server-side at click time
//    by the existing `POST /api/v1/commerce/affiliate/clicks`.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'
import { PREMIUM_REQUIRED_MESSAGE } from './subscription'

// ---------------------------------------------------------------------------
// Enums, mirroring packages/db/prisma/schema.prisma exactly (Decision 11).
// ---------------------------------------------------------------------------

export const paletteSourceSchema = z.enum(['selfie', 'wardrobe'])
export const skinUndertoneSchema = z.enum(['warm', 'cool', 'neutral', 'olive'])
export const skinDepthSchema = z.enum(['fair', 'light', 'medium', 'tan', 'deep'])
export const paletteAnalysisStatusSchema = z.enum([
  'pending_upload',
  'bytes_uploaded',
  'processing',
  'ready',
  'failed',
])
export const paletteAnalysisFailureReasonSchema = z.enum([
  'no_face',
  'low_quality',
  'privacy_violation',
  'insufficient_wardrobe',
  'timeout',
  'storage_error',
])
export const advisorSlotSchema = z.enum([
  'foundation',
  'blush',
  'jewelry',
  'bag',
  'eyewear',
])
export const advisorActionSchema = z.enum(['saved', 'dismissed'])

export type PaletteSource = z.infer<typeof paletteSourceSchema>
export type SkinUndertone = z.infer<typeof skinUndertoneSchema>
export type SkinDepth = z.infer<typeof skinDepthSchema>
export type PaletteAnalysisStatus = z.infer<typeof paletteAnalysisStatusSchema>
export type PaletteAnalysisFailureReason = z.infer<
  typeof paletteAnalysisFailureReasonSchema
>
export type AdvisorSlot = z.infer<typeof advisorSlotSchema>
export type AdvisorAction = z.infer<typeof advisorActionSchema>

// ---------------------------------------------------------------------------
// Palette analysis status: a discriminated union (Decision 12).
// ---------------------------------------------------------------------------

const paletteAnalysisUncommittedVariant = (status: 'pending_upload' | 'bytes_uploaded') =>
  z
    .object({
      status: z.literal(status),
      failureReason: z.null(),
      source: z.null(),
      undertone: z.null(),
      depth: z.null(),
      confidence: z.null(),
      analysisVersion: z.null(),
      analyzedAt: z.null(),
    })
    .strict()

export const paletteAnalysisSchema = z
  .discriminatedUnion('status', [
    paletteAnalysisUncommittedVariant('pending_upload'),
    paletteAnalysisUncommittedVariant('bytes_uploaded'),
    z
      .object({
        status: z.literal('processing'),
        failureReason: z.null(),
        source: paletteSourceSchema,
        undertone: z.null(),
        depth: z.null(),
        confidence: z.null(),
        analysisVersion: z.null(),
        analyzedAt: z.null(),
      })
      .strict(),
    z
      .object({
        status: z.literal('ready'),
        failureReason: z.null(),
        source: paletteSourceSchema,
        undertone: skinUndertoneSchema,
        // Nullable WITHIN ready: null for a wardrobe-sourced palette. AC 4's
        // degraded foundation guidance branches on this field, not on `source`.
        depth: skinDepthSchema.nullable(),
        confidence: z.number().min(0).max(1),
        analysisVersion: nonEmptyStringSchema,
        analyzedAt: isoTimestampSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal('failed'),
        failureReason: paletteAnalysisFailureReasonSchema,
        source: paletteSourceSchema,
        undertone: z.null(),
        depth: z.null(),
        confidence: z.null(),
        analysisVersion: z.null(),
        analyzedAt: z.null(),
      })
      .strict(),
  ])
  .openapi({
    description: [
      'One variant per analysis status. failureReason is present exactly on',
      'failed, and the derived scalars are present exactly on ready, with',
      'depth nullable within ready for a wardrobe-sourced palette. A combination',
      'such as a ready palette with a failureReason is unrepresentable in the',
      'generated types.',
    ].join(' '),
  })

export type PaletteAnalysis = z.infer<typeof paletteAnalysisSchema>

// ---------------------------------------------------------------------------
// Sponsored offer + recommendation card.
// ---------------------------------------------------------------------------

export const advisorSponsoredOfferSchema = z
  .object({
    partnerId: nonEmptyStringSchema.describe(
      'CommercePartner.slug. Stable, safe to log.'
    ),
    partnerDisplayName: nonEmptyStringSchema,
    offerId: nonEmptyStringSchema.describe(
      'Pass back to POST /api/v1/commerce/affiliate/clicks with surface: "palette_advisor".'
    ),
    offerTitle: nonEmptyStringSchema,
  })
  .strict()

export const advisorRecommendationCardSchema = z
  .object({
    slot: advisorSlotSchema,
    /** ADVISOR_RULES' stable identity. Never a translated string or an array index. */
    itemKey: nonEmptyStringSchema,
    /** A locale key, resolved client-side. Never an English shade name. */
    labelKey: nonEmptyStringSchema,
    swatchHex: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'swatchHex must be a 6-digit hex color' }),
    /**
     * Whether the acting user has saved this card. Dismissed cards are
     * omitted from the array entirely (AC 6: "a dismissed suggestion does
     * not reappear on the next read"), so there is no tri-state to publish.
     */
    saved: z.boolean(),
    /**
     * Zero or one affiliate offer per slot (Decision 7/AC 5). Null renders
     * the first-party recommendation alone.
     */
    sponsored: advisorSponsoredOfferSchema.nullable(),
  })
  .strict()

export type AdvisorSponsoredOffer = z.infer<typeof advisorSponsoredOfferSchema>
export type AdvisorRecommendationCard = z.infer<typeof advisorRecommendationCardSchema>

// ---------------------------------------------------------------------------
// GET /api/v1/commerce/premium/palette
// ---------------------------------------------------------------------------

export const paletteAdvisorProfileSchema = z
  .object({
    /**
     * The acting user's `PaletteProfile.id`, or null before any consent grant
     * has created the row.
     *
     * Published because a sponsored advisor card is activated through the
     * existing `POST /api/v1/commerce/affiliate/clicks`, whose
     * `recommendationId` is required and, for an advisor click, carries the
     * `PaletteProfile.id` (Decision 7) so the 60-second dedupe index stays
     * meaningful. Without this field a client has no truthful value to send.
     *
     * The server does not trust what comes back: `AffiliateClickService`
     * re-resolves the caller's own profile id on the advisor branch, so a
     * forged value cannot reach the attribution row or defeat the dedupe.
     */
    profileId: nonEmptyStringSchema.nullable(),
    isEntitled: z.boolean(),
    /** Server-evaluated color_analysis_enabled flag. */
    analysisEnabled: z.boolean(),
    /** True iff consent_granted_at is set and not currently revoked. */
    hasConsent: z.boolean(),
    /** Null before any analysis has ever been started. */
    analysis: paletteAnalysisSchema.nullable(),
    /**
     * One card per advisor slot with a resolvable recommendation. Empty
     * before an analysis is `ready`. A stored item_key from a retired
     * ADVISOR_RULES_VERSION resolves to nothing and is skipped rather than
     * crashing the surface.
     */
    recommendations: z.array(advisorRecommendationCardSchema),
  })
  .strict()

export const paletteAdvisorProfileResponseSchema = z.object({
  data: paletteAdvisorProfileSchema,
})

export type PaletteAdvisorProfile = z.infer<typeof paletteAdvisorProfileSchema>
export type PaletteAdvisorProfileResponse = z.infer<
  typeof paletteAdvisorProfileResponseSchema
>

// ---------------------------------------------------------------------------
// POST .../consent
// ---------------------------------------------------------------------------

export const setPaletteConsentInputSchema = z
  .object({
    granted: z
      .boolean()
      .describe('true grants consent; false revokes it and erases the palette.'),
  })
  .strict()

export const setPaletteConsentResponseSchema = z.object({
  data: paletteAdvisorProfileSchema,
})

export type SetPaletteConsentInput = z.infer<typeof setPaletteConsentInputSchema>
export type SetPaletteConsentResponse = z.infer<typeof setPaletteConsentResponseSchema>

// ---------------------------------------------------------------------------
// POST .../analyze (wardrobe source only; selfie goes through the upload lifecycle)
// ---------------------------------------------------------------------------

export const analyzePaletteInputSchema = z
  .object({
    source: z.literal('wardrobe'),
  })
  .strict()

export const analyzePaletteResponseSchema = z.object({
  data: paletteAdvisorProfileSchema,
})

export type AnalyzePaletteInput = z.infer<typeof analyzePaletteInputSchema>
export type AnalyzePaletteResponse = z.infer<typeof analyzePaletteResponseSchema>

// ---------------------------------------------------------------------------
// Selfie upload lifecycle, mirroring wardrobe.ts's silhouette shapes exactly.
// ---------------------------------------------------------------------------

export const createPaletteSelfieUploadUrlInputSchema = z
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

export const paletteSelfieUploadSessionSchema = z
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

export const createPaletteSelfieUploadUrlResponseSchema = z.object({
  data: paletteSelfieUploadSessionSchema,
})

export const paletteSelfieUploadSessionPathParamsSchema = z.object({
  uploadSessionId: nonEmptyStringSchema.describe('Opaque upload session ID.'),
})

export const commitPaletteSelfieInputSchema = z
  .object({
    uploadSessionId: nonEmptyStringSchema,
  })
  .strict()

export const commitPaletteSelfieResponseSchema = z.object({
  data: paletteAdvisorProfileSchema,
})

export type CreatePaletteSelfieUploadUrlInput = z.infer<
  typeof createPaletteSelfieUploadUrlInputSchema
>
export type PaletteSelfieUploadSession = z.infer<typeof paletteSelfieUploadSessionSchema>
export type CreatePaletteSelfieUploadUrlResponse = z.infer<
  typeof createPaletteSelfieUploadUrlResponseSchema
>
export type CommitPaletteSelfieInput = z.infer<typeof commitPaletteSelfieInputSchema>
export type CommitPaletteSelfieResponse = z.infer<
  typeof commitPaletteSelfieResponseSchema
>

// ---------------------------------------------------------------------------
// PUT .../recommendations
// ---------------------------------------------------------------------------

export const updateAdvisorRecommendationInputSchema = z
  .object({
    itemKey: nonEmptyStringSchema,
    slot: advisorSlotSchema,
    /** null clears the row (neither saved nor dismissed). */
    action: advisorActionSchema.nullable(),
  })
  .strict()

export const updateAdvisorRecommendationResponseSchema = z.object({
  data: paletteAdvisorProfileSchema,
})

export type UpdateAdvisorRecommendationInput = z.infer<
  typeof updateAdvisorRecommendationInputSchema
>
export type UpdateAdvisorRecommendationResponse = z.infer<
  typeof updateAdvisorRecommendationResponseSchema
>

// ---------------------------------------------------------------------------
// DELETE /api/v1/commerce/premium/palette
// ---------------------------------------------------------------------------

export const deletePaletteAdvisorResponseSchema = z.object({
  data: paletteAdvisorProfileSchema,
})

export type DeletePaletteAdvisorResponse = z.infer<
  typeof deletePaletteAdvisorResponseSchema
>

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

// PREMIUM_REQUIRED_MESSAGE is reused, not redefined, in the descriptions
// below: it is `PremiumEntitlementGuard`'s own 403 message, already exported
// once by `subscription.ts`. Re-exporting it here too would make the barrel's
// `export *` ambiguous between the two modules.

export const PALETTE_CONSENT_REQUIRED_MESSAGE =
  'Grant palette analysis consent before continuing.'

export const PALETTE_ANALYSIS_DISABLED_MESSAGE =
  'The color palette advisor is temporarily unavailable.'

export const PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE =
  'A palette analysis is already in progress.'

// ---------------------------------------------------------------------------
// Decision 6: the versioned, deterministic first-party rule table.
//
// It is data, not prose: every entry is { itemKey, labelKey, swatchHex }.
// itemKey is namespaced `advisor:{slot}:{undertone}[:{depth}]` and is the
// stable identity used by save/dismiss, by analytics, and by offer matching.
// labelKey is a locale key under commerce.premium.palette.shades.*; no
// English shade name is ever hardcoded in a component.
//
// Every swatchHex below is pinned in packages/api-client/src/contracts/http/palette-advisor.spec.ts
// to pass meetsWcagAA() against ADVISOR_SWATCH_CARD_BACKGROUND at the 3:1
// non-text floor (a colour swatch conveying information, not body text) --
// picked deliberately mid-luminance (#7A7580) so it can contrast with BOTH
// the lightest ("fair") and darkest ("deep") swatches at once, which neither
// a light nor a dark card background can do simultaneously. This is the same
// discipline 5.3's Decision 2/3 applied to the premium theme accents, which
// found two of three failing the small-text floor.
// ---------------------------------------------------------------------------

export const ADVISOR_RULES_VERSION = 'palette-advisor-v1'

/** The card background every ADVISOR_RULES swatchHex is pinned against. */
export const ADVISOR_SWATCH_CARD_BACKGROUND = '#7A7580'

export type AdvisorRuleEntry = {
  readonly itemKey: string
  readonly labelKey: string
  readonly swatchHex: string
}

export type AdvisorUndertoneRules = {
  readonly foundation: {
    readonly withDepth: Readonly<Record<SkinDepth, AdvisorRuleEntry>>
    readonly withoutDepth: AdvisorRuleEntry
  }
  readonly blush: readonly [AdvisorRuleEntry, AdvisorRuleEntry]
  readonly jewelry: AdvisorRuleEntry
  readonly bag: AdvisorRuleEntry
  readonly eyewear: AdvisorRuleEntry
}

function foundationEntry(
  undertone: SkinUndertone,
  depth: SkinDepth,
  swatchHex: string
): AdvisorRuleEntry {
  return {
    itemKey: `advisor:foundation:${undertone}:${depth}`,
    labelKey: `commerce.premium.palette.shades.foundation.${undertone}.${depth}`,
    swatchHex,
  }
}

function foundationFamilyEntry(
  undertone: SkinUndertone,
  swatchHex: string
): AdvisorRuleEntry {
  return {
    itemKey: `advisor:foundation:${undertone}`,
    labelKey: `commerce.premium.palette.shades.foundation.${undertone}.family`,
    swatchHex,
  }
}

function blushEntry(
  undertone: SkinUndertone,
  index: 0 | 1,
  swatchHex: string
): AdvisorRuleEntry {
  return {
    itemKey: `advisor:blush:${undertone}:${index}`,
    labelKey: `commerce.premium.palette.shades.blush.${undertone}.${index}`,
    swatchHex,
  }
}

function accessoryEntry(
  slot: 'jewelry' | 'bag' | 'eyewear',
  undertone: SkinUndertone,
  swatchHex: string
): AdvisorRuleEntry {
  return {
    itemKey: `advisor:${slot}:${undertone}`,
    labelKey: `commerce.premium.palette.shades.${slot}.${undertone}`,
    swatchHex,
  }
}

export const ADVISOR_RULES: Readonly<Record<SkinUndertone, AdvisorUndertoneRules>> =
  Object.freeze({
    warm: {
      foundation: {
        withDepth: {
          fair: foundationEntry('warm', 'fair', '#F3ECE2'),
          light: foundationEntry('warm', 'light', '#E4D4BE'),
          medium: foundationEntry('warm', 'medium', '#3A2C18'),
          tan: foundationEntry('warm', 'tan', '#362916'),
          deep: foundationEntry('warm', 'deep', '#161009'),
        },
        withoutDepth: foundationFamilyEntry('warm', '#3A2C18'),
      },
      blush: [blushEntry('warm', 0, '#4F1E17'), blushEntry('warm', 1, '#472515')],
      jewelry: accessoryEntry('jewelry', 'warm', '#E5D2A6'),
      bag: accessoryEntry('bag', 'warm', '#432714'),
      eyewear: accessoryEntry('eyewear', 'warm', '#3D2717'),
    },
    cool: {
      foundation: {
        withDepth: {
          fair: foundationEntry('cool', 'fair', '#F1E7E4'),
          light: foundationEntry('cool', 'light', '#E3D0C9'),
          medium: foundationEntry('cool', 'medium', '#3D271F'),
          tan: foundationEntry('cool', 'tan', '#39241D'),
          deep: foundationEntry('cool', 'deep', '#140D0A'),
        },
        withoutDepth: foundationFamilyEntry('cool', '#3D271F'),
      },
      blush: [blushEntry('cool', 0, '#4F172A'), blushEntry('cool', 1, '#4F171C')],
      jewelry: accessoryEntry('jewelry', 'cool', '#D5D6D9'),
      bag: accessoryEntry('bag', 'cool', '#2A2833'),
      eyewear: accessoryEntry('eyewear', 'cool', '#1A1A23'),
    },
    neutral: {
      foundation: {
        withDepth: {
          fair: foundationEntry('neutral', 'fair', '#EFEAE6'),
          light: foundationEntry('neutral', 'light', '#DFD6CD'),
          medium: foundationEntry('neutral', 'medium', '#322820'),
          tan: foundationEntry('neutral', 'tan', '#352B22'),
          deep: foundationEntry('neutral', 'deep', '#130F0C'),
        },
        withoutDepth: foundationFamilyEntry('neutral', '#322820'),
      },
      blush: [blushEntry('neutral', 0, '#4F1720'), blushEntry('neutral', 1, '#4F1C17')],
      jewelry: accessoryEntry('jewelry', 'neutral', '#E3D4C4'),
      bag: accessoryEntry('bag', 'neutral', '#3E271B'),
      eyewear: accessoryEntry('eyewear', 'neutral', '#2F2E33'),
    },
    olive: {
      foundation: {
        withDepth: {
          fair: foundationEntry('olive', 'fair', '#F0EFE5'),
          light: foundationEntry('olive', 'light', '#DAD8BE'),
          medium: foundationEntry('olive', 'medium', '#2E2C1A'),
          tan: foundationEntry('olive', 'tan', '#312F1C'),
          deep: foundationEntry('olive', 'deep', '#14130B'),
        },
        withoutDepth: foundationFamilyEntry('olive', '#2E2C1A'),
      },
      blush: [blushEntry('olive', 0, '#4F2017'), blushEntry('olive', 1, '#3F2512')],
      jewelry: accessoryEntry('jewelry', 'olive', '#272D16'),
      bag: accessoryEntry('bag', 'olive', '#27301A'),
      eyewear: accessoryEntry('eyewear', 'olive', '#2E301A'),
    },
  })

/**
 * Every AdvisorRuleEntry across every undertone, slot, and depth. The
 * canonical source both the advisor service (offer matching, save/dismiss
 * validation) and this contract's own WCAG test iterate over, so a rule
 * added to `ADVISOR_RULES` above is automatically covered everywhere else.
 */
export function listAdvisorRuleEntries(): readonly AdvisorRuleEntry[] {
  const entries: AdvisorRuleEntry[] = []
  for (const undertoneRules of Object.values(ADVISOR_RULES)) {
    entries.push(...Object.values(undertoneRules.foundation.withDepth))
    entries.push(undertoneRules.foundation.withoutDepth)
    entries.push(...undertoneRules.blush)
    entries.push(undertoneRules.jewelry, undertoneRules.bag, undertoneRules.eyewear)
  }
  return entries
}

/** Resolves a stored item_key back to its rule entry, or undefined for a retired version. */
export function resolveAdvisorRuleEntry(itemKey: string): AdvisorRuleEntry | undefined {
  return listAdvisorRuleEntries().find((entry) => entry.itemKey === itemKey)
}

// ---------------------------------------------------------------------------
// Decision 15: locale keys, enumerated beside ADVISOR_RULES so the rule
// table and its copy cannot drift. Every one of these (plus each
// `AdvisorRuleEntry.labelKey` above) ships under `commerce.premium.palette.*`
// in all ten locale catalogs on both surfaces.
// ---------------------------------------------------------------------------

export const PALETTE_ADVISOR_LOCALE_KEYS = Object.freeze([
  'commerce.premium.palette.sectionTitle',
  'commerce.premium.palette.intro',
  'commerce.premium.palette.consent.title',
  'commerce.premium.palette.consent.body',
  'commerce.premium.palette.consent.grant',
  'commerce.premium.palette.consent.revoke',
  'commerce.premium.palette.consent.granted',
  'commerce.premium.palette.source.selfie',
  'commerce.premium.palette.source.wardrobe',
  'commerce.premium.palette.source.selfieHint',
  'commerce.premium.palette.source.wardrobeHint',
  'commerce.premium.palette.status.idle',
  'commerce.premium.palette.status.uploading',
  'commerce.premium.palette.status.processing',
  'commerce.premium.palette.status.ready',
  'commerce.premium.palette.status.failed',
  'commerce.premium.palette.failure.noFace',
  'commerce.premium.palette.failure.lowQuality',
  'commerce.premium.palette.failure.privacyViolation',
  'commerce.premium.palette.failure.insufficientWardrobe',
  'commerce.premium.palette.failure.timeout',
  'commerce.premium.palette.failure.storageError',
  'commerce.premium.palette.result.undertone',
  'commerce.premium.palette.result.depth',
  'commerce.premium.palette.result.depthUnknown',
  'commerce.premium.palette.result.confidence',
  'commerce.premium.palette.undertone.warm',
  'commerce.premium.palette.undertone.cool',
  'commerce.premium.palette.undertone.neutral',
  'commerce.premium.palette.undertone.olive',
  'commerce.premium.palette.depth.fair',
  'commerce.premium.palette.depth.light',
  'commerce.premium.palette.depth.medium',
  'commerce.premium.palette.depth.tan',
  'commerce.premium.palette.depth.deep',
  'commerce.premium.palette.slot.foundation',
  'commerce.premium.palette.slot.blush',
  'commerce.premium.palette.slot.jewelry',
  'commerce.premium.palette.slot.bag',
  'commerce.premium.palette.slot.eyewear',
  'commerce.premium.palette.foundationDepthUnknown',
  'commerce.premium.palette.sponsored.disclosure',
  'commerce.premium.palette.sponsored.partnerLabel',
  'commerce.premium.palette.sponsored.cta',
  'commerce.premium.palette.actions.save',
  'commerce.premium.palette.actions.saved',
  'commerce.premium.palette.actions.dismiss',
  'commerce.premium.palette.actions.dismissed',
  'commerce.premium.palette.actions.undo',
  'commerce.premium.palette.locked.title',
  'commerce.premium.palette.locked.body',
  'commerce.premium.palette.locked.signedOutBody',
  'commerce.premium.palette.unavailable',
  'commerce.premium.palette.loadError',
  'commerce.premium.palette.saveError',
  'commerce.premium.palette.deleteConfirm',
] as const)

export type PaletteAdvisorLocaleKey = (typeof PALETTE_ADVISOR_LOCALE_KEYS)[number]

// ---------------------------------------------------------------------------
// OpenAPI registration
// ---------------------------------------------------------------------------

export function registerPaletteAdvisorContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('PaletteSource', paletteSourceSchema)
  registry.register('SkinUndertone', skinUndertoneSchema)
  registry.register('SkinDepth', skinDepthSchema)
  registry.register('PaletteAnalysisStatus', paletteAnalysisStatusSchema)
  registry.register('PaletteAnalysisFailureReason', paletteAnalysisFailureReasonSchema)
  registry.register('AdvisorSlot', advisorSlotSchema)
  registry.register('AdvisorAction', advisorActionSchema)
  registry.register('PaletteAnalysis', paletteAnalysisSchema)
  registry.register('AdvisorSponsoredOffer', advisorSponsoredOfferSchema)
  registry.register('AdvisorRecommendationCard', advisorRecommendationCardSchema)
  registry.register('PaletteAdvisorProfile', paletteAdvisorProfileSchema)

  const registeredProfileResponse = registry.register(
    'PaletteAdvisorProfileResponse',
    paletteAdvisorProfileResponseSchema
  )
  const registeredSetConsentInput = registry.register(
    'SetPaletteConsentInput',
    setPaletteConsentInputSchema
  )
  const registeredSetConsentResponse = registry.register(
    'SetPaletteConsentResponse',
    setPaletteConsentResponseSchema
  )
  const registeredAnalyzeInput = registry.register(
    'AnalyzePaletteInput',
    analyzePaletteInputSchema
  )
  const registeredAnalyzeResponse = registry.register(
    'AnalyzePaletteResponse',
    analyzePaletteResponseSchema
  )
  const registeredUploadUrlInput = registry.register(
    'CreatePaletteSelfieUploadUrlInput',
    createPaletteSelfieUploadUrlInputSchema
  )
  const registeredUploadUrlResponse = registry.register(
    'CreatePaletteSelfieUploadUrlResponse',
    createPaletteSelfieUploadUrlResponseSchema
  )
  const registeredCommitInput = registry.register(
    'CommitPaletteSelfieInput',
    commitPaletteSelfieInputSchema
  )
  const registeredCommitResponse = registry.register(
    'CommitPaletteSelfieResponse',
    commitPaletteSelfieResponseSchema
  )
  const registeredUpdateRecommendationInput = registry.register(
    'UpdateAdvisorRecommendationInput',
    updateAdvisorRecommendationInputSchema
  )
  const registeredUpdateRecommendationResponse = registry.register(
    'UpdateAdvisorRecommendationResponse',
    updateAdvisorRecommendationResponseSchema
  )
  const registeredDeleteResponse = registry.register(
    'DeletePaletteAdvisorResponse',
    deletePaletteAdvisorResponseSchema
  )

  const commonErrorResponses = {
    401: {
      description: 'Missing or invalid authentication headers',
      content: {
        'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
      },
    },
    500: {
      description: 'Internal server error occurred',
      content: {
        'application/json': { schema: commonSchemas.internalServerErrorHttpErrorSchema },
      },
    },
  } as const

  registry.registerPath({
    method: 'get',
    path: '/api/v1/commerce/premium/palette',
    tags: ['palette-advisor'],
    summary: 'Read the palette advisor profile',
    description:
      'Returns entitlement, consent, the current analysis (if any), and resolved recommendations. Deliberately NOT entitlement- or flag-gated: every signed-in caller needs an answer to render the locked or unavailable state cleanly.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Profile retrieved',
        content: { 'application/json': { schema: registeredProfileResponse } },
      },
      ...commonErrorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/premium/palette/consent',
    tags: ['palette-advisor'],
    summary: 'Grant or revoke palette analysis consent',
    description:
      'Persists a revocable, server-enforced consent fact and writes an AuditLog row on every change. Revoking runs the same erase path as DELETE.',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: registeredSetConsentInput } },
      },
    },
    responses: {
      200: {
        description: 'Consent updated',
        content: { 'application/json': { schema: registeredSetConsentResponse } },
      },
      400: {
        description: 'Invalid input payload',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      403: {
        description: `Not entitled ("${PREMIUM_REQUIRED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      503: {
        description: `color_analysis_enabled resolved false ("${PALETTE_ANALYSIS_DISABLED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
      ...commonErrorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/premium/palette/analyze',
    tags: ['palette-advisor'],
    summary: 'Derive a palette from the wardrobe',
    description:
      "Aggregates the acting user's PaletteInsights hex codes and enqueues classification. Answers 202 with the current (processing) status.",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: registeredAnalyzeInput } },
      },
    },
    responses: {
      202: {
        description: 'Analysis enqueued',
        content: { 'application/json': { schema: registeredAnalyzeResponse } },
      },
      400: {
        description: 'Invalid input payload',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      403: {
        description: `Not entitled ("${PREMIUM_REQUIRED_MESSAGE}") or no consent ("${PALETTE_CONSENT_REQUIRED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      409: {
        description: `An analysis is already in progress ("${PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      503: {
        description: `color_analysis_enabled resolved false ("${PALETTE_ANALYSIS_DISABLED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
      ...commonErrorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/premium/palette/selfie/upload-url',
    tags: ['palette-advisor'],
    summary: 'Allocate a selfie upload session',
    description:
      'Mirrors the silhouette My Form upload-url allocation, including Idempotency-Key handling. Guardian consent still applies for under-16 accounts through WardrobeUploadGuard.',
    security: [{ bearerAuth: [] }],
    request: {
      // Declared, not merely described: the controller rejects a missing or
      // non-UUID `idempotency-key` with 400 INVALID_IDEMPOTENCY_KEY, so a
      // generated client that cannot send the header cannot call this route
      // at all. Same shape as the silhouette commit registration in
      // `wardrobe.ts`.
      headers: z.object({
        'idempotency-key': z.string().uuid(),
      }),
      body: {
        required: true,
        content: { 'application/json': { schema: registeredUploadUrlInput } },
      },
    },
    responses: {
      201: {
        description: 'Upload session allocated',
        content: { 'application/json': { schema: registeredUploadUrlResponse } },
      },
      200: {
        description: 'Idempotency-Key replay of an existing session',
        content: { 'application/json': { schema: registeredUploadUrlResponse } },
      },
      400: {
        description: 'Invalid input payload',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      403: {
        description: `Not entitled ("${PREMIUM_REQUIRED_MESSAGE}") or no consent ("${PALETTE_CONSENT_REQUIRED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      503: {
        description: `color_analysis_enabled resolved false ("${PALETTE_ANALYSIS_DISABLED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
      ...commonErrorResponses,
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/commerce/premium/palette/selfie/uploads/{uploadSessionId}',
    tags: ['palette-advisor'],
    summary: 'Upload selfie bytes',
    description:
      'Raw bytes for the allocated session. Mirrors the silhouette bytes route and its upload-token, size, and MIME validation.',
    // The route mounts `RequestAuthGuard` in addition to the upload token,
    // exactly as `PUT /api/v1/wardrobe/uploads/{uploadSessionId}` does, so the
    // bearer requirement is part of the published contract rather than an
    // undocumented extra.
    security: [{ bearerAuth: [] }],
    request: {
      params: paletteSelfieUploadSessionPathParamsSchema,
      headers: z.object({
        'x-upload-token': z.string().min(1),
        'content-type': z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }),
      body: {
        required: true,
        content: {
          'image/jpeg': { schema: z.string().openapi({ format: 'binary' }) },
          'image/png': { schema: z.string().openapi({ format: 'binary' }) },
          'image/webp': { schema: z.string().openapi({ format: 'binary' }) },
        },
      },
    },
    responses: {
      204: { description: 'Bytes accepted' },
      400: {
        description: 'Invalid upload body',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      403: {
        description: 'Invalid or expired upload token',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: 'Unknown upload session',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      ...commonErrorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/premium/palette/selfie/commit',
    tags: ['palette-advisor'],
    summary: 'Commit the uploaded selfie and enqueue analysis',
    description:
      'Enqueues analysis for the committed selfie. 201 on a fresh commit, 200 on an Idempotency-Key replay, per the house convention.',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z.string().uuid(),
      }),
      body: {
        required: true,
        content: { 'application/json': { schema: registeredCommitInput } },
      },
    },
    responses: {
      201: {
        description: 'Commit accepted, analysis enqueued',
        content: { 'application/json': { schema: registeredCommitResponse } },
      },
      200: {
        description: 'Idempotency-Key replay',
        content: { 'application/json': { schema: registeredCommitResponse } },
      },
      400: {
        description: 'Invalid input payload',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      403: {
        description: `Not entitled ("${PREMIUM_REQUIRED_MESSAGE}") or no consent ("${PALETTE_CONSENT_REQUIRED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: 'Unknown upload session',
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      503: {
        description: `color_analysis_enabled resolved false ("${PALETTE_ANALYSIS_DISABLED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
      ...commonErrorResponses,
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/commerce/premium/palette/recommendations',
    tags: ['palette-advisor'],
    summary: 'Save, dismiss, or clear a recommendation',
    description:
      'action: null clears any prior saved/dismissed state for the item. Not flag-gated: this is a lightweight preference write, not an analysis path.',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: registeredUpdateRecommendationInput } },
      },
    },
    responses: {
      200: {
        description: 'Recommendation state updated',
        content: {
          'application/json': { schema: registeredUpdateRecommendationResponse },
        },
      },
      400: {
        description: 'Invalid input payload',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      403: {
        description: `Not entitled ("${PREMIUM_REQUIRED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      ...commonErrorResponses,
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/commerce/premium/palette',
    tags: ['palette-advisor'],
    summary: 'Erase the palette advisor profile',
    description:
      'Clears derived scalars, revokes consent, deletes AdvisorRecommendationState rows, purges any retained selfie object, and writes an AuditLog row. Deliberately NOT entitlement-gated: a lapsed subscriber must always be able to erase their data.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Erased',
        content: { 'application/json': { schema: registeredDeleteResponse } },
      },
      ...commonErrorResponses,
    },
  })
}
