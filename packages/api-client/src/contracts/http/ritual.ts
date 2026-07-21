import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { nonEmptyStringSchema, type RegisteredCommonHttpSchemas } from './common'
import { weatherSnapshotSchema } from './weather'

export const scenarioNameSchema = z.enum(['morning', 'midday', 'evening'])

export const scenarioOutfitSchema = z.object({
  id: nonEmptyStringSchema.describe('Unique identifier for the recommendation card.'),
  scenario: scenarioNameSchema.describe(
    'The daily scenario: morning, midday, or evening.'
  ),
  garmentIds: z
    .array(z.string())
    .describe('The custom or fallback garment identifiers suggested.'),
  // Story 2.3 Task 1 step 1 owner: update reasoningBadges property in the HTTP contracts schema
  reasoningBadges: z
    .array(
      z.object({
        key: nonEmptyStringSchema.describe('Unique key for the badge.'),
        label: nonEmptyStringSchema.describe('Localized default label for the badge.'),
        bullets: z
          .array(z.string())
          .describe('Explanatory bullet points explaining why the badge triggered.'),
      })
    )
    .describe('Reasoning badges justifying the garments chosen.'),
  comfortNotes: z
    .string()
    .describe('Explanation string based on weather and comfort thresholds.'),
})

export const ritualResponseSchema = z.object({
  data: z.object({
    weather: weatherSnapshotSchema,
    outfits: z
      .array(scenarioOutfitSchema)
      .length(3)
      .refine(
        (items) => {
          const scenarios = items.map((item) => item.scenario)
          return new Set(scenarios).size === 3
        },
        {
          message:
            'Outfits must cover three distinct scenarios (morning, midday, and evening).',
        }
      ),
    badges: z.array(z.string()),
  }),
})

export const ritualQueryParamsSchema = z
  .object({
    locationId: nonEmptyStringSchema
      .optional()
      .describe('Optional ID of a saved user location key or preferences reference.'),
  })
  .strict()

export type ScenarioName = z.infer<typeof scenarioNameSchema>
export type ScenarioOutfit = z.infer<typeof scenarioOutfitSchema>
export type RitualResponse = z.infer<typeof ritualResponseSchema>
export type RitualQueryParams = z.infer<typeof ritualQueryParamsSchema>

export function registerRitualContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })

  registry.register('ScenarioName', scenarioNameSchema)
  registry.register('ScenarioOutfit', scenarioOutfitSchema)
  const registeredRitualResponseSchema = registry.register(
    'RitualResponse',
    ritualResponseSchema
  )
  const registeredRitualQueryParamsSchema = registry.register(
    'RitualQueryParams',
    ritualQueryParamsSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/ritual',
    tags: ['ritual'],
    summary: 'Get or generate outfit recommendations for daily scenarios',
    description:
      'Generates three distinct outfits (morning, midday, evening) based on timezone-aligned weather snapshots and personalized comfort/wardrobe constraints.',
    security: [{ bearerAuth: [] }],
    request: {
      query: registeredRitualQueryParamsSchema,
    },
    responses: {
      200: {
        description: 'Successfully fetched or generated daily outfits',
        content: {
          'application/json': {
            schema: registeredRitualResponseSchema,
          },
        },
      },
      400: {
        description: 'Invalid query parameters or setup error',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Forbidden - User/guardian permission issues',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      500: {
        description: 'Internal server error occurred',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
    },
  })
}
