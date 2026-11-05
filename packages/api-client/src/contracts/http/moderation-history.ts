// Story 6.13 owner: the erasure request route and the evidence bundle in `packages/api-client/src/contracts/http/moderation-history.ts`.
// The bundle's objects are strict, so a new database column cannot reach a compliance reviewer's file by accident.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { moderationCaseIdSchema, moderationCaseSourceSchema } from './moderation-queue'

/** Account erasure has this long from the request to finish. */
export const MODERATION_ERASURE_DEADLINE_MS = 72 * 60 * 60 * 1000
export const MODERATION_EVIDENCE_RANGE_MAX_MS = 90 * 24 * 60 * 60 * 1000
export const MODERATION_EVIDENCE_DECISIONS_MAX = 5000
/** Vercel Functions refuse a response past 4.5 MB, so a larger bundle would commit its audit row and never arrive. */
export const MODERATION_EVIDENCE_BYTES_MAX = 4_000_000
export const MODERATION_EVIDENCE_SCHEMA_VERSION = 1

const isoSchema = z.string().datetime({ offset: true })
const storedIsoSchema = z.string().datetime()
const countSchema = z.number().int().nonnegative()
const idSchema = z.string().min(1).max(128)

// --- Errors -----------------------------------------------------------------

export const moderationHistoryErrorCodeSchema = z.enum([
  'moderation_history_disabled',
  'admin_required',
  'self_review_refused',
  'member_not_found',
  'case_not_found',
  'invalid_request',
  'invalid_range',
  'export_too_large',
  'audit_unavailable',
])
export type ModerationHistoryErrorCode = z.infer<typeof moderationHistoryErrorCodeSchema>

export const moderationHistoryErrorSchema = z
  .object({
    statusCode: z.number().int(),
    code: moderationHistoryErrorCodeSchema,
    message: z.string().min(1),
  })
  .strict()
export type ModerationHistoryError = z.infer<typeof moderationHistoryErrorSchema>

// --- Erasure request --------------------------------------------------------

export const moderationErasureRequestSchema = z
  .object({ memberId: z.string().min(1).max(128) })
  .strict()
export type ModerationErasureRequest = z.infer<typeof moderationErasureRequestSchema>

export const moderationErasureResultSchema = z
  .object({
    requestId: idSchema,
    requestedAt: storedIsoSchema,
    deadlineAt: storedIsoSchema,
    replayed: z.boolean(),
  })
  .strict()
export type ModerationErasureResult = z.infer<typeof moderationErasureResultSchema>

export const moderationErasureResponseSchema = z
  .object({ data: moderationErasureResultSchema })
  .strict()
export type ModerationErasureResponse = z.infer<typeof moderationErasureResponseSchema>

// --- Evidence export --------------------------------------------------------

const caseScopeSchema = z
  .object({ scope: z.literal('case'), caseId: moderationCaseIdSchema })
  .strict()

/** Instants on the wire, so an offset selects the same rows as its UTC form. */
const rangeScopeSchema = z
  .object({ scope: z.literal('range'), from: isoSchema, to: isoSchema })
  .strict()

export const moderationEvidenceExportRequestSchema = z.discriminatedUnion('scope', [
  caseScopeSchema,
  rangeScopeSchema,
])
export type ModerationEvidenceExportRequest = z.infer<
  typeof moderationEvidenceExportRequestSchema
>

/** A range the route accepts: `from` before `to`, and at most 90 days. */
export function isModerationEvidenceRangeValid(range: {
  from: string
  to: string
}): boolean {
  const span = new Date(range.to).getTime() - new Date(range.from).getTime()
  return span > 0 && span <= MODERATION_EVIDENCE_RANGE_MAX_MS
}

/** Every value of the `ModerationDecisionAction` enum: appeal steps are decision rows too. */
export const moderationEvidenceDecisionActions = [
  'resolve',
  'release',
  'takedown',
  'escalate',
  'ban',
  'appeal_requested',
  'appeal_upheld',
  'appeal_overturned',
] as const

