import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import type { RegisteredCommonHttpSchemas } from './common'

export const photoAiFeatureSchema = z.enum([
  'community-description',
  'garment-cutout',
  'garment-tags',
  'flat-lay-garments',
])
export const photoAiInputClassSchema = z.enum([
  'community-photo',
  'garment-photo',
  'flat-lay-photo',
])

const grantId = z.string().min(1).max(128)

export const revokePhotoAiConsentInputSchema = z.strictObject({ grantId })

export const photoAiConsentGrantSchema = z.strictObject({
  id: grantId,
  feature: photoAiFeatureSchema,
  inputClass: photoAiInputClassSchema,
  provider: z.string().min(1),
  policyVersion: z.string().min(1),
  expiresAt: z.iso.datetime(),
})

export const photoAiConsentResponseSchema = z.strictObject({
  data: z.strictObject({
    externalProcessingEnabled: z.literal(false),
    grants: z.array(photoAiConsentGrantSchema),
  }),
})

export type PhotoAiFeature = z.infer<typeof photoAiFeatureSchema>
export type PhotoAiInputClass = z.infer<typeof photoAiInputClassSchema>
export type PhotoAiConsentGrant = z.infer<typeof photoAiConsentGrantSchema>
export type PhotoAiConsentResponse = z.infer<typeof photoAiConsentResponseSchema>

export function registerPhotoAiConsentContracts(
  registry: OpenAPIRegistry,
  common: RegisteredCommonHttpSchemas
): void {
  const input = registry.register(
    'RevokePhotoAiConsentInput',
    revokePhotoAiConsentInputSchema
  )
  const grant = registry.register('PhotoAiConsentGrant', photoAiConsentGrantSchema)
  const response = registry.register(
    'PhotoAiConsentResponse',
    photoAiConsentResponseSchema.extend({
      data: photoAiConsentResponseSchema.shape.data.extend({ grants: z.array(grant) }),
    })
  )
  const headers = z.object({ 'Cache-Control': z.literal('private, no-store') })
  const json = (schema: z.ZodType) => ({ 'application/json': { schema } })
  const responses = {
    200: {
      description: 'Current permissions for the signed-in member.',
      headers,
      content: json(response),
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
      description: 'Account verification is temporarily unavailable.',
      headers,
      content: json(common.serviceUnavailableHttpErrorSchema),
    },
  }
  const tags = ['privacy']
  const security = [{ bearerAuth: [] }]
  registry.registerPath({
    method: 'get',
    path: '/api/v1/privacy/photo-ai-consent',
    tags,
    summary: 'List photo AI permissions for the signed-in member',
    security,
    responses,
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/privacy/photo-ai-consent/revoke',
    tags,
    summary: 'Revoke a photo AI permission held by the signed-in member',
    security,
    request: { body: { required: true, content: json(input) } },
    responses: {
      ...responses,
      400: {
        description: 'Invalid grant identifier.',
        headers,
        content: json(common.badRequestHttpErrorSchema),
      },
    },
  })
}
