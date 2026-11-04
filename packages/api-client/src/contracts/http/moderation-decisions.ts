// Story 6.11 owner: the moderation decision and appeal contract in `packages/api-client/src/contracts/http/moderation-decisions.ts`.
// The controller, OpenAPI document, generated SDK and web console all derive from these schemas.
// `moderationActionAvailability` is the single rule for what a viewer may do to a case: the detail
// route lists it through `deriveAllowedActions` and the decision route enforces it.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { communityModerationReasonCategories } from './community'
import {
  moderationAppealStatusSchema,
  moderationAppealStepSchema,
  moderationCaseIdSchema,
  moderationCaseStatusSchema,
  moderationDecisionActionSchema,
  moderationSanctionKindSchema,
  moderationSanctionSchema,
  type ModerationAppealStatus,
  type ModerationAppealStep,
  type ModerationDecisionAction,
  type ModerationSanctionKind,
} from './moderation-queue'

// --- Stored markers ---------------------------------------------------------

/** Prefix of the ban marker in `LookbookPost.moderation_reason` and `CommunityComment.screening_reason`. */
export const COMMUNITY_BAN_MARKER_PREFIX = 'community_ban:'
/** The closed `CommunityComment.screening_reason` of a comment takedown. The operator's words stay on the decision. */
export const MODERATION_OPERATOR_TAKEDOWN_REASON = 'operator_takedown'

/** True for a stored reason written by a ban or a comment takedown, which is never a screening finding. */
export function isOperatorHoldReason(reason: string | null | undefined): boolean {
  return (
    reason === MODERATION_OPERATOR_TAKEDOWN_REASON ||
    (reason ?? '').startsWith(COMMUNITY_BAN_MARKER_PREFIX)
  )
}

// --- Requests ---------------------------------------------------------------

export const MODERATION_REASON_MIN_LENGTH = 3
export const MODERATION_REASON_MAX_LENGTH = 1000
export const MODERATION_BAN_DURATION_DAYS = Object.freeze([1, 7, 30, 90] as const)

/**
 * Plain text, trimmed, then measured. A takedown stores it in `moderation_reason`, so a value that
 * reads as a screening code or a ban marker would turn an operator's words into a machine verdict.
 */
export const moderationDecisionReasonSchema = z
  .string()
  .trim()
  .min(MODERATION_REASON_MIN_LENGTH)
  .max(MODERATION_REASON_MAX_LENGTH)
  .refine(
    (reason) =>
      communityModerationReasonCategories(reason) === null &&
      !reason.startsWith(COMMUNITY_BAN_MARKER_PREFIX),
    { message: 'Reason is reserved.' }
  )
  .openapi({
    description:
      'Plain text from the moderator. A value that matches a screening category or begins with the ban marker prefix is refused.',
  })

const revisionSchema = z.string().regex(/^[0-9a-f]{16}$/)

const decisionFields = {
  reason: moderationDecisionReasonSchema,
  mutationId: z.string().uuid(),
  expectedRevision: revisionSchema,
}

export const moderationBanTermsSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('temporary'),
      durationDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]),
    })
    .strict(),
  z.object({ kind: z.literal('permanent') }).strict(),
])
export type ModerationBanTerms = z.infer<typeof moderationBanTermsSchema>

/** No moderator field on any arm: the moderator is the session, and an unknown key is refused. */
export const moderationDecisionInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resolve'), ...decisionFields }).strict(),
  z.object({ action: z.literal('release'), ...decisionFields }).strict(),
  z.object({ action: z.literal('takedown'), ...decisionFields }).strict(),
  z.object({ action: z.literal('escalate'), ...decisionFields }).strict(),
  z
    .object({
      action: z.literal('ban'),
      ...decisionFields,
      ban: moderationBanTermsSchema,
    })
    .strict(),
])
export type ModerationDecisionInput = z.infer<typeof moderationDecisionInputSchema>

export const moderationAppealInputSchema = z
  .object({
    status: moderationAppealStepSchema,
    reason: moderationDecisionReasonSchema,
    mutationId: z.string().uuid(),
  })
  .strict()
export type ModerationAppealInput = z.infer<typeof moderationAppealInputSchema>

// --- Responses --------------------------------------------------------------

export const moderationCacheInvalidationSchema = z.enum(['completed', 'deferred'])
export type ModerationCacheInvalidation = z.infer<
  typeof moderationCacheInvalidationSchema
>