export const moderationEvidenceDecisionSchema = z
  .object({
    decisionId: idSchema,
    caseId: moderationCaseIdSchema,
    sequence: z.number().int().positive(),
    source: moderationCaseSourceSchema,
    action: z.enum([...moderationEvidenceDecisionActions]),
    /** Null when erasure removed the moderator's words. */
    reason: z.string().max(2000).nullable(),
    reasonRemoved: z.boolean(),
    /** An internal id, and null once that moderator is erased. */
    moderatorId: idSchema.nullable(),
    moderatorRole: z.string().min(1).max(32),
    subjectAlias: z.string().max(128).nullable(),
    isTerminal: z.boolean(),
    decidedAt: storedIsoSchema,
    anonymizedAt: storedIsoSchema.nullable(),
  })
  .strict()
export type ModerationEvidenceDecision = z.infer<typeof moderationEvidenceDecisionSchema>

export const moderationEvidenceReporterStates = ['member', 'screening', 'erased'] as const
export const moderationEvidenceReporterStateSchema = z.enum([
  ...moderationEvidenceReporterStates,
])
export type ModerationEvidenceReporterState = z.infer<
  typeof moderationEvidenceReporterStateSchema
>

/** That a report exists, its category and its origin. Nothing here can identify who filed it. */
export const moderationEvidenceReportSchema = z
  .object({
    reportId: idSchema,
    source: moderationCaseSourceSchema,
    reason: z.string().min(1).max(64),
    origin: z.enum(['member', 'screening']),
    reporterState: moderationEvidenceReporterStateSchema,
    acceptedAt: storedIsoSchema,
    dueAt: storedIsoSchema,
    resolvedAt: storedIsoSchema.nullable(),
  })
  .strict()
export type ModerationEvidenceReport = z.infer<typeof moderationEvidenceReportSchema>

export const moderationEvidenceAuditEventTypes = [
  'moderation_decision_applied',
  'moderation_appeal_recorded',
  'moderation_case_viewed',
] as const

export const moderationEvidenceAuditEventSchema = z
  .object({
    eventType: z.enum([...moderationEvidenceAuditEventTypes]),
    occurredAt: storedIsoSchema,
    /** Null once that person is erased, while the immutable audit row keeps its own value. */
    actorId: idSchema.nullable(),
    role: z.string().min(1).max(32).nullable(),
    action: z.string().min(1).max(64).nullable(),
  })
  .strict()
export type ModerationEvidenceAuditEvent = z.infer<
  typeof moderationEvidenceAuditEventSchema
>

export const moderationEvidenceAlertSchema = z
  .object({
    kind: z.enum(['at_risk', 'breached', 'escalated']),
    delivery: z.enum(['pending', 'delivered', 'console_only', 'superseded']),
    slaDueAt: storedIsoSchema,
    detectedAt: storedIsoSchema,
    deliveredAt: storedIsoSchema.nullable(),
  })
  .strict()
export type ModerationEvidenceAlert = z.infer<typeof moderationEvidenceAlertSchema>

export const moderationEvidenceBundleSchema = z
  .object({
    schemaVersion: z.literal(MODERATION_EVIDENCE_SCHEMA_VERSION),
    exportId: z.string().uuid(),
    generatedAt: storedIsoSchema,
    scope: z.discriminatedUnion('scope', [
      caseScopeSchema,
      z
        .object({
          scope: z.literal('range'),
          from: storedIsoSchema,
          to: storedIsoSchema,
        })
        .strict(),
    ]),
    /** SHA-256 of the canonical four arrays, also in the audit row. A digest, and no signature. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    counts: z
      .object({
        decisions: countSchema,
        reports: countSchema,
        auditEvents: countSchema,
        alerts: countSchema,
        /** Decisions a range export left out because the exporter wrote or reported that case. */
        withheldForConflict: countSchema,
      })
      .strict(),
    decisions: z.array(moderationEvidenceDecisionSchema),
    reports: z.array(moderationEvidenceReportSchema),
    auditEvents: z.array(moderationEvidenceAuditEventSchema),
    alerts: z.array(moderationEvidenceAlertSchema),
  })
  .strict()
