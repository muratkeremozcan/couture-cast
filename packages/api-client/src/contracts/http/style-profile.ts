import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { SAMPLE_STYLE_OPTIONS, STYLE_AVOID_OPTIONS } from '@couture/utils'
import { z } from 'zod'
import type { RegisteredCommonHttpSchemas } from './common'

export const styleMoodEnum = z.enum(SAMPLE_STYLE_OPTIONS.style)
export const stylePaletteEnum = z.enum(SAMPLE_STYLE_OPTIONS.palette)
export const styleTextureEnum = z.enum(SAMPLE_STYLE_OPTIONS.texture)
export const styleFitEnum = z.enum(SAMPLE_STYLE_OPTIONS.fit)
export const styleAvoidEnum = z.enum(STYLE_AVOID_OPTIONS)

export const styleProfileSchema = z.strictObject({
  mood: styleMoodEnum.nullable(),
  palette: stylePaletteEnum.nullable(),
  texture: styleTextureEnum.nullable(),
  fit: styleFitEnum.nullable(),
  avoid: z
    .array(styleAvoidEnum)
    .max(3)
    .refine((values) => new Set(values).size === values.length, 'Pieces must be unique')
    .meta({
      description: 'The pieces the member prefers to avoid. Each choice may appear once.',
      uniqueItems: true,
    }),
})

export const updateStyleProfileInputSchema = styleProfileSchema
  .partial()
  .describe('Only supplied style preference fields are updated.')
export const styleProfileResponseSchema = z
  .strictObject({ data: styleProfileSchema })
  .describe('The authenticated account’s style preferences.')

export type StyleProfile = z.infer<typeof styleProfileSchema>
export type UpdateStyleProfileInput = z.infer<typeof updateStyleProfileInputSchema>
export type StyleProfileResponse = z.infer<typeof styleProfileResponseSchema>

export function registerStyleProfileContracts(
  registry: OpenAPIRegistry,
  common: RegisteredCommonHttpSchemas
) {
  const input = registry.register(
    'UpdateStyleProfileInput',
    updateStyleProfileInputSchema
  )
  const response = registry.register('StyleProfileResponse', styleProfileResponseSchema)
  const json = (schema: z.ZodType) => ({ 'application/json': { schema } })
  const headers = z.object({ 'Cache-Control': z.literal('private, no-store') })
  const methods = [
    ['get', 'Get account style preferences'],
    ['patch', 'Update the supplied account style preferences'],
    ['delete', 'Clear account style preferences'],
  ] as const

  for (const [method, summary] of methods) {
    registry.registerPath({
      method,
      path: '/api/v1/personalization/style-profile',
      tags: ['personalization'],
      summary,
      security: [{ bearerAuth: [] }],
      ...(method === 'patch' && {
        request: { body: { required: true, content: json(input) } },
      }),
      responses: {
        200: {
          description: 'Account style preferences.',
          headers,
          content: json(response),
        },
        ...(method === 'patch' && {
          400: {
            description: 'Invalid style preferences.',
            headers,
            content: json(common.badRequestHttpErrorSchema),
          },
        }),
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
          description: 'Account verification is temporarily unavailable.',
          headers,
          content: json(common.serviceUnavailableHttpErrorSchema),
        },
      },
    })
  }
}
