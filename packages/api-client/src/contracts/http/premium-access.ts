// Story 6.14 D6 owner: the premium access source read.
//
// `GET /api/v1/commerce/subscription` keeps its contract: web and mobile parse it with strict
// schemas, so an added key would break every installed build. This separate read tells a client
// whether the member has premium and where it comes from, so a complimentary member sees that
// state and no subscribe control. Every premium feature surface keeps rendering from its own
// server-side `isEntitled` and per-member flags.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import type { RegisteredCommonHttpSchemas } from './common'

/**
 * `complimentary` wins when a member also pays, because the grant is what keeps access open
 * whatever the subscription does. `none` covers free members and lapsed subscriptions.
 */
export const premiumAccessSourceSchema = z.enum(['subscription', 'complimentary', 'none'])

const premiumField = (value: boolean) =>
  z.literal(value).describe('True when the member passes the premium guard right now.')

/**
 * One variant per source, so `premium` can never contradict `source`: it is true exactly when
 * the source is not `none`. Clients render the complimentary state from `source`, never from
 * subscription status alone.
 */
export const premiumAccessSchema = z
  .discriminatedUnion('source', [
    z.object({ premium: premiumField(true), source: z.literal('subscription') }).strict(),
    z
      .object({ premium: premiumField(true), source: z.literal('complimentary') })
      .strict(),
    z.object({ premium: premiumField(false), source: z.literal('none') }).strict(),
  ])
  .describe(
    'Where premium access comes from. `premium` is true exactly when `source` is not `none`.'
  )

export const premiumAccessResponseSchema = z.object({
  data: premiumAccessSchema,
})

export type PremiumAccessSource = z.infer<typeof premiumAccessSourceSchema>
export type PremiumAccess = z.infer<typeof premiumAccessSchema>
export type PremiumAccessResponse = z.infer<typeof premiumAccessResponseSchema>

export function registerPremiumAccessContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('PremiumAccessSource', premiumAccessSourceSchema)
  registry.register('PremiumAccess', premiumAccessSchema)
  const registeredPremiumAccessResponseSchema = registry.register(
    'PremiumAccessResponse',
    premiumAccessResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/commerce/premium/access',
    tags: ['subscription'],
    summary: 'Read whether the member has premium and where it comes from',
    description:
      'Bearer only, private and never cached. `premium` matches the premium guard for the same request. `source` is `complimentary` for an owner grant (which wins when the member also pays), `subscription` for an active or grace-period subscription, and `none` otherwise.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Premium access source resolved',
        content: {
          'application/json': { schema: registeredPremiumAccessResponseSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
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
