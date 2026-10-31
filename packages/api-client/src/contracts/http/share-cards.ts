// Story 6.8 Task 1 step 1 owner: define the prepare contract in `packages/api-client/src/contracts/http/share-cards.ts`
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { supportedLocaleSchema } from './localization'

export const SHARE_CARD_MAX_BYTES = 3 * 1024 * 1024
export const shareCardSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('outfit'),
      recommendationId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('community_post'),
      postId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/),
    })
    .strict(),
])
const options = {
  source: shareCardSourceSchema,
  locale: supportedLocaleSchema,
  watermark: z.boolean(),
}
export const shareCardDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const prepareShareCardInputSchema = z.discriminatedUnion('purpose', [
  z.object({ ...options, purpose: z.literal('preview') }).strict(),
  z
    .object({
      ...options,
      purpose: z.literal('save'),
      expectedSha256: shareCardDigestSchema,
    })
    .strict(),
])
export const preparedShareCardSchema = z
  .object({
    pngBase64: z
      .string()
      .min(1)
      .max(4 * Math.ceil(SHARE_CARD_MAX_BYTES / 3))
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    accessibilityLabel: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[^\p{Cc}]+$/u),
    sha256: shareCardDigestSchema,
    width: z.literal(1080),
    height: z.literal(1350),
    mimeType: z.literal('image/png'),
    filename: z.literal('couturecast-card.png'),
    templateVersion: z.literal(1),
  })
  .strict()
export const prepareShareCardResponseSchema = z
  .object({ data: preparedShareCardSchema })
  .strict()
export type ShareCardSource = z.infer<typeof shareCardSourceSchema>
export type PrepareShareCardInput = z.infer<typeof prepareShareCardInputSchema>
export type PreparedShareCard = z.infer<typeof preparedShareCardSchema>

export function registerShareCardsContracts(registry: OpenAPIRegistry) {
  registry.register('PrepareShareCardInput', prepareShareCardInputSchema)
  registry.register('PrepareShareCardResponse', prepareShareCardResponseSchema)
  registry.registerPath({
    method: 'post',
    path: '/api/v1/share-cards/prepare',
    operationId: 'prepareShareCard',
    tags: ['share-cards'],
    security: [{ bearerAuth: [] }],
    summary: 'Prepare an authorized deterministic branded PNG',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: prepareShareCardInputSchema } },
      },
    },
    responses: {
      200: {
        description: 'Exact preview bytes or fresh save authorization',
        content: { 'application/json': { schema: prepareShareCardResponseSchema } },
      },
      400: { description: 'Invalid request' },
      401: { description: 'Authentication required' },
      403: { description: 'Access denied' },
      404: { description: 'source_unavailable' },
      409: { description: 'preview_changed' },
      503: { description: 'Preparation unavailable' },
    },
  })
}
