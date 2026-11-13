import { Injectable } from '@nestjs/common'
import {
  allowsTestOnlySecrets,
  appliesRevenueCatTestStore,
} from '../../config/runtime-environment.js'
import type { LedgerEntitlementState } from './premium-entitlement.service.js'

/**
 * Story 5.2: the RevenueCat REST boundary, defined as an abstract seam so
 * every consumer (refresh endpoint, forward outbox, reconciliation sweep,
 * processor-side erasure) depends on one interface and the suites run against
 * the deterministic fake below rather than the network.
 *
 * Resolution rule, mirroring `resolveStripeClient` and
 * `resolvePartnerWebhookSecret`: a configured `REVENUECAT_SECRET_API_KEY`
 * selects the real REST client; with no key, `allowsTestOnlySecrets()`
 * environments get the fake, and production throws at first use with an
 * actionable message — a prod misconfiguration must be a loud 500, never a
 * silent fake.
 */

/** `null` = the ledger reports no premium entitlement for this subscriber. */
export type RevenueCatSubscriberEntitlement = LedgerEntitlementState | null

export abstract class RevenueCatClient {
  /** GET /subscribers/{app_user_id}, projected onto our entitlement state. */
  abstract getSubscriberEntitlement(
    appUserId: string
  ): Promise<RevenueCatSubscriberEntitlement>

  /**
   * POST /v1/receipts with the Stripe subscription id as fetch token —
   * the forward that bridges "customer paid Stripe" to "customer gets
   * Premium". Idempotent on RevenueCat's side: the same fetch token twice
   * must not create two subscriptions.
   */
  abstract forwardStripeSubscription(
    appUserId: string,
    stripeSubscriptionId: string
  ): Promise<void>

  /** DELETE /subscribers/{app_user_id}; processor-side erasure (Decision 7). */
  abstract deleteSubscriber(appUserId: string): Promise<void>
}

/**
 * Deterministic in-memory ledger for integration and E2E suites. Tests
 * program it via {@link setEntitlement} / {@link failNextCall}; forwards are
 * recorded and, mirroring RevenueCat's real Stripe integration, materialize an
 * active entitlement for the subscriber so a re-driven forward becomes
 * observable through the same read path the product uses.
 */
@Injectable()
export class FakeRevenueCatClient extends RevenueCatClient {
  private readonly entitlements = new Map<string, RevenueCatSubscriberEntitlement>()
  private readonly forwardedTokens = new Map<string, string>()
  private failuresRemaining = 0

  /** Test hook: program the ledger state the next reads will report. */
  setEntitlement(appUserId: string, state: RevenueCatSubscriberEntitlement): void {
    this.entitlements.set(appUserId, state)
  }

  /** Test hook: make the next N calls fail like an RC outage. */
  failNextCall(count = 1): void {
    this.failuresRemaining = count
  }

  /** Test hook: the forwards recorded so far, keyed by app user id. */
  getForwardedSubscription(appUserId: string): string | undefined {
    return this.forwardedTokens.get(appUserId)
  }

  reset(): void {
    this.entitlements.clear()
    this.forwardedTokens.clear()
    this.failuresRemaining = 0
  }

  private consumeFailure(): void {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1
      throw new Error('FakeRevenueCatClient: simulated ledger outage')
    }
  }

  getSubscriberEntitlement(appUserId: string): Promise<RevenueCatSubscriberEntitlement> {
    this.consumeFailure()
    return Promise.resolve(this.entitlements.get(appUserId) ?? null)
  }

  forwardStripeSubscription(
    appUserId: string,
    stripeSubscriptionId: string
  ): Promise<void> {
    this.consumeFailure()
    const existing = this.forwardedTokens.get(appUserId)
    // Idempotency contract: re-forwarding the same fetch token is a no-op, and
    // the suites assert exactly that against this double.
    if (existing !== stripeSubscriptionId) {
      this.forwardedTokens.set(appUserId, stripeSubscriptionId)
      this.entitlements.set(appUserId, {
        status: 'active',
        store: 'stripe',
        productId: 'premium_monthly',
        willRenew: true,
        currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
      })
    }
    return Promise.resolve()
  }

  deleteSubscriber(appUserId: string): Promise<void> {
    this.consumeFailure()
    this.entitlements.delete(appUserId)
    this.forwardedTokens.delete(appUserId)
    return Promise.resolve()
  }
}

