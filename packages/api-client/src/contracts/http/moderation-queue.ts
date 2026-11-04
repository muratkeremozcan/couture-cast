// Story 6.10 owner: the moderator queue and case detail contract in `packages/api-client/src/contracts/http/moderation-queue.ts`.
// The controller, OpenAPI document, generated SDK and web console all derive from these schemas.
// `deriveCaseRisk` and `deriveSlaState` are the single definition of risk and SLA state.
// Story 6.12 imports the SLA half for scheduled alerts, so no second copy of a threshold may exist.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { communityReportReasonSchema, type CommunityReportReason } from './community'

// --- Vocabulary -------------------------------------------------------------

export const moderationCaseSourceSchema = z.enum(['post', 'comment'])
export type ModerationCaseSource = z.infer<typeof moderationCaseSourceSchema>

export const moderationCaseRiskSchema = z.enum(['low', 'medium', 'high'])
export type ModerationCaseRisk = z.infer<typeof moderationCaseRiskSchema>

export const moderationCaseStatusSchema = z.enum(['open', 'resolved'])
export type ModerationCaseStatus = z.infer<typeof moderationCaseStatusSchema>

export const moderationCaseSlaStateSchema = z.enum([
  'on_track',
  'at_risk',
  'breached',
  'resolved',
])
export type ModerationCaseSlaState = z.infer<typeof moderationCaseSlaStateSchema>

/** The closed codes the two routes put on the wire next to the HTTP status. */
export const moderationQueueErrorCodeSchema = z.enum([
  'invalid_filter',
  'invalid_cursor',
  'case_not_found',
  'moderation_console_disabled',
  'audit_unavailable',
])
export type ModerationQueueErrorCode = z.infer<typeof moderationQueueErrorCodeSchema>

export const moderationQueueErrorSchema = z
  .object({
    statusCode: z.number().int(),
    code: moderationQueueErrorCodeSchema,
    message: z.string().min(1),
  })
  .strict()
export type ModerationQueueError = z.infer<typeof moderationQueueErrorSchema>

/** The closed reasons a case image is unavailable. Comment cases always use `no_image`. */
export const moderationMediaUnavailableReasonSchema = z.enum([
  'target_erased',
  'anonymized',
  'purged',
  'no_image',
  'signing_failed',
])
export type ModerationMediaUnavailableReason = z.infer<
  typeof moderationMediaUnavailableReasonSchema
>

/** `unknown` means the reporter has no alias row yet, and a read never creates one. */
export const moderationAliasStateSchema = z.enum(['alias', 'erased', 'unknown'])
export type ModerationAliasState = z.infer<typeof moderationAliasStateSchema>

/** `screening` means the screener filed the report, so no member stands behind it. */
export const moderationReportOriginSchema = z.enum(['member', 'screening'])
export type ModerationReportOrigin = z.infer<typeof moderationReportOriginSchema>

export const moderationActorKindSchema = z.enum(['screening', 'reporter', 'operator'])
export type ModerationActorKind = z.infer<typeof moderationActorKindSchema>

// --- Decision vocabulary (Story 6.11) --------------------------------------

/** The five decisions. `escalate` alone is not terminal: it changes no report and no target. */
export const moderationDecisionActionSchema = z.enum([
  'resolve',
  'release',
  'takedown',
  'escalate',
  'ban',
])
export type ModerationDecisionAction = z.infer<typeof moderationDecisionActionSchema>

export const moderationSanctionKindSchema = z.enum(['temporary', 'permanent'])
export type ModerationSanctionKind = z.infer<typeof moderationSanctionKindSchema>

export const moderationAppealStatusSchema = z.enum([
  'not_requested',
  'requested',
  'upheld',
  'overturned',
])
export type ModerationAppealStatus = z.infer<typeof moderationAppealStatusSchema>

/** The steps an operator can record. `not_requested` is only ever the starting state. */
export const moderationAppealStepSchema = z.enum(['requested', 'upheld', 'overturned'])
export type ModerationAppealStep = z.infer<typeof moderationAppealStepSchema>

