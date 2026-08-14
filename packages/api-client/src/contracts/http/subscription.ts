// Story 5.2 Task 2 owner: premium subscription HTTP contracts.
//
// Design decisions that are load-bearing and easy to undo by accident:
//
// 1. No `SUBSCRIPTION_*` codes on the wire. Every shared error envelope in
//    `common.ts` is `.strict()` over exactly `{ statusCode, message, error }`.
//    Callers assert on status plus one of the exported message constants below,
//    which exist so controllers and tests cannot drift apart.
//
// 2. `status: 'none'` is a wire-only value. The database has no `none` row —
//    an absent PremiumEntitlement row IS "never subscribed" — and the union
//    below makes the correlation unrepresentable to get wrong: a `none`
//    response cannot carry a store, and an entitled response cannot lack one.
//
// 3. `purchasesEnabled` is the ONLY path by which the commerce_subscription
//    kill switch reaches a client. Both clients read it before rendering any
//    subscribe control; no client-side flag lookup exists.
//
// 4. No prices anywhere. Stripe Checkout and the stores render prices; a price
//    crossing our wire would be integer minor units + ISO-4217, and today none
//    does.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'

/**
 * The two operator-provisioned plans. A closed enum: adding a plan is a
 * deliberate contract change, and an unknown plan string fails the checkout
 * request at the schema with a 400 before any Stripe call happens.
 */
export const subscriptionPlanSchema = z.enum(['premium_monthly', 'premium_annual'])

/** Mirrors the EntitlementStore database enum; `promotional` = operator grants. */
export const entitlementStoreSchema = z.enum([
  'app_store',
  'play_store',
  'stripe',
  'promotional',
])

/**
 * Wire statuses. `none` means "no entitlement row exists"; the other four
 * mirror PremiumEntitlementStatus. Access rule: `active` and `grace_period`
 * pass the premium guard, everything else is denied.
 */
export const subscriptionStatusSchema = z.enum([
  'none',
  'active',
  'grace_period',
  'expired',
  'revoked',
])

const purchasesEnabledField = {
  purchasesEnabled: z
    .boolean()
    .describe(
      'Server-evaluated commerce_subscription_enabled flag. The only flag exposure path: clients render subscribe controls only when true. Status, refresh, and portal stay available regardless.'
    ),
}

export const subscriptionSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        status: z.literal('none'),
        store: z.null(),
        productId: z.null(),
        willRenew: z.null(),
        currentPeriodEnd: z.null(),
        syncedAt: z.null(),
        ...purchasesEnabledField,
      })
      .strict(),
    z
      .object({
        status: subscriptionStatusSchema.exclude(['none']),
        store: entitlementStoreSchema,
        productId: nonEmptyStringSchema.describe(
          'The provisioned product id, e.g. premium_monthly. Deliberately not the plan enum: the operator can add products without a contract change.'
        ),
        willRenew: z
          .boolean()
          .describe(
            'False after a cancellation while status stays active: the user keeps what they paid for until currentPeriodEnd.'
          ),
        currentPeriodEnd: isoTimestampSchema,
        syncedAt: isoTimestampSchema.describe(
          'Last successful sync from the entitlement ledger. Lets a client tell fresh state from a rate-limited refresh that served local state.'
        ),
        ...purchasesEnabledField,
      })
      .strict(),
  ])
  .openapi({
    description: [
      'One variant per subscription presence. The correlations between status and',
      'the entitlement fields are expressed by the variants themselves: a `none`',
      'response carries null entitlement fields with the keys still serialized,',
      'and an entitled response always carries all of them.',
    ].join(' '),
  })

export const subscriptionResponseSchema = z.object({
  data: subscriptionSchema,
})

export const checkoutSessionRequestSchema = z
  .object({
    plan: subscriptionPlanSchema.describe('Which Stripe price the session is for.'),
  })
  .strict()

export const checkoutSessionResponseSchema = z.object({
  data: z
    .object({
      url: z
        .string()
        .url()
        .describe(
          'Stripe-hosted Checkout URL. The web app redirects with window.location.assign; no Stripe dependency exists client-side.'
        ),
    })
    .strict(),
})