/**
 * The real REST client (Task 5). v1 REST API, Bearer-authenticated with the
 * secret API key; one entitlement id, `premium` (Decision 1).
 *
 * Projection rules for the subscriber GET, made explicit because they ARE the
 * refresh endpoint's and the drift-correction sweep's view of truth:
 *
 *   - no `premium` entitlement on the subscriber → `null` (never subscribed);
 *   - `expires_date` in the future → `active`, or `grace_period` when the
 *     matching subscription reports `billing_issues_detected_at`;
 *   - `expires_date` in the past → `expired` (the state is returned rather
 *     than `null` so the mirror keeps the store/product record);
 *   - `will_renew` = the matching subscription has no `unsubscribe_detected_at`.
 *
 * The GET creates an empty subscriber as a side effect (known RC quirk,
 * accepted in Decision 4): only authenticated users can trigger it, and empty
 * subscribers are inert.
 */
const REVENUECAT_API_BASE_URL = 'https://api.revenuecat.com/v1'
const REVENUECAT_ENTITLEMENT_ID = 'premium'

/** The narrow slice of RC's subscriber response this client reads. */
type RevenueCatSubscriberResponse = {
  subscriber?: {
    entitlements?: Record<
      string,
      {
        expires_date?: string | null
        purchase_date?: string | null
        product_identifier?: string | null
      }
    >
    subscriptions?: Record<
      string,
      {
        store?: string | null
        unsubscribe_detected_at?: string | null
        billing_issues_detected_at?: string | null
        expires_date?: string | null
      }
    >
  }
}

const restStoreMap: Readonly<Record<string, LedgerEntitlementState['store']>> = {
  app_store: 'app_store',
  mac_app_store: 'app_store',
  play_store: 'play_store',
  stripe: 'stripe',
  promotional: 'promotional',
}

/**
 * A REST subscription store projected onto ours, or undefined for a store we do not sell.
 * `test_store` is ours only where {@link appliesRevenueCatTestStore} opens it (story 6.15 D15);
 * elsewhere the pull refuses it like any other unsupported store.
 */
function mapRevenueCatRestStore(
  store: string | null | undefined
): LedgerEntitlementState['store'] | undefined {
  const normalized = store?.toLowerCase() ?? ''
  if (normalized === 'test_store') {
    return appliesRevenueCatTestStore() ? 'test_store' : undefined
  }
  // Own keys only: an inherited name such as `constructor` is not a store.
  return Object.hasOwn(restStoreMap, normalized) ? restStoreMap[normalized] : undefined
}

export class RevenueCatUnsupportedStoreError extends Error {
  constructor(readonly store: string | null) {
    super(
      `RevenueCat entitlement comes from an unsupported store: ${store ?? 'none recorded'}`
    )
    this.name = 'RevenueCatUnsupportedStoreError'
  }
}

export class RevenueCatUnrepresentableEntitlementError extends Error {
  constructor(readonly reason: 'missing_product' | 'no_expiry' | 'invalid_expiry') {
    super(`RevenueCat entitlement cannot be represented: ${reason}`)
    this.name = 'RevenueCatUnrepresentableEntitlementError'
  }
}

export class RevenueCatRequestError extends Error {
  constructor(
    readonly status: number,
    operation: string
  ) {
    // The status and operation are enough to diagnose; response bodies can
    // carry subscriber attributes and are never echoed into errors or logs.
    super(`RevenueCat ${operation} failed with status ${status}`)
    this.name = 'RevenueCatRequestError'
  }
}

export class RealRevenueCatClient extends RevenueCatClient {
  constructor(private readonly secretApiKey: string) {
    super()
  }

  async getSubscriberEntitlement(
    appUserId: string
  ): Promise<RevenueCatSubscriberEntitlement> {
    const response = await this.request(
      'GET',
      `/subscribers/${encodeURIComponent(appUserId)}`
    )
    if (!response.ok) {
      throw new RevenueCatRequestError(response.status, 'subscriber GET')
    }
    const body = (await response.json()) as RevenueCatSubscriberResponse
    return this.projectSubscriber(body)
  }

