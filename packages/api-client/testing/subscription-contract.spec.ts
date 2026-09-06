import { describe, expect, it } from 'vitest'
import {
  billingWebhookResponseSchema,
  checkoutSessionRequestSchema,
  checkoutSessionResponseSchema,
  conflictHttpErrorSchema,
  notFoundHttpErrorSchema,
  portalSessionResponseSchema,
  serviceUnavailableHttpErrorSchema,
  subscriptionPlanSchema,
  subscriptionResponseSchema,
  subscriptionSchema,
  unauthorizedHttpErrorSchema,
  BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE,
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
  SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
  SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE,
} from '../src/contracts/http'
import * as subscriptionContractExports from '../src/contracts/http/subscription'

/**
 * Story 5.2 Task 2: the consumer-side contract for the premium subscription.
 *
 * This suite asserts the PUBLISHED SHAPES only. Entitlement transitions,
 * webhook idempotency, and the kill-switch precedence are business rules proven
 * in the API unit and integration suites. A green run here says nothing about
 * them.
 */

const entitledSubscription = {
  status: 'active' as const,
  store: 'stripe' as const,
  productId: 'premium_monthly',
  willRenew: true,
  currentPeriodEnd: '2030-01-01T00:00:00.000Z',
  syncedAt: '2026-08-01T00:00:00.000Z',
  purchasesEnabled: true,
}

const noneSubscription = {
  status: 'none' as const,
  store: null,
  productId: null,
  willRenew: null,
  currentPeriodEnd: null,
  syncedAt: null,
  purchasesEnabled: true,
}

describe('subscription status response', () => {
  it('5.2-CONTRACT-01 carries the full entitlement on an entitled account', () => {
    const parsed = subscriptionResponseSchema.parse({ data: entitledSubscription })
    expect(parsed.data.status).toBe('active')
    if (parsed.data.status !== 'none') {
      expect(parsed.data.store).toBe('stripe')
      expect(parsed.data.willRenew).toBe(true)
    }
  })

  it('5.2-CONTRACT-02 serializes null entitlement fields for a never-subscribed account', () => {
    // Keys always serialized: `.nullable()` semantics, never `.optional()`.
    const parsed = subscriptionResponseSchema.parse({ data: noneSubscription })
    expect(parsed.data).toEqual(noneSubscription)
  })

  it('5.2-CONTRACT-03 rejects a none status that omits the entitlement keys', () => {
    expect(
      subscriptionSchema.safeParse({ status: 'none', purchasesEnabled: true }).success
    ).toBe(false)
  })

  it('5.2-CONTRACT-04 makes an entitled response without a store unrepresentable', () => {
    expect(
      subscriptionSchema.safeParse({ ...entitledSubscription, store: null }).success
    ).toBe(false)
    expect(
      subscriptionSchema.safeParse({ ...noneSubscription, status: 'active' }).success
    ).toBe(false)
  })

  it('5.2-CONTRACT-05 keeps cancelled-but-paid representable: active with willRenew false', () => {
    // CANCELLATION keeps access until period end; only EXPIRATION downgrades.
    const parsed = subscriptionSchema.parse({
      ...entitledSubscription,
      willRenew: false,
    })
    expect(parsed.status).toBe('active')
  })

  it('5.2-CONTRACT-06 requires purchasesEnabled on every variant', () => {
    const withoutFlag: Record<string, unknown> = { ...entitledSubscription }
    delete withoutFlag.purchasesEnabled
    expect(subscriptionSchema.safeParse(withoutFlag).success).toBe(false)

    const noneWithoutFlag: Record<string, unknown> = { ...noneSubscription }
    delete noneWithoutFlag.purchasesEnabled
    expect(subscriptionSchema.safeParse(noneWithoutFlag).success).toBe(false)
  })

  it('5.2-CONTRACT-07 accepts every store the ledger can report', () => {
    for (const store of ['app_store', 'play_store', 'stripe', 'promotional'] as const) {
      expect(
        subscriptionSchema.safeParse({ ...entitledSubscription, store }).success
      ).toBe(true)
    }
  })
})