export type ModerationEvidenceBundle = z.infer<typeof moderationEvidenceBundleSchema>

/** Whether this viewer's console offers the controls. The routes decide for themselves on each request. */
export const moderationEvidenceAvailabilitySchema = z
  .object({ rangeExport: z.boolean() })
  .strict()
export type ModerationEvidenceAvailability = z.infer<
  typeof moderationEvidenceAvailabilitySchema
>
export const moderationEvidenceAvailabilityResponseSchema = z
  .object({ data: moderationEvidenceAvailabilitySchema })
  .strict()
export type ModerationEvidenceAvailabilityResponse = z.infer<
  typeof moderationEvidenceAvailabilityResponseSchema
>

// --- OpenAPI ----------------------------------------------------------------

export function registerModerationHistoryContracts(registry: OpenAPIRegistry) {
  registry.register('ModerationErasureRequest', moderationErasureRequestSchema)
  registry.register('ModerationErasureResponse', moderationErasureResponseSchema)
  registry.register(
    'ModerationEvidenceExportRequest',
    moderationEvidenceExportRequestSchema
  )
  registry.register('ModerationEvidenceBundle', moderationEvidenceBundleSchema)
  registry.register('ModerationHistoryError', moderationHistoryErrorSchema)
  registry.register(
    'ModerationEvidenceAvailabilityResponse',
    moderationEvidenceAvailabilityResponseSchema
  )
  const error = (description: string) => ({
    description,
    content: { 'application/json': { schema: moderationHistoryErrorSchema } },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/moderation/erasure-requests',
    operationId: 'requestModerationErasure',
    tags: ['moderation'],
    security: [{ bearerAuth: [] }],
    summary:
      'Start the account erasure of community and moderation data (private, no-store)',
    description:
      'Admin only. Identity leaves moderation records in the same transaction, and the rest completes within 72 hours. A repeat returns the first request and never moves the clock.',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: moderationErasureRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'The member already had a request, which is returned unchanged',
        content: { 'application/json': { schema: moderationErasureResponseSchema } },
      },
      201: {
        description: 'The request was recorded and identity removed',
        content: { 'application/json': { schema: moderationErasureResponseSchema } },
      },
      400: error('invalid_request'),
      401: { description: 'Authentication required' },
      403: error('Insufficient role or admin_required'),
      404: error('member_not_found'),
      503: error('moderation_history_disabled or audit_unavailable'),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/moderation/evidence-exports/availability',
    operationId: 'getModerationEvidenceAvailability',
    tags: ['moderation'],
    security: [{ bearerAuth: [] }],
    summary:
      'Whether the console offers evidence export to this viewer (private, no-store)',
    description: 'Moderator and admin only. Answers 503 while the feature is off.',
    responses: {
      200: {
        description: 'What this viewer may export',
        content: {
          'application/json': { schema: moderationEvidenceAvailabilityResponseSchema },
        },
      },
      401: { description: 'Authentication required' },
      403: { description: 'Insufficient role' },
      503: error('moderation_history_disabled'),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/moderation/evidence-exports',
    operationId: 'exportModerationEvidence',
    tags: ['moderation'],
    security: [{ bearerAuth: [] }],
    summary: 'Download a moderation evidence bundle (private, no-store)',
    description:
      'A moderator or admin exports one case, and an admin alone exports a period. POST because each export writes one audit row in the transaction that reads the bundle.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: moderationEvidenceExportRequestSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'The bundle, as a file attachment',
        content: { 'application/json': { schema: moderationEvidenceBundleSchema } },
      },
      400: error('invalid_request or invalid_range'),
      401: { description: 'Authentication required' },
      403: error('Insufficient role, admin_required or self_review_refused'),
      404: error('case_not_found'),
      413: error('export_too_large'),
      503: error('moderation_history_disabled or audit_unavailable'),
    },
  })
}