  async forwardStripeSubscription(
    appUserId: string,
    stripeSubscriptionId: string
  ): Promise<void> {
    const response = await this.request('POST', '/receipts', {
      headers: { 'X-Platform': 'stripe' },
      body: JSON.stringify({
        app_user_id: appUserId,
        fetch_token: stripeSubscriptionId,
      }),
    })
    if (!response.ok) {
      throw new RevenueCatRequestError(response.status, 'receipt forward')
    }
  }

  async deleteSubscriber(appUserId: string): Promise<void> {
    const response = await this.request(
      'DELETE',
      `/subscribers/${encodeURIComponent(appUserId)}`
    )
    // 404 counts as erased: deleting an unknown subscriber is the desired
    // end state, and erasure flows must be idempotent.
    if (!response.ok && response.status !== 404) {
      throw new RevenueCatRequestError(response.status, 'subscriber DELETE')
    }
  }

  private async request(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: string } = {}
  ): Promise<Response> {
    return fetch(`${REVENUECAT_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretApiKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    })
  }

  private projectSubscriber(
    body: RevenueCatSubscriberResponse
  ): RevenueCatSubscriberEntitlement {
    const entitlement = body.subscriber?.entitlements?.[REVENUECAT_ENTITLEMENT_ID]
    if (!entitlement) {
      return null
    }
    // An entitlement that is present but that our model cannot represent fails the pull, so
    // refresh answers 503 and reconciliation leaves the member's row as it is. Answering null
    // here would read as "no entitlement" and expire a paying member (story 6.15 R4-01).
    const productId = entitlement.product_identifier ?? null
    if (productId === null) {
      throw new RevenueCatUnrepresentableEntitlementError('missing_product')
    }
    const subscription = body.subscriber?.subscriptions?.[productId]
    const store = mapRevenueCatRestStore(subscription?.store)
    if (store === undefined) {
      // A store we do not sell (AMAZON, a RevenueCat Test Store purchase outside an explicit local
      // or preview TEST_ENV) or a missing subscription record never takes a real store's identity
      // (story 6.15 R3-01, D15). Checked
      // before the expiry, so a lifetime or malformed unsupported entitlement fails the same way.
      throw new RevenueCatUnsupportedStoreError(subscription?.store ?? null)
    }
    if (!entitlement.expires_date) {
      // A lifetime entitlement has no period end in our subscription-only model.
      throw new RevenueCatUnrepresentableEntitlementError('no_expiry')
    }
    const expiresAt = new Date(entitlement.expires_date)
    if (Number.isNaN(expiresAt.getTime())) {
      throw new RevenueCatUnrepresentableEntitlementError('invalid_expiry')
    }
    const willRenew = !subscription?.unsubscribe_detected_at
    const inGrace =
      Boolean(subscription?.billing_issues_detected_at) &&
      expiresAt.getTime() > Date.now()

    const status: LedgerEntitlementState['status'] =
      expiresAt.getTime() <= Date.now() ? 'expired' : inGrace ? 'grace_period' : 'active'

    return {
      status,
      store,
      productId,
      willRenew: status === 'expired' ? false : willRenew,
      currentPeriodEnd: expiresAt,
    }
  }
}

/**
 * Production placeholder for environments with no key configured. Throwing at
 * CALL time rather than construction keeps module bootstrap clean in
 * environments that never touch RevenueCat.
 */
@Injectable()
export class UnconfiguredRevenueCatClient extends RevenueCatClient {
  private fail(): never {
    throw new Error(
      'REVENUECAT_SECRET_API_KEY is not configured. Set it in the API environment; see .env.example and the premium runbook.'
    )
  }

  getSubscriberEntitlement(): Promise<RevenueCatSubscriberEntitlement> {
    this.fail()
  }

  forwardStripeSubscription(): Promise<void> {
    this.fail()
  }

  deleteSubscriber(): Promise<void> {
    this.fail()
  }
}

/**
 * Module-level factory. The fake is a singleton per process on purpose: the
 * integration suite's arrange step and the request under test must see the
 * same in-memory ledger.
 */
let fakeSingleton: FakeRevenueCatClient | null = null

export function resolveRevenueCatClient(): RevenueCatClient {
  const configured = process.env.REVENUECAT_SECRET_API_KEY?.trim()
  if (configured) {
    return new RealRevenueCatClient(configured)
  }
  if (allowsTestOnlySecrets()) {
    fakeSingleton ??= new FakeRevenueCatClient()
    return fakeSingleton
  }
  return new UnconfiguredRevenueCatClient()
}
