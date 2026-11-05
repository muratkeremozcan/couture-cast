// Story 6.12 owner: the SLA read route and the operations webhook contract in `packages/api-client/src/contracts/http/moderation-sla.ts`.
// The SLA thresholds stay in `moderation-queue.ts`. This file holds only what monitoring adds.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  moderationCaseIdSchema,
  moderationCaseRiskSchema,
  moderationCaseSourceSchema,
} from './moderation-queue'

// --- Vocabulary -------------------------------------------------------------

// Each schema owns a copy of its list, and each `.nullable()` sits on its own instance: zod-to-openapi
// pushes null into the enum values of a nullable enum, which would corrupt a shared array or schema.

export const moderationSlaAlertKinds = ['at_risk', 'breached', 'escalated'] as const
export const moderationSlaAlertKindSchema = z.enum([...moderationSlaAlertKinds])
export type ModerationSlaAlertKind = z.infer<typeof moderationSlaAlertKindSchema>

export const moderationSlaDeliveryStates = [
  'pending',
  'delivered',
  'console_only',
  'superseded',
] as const
export const moderationSlaDeliveryStateSchema = z.enum([...moderationSlaDeliveryStates])
export type ModerationSlaDeliveryState = z.infer<typeof moderationSlaDeliveryStateSchema>

/** `interrupted` is recorded by a claim that finds a lease a dead worker left behind. */
export const moderationSlaFailureCodes = [
  'timeout',
  'network',
  'http_3xx',
  'http_4xx',
  'http_5xx',
  'invalid_config',
  'interrupted',
] as const
export const moderationSlaFailureCodeSchema = z.enum([...moderationSlaFailureCodes])
export type ModerationSlaFailureCode = z.infer<typeof moderationSlaFailureCodeSchema>

export const moderationSlaChannels = ['webhook', 'console'] as const
export const moderationSlaChannelSchema = z.enum([...moderationSlaChannels])
export type ModerationSlaChannel = z.infer<typeof moderationSlaChannelSchema>

export const moderationSlaErrorCodeSchema = z.enum(['moderation_sla_disabled'])
export type ModerationSlaErrorCode = z.infer<typeof moderationSlaErrorCodeSchema>

export const moderationSlaErrorSchema = z
  .object({
    statusCode: z.number().int(),
    code: moderationSlaErrorCodeSchema,
    message: z.string().min(1),
  })
  .strict()
export type ModerationSlaError = z.infer<typeof moderationSlaErrorSchema>

/** A monitor stamp older than this is reported as stale. Five missed one-minute sweeps. */
export const MODERATION_SLA_MONITOR_STALE_MS = 5 * 60 * 1000
export const MODERATION_SLA_RECENT_ALERTS_LIMIT = 50
export const MODERATION_SLA_RESOLUTION_WINDOW_DAYS = 7

// --- Read route -------------------------------------------------------------

const isoSchema = z.string().datetime()
const countSchema = z.number().int().nonnegative()

export const moderationSlaRecentAlertSchema = z
  .object({
    id: z.string().min(1),
    kind: moderationSlaAlertKindSchema,
    caseId: moderationCaseIdSchema,
    source: moderationCaseSourceSchema,
    risk: moderationCaseRiskSchema,
    slaDueAt: isoSchema,
    detectedAt: isoSchema,
    delivery: moderationSlaDeliveryStateSchema,
    attempts: countSchema,
    lastErrorCode: z.enum([...moderationSlaFailureCodes]).nullable(),
    deliveredAt: isoSchema.nullable(),
  })
  .strict()
export type ModerationSlaRecentAlert = z.infer<typeof moderationSlaRecentAlertSchema>

export const moderationSlaSummarySchema = z
  .object({
    serverNow: isoSchema,
    monitor: z
      .object({
        lastSweepAt: isoSchema.nullable(),
        stale: z.boolean(),
        channel: z.enum([...moderationSlaChannels]).nullable(),
      })
      .strict(),
    queue: z
      .object({
        onTrack: countSchema,
        atRisk: countSchema,
        breached: countSchema,
        escalated: countSchema,
        oldestDueAt: isoSchema.nullable(),
      })
      .strict(),
    resolution: z
      .object({
        windowDays: z.literal(MODERATION_SLA_RESOLUTION_WINDOW_DAYS),
        resolved: countSchema,
        withinSla: countSchema,
        late: countSchema,
      })
      .strict(),
    alerts: z
      .object({
        pending: countSchema,
        failing: countSchema,
        consoleOnly: countSchema,
      })
      .strict(),
    screening: z.object({ oldestPendingReviewAt: isoSchema.nullable() }).strict(),
    recentAlerts: z
      .array(moderationSlaRecentAlertSchema)
      .max(MODERATION_SLA_RECENT_ALERTS_LIMIT),
  })
  .strict()
export type ModerationSlaSummary = z.infer<typeof moderationSlaSummarySchema>

export const moderationSlaResponseSchema = z
  .object({ data: moderationSlaSummarySchema })
  .strict()
export type ModerationSlaResponse = z.infer<typeof moderationSlaResponseSchema>

// --- Operations webhook -----------------------------------------------------

/** Every field a receiver sees. It holds no reason, excerpt, alias, reporter or subject. */
export const moderationSlaWebhookPayloadSchema = z
  .object({
    id: z.string().min(1),
    kind: moderationSlaAlertKindSchema,
    source: moderationCaseSourceSchema,
    risk: moderationCaseRiskSchema,
    slaDueAt: isoSchema,
    detectedAt: isoSchema,
    casePath: z.string().startsWith('/moderation/cases/'),
    caseUrl: z.string().url().nullable(),
    text: z.string().min(1),
  })
  .strict()
export type ModerationSlaWebhookPayload = z.infer<
  typeof moderationSlaWebhookPayloadSchema
>

/** The one payload `npm run moderation:sla:drill` sends. It names no case. */
export const moderationSlaDrillPayloadSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal('drill'),
    detectedAt: isoSchema,
    text: z.string().min(1),
  })
  .strict()
export type ModerationSlaDrillPayload = z.infer<typeof moderationSlaDrillPayloadSchema>

// --- OpenAPI ----------------------------------------------------------------

export function registerModerationSlaContracts(registry: OpenAPIRegistry) {
  registry.register('ModerationSlaResponse', moderationSlaResponseSchema)
  registry.register('ModerationSlaError', moderationSlaErrorSchema)

  registry.registerPath({
    method: 'get',
    path: '/api/v1/moderation/sla',
    operationId: 'getModerationSla',
    tags: ['moderation'],
    security: [{ bearerAuth: [] }],
    summary: 'SLA state of the queue and the monitor (private, no-store)',
    description:
      'Moderator and admin only. Read-only. Counts, monitor health and the newest operations alerts, with no case content.',
    responses: {
      200: {
        description: 'The SLA summary',
        content: { 'application/json': { schema: moderationSlaResponseSchema } },
      },
      401: { description: 'Authentication required' },
      403: { description: 'Insufficient role' },
      503: {
        description: 'moderation_sla_disabled',
        content: { 'application/json': { schema: moderationSlaErrorSchema } },
      },
    },
  })
}
