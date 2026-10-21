// Story 6.5 owner: separate versioned sync, settings, targets and installation contracts.
import { z } from 'zod'
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  communityCommentSchema,
  communityFeedModeSchema,
  communityReactionFeedItemSchema,
  communityReactionSummarySchema,
} from './community'
import { alertPreferencesSchema } from './alerts'
import { type RegisteredCommonHttpSchemas } from './common'

const id = z.string().trim().min(1).max(200)
const revision = z.string().regex(/^\d+$/)
export const communityNotificationDataSchema = z
  .object({
    version: z.literal(1),
    notificationId: z.string().uuid(),
    source: z.literal('notification'),
    type: z.literal('community'),
    cardId: id,
    commentId: id.optional(),
    parentId: id.optional(),
    expiresAt: z.string().datetime(),
  })
  .strict()
  .refine((value) => !value.parentId || Boolean(value.commentId), {
    message: 'Parent requires a comment.',
  })
export type CommunityNotificationData = z.infer<typeof communityNotificationDataSchema>
export const communityDoorbellSchema = z
  .object({ version: z.literal(1), type: z.literal('community:changed') })
  .strict()
export const communityAvailabilitySchema = z
  .object({ version: z.literal(1), status: z.enum(['unavailable', 'denied']) })
  .strict()
export const communityStreamEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      version: z.literal(1),
      kind: z.literal('resync'),
      resyncRequired: z.literal(true),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.enum(['post.published', 'reactions.changed', 'comment.published']),
      postId: id,
      commentId: id.optional(),
      parentId: id.optional(),
      communityRevision: revision,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal('comment.status'),
      postId: id,
      commentId: id,
      privateRevision: revision,
    })
    .strict(),
])
export const communityEventsQuerySchema = z
  .object({
    cursor: z.string().max(4096).optional(),
    mode: communityFeedModeSchema.default('all'),
  })
  .strict()
export const communityEventsResponseSchema = z
  .object({
    data: z
      .object({
        events: z.array(communityStreamEventSchema).max(200),
        nextCursor: z.string().min(1),
        hasMore: z.boolean(),
        resyncRequired: z.boolean(),
      })
      .strict(),
  })
  .strict()
export const communityNotificationPreferenceSchema = z
  .object({
    enabled: z.boolean(),
    timezoneConfigured: z.boolean().default(true),
    ...alertPreferencesSchema.innerType().shape,
    revision: id,
  })
  .strict()
export const communityNotificationPreferencesResponseSchema = z
  .object({ data: communityNotificationPreferenceSchema })
  .strict()
export const patchCommunityNotificationPreferencesSchema = z
  .object({
    baseRevision: id,
    enabled: z.boolean().optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietHoursStart: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    quietHoursEnd: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    timezone: alertPreferencesSchema.innerType().shape.timezone.optional(),
  })
  .strict()
const target = z
  .object({ key: id, postId: id, commentId: id.optional(), parentId: id.optional() })
  .strict()
export const resolveCommunityTargetsInputSchema = z
  .object({ targets: z.array(target).min(1).max(50) })
  .strict()
  .superRefine(({ targets }, ctx) => {
    if (new Set(targets.map((t) => t.key)).size !== targets.length)
      ctx.addIssue({
        code: 'custom',
        path: ['targets'],
        message: 'Target keys must be unique.',
      })
    if (targets.some((t) => t.parentId && !t.commentId))
      ctx.addIssue({
        code: 'custom',
        path: ['targets'],
        message: 'Parent requires a comment.',
      })
  })
export const resolvedCommunityTargetSchema = z.discriminatedUnion('status', [
  z.object({ key: id, status: z.literal('unavailable') }).strict(),
  z
    .object({
      key: id,
      status: z.literal('available'),
      communityRevision: revision,
      post: communityReactionFeedItemSchema.extend({
        reactions: communityReactionSummarySchema,
      }),
      comment: communityCommentSchema.nullable(),
      parent: communityCommentSchema.nullable(),
      pageCursor: z.string().nullable(),
      parentPageCursor: z.string().nullable(),
      threadPosition: z.number().int().nonnegative().nullable(),
    })
    .strict(),
])
export const resolveCommunityTargetsResponseSchema = z
  .object({
    data: z.object({ targets: z.array(resolvedCommunityTargetSchema).max(50) }).strict(),
  })
  .strict()
export const registerPushTokenInputSchema = z
  .object({
    token: z
      .string()
      .regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/)
      .max(255),
    installationId: z.string().uuid(),
    platform: z.enum(['ios', 'android']),
    permission: z.enum(['granted', 'denied', 'undetermined']),
    expectedBinding: z
      .object({
        registrationId: id,
        bindingGeneration: z.number().int().positive(),
      })
      .strict()
      .optional(),
    transfer: z.boolean().optional(),
  })
  .strict()
export const pushRegistrationSchema = z
  .object({
    registrationId: id,
    bindingGeneration: z.number().int().positive(),
    platform: z.string().nullable(),
    permission: z.enum(['granted', 'denied', 'undetermined', 'unknown']),
    lastUsedAt: z.string().datetime(),
  })
  .strict()
