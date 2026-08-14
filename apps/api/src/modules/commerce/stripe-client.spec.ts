import { afterEach, describe, expect, it } from 'vitest'
import {
  FakeStripeBillingClient,
  RealStripeBillingClient,
  resolveStripeClient,
  resolveStripePriceId,
  UnconfiguredStripeBillingClient,
} from './stripe-client.js'

/**
 * Story 5.2 Decision 9/10: the resolution rules for the outbound Stripe seam.
 * The fake's behaviour is exercised throughout `stripe-billing.service.spec.ts`
 * and the integration suites; the real client's HTTP calls are deliberately
 * untested here (they are Stripe's SDK; the staged smoke run in the runbook is
 * their pre-production proof).
 */
describe('resolveStripeClient', () => {
  const savedKey = process.env.STRIPE_SECRET_KEY
  const savedNodeEnv = process.env.NODE_ENV
  const savedTestEnv = process.env.TEST_ENV

  afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = savedKey
    // Delete-or-assign, like the other two: a bare assignment would restore an
    // originally-unset NODE_ENV as the literal string 'undefined', which reads
    // as production to allowsTestOnlySecrets and would hand every later suite
    // in this process the real client instead of the fake.
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = savedNodeEnv
    if (savedTestEnv === undefined) delete process.env.TEST_ENV
    else process.env.TEST_ENV = savedTestEnv
  })

  it('selects the real client whenever a key is configured', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_configured_key'

    expect(resolveStripeClient()).toBeInstanceOf(RealStripeBillingClient)
  })

  it('selects the singleton fake with no key in a test-only environment', () => {
    delete process.env.STRIPE_SECRET_KEY

    const first = resolveStripeClient()
    expect(first).toBeInstanceOf(FakeStripeBillingClient)
    // Singleton on purpose: the suite's arrange step and the request under
    // test must see the same recorded calls.
    expect(resolveStripeClient()).toBe(first)
  })

  it('selects the loud placeholder in production with no key — never a silent fake', () => {
    delete process.env.STRIPE_SECRET_KEY
    process.env.NODE_ENV = 'production'
    delete process.env.TEST_ENV

    const client = resolveStripeClient()
    expect(client).toBeInstanceOf(UnconfiguredStripeBillingClient)
    // The placeholder throws synchronously at call time; awaited by an async
    // caller that still surfaces as a rejection, i.e. the honest 500.
    expect(() => client.createCustomer('user-1')).toThrow(
      'STRIPE_SECRET_KEY is not configured'
    )
    expect(() => client.createPortalSession('cus_1', 'https://example.test')).toThrow(
      'STRIPE_SECRET_KEY is not configured'
    )
  })
})

describe('resolveStripePriceId', () => {
  const savedMonthly = process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID
  const savedAnnual = process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID
  const savedNodeEnv = process.env.NODE_ENV
  const savedTestEnv = process.env.TEST_ENV

  afterEach(() => {
    if (savedMonthly === undefined) delete process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID
    else process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = savedMonthly
    if (savedAnnual === undefined) delete process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID
    else process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID = savedAnnual
    process.env.NODE_ENV = savedNodeEnv
    if (savedTestEnv === undefined) delete process.env.TEST_ENV
    else process.env.TEST_ENV = savedTestEnv
  })

  it('uses the configured price id when set', () => {
    process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID = 'price_live_annual'

    expect(resolveStripePriceId('premium_annual')).toBe('price_live_annual')
  })

  it('falls back to a deterministic test-only id when unset in a test environment', () => {
    delete process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID

    expect(resolveStripePriceId('premium_monthly')).toBe('price_test_premium_monthly')
  })

  it('throws an actionable error in production when unset (validated at point of use)', () => {
    delete process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID
    process.env.NODE_ENV = 'production'
    delete process.env.TEST_ENV

    expect(() => resolveStripePriceId('premium_monthly')).toThrow(
      'STRIPE_PREMIUM_MONTHLY_PRICE_ID is not configured'
    )
  })
})
