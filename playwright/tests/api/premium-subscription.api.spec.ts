// Story 5.2: the premium subscription API against the seeded fixtures.
//
// SETUP SHAPE. `PremiumEntitlement` is worker-only by design, since a
// client-writable entitlement row is free Premium, so the entitled, expired and
// grace-period states have NO public write path and cannot be arranged here. They
// come from the deterministic seed users in `packages/db/prisma/seeds/commerce.ts`
// (Decision 9) and are read strictly read-only. The never-subscribed state is the
// one branch a fresh public-API signup provides, and it is the only account this
// file mutates.
//
// The seeded users are shared across parallel Playwright workers, so no test below
// calls `POST /subscription/refresh` as a seeded user: that endpoint's ledger pull
// would downgrade a locally-active row the fake ledger knows nothing about, breaking
// every other worker reading the same fixture.
import Stripe from 'stripe'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  billingWebhookResponseSchema,
  checkoutSessionResponseSchema,
  notFoundHttpErrorSchema,
  subscriptionResponseSchema,
  unauthorizedHttpErrorSchema,
  BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
} from '@couture/api-client/contracts/http'
// The PURE secrets module, never the Nest service: importing the service would pull
// its decorators and DI into the Playwright worker, which cannot load them.
import {
  buildTestOnlyRevenueCatWebhookAuth,
  buildTestOnlyStripeWebhookSecret,
} from '../../../apps/api/src/modules/commerce/billing-webhook-secrets'
import { authHeaders, buildUniqueId } from '../../support/helpers/api-test'
import {
  CHECKOUT_SESSION_PATH,
  PORTAL_SESSION_PATH,
  PREMIUM_SEED_USERS,
  REVENUECAT_WEBHOOK_PATH,
  STRIPE_WEBHOOK_PATH,
  SUBSCRIPTION_PATH,
  SUBSCRIPTION_REFRESH_PATH,
  premiumApiTest as test,
  expect,
} from '../../support/helpers/premium-session'

/** The REAL stripe library, exactly what the server verifies deliveries with. */
const stripeSigner = new Stripe('sk_test_signing_helper_only')

/** Read-only headers for a seeded fixture user; see the file header. */
const seededHeaders = (key: keyof typeof PREMIUM_SEED_USERS) =>
  authHeaders(PREMIUM_SEED_USERS[key].id, 'admin')

test.describe('premium subscription status over the public API', () => {
  test('5.2-E2E-API-001 serves a never-subscribed account as status none with every key present', async ({
    request,
    premiumApi,
  }) => {
    const response = await request.get(`${premiumApi.apiBaseUrl}${SUBSCRIPTION_PATH}`, {
      headers: premiumApi.headers,
    })

    expect(response.status()).toBe(200)
    const body = subscriptionResponseSchema.parse(await response.json())
    expect(body.data.status).toBe('none')
    // The nulls are serialized, never omitted, so both clients read one shape
    // whatever the subscription state.
    expect(body.data.store).toBeNull()
    expect(body.data.currentPeriodEnd).toBeNull()
    void log.info(`fresh account reads as ${body.data.status}`)
  })

  // `premiumApi` is taken here for its resolved base URL and its non-local skip
  // guard; the assertions read the seeded users.
  test('5.2-E2E-API-002 reflects each seeded entitlement state', async ({
    request,
    premiumApi,
  }) => {
    for (const [key, expected] of [
      ['active', 'active'],
      ['expired', 'expired'],
      ['grace', 'grace_period'],
    ] as const) {
      const response = await request.get(`${premiumApi.apiBaseUrl}${SUBSCRIPTION_PATH}`, {
        headers: seededHeaders(key),
      })

      expect(response.status(), `seeded user ${key}`).toBe(200)
      const body = subscriptionResponseSchema.parse(await response.json())
      expect(body.data.status, `seeded user ${key}`).toBe(expected)
    }
  })

  test('5.2-E2E-API-003 refuses an unauthenticated read', async ({
    request,
    premiumApi,
  }) => {
    const response = await request.get(`${premiumApi.apiBaseUrl}${SUBSCRIPTION_PATH}`)

    expect(response.status()).toBe(401)
    unauthorizedHttpErrorSchema.parse(await response.json())
  })
})

