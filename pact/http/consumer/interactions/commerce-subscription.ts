import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  checkoutSessionResponseSchema,
  portalSessionResponseSchema,
  subscriptionResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  isoTimestamp,
  like,
  nullValue,
  pactEventAuth,
  pactEventHeaders,
  string,
  type CreateClient,
} from './shared'

/* ---------------------------------------------------------------------------
 * Story 5.2 premium subscription lifecycle.
 *
 * Scoped to what each consumer actually calls (Pact mirrors usage): mobile
 * reads status and triggers the post-purchase refresh; web reads status and
 * creates Stripe Checkout / Customer Portal sessions. The billing webhooks
 * have no interaction here because Stripe and RevenueCat are their callers,
 * not our clients. WHEN each status is produced (flag resolution, the
 * 10-second refresh throttle, the entitlement transition table, Stripe
 * failures) is proven in the API unit and integration suites; these
 * interactions record the statuses, error envelopes, and the discriminated
 * status union a client must understand.
 *
 * The two hosts are RFC-2606 `.test`, matching Decision 9's fake Stripe
 * client: a URL recorded in a pact file can never resolve on the public
 * internet.
 *
 * Every identifier below is mirrored in `pact/http/provider/provider-helper.ts`.
 * Both sides must agree or the pinned `string()` matchers fail verification.
 * ------------------------------------------------------------------------- */

const SUBSCRIPTION_PRODUCT_ID = 'premium_monthly'
const SUBSCRIPTION_PERIOD_END = '2026-09-11T10:00:00.000Z'
const SUBSCRIPTION_SYNCED_AT = '2026-08-11T10:00:00.000Z'
const SUBSCRIPTION_CHECKOUT_URL = 'https://checkout.stripe.test/c/pay/cs-pact-1'
const SUBSCRIPTION_PORTAL_URL = 'https://billing.stripe.test/p/session/pact-1'

const checkoutSessionRequestBody = { plan: 'premium_monthly' as const }

/**
 * The entitled variant of the status union, as mobile reads it after a store
 * purchase: `store: 'app_store'` pins the store-managed rail, and every
 * entitlement field is present. The correlation is the contract — an entitled
 * response can never carry a null store or period end.
 */
export async function verifyEntitledSubscriptionStatusInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has an active premium entitlement',
        params: { userId: pactEventAuth.userId, store: 'app_store' },
      })
    )
    .uponReceiving('a request for the premium subscription status of an entitled user')
    .withRequest(
      'GET',
      '/api/v1/commerce/subscription',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            status: string('active'),
            store: string('app_store'),
            productId: string(SUBSCRIPTION_PRODUCT_ID),
            willRenew: like(true),
            currentPeriodEnd: isoTimestamp(SUBSCRIPTION_PERIOD_END),
            syncedAt: isoTimestamp(SUBSCRIPTION_SYNCED_AT),
            purchasesEnabled: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommerceSubscriptionGet()

      const parsed = subscriptionResponseSchema.parse(response)
      expect(parsed.data.status).toBe('active')
      expect(parsed.data.store).toBe('app_store')
      expect(parsed.data.currentPeriodEnd).toBe(SUBSCRIPTION_PERIOD_END)
    })
}

/**
 * The post-purchase poll: mobile calls refresh to beat webhook latency after
 * a store purchase. A refresh re-reads the ledger and creates nothing, so it
 * answers 200 with the same body shape as the status read — `syncedAt` is how
 * a client tells a real pull from a rate-limited response that served local
 * state, which is exactly why the field is pinned here.
 */
export async function verifySubscriptionRefreshInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has an active premium entitlement',
        params: { userId: pactEventAuth.userId, store: 'app_store' },
      })
    )
    .uponReceiving('a request to refresh the premium subscription from the ledger')
    .withRequest(
      'POST',
      '/api/v1/commerce/subscription/refresh',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            status: string('active'),
            store: string('app_store'),
            productId: string(SUBSCRIPTION_PRODUCT_ID),
            willRenew: like(true),
            currentPeriodEnd: isoTimestamp(SUBSCRIPTION_PERIOD_END),
            syncedAt: isoTimestamp(SUBSCRIPTION_SYNCED_AT),
            purchasesEnabled: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response =
        await createClient(mockServer).apiV1CommerceSubscriptionRefreshPost()

      const parsed = subscriptionResponseSchema.parse(response)
      expect(parsed.data.status).toBe('active')
      expect(parsed.data.syncedAt).toBe(SUBSCRIPTION_SYNCED_AT)
    })
}

/**
 * The `none` variant of the status union, as web reads it before rendering
 * the subscribe CTA. `status: 'none'` is exact (it is the union discriminant)
 * and the entitlement fields are pinned null WITH the keys serialized — the
 * response shape never varies, which is what lets a client destructure it
 * unconditionally. `purchasesEnabled` is the only path the kill switch takes
 * to a client, so it is asserted on this exact branch.
 */
export async function verifyNeverSubscribedStatusInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has no premium entitlement',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(
      'a request for the premium subscription status of a never-subscribed user'
    )
    .withRequest(
      'GET',
      '/api/v1/commerce/subscription',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            status: 'none',
            store: nullValue(),
            productId: nullValue(),
            willRenew: nullValue(),
            currentPeriodEnd: nullValue(),
            syncedAt: nullValue(),
            purchasesEnabled: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommerceSubscriptionGet()

      const parsed = subscriptionResponseSchema.parse(response)
      expect(parsed.data).toEqual({
        status: 'none',
        store: null,
        productId: null,
        willRenew: null,
        currentPeriodEnd: null,
        syncedAt: null,
        purchasesEnabled: true,
      })
    })
}

export async function verifyCheckoutSessionInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has no premium entitlement',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to create a Stripe Checkout session')
    .withRequest(
      'POST',
      '/api/v1/commerce/subscription/checkout-session',
      setJsonContent({ headers: pactEventHeaders, body: checkoutSessionRequestBody })
    )
    .willRespondWith(
      201,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: { data: { url: string(SUBSCRIPTION_CHECKOUT_URL) } },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1CommerceSubscriptionCheckoutSessionPost({
        checkoutSessionRequest: checkoutSessionRequestBody,
      })

      // The web app hands this URL to window.location.assign, so the two
      // things a client must be able to rely on are pinned: https, and a
      // Stripe-hosted destination rather than a relative path.
      const body = checkoutSessionResponseSchema.parse(response)
      expect(new URL(body.data.url).protocol).toBe('https:')
      expect(new URL(body.data.url).hostname).toBe('checkout.stripe.test')
    })
}

export async function verifyPortalSessionInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has a Stripe billing profile',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to create a Stripe Customer Portal session')
    .withRequest(
      'POST',
      '/api/v1/commerce/subscription/portal-session',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      201,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: { data: { url: string(SUBSCRIPTION_PORTAL_URL) } },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response =
        await createClient(mockServer).apiV1CommerceSubscriptionPortalSessionPost()

      const body = portalSessionResponseSchema.parse(response)
      expect(new URL(body.data.url).protocol).toBe('https:')
      expect(new URL(body.data.url).hostname).toBe('billing.stripe.test')
    })
}

/**
 * Decision 5: no `SUBSCRIPTION_*` codes on the wire. The shared error
 * envelopes are `.strict()` over exactly `{ statusCode, message, error }`, so
 * a client branches on status plus one of the exported message constants.
 * Each row drives its own `it.each` case: PactV4's Rust FFI
 * non-deterministically drops an interaction when more than one
 * `addInteraction()...executeTest()` chain is awaited inside one test body.
 *
 * The portal-404 row is the one arrangement that needs a factory override:
 * an ACTIVE entitlement bought through the App Store, with no Stripe billing
 * profile — being a paying subscriber is not what grants portal access,
 * having a Stripe billing history is.
 */
export type SubscriptionErrorInteraction = {
  description: string
  path: string
  state: string
  stateParams: Record<string, string>
  requestBody?: Record<string, unknown>
  status: number
  message: string
  reason: string
}

export const subscriptionErrorInteractions: SubscriptionErrorInteraction[] = [
  {
    description: 'reports the disabled purchase rail as unavailable',
    path: '/api/v1/commerce/subscription/checkout-session',
    state: 'Premium subscriptions are disabled',
    stateParams: { userId: pactEventAuth.userId },
    requestBody: checkoutSessionRequestBody,
    status: 503,
    message: COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
    reason: 'Service Unavailable',
  },
  {
    description: 'rejects checkout for an already-subscribed account',
    path: '/api/v1/commerce/subscription/checkout-session',
    state: 'The user has an active premium entitlement',
    stateParams: { userId: pactEventAuth.userId, store: 'stripe' },
    requestBody: checkoutSessionRequestBody,
    status: 409,
    message: SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
    reason: 'Conflict',
  },
  {
    description: 'reports a missing Stripe billing profile on portal access',
    path: '/api/v1/commerce/subscription/portal-session',
    state: 'The user has an active premium entitlement',
    stateParams: { userId: pactEventAuth.userId, store: 'app_store' },
    status: 404,
    message: SUBSCRIPTION_NOT_FOUND_MESSAGE,
    reason: 'Not Found',
  },
]

export async function verifySubscriptionErrorInteraction(
  pact: PactV4,
  interaction: SubscriptionErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: interaction.state,
        params: interaction.stateParams,
      })
    )
    .uponReceiving(`a subscription request that ${interaction.description}`)
    .withRequest(
      'POST',
      interaction.path,
      setJsonContent({
        headers: pactEventHeaders,
        ...(interaction.requestBody ? { body: interaction.requestBody } : {}),
      })
    )
    .willRespondWith(
      interaction.status,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          statusCode: like(interaction.status),
          message: string(interaction.message),
          error: string(interaction.reason),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: what matters is the envelope the clients branch on.
      const response = await fetch(`${mockServer.url}${interaction.path}`, {
        method: 'POST',
        headers: interaction.requestBody
          ? { ...pactEventHeaders, 'Content-Type': 'application/json' }
          : pactEventHeaders,
        ...(interaction.requestBody
          ? { body: JSON.stringify(interaction.requestBody) }
          : {}),
      })

      expect(response.status).toBe(interaction.status)
      expect(response.headers.get('cache-control')).toBe('private, no-store')

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(interaction.message)
      expect(payload.error).toBe(interaction.reason)
      // There is no machine-readable code to branch on, by design.
      expect(payload).not.toHaveProperty('code')
    })
}