/** A sanction as an operator sees it. The member's own view is `communityBannedErrorSchema`. */
export const moderationSanctionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      sanctionId: z.string().min(1).max(64),
      kind: z.literal('temporary'),
      expiresAt: z.string().datetime(),
      appealStatus: moderationAppealStatusSchema,
    })
    .strict(),
  z
    .object({
      sanctionId: z.string().min(1).max(64),
      kind: z.literal('permanent'),
      expiresAt: z.null(),
      appealStatus: moderationAppealStatusSchema,
    })
    .strict(),
])
export type ModerationSanction = z.infer<typeof moderationSanctionSchema>

/** The author's standing. `sanction` is the newest row, active or not. Null when the author is gone. */
export const moderationSubjectStandingSchema = z
  .object({
    active: z.boolean(),
    sanction: moderationSanctionSchema.nullable(),
    /** Bans older than `sanction`. */
    priorBanCount: z.number().int().min(0),
    /** The steps this viewer may record on `sanction` now. */
    allowedAppealSteps: z.array(moderationAppealStepSchema),
  })
  .strict()
export type ModerationSubjectStanding = z.infer<typeof moderationSubjectStandingSchema>

/** The fields 6.11 adds to the case detail. `allowedActions` and `banKinds` are computed for the viewer. */
export const moderationCaseDecisionStateSchema = z
  .object({
    revision: z.string().regex(/^[0-9a-f]{16}$/),
    allowedActions: z.array(moderationDecisionActionSchema),
    banKinds: z.array(moderationSanctionKindSchema),
    escalated: z.boolean(),
    /** The earliest terminal decision of the case. It never moves. */
    firstDecisionAt: z.string().datetime().nullable(),
    subjectStanding: moderationSubjectStandingSchema.nullable(),
  })
  .strict()
export type ModerationCaseDecisionState = z.infer<
  typeof moderationCaseDecisionStateSchema
>

// --- Risk and SLA: the single definition ----------------------------------

export const MODERATION_RISK_RANKS = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
} as const)
export const MODERATION_RISK_BY_RANK = Object.freeze([
  'low',
  'medium',
  'high',
] as const satisfies readonly ModerationCaseRisk[])

/** Base risk rank of the strongest open report reason. */
export const MODERATION_REASON_RISK_RANK: Readonly<
  Record<CommunityReportReason, number>
> = Object.freeze({
  hate_speech: 2,
  violence: 2,
  harassment: 1,
  inappropriate_content: 1,
  spam: 0,
  other: 0,
})

/** Distinct open reporters at or above this count raise the risk one level. */
export const MODERATION_REPORTER_BUMP_THRESHOLD = 3

export const SLA_DURATION_MS = 24 * 60 * 60 * 1000
/** A quarter of the 24-hour SLA. At or below this remaining time a case is at risk. */
export const SLA_AT_RISK_WINDOW_MS = 6 * 60 * 60 * 1000

export interface DeriveCaseRiskInput {
  /** The reasons of the case's open reports. An empty list means `low`. */
  reasons: readonly CommunityReportReason[]
  /** The target carries a machine screening finding. */
  hasFinding: boolean
  distinctOpenReporters: number
}

/** The numeric rank the SQL path computes. `deriveCaseRisk` maps it to the enum. */
export function deriveCaseRiskRank(input: DeriveCaseRiskInput): number {
  const base = input.reasons.reduce(
    (strongest, reason) => Math.max(strongest, MODERATION_REASON_RISK_RANK[reason]),
    0
  )
  const bumps =
    (input.hasFinding ? 1 : 0) +
    (input.distinctOpenReporters >= MODERATION_REPORTER_BUMP_THRESHOLD ? 1 : 0)
  return Math.min(base + bumps, MODERATION_RISK_BY_RANK.length - 1)
}

export function deriveCaseRisk(input: DeriveCaseRiskInput): ModerationCaseRisk {
  return MODERATION_RISK_BY_RANK[deriveCaseRiskRank(input)] ?? 'low'
}

export interface DeriveSlaStateInput {
  status: ModerationCaseStatus
  /** The earliest open `sla_due_at` of the case. */
  dueAt: Date | string
  /** One clock read per request. */
  now: Date | string
}

