// Story 5.3 Task 3 owner: premium theme HTTP contracts.
//
// Design decisions that are load-bearing and easy to undo by accident:
//
// 1. `theme: null` IS the Default palette. There is no `default`/`none` member
//    in `premiumThemeKeySchema`, because an absent selection and an explicit
//    "none" value would be two spellings of the same fact (the trap Story 5.2
//    named for PremiumEntitlementStatus). On the write path `null` resets to
//    Default; on the read path an absent stored row and a stored `null` are
//    indistinguishable by construction.
//
// 2. Three palettes, closed. Jewel Radiance, Autumn Umber, Winter Metallic come
//    from `refs/ux/ux-color-themes.html`, the file the UX spec designates as the
//    precise-values reference. Spring Bloom is marked future there and is
//    deliberately absent; adding a fourth member is a contract change, not a
//    UI change.
//
// 3. One round trip resolves the whole surface. `isEntitled` and `themesEnabled`
//    ride along with `theme` so no client has to combine this response with
//    `/api/v1/commerce/subscription` to decide what to render. A client that
//    joined two responses would also have two moments in time to disagree about.
//
// 4. No hex values on the wire. The palette tables live in each surface's own
//    styling layer (web CSS custom properties, mobile StyleSheet colors); the
//    contract carries the key only. A color crossing this wire would make every
//    palette tweak a contract change.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import type { RegisteredCommonHttpSchemas } from './common'
import { PREMIUM_REQUIRED_MESSAGE } from './subscription'

/**
 * The three shipped palettes. A closed enum: an unknown key fails the PUT at
 * the schema with a 400 before any write happens, and a stale key stored by an
 * older client is resolved to Default on read rather than rendered blindly.
 */
export const premiumThemeKeySchema = z.enum([
  'jewel_radiance',
  'autumn_umber',
  'winter_metallic',
])

/**
 * The nullable publication of the palette key. Every field that carries `theme`
 * on the wire goes through this, and the explicit `enum` is load-bearing rather
 * than decoration.
 *
 * zod-to-openapi renders `enum.nullable()` as
 * `{"type": ["string", "null"], "enum": [...values]}` and drops the `null`
 * member, which would document a schema that rejects the very value its type
 * allows. `openapi.ts` compensates with a `preserveNullableEnumValues` post-pass
 * that appends `null` in place, into an array zod-to-openapi hands out by
 * reference from the ZodEnum's own `_def.values`. Appending there would also add
 * `null` to the standalone `PremiumThemeKey` component and to the SDK enum
 * generated from it, neither of which accepts null. `premiumThemeKeySchema` is
 * this repository's first enum published both standalone and nullable, which is
 * why no earlier contract tripped it.
 *
 * Supplying the finished array here means the post-pass finds `null` already
 * present and leaves the shared values array untouched. Each call builds its own
 * array, so no two publications can alias one another either.
 * `premium-theme-contract.spec.ts` generates the document and pins both halves
 * of this: `PremiumThemeKey` without `null`, the nullable nodes with it.
 * `openapi.ts` records why the post-pass itself is not corrected in this change.
 */
const nullablePremiumThemeKeySchema = (description: string) =>
  premiumThemeKeySchema.nullable().openapi({
    type: ['string', 'null'],
    enum: [...premiumThemeKeySchema.options, null],
    description,
  })

export const premiumThemeSchema = z
  .object({
    theme: nullablePremiumThemeKeySchema(
      'The palette to render, already resolved server-side. Null is the Default monochrome-and-gold system, which is also what a non-entitled caller reads regardless of what is stored.'
    ),
    isEntitled: z
      .boolean()
      .describe(
        'Whether the acting user currently passes the premium entitlement check. False forces theme to null in the same response, so a client never has to combine entitlement with preference itself.'
      ),
    themesEnabled: z
      .boolean()
      .describe(
        'Server-evaluated premium_themes_enabled flag. The only flag exposure path: clients render the gallery as selectable only when true. Reading the current theme stays available regardless.'
      ),
  })
  .strict()

export const premiumThemeResponseSchema = z.object({
  data: premiumThemeSchema,
})

export const updatePremiumThemeInputSchema = z
  .object({
    theme: nullablePremiumThemeKeySchema(
      'The palette to store. Null resets to Default; it upserts the stored row to null and never deletes it, so reset and downgrade stay distinguishable from "never chose".'
    ),
  })
  .strict()

export const updatePremiumThemeResponseSchema = z.object({
  data: premiumThemeSchema,
})

export type PremiumThemeKey = z.infer<typeof premiumThemeKeySchema>
export type PremiumTheme = z.infer<typeof premiumThemeSchema>
export type PremiumThemeResponse = z.infer<typeof premiumThemeResponseSchema>
export type UpdatePremiumThemeInput = z.infer<typeof updatePremiumThemeInputSchema>
export type UpdatePremiumThemeResponse = z.infer<typeof updatePremiumThemeResponseSchema>