/** What a replay returns from the decision row. `cacheInvalidation` is measured per request, so it is not stored. */
export const moderationStoredDecisionResultSchema = z
  .object({
    decisionId: z.string().min(1).max(64),
    caseId: moderationCaseIdSchema,
    action: moderationDecisionActionSchema,
    decidedAt: z.string().datetime(),
    firstDecisionAt: z.string().datetime().nullable(),
    revision: revisionSchema,
    caseStatus: moderationCaseStatusSchema,
    escalated: z.boolean(),
    /** The target's status after the decision. Null for an erased target. */
    targetStatus: z.string().min(1).max(64).nullable(),
    sanction: moderationSanctionSchema.nullable(),
  })
  .strict()
export type ModerationStoredDecisionResult = z.infer<
  typeof moderationStoredDecisionResultSchema
>

export const moderationDecisionResultSchema = moderationStoredDecisionResultSchema
  .extend({
    replayed: z.boolean(),
    cacheInvalidation: moderationCacheInvalidationSchema,
  })
  .strict()
export type ModerationDecisionResult = z.infer<typeof moderationDecisionResultSchema>
export const moderationDecisionResponseSchema = z
  .object({ data: moderationDecisionResultSchema })
  .strict()

export const moderationStoredAppealResultSchema = z
  .object({
    decisionId: z.string().min(1).max(64),
    decidedAt: z.string().datetime(),
    sanction: moderationSanctionSchema,
    /** True while the ban still refuses the member. An overturned or expired ban is false. */
    active: z.boolean(),
    /** How many hidden items came back. Zero when the member is no longer eligible. */
    restoredCount: z.number().int().min(0),
  })
  .strict()
export type ModerationStoredAppealResult = z.infer<
  typeof moderationStoredAppealResultSchema
>

export const moderationAppealResultSchema = moderationStoredAppealResultSchema
  .extend({
    replayed: z.boolean(),
    cacheInvalidation: moderationCacheInvalidationSchema,
  })
  .strict()
export type ModerationAppealResult = z.infer<typeof moderationAppealResultSchema>
export const moderationAppealResponseSchema = z
  .object({ data: moderationAppealResultSchema })
  .strict()

// --- Errors -----------------------------------------------------------------

export const moderationDecisionErrorCodeSchema = z.enum([
  'invalid_decision',
  'case_not_found',
  'sanction_not_found',
  'moderation_console_disabled',
  'moderation_decisions_disabled',
  'self_review_refused',
  'admin_required',
  'operator_sanctioned',
  'case_conflict',
  'action_not_applicable',
  'idempotency_mismatch',
  'appeal_transition_invalid',
  'audit_unavailable',
])
export type ModerationDecisionErrorCode = z.infer<
  typeof moderationDecisionErrorCodeSchema
>

/** Why an action cannot apply to the case as it stands. */
export const moderationDecisionDetailSchema = z.enum([
  'no_open_reports',
  'target_not_held',
  'target_not_published',
  'already_escalated',
  'target_erased',
  'subject_banned',
  'already_banned',
  'author_ineligible',
  'community_writes_closed',
])
export type ModerationDecisionDetail = z.infer<typeof moderationDecisionDetailSchema>

export const moderationDecisionErrorSchema = z
  .object({
    statusCode: z.number().int(),
    code: moderationDecisionErrorCodeSchema,
    message: z.string().min(1),
    /** Only on `action_not_applicable`. */
    detail: moderationDecisionDetailSchema.optional(),
    /** Only on `case_conflict`. */
    currentRevision: revisionSchema.optional(),
  })
  .strict()
export type ModerationDecisionError = z.infer<typeof moderationDecisionErrorSchema>

/** Distinct from the rollout copy, because both clients still match 403 messages after reading `code`. */
export const COMMUNITY_BANNED_MESSAGE = 'Community access is suspended for this account.'

/** The member's view of their own ban. It names no reason, moderator, case or sanction id. */
export const communityBannedErrorSchema = z
  .object({
    statusCode: z.literal(403),
    code: z.literal('community_banned'),
    message: z.string().min(1),
    sanction: z
      .object({
        kind: moderationSanctionKindSchema,
        expiresAt: z.string().datetime().nullable(),
        appealStatus: moderationAppealStatusSchema,
      })
      .strict(),
  })
  .strict()
export type CommunityBannedError = z.infer<typeof communityBannedErrorSchema>

// --- The availability rule ---------------------------------------------------