export const portalSessionResponseSchema = z.object({
  data: z
    .object({
      url: z
        .string()
        .url()
        .describe(
          'Stripe Customer Portal URL. Cancel, upgrade, and downgrade for web-managed subscriptions happen there, never in hand-built UI.'
        ),
    })
    .strict(),
})

export const billingWebhookResponseSchema = z.object({
  data: z.object({ received: z.literal(true) }).strict(),
})

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>
export type EntitlementStore = z.infer<typeof entitlementStoreSchema>
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>
export type Subscription = z.infer<typeof subscriptionSchema>
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>
export type CheckoutSessionRequest = z.infer<typeof checkoutSessionRequestSchema>
export type CheckoutSessionResponse = z.infer<typeof checkoutSessionResponseSchema>
export type PortalSessionResponse = z.infer<typeof portalSessionResponseSchema>
export type BillingWebhookResponse = z.infer<typeof billingWebhookResponseSchema>

// --- Error messages --------------------------------------------------------

/** Kill switch: checkout-session creation while commerce_subscription_enabled is off. */
export const COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE =
  'Premium subscriptions are temporarily unavailable.'

export const SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE =
  'This account already has an active Premium subscription.'

/** Portal session requested with no Stripe billing profile on record. */
export const SUBSCRIPTION_NOT_FOUND_MESSAGE =
  'No web subscription found for this account.'

/** Portal session requested for a store-managed (App Store / Play) subscription. */
export const SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE =
  'This subscription is managed in the app store it was purchased from.'

/** The RevenueCat ledger pull failed or timed out during refresh. */
export const SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE =
  'Subscription status is temporarily unavailable. Please try again shortly.'

/**
 * Every auth failure of both billing webhooks returns this one message, so
 * neither endpoint can be used to probe which secrets are configured. The
 * actual reason is logged server-side only.
 */
export const BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE = 'Invalid webhook credentials.'

/** The premium guard's 403 for non-entitled users on Premium-only surfaces. */
export const PREMIUM_REQUIRED_MESSAGE =
  'A Premium subscription is required for this feature.'

// --- OpenAPI registration --------------------------------------------------