// --- Error messages --------------------------------------------------------

/**
 * Kill switch: a theme write while `premium_themes_enabled` resolves false.
 *
 * Only an entitled caller can ever see this. `PremiumEntitlementGuard` is a Nest
 * guard and runs pre-handler, while the flag check lives in the service body, so
 * a non-entitled caller gets 403 `PREMIUM_REQUIRED_MESSAGE` whatever the flag
 * says. That ordering is deliberate: a payer is the only one who needs to know
 * the feature is provisionally switched off.
 *
 * `PREMIUM_REQUIRED_MESSAGE` is owned by `subscription.ts` and reused here
 * rather than redefined, so the guard and this route cannot drift apart.
 */
export const PREMIUM_THEMES_DISABLED_MESSAGE =
  'Premium themes are temporarily unavailable.'

/**
 * A theme write whose owning `User` row no longer exists.
 *
 * The window is one request wide and only account erasure opens it: the upsert
 * violates `PremiumThemePreference_user_id_fkey` (Prisma `P2003`) because the
 * row it would write has nothing left to point at. Left unhandled that answered
 * 500, which reads as "the server is broken" for what is really "this account
 * is gone" — the same distinction `COMMERCE_OFFER_NOT_FOUND_MESSAGE` and
 * `SUBSCRIPTION_NOT_FOUND_MESSAGE` already draw for the other commerce writes.
 *
 * Documented as a 404 on the PUT operation below. An earlier revision left it
 * undocumented on the theory that publishing it would drag an `optic diff`
 * conversation into a defect fix; that was wrong twice over. Adding a response
 * to an operation is additive rather than breaking, and a status a client can
 * actually receive belongs in the contract whether or not documenting it is
 * convenient.
 */
export const PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE = 'Account not found.'

// --- OpenAPI registration --------------------------------------------------

export function registerPremiumThemeContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('PremiumThemeKey', premiumThemeKeySchema)
  registry.register('PremiumTheme', premiumThemeSchema)

  const registeredPremiumThemeResponseSchema = registry.register(
    'PremiumThemeResponse',
    premiumThemeResponseSchema
  )
  const registeredUpdatePremiumThemeInputSchema = registry.register(
    'UpdatePremiumThemeInput',
    updatePremiumThemeInputSchema
  )
  const registeredUpdatePremiumThemeResponseSchema = registry.register(
    'UpdatePremiumThemeResponse',
    updatePremiumThemeResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/commerce/premium/theme',
    tags: ['premium-theme'],
    summary: 'Read the resolved premium theme',
    description:
      'Returns the palette the acting user should render, together with the entitlement and flag state that produced it. Deliberately NOT entitlement-gated: every signed-in caller needs an answer, and a non-entitled caller simply reads theme null. A stored key the server no longer recognises also resolves to null rather than failing, so a stale client value degrades to Default instead of breaking the settings page.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description:
          'Resolved theme retrieved (null theme for Default, for non-entitled callers, and for a stale stored key)',
        content: {
          'application/json': { schema: registeredPremiumThemeResponseSchema },
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

  registry.registerPath({
    method: 'put',
    path: '/api/v1/commerce/premium/theme',
    tags: ['premium-theme'],
    summary: 'Select or reset the premium theme',
    description: `Stores the acting user's palette choice and returns the freshly resolved state, the same shape the GET returns. Null resets to Default by upserting the stored row to null; the row is never deleted, not on reset and not on entitlement loss. Status precedence is fixed so assertions are deterministic: 403 ("${PREMIUM_REQUIRED_MESSAGE}") outranks 503 ("${PREMIUM_THEMES_DISABLED_MESSAGE}"), because the entitlement guard runs pre-handler and the flag check lives in the service body. A non-entitled caller therefore never observes the kill switch.`,
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredUpdatePremiumThemeInputSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Theme stored, including when the value was unchanged',
        content: {
          'application/json': {
            schema: registeredUpdatePremiumThemeResponseSchema,
          },
        },
      },
      400: {
        description: 'Invalid input payload (unknown palette key or extra properties)',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: `The acting user has no active Premium entitlement ("${PREMIUM_REQUIRED_MESSAGE}"). Returned before the feature flag is consulted.`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: `The acting user's account no longer exists ("${PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE}"). One request wide: the upsert violates the preference table's user foreign key because the User row was deleted while the write was in flight. Documented on the PUT only — the GET reads and cannot hit the constraint.`,
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
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
      503: {
        description: `premium_themes_enabled resolved false ("${PREMIUM_THEMES_DISABLED_MESSAGE}"). Reachable only by an entitled caller.`,
        content: {
          'application/json': {
            schema: commonSchemas.serviceUnavailableHttpErrorSchema,
          },
        },
      },
    },
  })
}
