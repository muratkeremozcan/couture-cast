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
  // Story 6.9 D3: reauthorizes the previewed bytes for the OS share sheet. Same
  // shape as `save`; the server answers 403 with no audit row when the
  // per-member `share_card_native_share_enabled` flag is off.
  z
    .object({
      ...options,
      purpose: z.literal('share'),
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
// Story 6.9 D4: a dedicated capabilities read. Preview and save responses stay
// strict and unchanged, so a deployed 6.8 client never sees a new field.
export const shareCardCapabilitiesSchema = z.object({ nativeShare: z.boolean() }).strict()
export const shareCardCapabilitiesResponseSchema = z
  .object({ data: shareCardCapabilitiesSchema })
  .strict()
export type ShareCardSource = z.infer<typeof shareCardSourceSchema>
export type PrepareShareCardInput = z.infer<typeof prepareShareCardInputSchema>
export type PreparedShareCard = z.infer<typeof preparedShareCardSchema>
export type ShareCardCapabilities = z.infer<typeof shareCardCapabilitiesSchema>

export function registerShareCardsContracts(registry: OpenAPIRegistry) {
  registry.register('PrepareShareCardInput', prepareShareCardInputSchema)
  registry.register('PrepareShareCardResponse', prepareShareCardResponseSchema)
  registry.register('ShareCardCapabilitiesResponse', shareCardCapabilitiesResponseSchema)
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
        description: 'Exact preview bytes or fresh save or share authorization',
        content: { 'application/json': { schema: prepareShareCardResponseSchema } },
      },
      400: { description: 'Invalid request' },
      401: { description: 'Authentication required' },
      403: {
        description:
          'share_disabled: native share is off for this member (share purpose only), or access denied',
      },
      404: { description: 'source_unavailable' },
      409: { description: 'preview_changed' },
      503: { description: 'Preparation unavailable' },
    },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/share-cards/capabilities',
    operationId: 'getShareCardCapabilities',
    tags: ['share-cards'],
    security: [{ bearerAuth: [] }],
    summary: "The caller's share-card capabilities (private, no-store)",
    responses: {
      200: {
        description: 'Whether native share is enabled for this member',
        content: { 'application/json': { schema: shareCardCapabilitiesResponseSchema } },
      },
      401: { description: 'Authentication required' },
    },
  })
}
