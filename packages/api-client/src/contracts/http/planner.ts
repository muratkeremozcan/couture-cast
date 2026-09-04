import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { nonEmptyStringSchema, type RegisteredCommonHttpSchemas } from './common'
import { supportedLocaleSchema } from './localization'
import { nullableWeatherConditionSchema } from './weather'
import { garmentCategoryEnum, garmentImageAccessSchema } from './wardrobe'
import { scenarioOutfitSchema } from './ritual'
import { PREMIUM_REQUIRED_MESSAGE } from './subscription'

// Story 5.5 Decision 5: the platform header every planner operation requires,
// so `premium_planner_viewed`/`premium_planner_day_reshuffled` can carry a
// server-trusted `platform` property instead of a client-supplied one.
export const plannerPlatformSchema = z.enum(['web', 'mobile'])

export const plannerHeadersSchema = z.object({
  'x-couture-platform': plannerPlatformSchema.describe(
    'Which client is calling. Required on every planner operation; drives the platform property on both planner analytics events.'
  ),
})

/**
 * Validated `YYYY-MM-DD`, checked for real calendar validity (not just the
 * digit shape). Local to this contract module rather than imported from the
 * API's weather or personalization internals, matching this package's
 * existing pattern of small, self-contained validators.
 */
export const plannerLocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid local date')
  .refine((value) => {
    const parts = value.split('-')
    const year = Number(parts[0])
    const month = Number(parts[1])
    const day = Number(parts[2])
    const parsed = new Date(Date.UTC(year, month - 1, day))
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    )
  }, 'Invalid calendar date')
  .openapi({
    description: [
      'Runtime invariant NOT expressible in this schema: a real calendar date',
      '(e.g. `2026-02-30` fails), not just the `YYYY-MM-DD` digit shape.',
    ].join(' '),
  })