const RELEASABLE_POST_STATUSES: readonly string[] = ['flagged']
const RELEASABLE_COMMENT_STATUSES: readonly string[] = [
  'held_for_review',
  'blocked',
  'screening_failed',
]

export type ModerationCaseTargetState =
  /** An orphan case, an anonymized post, an erased comment or a null author. */
  | { state: 'erased' }
  | {
      state: 'live'
      kind: 'post' | 'comment'
      status: string
      /** The post has `erasure_requested_at`. It refuses a release and still allows a ban. */
      erasureRequested: boolean
    }

export interface ModerationAvailabilityInput {
  role: 'moderator' | 'admin'
  viewerConflict: boolean
  operatorSanctioned: boolean
  escalated: boolean
  openReportCount: number
  target: ModerationCaseTargetState
  /** The kind of the author's active ban, or null. */
  subjectBan: ModerationSanctionKind | null
  /** `assertCommunityDatabaseAccess` passes for the author, ban aside. */
  authorEligible: boolean
  /** `community_write_enabled` for the author. */
  writesOpen: boolean
}

export type ModerationAvailability =
  | { available: true }
  | {
      available: false
      code: 'operator_sanctioned' | 'self_review_refused' | 'admin_required'
    }
  | {
      available: false
      code: 'action_not_applicable'
      detail: ModerationDecisionDetail
    }

const notApplicable = (detail: ModerationDecisionDetail): ModerationAvailability => ({
  available: false,
  code: 'action_not_applicable',
  detail,
})

const AVAILABLE: ModerationAvailability = { available: true }

const releaseAvailability = (
  input: ModerationAvailabilityInput
): ModerationAvailability => {
  const { target } = input
  if (target.state === 'erased' || target.erasureRequested)
    return notApplicable('target_erased')
  const releasable =
    target.kind === 'post' ? RELEASABLE_POST_STATUSES : RELEASABLE_COMMENT_STATUSES
  if (!releasable.includes(target.status)) return notApplicable('target_not_held')
  if (input.subjectBan !== null) return notApplicable('subject_banned')
  if (!input.authorEligible) return notApplicable('author_ineligible')
  return input.writesOpen ? AVAILABLE : notApplicable('community_writes_closed')
}

const banAvailability = (
  input: ModerationAvailabilityInput,
  banKind?: ModerationSanctionKind
): ModerationAvailability => {
  if (input.target.state === 'erased') return notApplicable('target_erased')
  if (input.subjectBan === 'permanent') return notApplicable('already_banned')
  if (input.subjectBan === 'temporary' && banKind !== 'permanent')
    return notApplicable('already_banned')
  return AVAILABLE
}

/** The state half of the rule, per action. */
const STATE_RULES: Readonly<
  Record<
    ModerationDecisionAction,
    (
      input: ModerationAvailabilityInput,
      banKind?: ModerationSanctionKind
    ) => ModerationAvailability
  >
> = {
  resolve: (input) =>
    input.openReportCount > 0 ? AVAILABLE : notApplicable('no_open_reports'),
  escalate: (input) => {
    if (input.openReportCount === 0) return notApplicable('no_open_reports')
    return input.escalated ? notApplicable('already_escalated') : AVAILABLE
  },
  takedown: ({ target }) => {
    if (target.state === 'erased') return notApplicable('target_erased')
    return target.status === 'published'
      ? AVAILABLE
      : notApplicable('target_not_published')
  },
  release: releaseAvailability,
  ban: banAvailability,
}

/** The viewer half of the rule, in the TEA-08 order: own standing, conflict, role. */
export function moderationViewerRefusal(
  input: ModerationAvailabilityInput,
  action: ModerationDecisionAction,
  banKind?: ModerationSanctionKind
): 'operator_sanctioned' | 'self_review_refused' | 'admin_required' | null {
  if (input.operatorSanctioned) return 'operator_sanctioned'
  if (input.viewerConflict) return 'self_review_refused'
  if (input.role === 'admin') return null
  const terminalOnEscalated = input.escalated && action !== 'escalate'
  const permanentBan = action === 'ban' && banKind === 'permanent'
  return terminalOnEscalated || permanentBan ? 'admin_required' : null
}

/**
 * Whether the viewer may apply an action now. `case_conflict` sits between the viewer half and the
 * state half, so the decision path calls `moderationViewerRefusal`, checks the revision, then calls this.
 */
export function moderationActionAvailability(
  input: ModerationAvailabilityInput,
  action: ModerationDecisionAction,
  banKind?: ModerationSanctionKind
): ModerationAvailability {
  const refusal = moderationViewerRefusal(input, action, banKind)
  if (refusal) return { available: false, code: refusal }
  return STATE_RULES[action](input, banKind)
}