test.describe('checkout and portal sessions', () => {
  test('5.2-E2E-API-010 mints a Checkout URL for a never-subscribed account', async ({
    request,
    premiumApi,
  }) => {
    const response = await request.post(
      `${premiumApi.apiBaseUrl}${CHECKOUT_SESSION_PATH}`,
      { headers: premiumApi.headers, data: { plan: 'premium_monthly' } }
    )

    expect(response.status()).toBe(201)
    const body = checkoutSessionResponseSchema.parse(await response.json())
    // An RFC-2606 `.test` host: the fake Stripe client's URL never resolves, so
    // nothing here can reach the real Stripe.
    expect(new URL(body.data.url).hostname.endsWith('.test')).toBe(true)
  })

  test('5.2-E2E-API-011 rejects an unknown plan at the schema', async ({
    request,
    premiumApi,
  }) => {
    const response = await request.post(
      `${premiumApi.apiBaseUrl}${CHECKOUT_SESSION_PATH}`,
      { headers: premiumApi.headers, data: { plan: 'premium_lifetime' } }
    )

    expect(response.status()).toBe(400)
  })

  test('5.2-E2E-API-012 answers 404 for a portal session with no billing profile', async ({
    request,
    premiumApi,
  }) => {
    const response = await request.post(
      `${premiumApi.apiBaseUrl}${PORTAL_SESSION_PATH}`,
      {
        headers: premiumApi.headers,
      }
    )

    expect(response.status()).toBe(404)
    const body = notFoundHttpErrorSchema.parse(await response.json())
    expect(body.message).toBe(SUBSCRIPTION_NOT_FOUND_MESSAGE)
  })
})

test.describe('billing webhooks reject unauthenticated deliveries uniformly', () => {
  test('5.2-E2E-API-020 rejects an unsigned Stripe delivery', async ({
    request,
    premiumApi,
  }) => {
    const response = await request.post(
      `${premiumApi.apiBaseUrl}${STRIPE_WEBHOOK_PATH}`,
      {
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify({ id: 'evt_unsigned', type: 'checkout.session.completed' }),
      }
    )

    expect(response.status()).toBe(401)
    const body = unauthorizedHttpErrorSchema.parse(await response.json())
    // One message for every failure mode, so the endpoint cannot be used to
    // discover which secrets are configured.
    expect(body.message).toBe(BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE)
  })

  test('5.2-E2E-API-021 rejects a Stripe delivery signed with the wrong secret', async ({
    request,
    premiumApi,
  }) => {
    const payload = JSON.stringify({
      id: `evt_${buildUniqueId('api', test.info())}`,
      type: 'checkout.session.completed',
    })
    const response = await request.post(
      `${premiumApi.apiBaseUrl}${STRIPE_WEBHOOK_PATH}`,
      {
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=1,v1=deadbeef',
        },
        data: payload,
      }
    )

    expect(response.status()).toBe(401)
    expect(unauthorizedHttpErrorSchema.parse(await response.json()).message).toBe(
      BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE
    )
  })

  test('5.2-E2E-API-022 rejects a RevenueCat delivery with no credential', async ({
    request,
    premiumApi,
  }) => {
    const response = await request.post(
      `${premiumApi.apiBaseUrl}${REVENUECAT_WEBHOOK_PATH}`,
      {
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify({ api_version: '1.0', event: { id: 'x', type: 'TEST' } }),
      }
    )

    expect(response.status()).toBe(401)
    expect(unauthorizedHttpErrorSchema.parse(await response.json()).message).toBe(
      BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE
    )
  })

  test('5.2-E2E-API-023 accepts an authenticated RevenueCat TEST event and records it', async ({
    request,
    premiumApi,
  }) => {
    // RevenueCat fires TEST when an operator configures the webhook and a non-200
    // fails their setup check, so this delivery's success is part of the
    // provisioning runbook.
    const response = await request.post(
      `${premiumApi.apiBaseUrl}${REVENUECAT_WEBHOOK_PATH}`,
      {
        headers: {
          'content-type': 'application/json',
          authorization: buildTestOnlyRevenueCatWebhookAuth(),
        },
        data: JSON.stringify({
          api_version: '1.0',
          event: {
            id: `e2e-${buildUniqueId('api', test.info())}`,
            type: 'TEST',
            app_user_id: premiumApi.userId,
            event_timestamp_ms: Date.parse('2026-08-12T00:00:00.000Z'),
          },
        }),
      }
    )

    expect(response.status()).toBe(200)
    billingWebhookResponseSchema.parse(await response.json())

    // Record-only: a TEST event must not manufacture an entitlement.
    const status = await request.get(`${premiumApi.apiBaseUrl}${SUBSCRIPTION_PATH}`, {
      headers: premiumApi.headers,
    })
    expect(subscriptionResponseSchema.parse(await status.json()).data.status).toBe('none')
  })
})