export function registerSubscriptionContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('SubscriptionPlan', subscriptionPlanSchema)
  registry.register('EntitlementStore', entitlementStoreSchema)
  registry.register('SubscriptionStatus', subscriptionStatusSchema)
  registry.register('Subscription', subscriptionSchema)

  const registeredSubscriptionResponseSchema = registry.register(
    'SubscriptionResponse',
    subscriptionResponseSchema
  )
  const registeredCheckoutSessionRequestSchema = registry.register(
    'CheckoutSessionRequest',
    checkoutSessionRequestSchema
  )
  const registeredCheckoutSessionResponseSchema = registry.register(
    'CheckoutSessionResponse',
    checkoutSessionResponseSchema
  )
  const registeredPortalSessionResponseSchema = registry.register(
    'PortalSessionResponse',
    portalSessionResponseSchema
  )
  const registeredBillingWebhookResponseSchema = registry.register(
    'BillingWebhookResponse',
    billingWebhookResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/commerce/subscription',
    tags: ['subscription'],
    summary: 'Read the premium subscription status',
    description:
      'Returns the subscription state for the acting user from the local entitlement mirror, plus the server-evaluated purchasesEnabled flag. Deliberately NOT gated by commerce_subscription_enabled: a paying user must always be able to see their subscription, including while purchasing is switched off.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Subscription state retrieved (status "none" when never subscribed)',
        content: {
          'application/json': { schema: registeredSubscriptionResponseSchema },
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
    method: 'post',
    path: '/api/v1/commerce/subscription/refresh',
    tags: ['subscription'],
    summary: 'Refresh the subscription from the entitlement ledger',
    description: `Synchronously pulls the RevenueCat ledger and applies the snapshot, beating webhook latency after a purchase. Rate limited per user (10-second minimum interval; inside the window the local state is served — syncedAt tells the caller which happened). A ledger failure returns 503 ("${SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE}") rather than stale-as-fresh.`,
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description:
          'Subscription state after the ledger pull (or local state inside the rate-limit window)',
        content: {
          'application/json': { schema: registeredSubscriptionResponseSchema },
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
      503: {
        description: `The entitlement ledger was unreachable ("${SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE}")`,
        content: {
          'application/json': {
            schema: commonSchemas.serviceUnavailableHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/subscription/checkout-session',
    tags: ['subscription'],
    summary: 'Create a Stripe Checkout session',
    description:
      'Creates a subscription-mode Stripe Checkout session for the requested plan and returns its URL. The Stripe customer is created or reused at session-creation time and linked via client_reference_id AND metadata.userId, so an abandoned checkout still leaves a portal-capable customer. Status precedence is fixed so assertions are deterministic: 503 (kill switch) outranks 400 (schema) outranks 409 (already subscribed) outranks 500 (Stripe failure).',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredCheckoutSessionRequestSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'Checkout session created',
        content: {
          'application/json': { schema: registeredCheckoutSessionResponseSchema },
        },
      },
      400: {
        description: 'Invalid input payload (unknown plan)',
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
      409: {
        description: `The account already has an active or grace-period subscription ("${SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      500: {
        description: 'The Stripe API call failed or the Stripe key is missing',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description: `commerce_subscription_enabled resolved false ("${COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE}")`,
        content: {
          'application/json': {
            schema: commonSchemas.serviceUnavailableHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/subscription/portal-session',
    tags: ['subscription'],
    summary: 'Create a Stripe Customer Portal session',
    description: `Returns a Customer Portal URL for cancel/upgrade/downgrade of a web-managed subscription. Deliberately NOT gated by the kill switch: a paying user must always be able to manage and cancel. Store-managed subscriptions answer 409 ("${SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE}"); clients normally render a "manage in the App Store / Play Store" hint instead of calling.`,
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Portal session created',
        content: {
          'application/json': { schema: registeredPortalSessionResponseSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      404: {
        description: `No Stripe billing profile exists for this account ("${SUBSCRIPTION_NOT_FOUND_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      409: {
        description: `The subscription is store-managed ("${SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
      },
      500: {
        description: 'The Stripe API call failed or the Stripe key is missing',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/subscription/webhooks/stripe',
    tags: ['subscription'],
    summary: 'Receive a Stripe billing webhook',
    description:
      'Machine-to-machine, authenticated by the Stripe signature over the raw body — parsed only after verification. Idempotent on (provider, event id): replays return 200 and write nothing. Always records, even while purchasing is switched off: returning an error to a retrying provider would drop billing facts for payments that already happened. checkout.session.completed additionally records a forward obligation to the entitlement ledger, re-driven by the reconciliation sweep until satisfied.',
    responses: {
      200: {
        description: 'Event recorded, or recognised as a replay and ignored',
        content: {
          'application/json': { schema: registeredBillingWebhookResponseSchema },
        },
      },
      401: {
        description: `Any signature failure — missing header, stale timestamp, wrong secret, tampered body — returns this identical message ("${BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE}"); the reason is logged server-side only.`,
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/subscription/webhooks/revenuecat',
    tags: ['subscription'],
    summary: 'Receive a RevenueCat entitlement webhook',
    description:
      'Machine-to-machine, authenticated by HMAC signature (preferred) or the static Authorization header, compared in constant time — parsed only after verification. The single entitlement writer: every applied event records a BillingEvent, drives the entitlement transition, and writes an audit row in one transaction. Idempotent on (provider, event id); out-of-order events older than the last applied event are dropped. Unknown app_user_ids and unknown event types return 200 and record without transitioning, so a delivery is never bounced for a fact we cannot change.',
    responses: {
      200: {
        description: 'Event recorded (and applied when it transitions the entitlement)',
        content: {
          'application/json': { schema: registeredBillingWebhookResponseSchema },
        },
      },
      401: {
        description: `Any credential failure returns this identical message ("${BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE}"); the reason is logged server-side only.`,
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
    },
  })
}