export function deriveSlaState(input: DeriveSlaStateInput): ModerationCaseSlaState {
  if (input.status === 'resolved') return 'resolved'
  const remaining = new Date(input.dueAt).getTime() - new Date(input.now).getTime()
  // A silent `on_track` for an unparseable time would hide a breached case.
  if (Number.isNaN(remaining)) throw new RangeError('deriveSlaState needs valid times')
  if (remaining <= 0) return 'breached'
  return remaining <= SLA_AT_RISK_WINDOW_MS ? 'at_risk' : 'on_track'
}

// --- Queue ------------------------------------------------------------------

export const MODERATION_QUEUE_DEFAULT_LIMIT = 25
export const MODERATION_QUEUE_MAX_LIMIT = 50

export const moderationCaseIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^(post|comment|orphan-post|orphan-comment)\.[A-Za-z0-9_-]+$/)

const isoSchema = z.string().datetime()

/** The query string. Every filter takes one value. `locale=unknown` selects cases with no locale. */
export const moderationCasesQuerySchema = z
  .object({
    source: moderationCaseSourceSchema.optional(),
    locale: z
      .string()
      .min(1)
      .max(35)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    risk: moderationCaseRiskSchema.optional(),
    status: moderationCaseStatusSchema.default('open'),
    sla: moderationCaseSlaStateSchema.optional(),
    // Plain decimal digits only: `Number()` would also accept `1e1`, `0x10` and padded input.
    limit: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? /^[0-9]+$/.test(value)
            ? Number(value)
            : Number.NaN
          : value,
      z
        .number()
        .int()
        .min(1)
        .max(MODERATION_QUEUE_MAX_LIMIT)
        .default(MODERATION_QUEUE_DEFAULT_LIMIT)
    ),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict()
export type ModerationCasesQuery = z.infer<typeof moderationCasesQuerySchema>

export const moderationCaseSummarySchema = z
  .object({
    caseId: moderationCaseIdSchema,
    source: moderationCaseSourceSchema,
    status: moderationCaseStatusSchema,
    risk: moderationCaseRiskSchema,
    slaState: moderationCaseSlaStateSchema,
    /** The earliest open due time. For a resolved case, the earliest due time of its reports. */
    slaDueAt: isoSchema,
    /** The earliest accepted time among the case's open reports. */
    acceptedAt: isoSchema,
    /** An escalation is waiting for an admin. It changes no SLA value or ordering. */
    escalated: z.boolean(),
    reportCount: z.number().int().min(1),
    reasons: z.array(communityReportReasonSchema).min(1),
    locale: z.string().min(1).max(35).nullable(),
    hasFinding: z.boolean(),
    /** User-authored text. Render it as inert plain text. */
    excerpt: z.string().max(280).nullable(),
  })
  .strict()
export type ModerationCaseSummary = z.infer<typeof moderationCaseSummarySchema>

export const moderationCasesPageSchema = z
  .object({
    items: z.array(moderationCaseSummarySchema).max(MODERATION_QUEUE_MAX_LIMIT),
    nextCursor: z.string().min(1).max(1024).nullable(),
    serverNow: isoSchema,
  })
  .strict()
export const moderationCasesResponseSchema = z
  .object({ data: moderationCasesPageSchema })
  .strict()
export type ModerationCasesPage = z.infer<typeof moderationCasesPageSchema>

// --- Case detail ------------------------------------------------------------

/** What the reporter saw, projected through an allowlist. Unknown stored keys never appear. */
export const moderationSnapshotSchema = z
  .object({
    available: z.boolean(),
    caption: z.string().nullable(),
    altText: z.string().nullable(),
    body: z.string().nullable(),
    climateBand: z.string().nullable(),
    capturedAt: isoSchema.nullable(),
  })
  .strict()

/** The live state of the target right now, so a moderator can tell it is already gone. */
export const moderationTargetSchema = z
  .object({
    state: z.enum(['live', 'erased']),
    /** The post or comment status. Null once the target is erased. */
    status: z.string().min(1).max(64).nullable(),
    publishedAt: isoSchema.nullable(),
    /** The parent comment for a reply, when still live. */
    parentBody: z.string().nullable(),
  })
  .strict()

export const moderationIdentitySchema = z
  .object({
    state: moderationAliasStateSchema,
    alias: z.string().min(1).max(64).nullable(),
  })
  .strict()

export const moderationReporterSchema = z
  .object({
    identity: moderationIdentitySchema,
    origin: moderationReportOriginSchema,
    reason: communityReportReasonSchema,
    /** Reporter free text from post reports, at most 500 characters. Plain text only. */
    details: z.string().max(500).nullable(),
    reportedAt: isoSchema,
    resolved: z.boolean(),
  })
  .strict()

export const moderationFindingsSchema = z
  .object({
    /** Known screening codes only. */
    codes: z.array(z.string().min(1).max(64)),
    categories: z.array(z.string().min(1).max(32)),
    engineVersion: z.string().min(1).max(64).nullable(),
    /** A free-text reason an operator wrote. Never a screening code. Plain text only. */
    operatorNote: z.string().max(2000).nullable(),
  })
  .strict()

export const moderationPriorActionSchema = z
  .object({
    actorKind: moderationActorKindSchema,
    action: z.string().min(1).max(64),
    reason: z.string().max(2000).nullable(),
    occurredAt: isoSchema,
  })
  .strict()

export const moderationMediaSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      url: z.string().url(),
      expiresAt: isoSchema,
      altText: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      reason: moderationMediaUnavailableReasonSchema,
    })
    .strict(),
])
export type ModerationMedia = z.infer<typeof moderationMediaSchema>