describe('checkout session request', () => {
  it('5.2-CONTRACT-08 accepts exactly the two provisioned plans', () => {
    expect(checkoutSessionRequestSchema.parse({ plan: 'premium_monthly' })).toEqual({
      plan: 'premium_monthly',
    })
    expect(checkoutSessionRequestSchema.parse({ plan: 'premium_annual' })).toEqual({
      plan: 'premium_annual',
    })
    expect(subscriptionPlanSchema.options).toHaveLength(2)
  })

  it('5.2-CONTRACT-09 rejects unknown plans and widened payloads', () => {
    expect(
      checkoutSessionRequestSchema.safeParse({ plan: 'premium_weekly' }).success
    ).toBe(false)
    // `.strict()`: a client cannot smuggle a price, coupon, or trial flag in.
    expect(
      checkoutSessionRequestSchema.safeParse({
        plan: 'premium_monthly',
        priceUsd: 4.99,
      }).success
    ).toBe(false)
  })
})

describe('session responses', () => {
  it('5.2-CONTRACT-10 publishes one URL and nothing else', () => {
    for (const schema of [checkoutSessionResponseSchema, portalSessionResponseSchema]) {
      expect(
        schema.safeParse({ data: { url: 'https://checkout.stripe.test/c/pay/cs_1' } })
          .success
      ).toBe(true)
      // A session id alongside the URL would invite clients to build their own
      // Stripe integration; the URL is the whole surface.
      expect(
        schema.safeParse({
          data: { url: 'https://checkout.stripe.test/c/pay/cs_1', sessionId: 'cs_1' },
        }).success
      ).toBe(false)
      expect(schema.safeParse({ data: { url: 'not-a-url' } }).success).toBe(false)
    }
  })
})

describe('billing webhook response', () => {
  it('5.2-CONTRACT-11 answers with the literal received flag', () => {
    expect(billingWebhookResponseSchema.parse({ data: { received: true } })).toEqual({
      data: { received: true },
    })
    expect(
      billingWebhookResponseSchema.safeParse({ data: { received: false } }).success
    ).toBe(false)
  })
})

describe('error envelopes and messages', () => {
  it('5.2-CONTRACT-12 publishes exactly one webhook rejection message', () => {
    // Both webhooks answer every auth failure identically so neither can be
    // used to probe which secrets are configured.
    const parsed = unauthorizedHttpErrorSchema.parse({
      statusCode: 401,
      message: BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE,
      error: 'Unauthorized',
    })
    expect(parsed.message).toBe(BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE)
  })

  it('5.2-CONTRACT-13 carries no machine-readable code in any error envelope', () => {
    // `.strict()` on the shared envelopes is the enforcement point.
    expect(
      serviceUnavailableHttpErrorSchema.safeParse({
        statusCode: 503,
        message: COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
        error: 'Service Unavailable',
        code: 'COMMERCE_SUBSCRIPTION_DISABLED',
      }).success
    ).toBe(false)
  })

  it('5.2-CONTRACT-14 keeps the portal 404 and 409 messages distinct', () => {
    // "No web subscription" (no Stripe profile) and "store-managed" are
    // different user situations with different fixes; collapsing them would
    // point App Store subscribers at a checkout they must not use.
    expect(SUBSCRIPTION_NOT_FOUND_MESSAGE).not.toBe(SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE)
    notFoundHttpErrorSchema.parse({
      statusCode: 404,
      message: SUBSCRIPTION_NOT_FOUND_MESSAGE,
      error: 'Not Found',
    })
    conflictHttpErrorSchema.parse({
      statusCode: 409,
      message: SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE,
      error: 'Conflict',
    })
  })

  it('5.2-CONTRACT-15 exports the full message constant set for callers to assert on', () => {
    for (const message of [
      COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
      SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
      SUBSCRIPTION_NOT_FOUND_MESSAGE,
      SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE,
      SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE,
      BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE,
      PREMIUM_REQUIRED_MESSAGE,
    ]) {
      expect(message.length).toBeGreaterThan(0)
    }
    // All seven are re-exported through the deep subpath both clients import.
    expect(Object.keys(subscriptionContractExports)).toEqual(
      expect.arrayContaining([
        'COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE',
        'SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE',
        'SUBSCRIPTION_NOT_FOUND_MESSAGE',
        'SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE',
        'SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE',
        'BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE',
        'PREMIUM_REQUIRED_MESSAGE',
      ])
    )
  })

  it('5.2-CONTRACT-16 exposes no endpoint that takes a user id', () => {
    // Cross-user authz by construction: the subscription endpoints operate on
    // the acting user only. A contract regression that introduced an id
    // parameter would surface here as a new registered path shape.
    const registeredPathSources = [
      subscriptionContractExports.registerSubscriptionContracts.toString(),
    ]
    for (const source of registeredPathSources) {
      expect(source).not.toMatch(/\{userId\}|\{id\}/)
    }
  })
})
