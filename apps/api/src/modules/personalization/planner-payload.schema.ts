// Story 5.5 Decision 4: the internal strict Zod schema for
// `PlannerDayPlan.plan_payload`. Parsed on every read; a row that fails this
// parse is treated exactly like a missing row (deleted and regenerated).
//
// Contains scenario, garment ids, reasoning badges, comfort notes, capsule id
// and name, auto-filled garment ids, starter-wardrobe marker, and a weather
// summary. Deliberately omits signed image access (computed fresh on every
// read, batched, in PlannerService) and affiliate offers (out of scope).
import { z } from 'zod'
import {
  plannerWeatherConfidenceSchema,
  plannerWeatherFreshnessSchema,
  weatherConditionSchema,
} from '../../contracts/http.js'

const plannerPersistedBadgeSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    bullets: z.array(z.string()).min(1),
  })
  .strict()

const plannerPersistedOutfitSchema = z
  .object({
    scenario: z.enum(['morning', 'midday', 'evening']),
    garmentIds: z.array(z.string()),
    capsuleId: z.string().nullable(),
    capsuleName: z.string().nullable(),
    autoFilledGarmentIds: z.array(z.string()),
    reasoningBadges: z.array(plannerPersistedBadgeSchema),
    comfortNotes: z.string(),
  })
  .strict()

const plannerPersistedWeatherSchema = z
  .object({
    confidence: plannerWeatherConfidenceSchema,
    freshness: plannerWeatherFreshnessSchema.nullable(),
    condition: weatherConditionSchema.nullable(),
    temperatureLow: z.number().finite().nullable(),
    temperatureHigh: z.number().finite().nullable(),
  })
  .strict()

export const plannerPersistedPayloadSchema = z
  .object({
    outfits: z.array(plannerPersistedOutfitSchema).length(3),
    isStarterWardrobe: z.boolean(),
    weather: plannerPersistedWeatherSchema,
  })
  .strict()

export type PlannerPersistedPayload = z.infer<typeof plannerPersistedPayloadSchema>
export type PlannerPersistedOutfit = z.infer<typeof plannerPersistedOutfitSchema>
