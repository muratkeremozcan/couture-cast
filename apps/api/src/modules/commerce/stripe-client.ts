import { Injectable } from '@nestjs/common'
import Stripe from 'stripe'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'
import type { SubscriptionPlan } from '../../contracts/http.js'

/**
 * Story 5.2 Task 4: the OUTBOUND Stripe boundary, defined as an abstract seam
 * so checkout-session, portal-session, customer ops, and processor-side
 * erasure all depend on one interface and the suites run against the
 * deterministic fake below rather than the network.
 *
 * SCOPE OF THE FAKE — outbound API calls only (Decision 9). Webhook signature
 * verification is deliberately NOT part of this seam: `constructEvent` is pure
 * local HMAC and it is the webhook's only authentication, so faking it would
 * ship the auth branch untested. The webhook service always runs the real
 * `stripe` library's verifier; suites sign fixtures with
 * `stripe.webhooks.generateTestHeaderString` against the test-only secret.
 *
 * Resolution rule, mirroring `resolveRevenueCatClient`: a configured
 * `STRIPE_SECRET_KEY` selects the real client; with no key,
 * `allowsTestOnlySecrets()` environments get the fake, and production throws
 * at first use with an actionable message — a prod misconfiguration must be a
 * loud 500, never a silent fake.
 */

/** Pinned per the story's tech notes (stripe-node v22.x). */
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-07-29.dahlia'

export type StripeCheckoutSessionInput = {
  customerId: string
  priceId: string
  /** Written to BOTH client_reference_id and metadata.userId (Decision 4). */
  userId: string
  plan: SubscriptionPlan
  successUrl: string
  cancelUrl: string
}

export type StripeCheckoutSession = {
  id: string
  url: string
}

export type StripePortalSession = {
  url: string
}

export abstract class StripeBillingClient {
  /** customers.create; returns the new customer id. */
  abstract createCustomer(userId: string): Promise<string>

  /** checkout.sessions.create with mode 'subscription'. */
  abstract createCheckoutSession(
    input: StripeCheckoutSessionInput
  ): Promise<StripeCheckoutSession>

  /** billingPortal.sessions.create. */
  abstract createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<StripePortalSession>

  /** customers.del; processor-side erasure (Decision 7). */
  abstract deleteCustomer(customerId: string): Promise<void>
}

/** The real REST client. Constructed only when STRIPE_SECRET_KEY is set. */
export class RealStripeBillingClient extends StripeBillingClient {
  private readonly stripe: Stripe

  constructor(secretKey: string) {
    super()
    this.stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION })
  }

  async createCustomer(userId: string): Promise<string> {
    // No email, no name: the customer record carries only our opaque user id,
    // matching the AC 7 disclosure (account id and purchase state, never more).
    const customer = await this.stripe.customers.create({
      metadata: { userId },
    })
    return customer.id
  }

  async createCheckoutSession(
    input: StripeCheckoutSessionInput
  ): Promise<StripeCheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      // Both linkage paths on purpose: the webhook resolves the user by
      // client_reference_id first, BillingCustomer lookup second (Decision 4).
      client_reference_id: input.userId,
      metadata: { userId: input.userId, plan: input.plan },
      subscription_data: { metadata: { userId: input.userId, plan: input.plan } },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    })
    if (!session.url) {
      throw new Error('Stripe returned a checkout session without a URL')
    }
    return { id: session.id, url: session.url }
  }

  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<StripePortalSession> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
    return { url: session.url }
  }

  async deleteCustomer(customerId: string): Promise<void> {
    await this.stripe.customers.del(customerId)
  }
}

/**
 * Deterministic double for integration and E2E suites. Returns stable
 * RFC-2606 `.test` URLs and canned session objects; records calls so suites
 * can assert on them; failures are programmable so the 500 branches and the
 * outbox behaviour are testable without a network.
 */