/** The appeal rule the standing section lists and the appeal route enforces. */
export function deriveAllowedAppealSteps(input: {
  role: 'moderator' | 'admin'
  viewerConflict: boolean
  operatorSanctioned: boolean
  /** Not lifted and not past its expiry. */
  sanctionActive: boolean
  appealStatus: ModerationAppealStatus
}): ModerationAppealStep[] {
  if (input.viewerConflict || input.operatorSanctioned || !input.sanctionActive) return []
  if (input.appealStatus === 'not_requested') return ['requested']
  if (input.appealStatus === 'requested' && input.role === 'admin')
    return ['upheld', 'overturned']
  return []
}

/** The list the case detail returns. An empty list means the console renders no form. */
export function deriveAllowedActions(input: ModerationAvailabilityInput): {
  allowedActions: ModerationDecisionAction[]
  banKinds: ModerationSanctionKind[]
} {
  const banKinds = moderationSanctionKindSchema.options.filter(
    (kind) => moderationActionAvailability(input, 'ban', kind).available
  )
  const allowedActions: ModerationDecisionAction[] = (
    ['resolve', 'release', 'takedown', 'escalate'] as const
  ).filter((action) => moderationActionAvailability(input, action).available)
  return {
    allowedActions: banKinds.length > 0 ? [...allowedActions, 'ban'] : allowedActions,
    banKinds,
  }
}

// --- OpenAPI ----------------------------------------------------------------

export function registerModerationDecisionContracts(registry: OpenAPIRegistry) {
  registry.register('ModerationDecisionInput', moderationDecisionInputSchema)
  registry.register('ModerationDecisionResponse', moderationDecisionResponseSchema)
  registry.register('ModerationAppealInput', moderationAppealInputSchema)
  registry.register('ModerationAppealResponse', moderationAppealResponseSchema)
  registry.register('ModerationDecisionError', moderationDecisionErrorSchema)
  registry.register('CommunityBannedError', communityBannedErrorSchema)
  const error = (description: string) => ({
    description,
    content: { 'application/json': { schema: moderationDecisionErrorSchema } },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/moderation/cases/{caseId}/decisions',
    operationId: 'applyModerationDecision',
    tags: ['moderation'],
    security: [{ bearerAuth: [] }],
    summary: 'Apply one decision to a whole case (private, no-store)',
    description:
      'Moderator and admin only. The moderator is the session. One transaction per decision, idempotent per moderator and mutationId.',
    request: {
      params: z.object({ caseId: moderationCaseIdSchema }),
      body: {
        required: true,
        content: { 'application/json': { schema: moderationDecisionInputSchema } },
      },
    },
    responses: {
      200: {
        description: 'The decision applied, or the stored response of a retry',
        content: { 'application/json': { schema: moderationDecisionResponseSchema } },
      },
      400: error('invalid_decision'),
      401: { description: 'Authentication required' },
      403: error(
        'Insufficient role, self_review_refused, admin_required or operator_sanctioned'
      ),
      404: error('case_not_found'),
      409: error('case_conflict, action_not_applicable or idempotency_mismatch'),
      503: error(
        'moderation_console_disabled, moderation_decisions_disabled or audit_unavailable'
      ),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/moderation/sanctions/{sanctionId}/appeal',
    operationId: 'recordModerationAppeal',
    tags: ['moderation'],
    security: [{ bearerAuth: [] }],
    summary: 'Record one appeal step on a sanction (private, no-store)',
    description:
      'Moderator and admin may record requested. Only an admin may record upheld or overturned.',
    request: {
      params: z.object({ sanctionId: z.string().min(1).max(64) }),
      body: {
        required: true,
        content: { 'application/json': { schema: moderationAppealInputSchema } },
      },
    },
    responses: {
      200: {
        description: 'The step recorded, or the stored response of a retry',
        content: { 'application/json': { schema: moderationAppealResponseSchema } },
      },
      400: error('invalid_decision'),
      401: { description: 'Authentication required' },
      403: error(
        'Insufficient role, self_review_refused, admin_required or operator_sanctioned'
      ),
      404: error('sanction_not_found'),
      409: error('appeal_transition_invalid or idempotency_mismatch'),
      503: error(
        'moderation_console_disabled, moderation_decisions_disabled or audit_unavailable'
      ),
    },
  })
}
