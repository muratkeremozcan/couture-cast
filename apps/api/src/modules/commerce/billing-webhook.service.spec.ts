import { afterEach, describe, expect, it } from 'vitest'
import type Stripe from 'stripe'
import {
  buildTestOnlyRevenueCatWebhookAuth,
  buildTestOnlyStripeWebhookSecret,
  mapRevenueCatStore,
  planRevenueCatTransition,
  projectRevenueCatEventPayload,
  projectStripeEventPayload,
  resolveRevenueCatWebhookAuth,
  resolveStripeWebhookSecret,
  type RevenueCatEvent,
} from './billing-webhook.service.js'

/**
 * Story 5.2: unit coverage for the webhook rails' pure decision logic — the
 * Decision 6 payload projections (5.2-API-012), the Decision 4 transition
 * planning, and the Decision 10 secret resolution. The HTTP-visible behaviour
 * (signatures, idempotency, transactions, telemetry) is proven in the
 * integration suites; these keep the CI unit tier honest (deferred-work #10).
 */

function rcEvent(overrides: Partial<RevenueCatEvent> = {}): RevenueCatEvent {
  return {
    id: 'evt-1',
    type: 'INITIAL_PURCHASE',
    event_timestamp_ms: 1_754_998_400_000,
    app_user_id: 'user-1',
    product_id: 'premium_monthly',
    period_type: 'NORMAL',
    purchased_at_ms: 1_754_998_300_000,
    expiration_at_ms: 1_757_676_700_000,
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    cancel_reason: null,
    ...overrides,
  }
}

describe('payload projection (5.2-API-012): allowlist strips a maximal fixture', () => {
  it('projects a RevenueCat event to exactly the allowlisted fields', () => {
    // A maximal hostile fixture: every banned category present as a sibling.
    const maximal = {
      ...rcEvent(),
      subscriber_attributes: { $email: { value: 'person@example.com' } },
      aliases: ['other-id'],
      price: 4.99,
      price_in_purchased_currency: 4.99,
      currency: 'USD',
      takehome_percentage: 0.7,
      offer_code: 'PROMO50',
      original_transaction_id: 'txn-123',
      presented_offering_id: 'default',
    } as unknown as RevenueCatEvent

    const projection = projectRevenueCatEventPayload(maximal)

    expect(projection).toEqual({
      eventType: 'INITIAL_PURCHASE',
      store: 'app_store',
      productId: 'premium_monthly',
      periodType: 'NORMAL',
      purchasedAtMs: 1_754_998_300_000,
      expirationAtMs: 1_757_676_700_000,
      cancelReason: null,
      environment: 'PRODUCTION',
      fetchToken: null,
    })
    // The projection is the exact persisted object: no price, no email, no
    // offer codes, no transaction ids can ride along.
    expect(Object.keys(projection)).not.toContain('price')
    expect(JSON.stringify(projection)).not.toContain('example.com')
  })

  it('projects a Stripe subscription event, mapping period end to ms and reason', () => {
    const event = {
      id: 'evt_stripe_1',
      type: 'customer.subscription.updated',
      created: 1_754_998_400,
      livemode: false,
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          current_period_end: 1_757_676_700,
          cancellation_details: { reason: 'cancellation_requested' },
          items: { data: [{ price: { lookup_key: 'premium_monthly' } }] },
          // Banned-category siblings that must not survive projection:
          latest_invoice: 'in_abc',
          default_payment_method: 'pm_abc',
          metadata: { userId: 'user-1' },
        },
      },
    } as unknown as Stripe.Event

    expect(projectStripeEventPayload(event, null)).toEqual({
      eventType: 'customer.subscription.updated',
      store: 'stripe',
      productId: 'premium_monthly',
      periodType: null,
      purchasedAtMs: null,
      expirationAtMs: 1_757_676_700_000,
      cancelReason: 'cancellation_requested',
      environment: 'false',
      fetchToken: null,
    })
  })

  it('records the forward fetch token on checkout events — the outbox re-drive pointer', () => {
    const event = {
      id: 'evt_stripe_2',
      type: 'checkout.session.completed',
      created: 1_754_998_400,
      livemode: true,
      data: {
        object: {
          id: 'cs_123',
          customer: 'cus_123',
          subscription: 'sub_456',
          client_reference_id: 'user-1',
          metadata: { userId: 'user-1', plan: 'premium_annual' },
        },
      },
    } as unknown as Stripe.Event

    const projection = projectStripeEventPayload(event, 'sub_456')

    expect(projection.fetchToken).toBe('sub_456')
    expect(projection.productId).toBe('premium_annual')
    expect(projection.store).toBe('stripe')
  })
})