@Injectable()
export class FakeStripeBillingClient extends StripeBillingClient {
  private customerSequence = 0
  private sessionSequence = 0
  private failuresRemaining = 0
  /** Test hook: checkout sessions created so far, newest last. */
  readonly checkoutSessions: StripeCheckoutSessionInput[] = []
  /** Test hook: customer ids deleted so far. */
  readonly deletedCustomerIds: string[] = []

  /** Test hook: make the next N calls fail like a Stripe outage. */
  failNextCall(count = 1): void {
    this.failuresRemaining = count
  }

  reset(): void {
    this.customerSequence = 0
    this.sessionSequence = 0
    this.failuresRemaining = 0
    this.checkoutSessions.length = 0
    this.deletedCustomerIds.length = 0
  }

  private consumeFailure(): void {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1
      throw new Error('FakeStripeBillingClient: simulated Stripe API outage')
    }
  }

  createCustomer(userId: string): Promise<string> {
    this.consumeFailure()
    this.customerSequence += 1
    return Promise.resolve(`cus_test_${userId.slice(0, 12)}_${this.customerSequence}`)
  }

  createCheckoutSession(
    input: StripeCheckoutSessionInput
  ): Promise<StripeCheckoutSession> {
    this.consumeFailure()
    this.sessionSequence += 1
    this.checkoutSessions.push(input)
    return Promise.resolve({
      id: `cs_test_${this.sessionSequence}`,
      url: `https://checkout.stripe.test/c/pay/cs_test_${this.sessionSequence}`,
    })
  }

  createPortalSession(customerId: string): Promise<StripePortalSession> {
    this.consumeFailure()
    this.sessionSequence += 1
    return Promise.resolve({
      url: `https://portal.stripe.test/p/session/${customerId}/${this.sessionSequence}`,
    })
  }

  deleteCustomer(customerId: string): Promise<void> {
    this.consumeFailure()
    this.deletedCustomerIds.push(customerId)
    return Promise.resolve()
  }
}

/** Production placeholder: throws at CALL time with an actionable message. */
export class UnconfiguredStripeBillingClient extends StripeBillingClient {
  private fail(): never {
    throw new Error(
      'STRIPE_SECRET_KEY is not configured. Set it in the API environment; see .env.example and the premium runbook.'
    )
  }

  createCustomer(): Promise<string> {
    this.fail()
  }

  createCheckoutSession(): Promise<StripeCheckoutSession> {
    this.fail()
  }

  createPortalSession(): Promise<StripePortalSession> {
    this.fail()
  }

  deleteCustomer(): Promise<void> {
    this.fail()
  }
}

/**
 * Module-level factory. The fake is a singleton per process on purpose: the
 * integration suite's arrange step and the request under test must see the
 * same recorded calls.
 */
let fakeSingleton: FakeStripeBillingClient | null = null

export function resolveStripeClient(): StripeBillingClient {
  const configured = process.env.STRIPE_SECRET_KEY?.trim()
  if (configured) {
    return new RealStripeBillingClient(configured)
  }
  if (allowsTestOnlySecrets()) {
    fakeSingleton ??= new FakeStripeBillingClient()
    return fakeSingleton
  }
  return new UnconfiguredStripeBillingClient()
}

/**
 * The Stripe price id for a plan, validated at point of use (Decision 10 — no
 * env schema exists; a missing id in production must be an actionable throw,
 * which the controller surfaces as the honest 500). Test-only fallbacks keep
 * the fake path deterministic without any operator provisioning.
 */
export function resolveStripePriceId(plan: SubscriptionPlan): string {
  const envName =
    plan === 'premium_monthly'
      ? 'STRIPE_PREMIUM_MONTHLY_PRICE_ID'
      : 'STRIPE_PREMIUM_ANNUAL_PRICE_ID'
  const configured = process.env[envName]?.trim()
  if (configured) {
    return configured
  }
  if (allowsTestOnlySecrets()) {
    return `price_test_${plan}`
  }
  throw new Error(
    `${envName} is not configured. Set it in the API environment; see .env.example and the premium runbook.`
  )
}