function toEpochDay(localDate: string): number {
  const parts = localDate.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

// --- Weather summary ---------------------------------------------------------

export const plannerWeatherConfidenceSchema = z.enum(['hourly', 'daily', 'unavailable'])
export const plannerWeatherFreshnessSchema = z.enum(['fresh', 'cached', 'stale'])

export const plannerWeatherSummarySchema = z
  .object({
    confidence: plannerWeatherConfidenceSchema.describe(
      'hourly: exact 08:00/13:00/19:00 segments. daily: projected from the provider daily summary. unavailable: no usable weather for this date at all.'
    ),
    freshness: plannerWeatherFreshnessSchema
      .nullable()
      .describe(
        'Null exactly when confidence is unavailable; there is no snapshot to date.'
      ),
    condition: nullableWeatherConditionSchema,
    temperatureLow: z.number().finite().nullable(),
    temperatureHigh: z.number().finite().nullable(),
  })
  .strict()

// --- Scenario outfit (display-enriched) --------------------------------------

export const plannerDisplayGarmentSchema = z
  .object({
    id: nonEmptyStringSchema,
    category: garmentCategoryEnum.nullable(),
    imageAccess: garmentImageAccessSchema.nullable(),
  })
  .strict()

export const plannerScenarioOutfitSchema = scenarioOutfitSchema.extend({
  displayGarments: z
    .array(plannerDisplayGarmentSchema)
    .describe(
      'Category and fresh signed image access for every real garment id in garmentIds, batched in one lookup per Decision 4 rather than resolved per garment. A starter-wardrobe placeholder id has no entry here.'
    ),
  // Story 5.5 Decision 4: planner affiliate behavior is deliberately out of
  // scope. Narrowed from the base schema's `shopThisLookSchema.nullable()` to
  // always null, so a client can rely on the constraint rather than the
  // absence of live data.
  shopThisLook: z
    .null()
    .describe(
      'Always null. Planner cards never carry an affiliate CTA; this preserves the shared scenario contract while keeping planner affiliate behavior out of scope for this story.'
    ),
})

// --- Day result (discriminated union) ----------------------------------------

export const plannerReadyDaySchema = z
  .object({
    status: z.literal('ready'),
    planDate: plannerLocalDateSchema,
    version: z.number().int().min(1),
    weather: plannerWeatherSummarySchema,
    isStarterWardrobe: z
      .boolean()
      .describe(
        'True when any scenario fell back to a placeholder garment because the eligible wardrobe had nothing for a required category.'
      ),
    outfits: z
      .array(plannerScenarioOutfitSchema)
      .min(3)
      .max(3)
      .refine((items) => new Set(items.map((item) => item.scenario)).size === 3, {
        message:
          'Outfits must cover three distinct scenarios (morning, midday, and evening).',
      })
      .openapi({
        description: [
          'Collection invariant enforced at runtime and NOT expressible in this schema:',
          'the three outfits always cover three distinct scenarios (morning, midday,',
          'evening), one each.',
        ].join(' '),
      }),
  })
  .strict()

export const PLANNER_GENERATION_FAILED_ERROR_CODE = 'generation_failed'

export const plannerErrorDaySchema = z
  .object({
    status: z.literal('error'),
    planDate: plannerLocalDateSchema,
    errorCode: z.literal(PLANNER_GENERATION_FAILED_ERROR_CODE),
    retryable: z.literal(true),
  })
  .strict()

export const plannerDayResultSchema = z.discriminatedUnion('status', [
  plannerReadyDaySchema,
  plannerErrorDaySchema,
])

// --- GET response -------------------------------------------------------------

export const plannerQueryParamsSchema = z
  .object({
    locationId: nonEmptyStringSchema
      .optional()
      .describe(
        'Optional ID of a saved user location. Defaults to the primary or first location.'
      ),
    locale: supportedLocaleSchema
      .optional()
      .describe('Optional locale override for this localized planner response.'),
  })
  .strict()

export const plannerResponseSchema = z.object({
  data: z.object({
    locationId: nonEmptyStringSchema,
    timezone: nonEmptyStringSchema,
    anchorDate: plannerLocalDateSchema,
    daysReady: z.number().int().min(0).max(7),
    days: z
      .array(plannerDayResultSchema)
      .min(7)
      .max(7)
      .refine(
        (days) => {
          const dates = days.map((day) => day.planDate)
          if (new Set(dates).size !== dates.length) {
            return false
          }
          const epochDays = dates.map(toEpochDay)
          return epochDays.every(
            (value, index) => index === 0 || value === epochDays[index - 1]! + 1
          )
        },
        {
          message:
            'days must be exactly seven unique, consecutive local dates in chronological order.',
        }
      )
      .openapi({
        description: [
          'Collection invariant enforced at runtime and NOT expressible in this schema:',
          'exactly seven unique, consecutive local dates in chronological order, one entry',
          'per date. A failed date is represented as status "error" rather than omitted, so',
          'the array is always exactly seven long.',
        ].join(' '),
      }),
  }),
})

// --- Reshuffle ------------------------------------------------------------

export const plannerReshufflePathParamsSchema = z
  .object({
    planDate: plannerLocalDateSchema,
  })
  .strict()

export const plannerReshuffleInputSchema = z
  .object({
    expectedVersion: z
      .number()
      .int()
      .min(1)
      .describe(
        'The version currently displayed by the client. Guards against a stale reshuffle.'
      ),
  })
  .strict()

export const plannerReshuffleResponseSchema = z.object({
  data: z.object({
    day: plannerReadyDaySchema,
    unchanged: z
      .boolean()
      .describe(
        'True only when all three scenario garment sets and capsule choices are identical to the displayed result.'
      ),
  }),
})

// --- Messages ---------------------------------------------------------------

export const PREMIUM_PLANNER_DISABLED_MESSAGE =
  'The premium planner is temporarily unavailable.'
export const PLANNER_DAY_CHANGED_MESSAGE = 'This day changed since you last viewed it.'

// --- Types --------------------------------------------------------------------

export type PlannerPlatform = z.infer<typeof plannerPlatformSchema>
export type PlannerWeatherConfidence = z.infer<typeof plannerWeatherConfidenceSchema>
export type PlannerWeatherFreshness = z.infer<typeof plannerWeatherFreshnessSchema>
export type PlannerWeatherSummary = z.infer<typeof plannerWeatherSummarySchema>
export type PlannerDisplayGarment = z.infer<typeof plannerDisplayGarmentSchema>
export type PlannerScenarioOutfit = z.infer<typeof plannerScenarioOutfitSchema>
export type PlannerReadyDay = z.infer<typeof plannerReadyDaySchema>
export type PlannerErrorDay = z.infer<typeof plannerErrorDaySchema>
export type PlannerDayResult = z.infer<typeof plannerDayResultSchema>
export type PlannerQueryParams = z.infer<typeof plannerQueryParamsSchema>
export type PlannerResponse = z.infer<typeof plannerResponseSchema>
export type PlannerReshufflePathParams = z.infer<typeof plannerReshufflePathParamsSchema>
export type PlannerReshuffleInput = z.infer<typeof plannerReshuffleInputSchema>
export type PlannerReshuffleResponse = z.infer<typeof plannerReshuffleResponseSchema>

// --- Registration ---------------------------------------------------------

export function registerPlannerContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('PlannerDayResult', plannerDayResultSchema)
  const registeredPlannerResponseSchema = registry.register(
    'PlannerResponse',
    plannerResponseSchema
  )
  const registeredPlannerQueryParamsSchema = registry.register(
    'PlannerQueryParams',
    plannerQueryParamsSchema
  )
  const registeredPlannerHeadersSchema = registry.register(
    'PlannerHeaders',
    plannerHeadersSchema
  )
  const registeredPlannerReshufflePathParamsSchema = registry.register(
    'PlannerReshufflePathParams',
    plannerReshufflePathParamsSchema
  )
  const registeredPlannerReshuffleInputSchema = registry.register(
    'PlannerReshuffleInput',
    plannerReshuffleInputSchema
  )
  const registeredPlannerReshuffleResponseSchema = registry.register(
    'PlannerReshuffleResponse',
    plannerReshuffleResponseSchema
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
    path: '/api/v1/commerce/premium/planner',
    tags: ['planner'],
    summary: 'Get or generate the seven-day outfit planner for a saved location',
    description:
      'Returns exactly seven consecutive local dates, each ready with three scenario outfits or reporting an isolated generation failure. Weather-aware: uses exact hourly segments when available, a daily-summary projection when not, and an honest wardrobe baseline when no usable weather exists for a date.',
    security: [{ bearerAuth: [] }],
    request: {
      query: registeredPlannerQueryParamsSchema,
      headers: registeredPlannerHeadersSchema,
    },
    responses: {
      200: {
        description: 'Planner window resolved (fully or partially ready)',
        content: { 'application/json': { schema: registeredPlannerResponseSchema } },
      },
      400: {
        description: 'Invalid query parameters',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      403: {
        description: `Not entitled ("${PREMIUM_REQUIRED_MESSAGE}") or location not owned by user`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      503: {
        description: `premium_planner_enabled resolved false ("${PREMIUM_PLANNER_DISABLED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
      ...commonErrorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/premium/planner/{planDate}/reshuffle',
    tags: ['planner'],
    summary: 'Reshuffle one day of the planner',
    description:
      'Regenerates a single date, preferring capsules and garments absent from the currently displayed result. Atomic: the three scenarios, version, source, and reshuffle count change together or not at all.',
    security: [{ bearerAuth: [] }],
    request: {
      params: registeredPlannerReshufflePathParamsSchema,
      query: registeredPlannerQueryParamsSchema,
      headers: registeredPlannerHeadersSchema,
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredPlannerReshuffleInputSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Day reshuffled (or left unchanged, when no disjoint result exists)',
        content: {
          'application/json': { schema: registeredPlannerReshuffleResponseSchema },
        },
      },
      400: {
        description: 'Invalid planDate or request body',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      403: {
        description: `Not entitled ("${PREMIUM_REQUIRED_MESSAGE}"), or location/date not owned by or in scope for user`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      409: {
        description: `The displayed version is stale ("${PLANNER_DAY_CHANGED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      503: {
        description: `premium_planner_enabled resolved false ("${PREMIUM_PLANNER_DISABLED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.serviceUnavailableHttpErrorSchema },
        },
      },
      ...commonErrorResponses,
    },
  })
}