export const registerPushTokenResponseSchema = z
  .object({ data: pushRegistrationSchema })
  .strict()
export const pushRegistrationsResponseSchema = z
  .object({
    data: z.object({ registrations: z.array(pushRegistrationSchema).max(5) }).strict(),
  })
  .strict()
export const removePushRegistrationQuerySchema = z
  .object({ bindingGeneration: z.coerce.number().int().positive() })
  .strict()
export const removePushRegistrationResponseSchema = z
  .object({ data: z.object({ removed: z.boolean() }).strict() })
  .strict()

export type CommunityStreamEvent = z.infer<typeof communityStreamEventSchema>
export type CommunityNotificationSettings = z.infer<
  typeof communityNotificationPreferenceSchema
>
export type PatchCommunityNotificationPreferences = z.infer<
  typeof patchCommunityNotificationPreferencesSchema
>
export type ResolveCommunityTargetsInput = z.infer<
  typeof resolveCommunityTargetsInputSchema
>
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenInputSchema>

export const communityUnavailableResponseSchema = z
  .object({
    statusCode: z.literal(503),
    code: z.literal('unavailable'),
    retryAfterSeconds: z.number().int().min(1).max(45),
    message: z.string(),
    error: z.string().optional(),
  })
  .passthrough()
export const communityInvalidRequestResponseSchema = z
  .object({
    statusCode: z.literal(400).optional(),
    code: z.enum(['invalid_request', 'invalid_cursor']),
    message: z.string(),
  })
  .passthrough()
export const communityConflictResponseSchema = z
  .object({
    statusCode: z.literal(409).optional(),
    code: z.enum([
      'resync_required',
      'revision_conflict',
      'binding_changed',
      'registration_limit',
    ]),
    message: z.string().optional(),
    current: communityNotificationPreferenceSchema.optional(),
  })
  .passthrough()

export function registerCommunitySyncContracts(
  registry: OpenAPIRegistry,
  _common: RegisteredCommonHttpSchemas
) {
  const routes = [
    {
      method: 'get',
      path: '/community/events',
      operationId: 'getCommunityEvents',
      response: communityEventsResponseSchema,
      query: communityEventsQuerySchema,
    },
    {
      method: 'get',
      path: '/community/notification-preferences',
      operationId: 'getCommunityNotificationPreferences',
      response: communityNotificationPreferencesResponseSchema,
    },
    {
      method: 'patch',
      path: '/community/notification-preferences',
      operationId: 'patchCommunityNotificationPreferences',
      response: communityNotificationPreferencesResponseSchema,
      body: patchCommunityNotificationPreferencesSchema,
    },
    {
      method: 'post',
      path: '/community/targets/resolve',
      operationId: 'resolveCommunityTargets',
      response: resolveCommunityTargetsResponseSchema,
      body: resolveCommunityTargetsInputSchema,
    },
    {
      method: 'post',
      path: '/notifications/push-tokens',
      operationId: 'registerPushToken',
      response: registerPushTokenResponseSchema,
      body: registerPushTokenInputSchema,
    },
    {
      method: 'get',
      path: '/notifications/push-tokens',
      operationId: 'getPushRegistrations',
      response: pushRegistrationsResponseSchema,
    },
    {
      method: 'delete',
      path: '/notifications/push-tokens/{registrationId}',
      operationId: 'removePushRegistration',
      response: removePushRegistrationResponseSchema,
      query: removePushRegistrationQuerySchema,
    },
  ] as const
  for (const route of routes)
    registry.registerPath({
      method: route.method,
      path: `/api/v1${route.path}`,
      operationId: route.operationId,
      summary: route.operationId,
      tags: ['communitySync'],
      security: [{ bearerAuth: [] }],
      ...('query' in route ? { request: { query: route.query } } : {}),
      ...('body' in route
        ? {
            request: {
              body: {
                content: {
                  'application/json': {
                    schema: registry.register(`${route.operationId}Input`, route.body),
                  },
                },
              },
            },
          }
        : {}),
      ...(route.path.includes('{registrationId}')
        ? {
            parameters: [
              {
                in: 'path' as const,
                name: 'registrationId',
                required: true,
                schema: { type: 'string' as const },
              },
            ],
          }
        : {}),
      responses: {
        200: {
          description: 'Success',
          content: {
            'application/json': {
              schema: registry.register(`${route.operationId}Response`, route.response),
            },
          },
        },
        400: {
          description: 'Invalid request or cursor',
          content: {
            'application/json': { schema: communityInvalidRequestResponseSchema },
          },
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Denied' },
        409: {
          description: 'Revision conflict, binding conflict or resync_required',
          content: { 'application/json': { schema: communityConflictResponseSchema } },
        },
        503: {
          description: 'unavailable; bounded retry seconds preserve the remote cadence',
          content: { 'application/json': { schema: communityUnavailableResponseSchema } },
        },
      },
    })
}
