import { z } from 'zod'

/** Story 0.5 owner file: shared socket payload schemas.
 * Why this file exists:
 * - Realtime namespaces need one payload contract so web, mobile, and API all
 *   agree on version, timestamp, userId, and event-specific data.
 * - If each surface shaped its own socket payloads, fallback and debugging
 *   would drift quickly.
 * Alternatives:
 * - Untyped ad hoc JSON payloads per namespace.
 * - Provider-specific schema definitions duplicated in each app.
 * Ownership anchor:
 * - Story 0.5 Task 4 owner: define shared socket payload schemas for realtime namespaces.
 *
 * Flow refs:
 * - S0.5/T1: the gateway emits namespace-specific events using these contracts.
 * - S0.5/T5: polling fallback returns events that still need to match the same
 *   shared payload expectations.
 */
export interface BaseEvent<T = unknown> {
  version: string
  timestamp: string
  userId: string
  data: T
}

const isoTimestamp = z.string().datetime()

// Flow ref S0.5/T4: every socket payload starts from the same envelope before
// namespace-specific data is added.
const baseEventSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    version: z.string().min(1),
    timestamp: isoTimestamp,
    userId: z.string().min(1),
    data: dataSchema,
  })

export const lookbookNewEventSchema = baseEventSchema(
  z.object({
    postId: z.string().min(1),
    locale: z.string().optional(),
    climateBand: z.string().optional(),
    mediaUrls: z.array(z.string().url()).optional(),
  })
)

export type LookbookNewEvent = BaseEvent<z.infer<typeof lookbookNewEventSchema>['data']>

export const ritualUpdateEventSchema = baseEventSchema(
  z.object({
    ritualId: z.string().min(1),
    status: z.enum(['scheduled', 'in-progress', 'completed']),
    nextRunAt: isoTimestamp.optional(),
    message: z.string().optional(),
  })
)

export type RitualUpdateEvent = BaseEvent<z.infer<typeof ritualUpdateEventSchema>['data']>

export const alertWeatherEventSchema = baseEventSchema(
  z.object({
    alertType: z.enum(['temperature', 'precipitation', 'severe']),
    location: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(['info', 'warning', 'critical']),
  })
)

export type AlertWeatherEvent = BaseEvent<z.infer<typeof alertWeatherEventSchema>['data']>

export const socketEventSchemas = {
  'lookbook:new': lookbookNewEventSchema,
  'ritual:update': ritualUpdateEventSchema,
  'alert:weather': alertWeatherEventSchema,
}

export type SocketEvent =
  | { channel: 'lookbook:new'; event: LookbookNewEvent }
  | { channel: 'ritual:update'; event: RitualUpdateEvent }
  | { channel: 'alert:weather'; event: AlertWeatherEvent }