describe('RevenueCat store mapping', () => {
  it.each([
    ['APP_STORE', 'app_store'],
    ['MAC_APP_STORE', 'app_store'],
    ['PLAY_STORE', 'play_store'],
    ['STRIPE', 'stripe'],
    ['PROMOTIONAL', 'promotional'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(mapRevenueCatStore(input)).toBe(expected)
  })

  it('maps unknown stores and absence to null rather than guessing', () => {
    expect(mapRevenueCatStore('AMAZON')).toBeNull()
    expect(mapRevenueCatStore(null)).toBeNull()
    expect(mapRevenueCatStore(undefined)).toBeNull()
  })
})

describe('the Decision 4 transition table (planning half)', () => {
  const applyCases = [
    ['INITIAL_PURCHASE', 'active', true],
    ['RENEWAL', 'active', true],
    ['PRODUCT_CHANGE', 'active', true],
    ['CANCELLATION', 'active', false],
    ['UNCANCELLATION', 'active', true],
    ['BILLING_ISSUE', 'grace_period', true],
    ['EXPIRATION', 'expired', false],
    ['REFUND_REVERSED', 'active', true],
    ['SUBSCRIPTION_EXTENDED', 'active', true],
    ['TEMPORARY_ENTITLEMENT_GRANT', 'active', true],
  ] as const

  it.each(applyCases)(
    '%s plans status %s with willRenew %s',
    (type, status, willRenew) => {
      const plan = planRevenueCatTransition(rcEvent({ type }))
      expect(plan).toEqual({
        kind: 'apply',
        state: {
          status,
          store: 'app_store',
          productId: 'premium_monthly',
          willRenew,
          currentPeriodEnd: new Date(1_757_676_700_000),
        },
      })
    }
  )

  it.each([
    'SUBSCRIPTION_PAUSED',
    'NON_RENEWING_PURCHASE',
    'TEST',
    'SOME_FUTURE_EVENT_TYPE',
  ])('%s is record-only: the enumeration is not assumed exhaustive', (type) => {
    expect(planRevenueCatTransition(rcEvent({ type }))).toEqual({ kind: 'record-only' })
  })

  it('routes TRANSFER to the two-user path', () => {
    expect(planRevenueCatTransition(rcEvent({ type: 'TRANSFER' }))).toEqual({
      kind: 'transfer',
    })
  })

  it('degrades an apply event missing state fields to record-only, never a bounce', () => {
    expect(
      planRevenueCatTransition(rcEvent({ type: 'RENEWAL', expiration_at_ms: null }))
    ).toEqual({ kind: 'record-only' })
    expect(
      planRevenueCatTransition(rcEvent({ type: 'RENEWAL', store: 'AMAZON' }))
    ).toEqual({ kind: 'record-only' })
    expect(
      planRevenueCatTransition(rcEvent({ type: 'RENEWAL', product_id: null }))
    ).toEqual({ kind: 'record-only' })
  })
})

describe('secret resolution (Decision 10: point of use, test-only fallbacks)', () => {
  const savedStripe = process.env.STRIPE_WEBHOOK_SECRET
  const savedRc = process.env.REVENUECAT_WEBHOOK_AUTH

  afterEach(() => {
    if (savedStripe === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = savedStripe
    if (savedRc === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH
    else process.env.REVENUECAT_WEBHOOK_AUTH = savedRc
  })

  it('falls back to the deterministic test-only values when nothing is set', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.REVENUECAT_WEBHOOK_AUTH

    expect(resolveStripeWebhookSecret()).toBe(buildTestOnlyStripeWebhookSecret())
    expect(resolveRevenueCatWebhookAuth()).toBe(buildTestOnlyRevenueCatWebhookAuth())
  })

  it('uses a configured value verbatim when it meets the length floor', () => {
    const value = 'x'.repeat(40)
    process.env.STRIPE_WEBHOOK_SECRET = value
    process.env.REVENUECAT_WEBHOOK_AUTH = value

    expect(resolveStripeWebhookSecret()).toBe(value)
    expect(resolveRevenueCatWebhookAuth()).toBe(value)
  })

  it('rejects a configured-but-short secret outright — no fallback masking (.env.example warning)', () => {
    // A set-but-placeholder secret must NOT fall back to the test value: the
    // server would verify with one secret while suites sign with another, and
    // every valid webhook would 401 in exactly one environment.
    process.env.STRIPE_WEBHOOK_SECRET = 'too-short'
    process.env.REVENUECAT_WEBHOOK_AUTH = 'too-short'

    expect(resolveStripeWebhookSecret()).toBeNull()
    expect(resolveRevenueCatWebhookAuth()).toBeNull()
  })
})
