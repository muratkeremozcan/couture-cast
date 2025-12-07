import { z } from 'zod'

export interface BaseEvent<T = unknown> {
  version: string
  timestamp: string
  userId: string
  data: T
}

const isoTimestamp = z.string().datetime()

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