export const moderationCaseDetailSchema = z
  .object({
    caseId: moderationCaseIdSchema,
    source: moderationCaseSourceSchema,
    status: moderationCaseStatusSchema,
    risk: moderationCaseRiskSchema,
    slaState: moderationCaseSlaStateSchema,
    slaDueAt: isoSchema,
    acceptedAt: isoSchema,
    serverNow: isoSchema,
    reportCount: z.number().int().min(1),
    locale: z.string().min(1).max(35).nullable(),
    subject: moderationIdentitySchema,
    snapshot: moderationSnapshotSchema,
    target: moderationTargetSchema,
    findings: moderationFindingsSchema.nullable(),
    reporters: z.array(moderationReporterSchema).min(1),
    priorActions: z.array(moderationPriorActionSchema),
    media: moderationMediaSchema,
    /** The moderator wrote the target or filed one of its reports. 6.11 refuses self-review. */
    viewerConflict: z.boolean(),
    ...moderationCaseDecisionStateSchema.shape,
  })
  .strict()
export type ModerationCaseDetail = z.infer<typeof moderationCaseDetailSchema>
export const moderationCaseDetailResponseSchema = z
  .object({ data: moderationCaseDetailSchema })
  .strict()

// --- OpenAPI ----------------------------------------------------------------

export function registerModerationQueueContracts(registry: OpenAPIRegistry) {
  registry.register('ModerationCasesResponse', moderationCasesResponseSchema)
  registry.register('ModerationCaseDetailResponse', moderationCaseDetailResponseSchema)
  registry.register('ModerationQueueError', moderationQueueErrorSchema)
  const error = (description: string) => ({
    description,
    content: { 'application/json': { schema: moderationQueueErrorSchema } },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/moderation/cases',
    operationId: 'listModerationCases',
    tags: ['moderation'],
    security: [{ bearerAuth: [] }],
    summary: 'The moderator case queue (private, no-store)',
    description:
      'Moderator and admin only. Read-only. Ordered by risk, earliest open due time and case key, with a signed keyset cursor bound to the filters.',
    request: { query: moderationCasesQuerySchema },
    responses: {
      200: {
        description: 'One page of cases',
        content: { 'application/json': { schema: moderationCasesResponseSchema } },
      },
      400: error('invalid_filter or invalid_cursor'),
      401: { description: 'Authentication required' },
      403: { description: 'Insufficient role' },
      503: error('moderation_console_disabled'),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/moderation/cases/{caseId}',
    operationId: 'getModerationCase',
    tags: ['moderation'],
    security: [{ bearerAuth: [] }],
    summary: 'One moderation case with its full context (private, no-store)',
    description:
      'Moderator and admin only. Read-only except for one audit row per successful read.',
    request: { params: z.object({ caseId: moderationCaseIdSchema }) },
    responses: {
      200: {
        description: 'The case detail',
        content: { 'application/json': { schema: moderationCaseDetailResponseSchema } },
      },
      401: { description: 'Authentication required' },
      403: { description: 'Insufficient role' },
      404: error('case_not_found'),
      503: error('moderation_console_disabled or audit_unavailable'),
    },
  })
}
