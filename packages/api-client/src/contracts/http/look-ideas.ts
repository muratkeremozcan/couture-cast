import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  COMMUNITY_SAMPLE_WEATHER_KEYS,
  memberLookbookRankingSchema,
  SAMPLE_WEATHER_KEYS,
} from '@couture/utils'
import { z } from 'zod'
import type { RegisteredCommonHttpSchemas } from './common'
import { styleProfileSchema } from './style-profile'

export const lookIdeasInputSchema = z.strictObject({
  weather: z.enum([...SAMPLE_WEATHER_KEYS, ...COMMUNITY_SAMPLE_WEATHER_KEYS]),
  profile: styleProfileSchema.nullable(),
})

export const lookIdeasResponseSchema = z.strictObject({
  data: memberLookbookRankingSchema.nullable(),
})

export type LookIdeasInput = z.infer<typeof lookIdeasInputSchema>
export type LookIdeasResponse = z.infer<typeof lookIdeasResponseSchema>

export function registerLookIdeasContract(
  registry: OpenAPIRegistry,
  common: RegisteredCommonHttpSchemas
) {
  const input = registry.register('LookIdeasInput', lookIdeasInputSchema)
  const response = registry.register('LookIdeasResponse', lookIdeasResponseSchema)
  const headers = z.object({ 'Cache-Control': z.literal('private, no-store') })
  const json = (schema: z.ZodType) => ({ 'application/json': { schema } })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/personalization/look-ideas',
    tags: ['personalization'],
    summary: 'Rank and describe weather-eligible catalog outfits',
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: json(input) } },
    responses: {
      200: {
        description: 'Catalog outfit ranking if available.',
        headers,
        content: json(response),
      },
      400: {
        description: 'Invalid outfit preferences.',
        headers,
        content: json(common.badRequestHttpErrorSchema),
      },
      401: {
        description: 'Missing or invalid authentication.',
        headers,
        content: json(common.unauthorizedHttpErrorSchema),
      },
      403: {
        description: 'Account access restricted.',
        headers,
        content: json(common.forbiddenHttpErrorSchema),
      },
      503: {
        description: 'Account verification temporarily unavailable.',
        headers,
        content: json(common.serviceUnavailableHttpErrorSchema),
      },
    },
  })
}