test.describe('on-demand refresh', () => {
  test('5.2-E2E-API-030 answers a fresh account on demand without inventing an entitlement', async ({
    request,
    premiumApi,
  }) => {
    // Safe on a fresh account only. See the file header on why no seeded user may
    // be refreshed.
    const response = await request.post(
      `${premiumApi.apiBaseUrl}${SUBSCRIPTION_REFRESH_PATH}`,
      { headers: premiumApi.headers }
    )

    expect(response.status()).toBe(200)
    const body = subscriptionResponseSchema.parse(await response.json())
    expect(body.data.status).toBe('none')
  })
})

test.describe('the one-writer rule, end to end over HTTP', () => {
  test('5.2-E2E-API-050 a Stripe payment does NOT write the entitlement; the ledger does', async ({
    request,
    premiumApi,
  }) => {
    // Decision 1's rejected provisional activation, made observable. The middle
    // assertion is the point: after a fully valid, signed Stripe completion the
    // entitlement is still absent, because the Stripe rail records and forwards and
    // never writes entitlement state. That window IS the paid-but-locked mode the
    // story names, and a future "helpful" provisional activation turns this red.
    const subscriptionId = `sub_${buildUniqueId('api', test.info())}`
    const payload = JSON.stringify({
      id: `evt_${buildUniqueId('api', test.info())}`,
      object: 'event',
      type: 'checkout.session.completed',
      created: Math.floor(Date.parse('2026-08-12T00:00:00.000Z') / 1000),
      livemode: false,
      api_version: '2026-07-29.dahlia',
      data: {
        object: {
          id: `cs_${buildUniqueId('api', test.info())}`,
          object: 'checkout.session',
          client_reference_id: premiumApi.userId,
          customer: `cus_${buildUniqueId('api', test.info())}`,
          subscription: subscriptionId,
          metadata: { userId: premiumApi.userId, plan: 'premium_monthly' },
        },
      },
    })

    const delivered = await request.post(
      `${premiumApi.apiBaseUrl}${STRIPE_WEBHOOK_PATH}`,
      {
        headers: {
          'content-type': 'application/json',
          'stripe-signature': stripeSigner.webhooks.generateTestHeaderString({
            payload,
            secret: buildTestOnlyStripeWebhookSecret(),
          }),
        },
        data: payload,
      }
    )
    expect(delivered.status()).toBe(200)

    const duringWindow = await request.get(
      `${premiumApi.apiBaseUrl}${SUBSCRIPTION_PATH}`,
      { headers: premiumApi.headers }
    )
    expect(
      subscriptionResponseSchema.parse(await duringWindow.json()).data.status,
      'the Stripe rail must not write entitlement state'
    ).toBe('none')

    // The forward reached the ledger, so pulling it closes the window.
    const refreshed = await request.post(
      `${premiumApi.apiBaseUrl}${SUBSCRIPTION_REFRESH_PATH}`,
      { headers: premiumApi.headers }
    )
    expect(refreshed.status()).toBe(200)
    const after = subscriptionResponseSchema.parse(await refreshed.json())
    expect(after.data.status).toBe('active')
    if (after.data.status !== 'none') {
      expect(after.data.store).toBe('stripe')
    }
  })
})

test.describe('webhook secret wiring', () => {
  test('5.2-E2E-API-040 uses the test-only Stripe secret, never a real one', () => {
    // A guard on the environment: if a real secret leaked into the local stack, the
    // fixtures would sign with one value while the server verified with another and
    // every webhook test would 401 for a reason unrelated to what it asserts.
    expect(buildTestOnlyStripeWebhookSecret().length).toBeGreaterThanOrEqual(32)
    expect(buildTestOnlyStripeWebhookSecret()).toContain('test')
  })
})
