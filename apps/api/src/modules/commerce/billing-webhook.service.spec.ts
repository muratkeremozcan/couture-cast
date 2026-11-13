import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { PrismaClient } from '@prisma/client'
import { abortFirstRun } from '../../testing/pldbgapi2.js'
import type { PremiumEntitlementService } from './premium-entitlement.service.js'
import type { RevenueCatClient } from './revenuecat-client.js'
import type { SubscriptionService } from './subscription.service.js'
import {
  BillingWebhookService,
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

// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
describe('unsupported stores never reach the ledger (story 6.15 R3-01)', () => {
  // Each case runs under every TEST_ENV that must keep the production partition, so the D15
  // Test Store path, open only under an explicit local or preview TEST_ENV, cannot open
  // production by accident. NODE_ENV is `test` here, which must not open it either.
  const environments = [undefined, 'staging', 'production', 'qa'] as const

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe.each(environments)('with TEST_ENV %s', (testEnv) => {
    beforeEach(() => {
      if (testEnv === undefined) vi.stubEnv('TEST_ENV', undefined as unknown as string)
      else vi.stubEnv('TEST_ENV', testEnv)
    })

    it.each(['INITIAL_PURCHASE', 'RENEWAL', 'EXPIRATION', 'TRANSFER'])(
      'a TEST_STORE %s is record-only',
      (type) => {
        expect(planRevenueCatTransition(rcEvent({ type, store: 'TEST_STORE' }))).toEqual({
          kind: 'record-only',
        })
      }
    )

    it('TEST_STORE maps to no store and its payload projection names none', () => {
      expect(mapRevenueCatStore('TEST_STORE')).toBeNull()
      expect(
        projectRevenueCatEventPayload(rcEvent({ store: 'TEST_STORE' })).store
      ).toBeNull()
    })

    it('a TRANSFER from any store we do not sell is record-only, so no paid row is revoked', () => {
      expect(
        planRevenueCatTransition(
          rcEvent({
            type: 'TRANSFER',
            store: 'AMAZON',
            transferred_from: ['paid-member'],
            transferred_to: ['other-member'],
          })
        )
      ).toEqual({ kind: 'record-only' })
    })
  })

  it('a TRANSFER with no store still moves the losing row, as before', () => {
    expect(planRevenueCatTransition(rcEvent({ type: 'TRANSFER', store: null }))).toEqual({
      kind: 'transfer',
    })
  })

  it('a TEST_STORE TRANSFER touching a paid member writes the event and no entitlement', async () => {
    const savedRc = process.env.REVENUECAT_WEBHOOK_AUTH
    delete process.env.REVENUECAT_WEBHOOK_AUTH
    try {
      const create = vi.fn().mockResolvedValue({})
      const prisma = {
        billingEvent: { findUnique: vi.fn().mockResolvedValue(null), create },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'paid-member' }) },
        $transaction: vi.fn((work: (tx: unknown) => unknown) =>
          work({ billingEvent: { create }, premiumEntitlement: { findUnique: vi.fn() } })
        ),
      }
      const applyLedgerEvent = vi.fn()
      const service = new BillingWebhookService(
        prisma as unknown as PrismaClient,
        { applyLedgerEvent } as unknown as PremiumEntitlementService,
        { emitTransition: vi.fn() } as unknown as SubscriptionService,
        {} as RevenueCatClient
      )
      const body = {
        event: rcEvent({
          type: 'TRANSFER',
          store: 'TEST_STORE',
          transferred_from: ['paid-member'],
          transferred_to: ['other-member'],
        }),
      }

      await service.handleRevenueCatWebhook({
        authorization: buildTestOnlyRevenueCatWebhookAuth(),
        rawBody: Buffer.from(JSON.stringify(body)),
      })

      expect(applyLedgerEvent).not.toHaveBeenCalled()
    } finally {
      if (savedRc === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH
      else process.env.REVENUECAT_WEBHOOK_AUTH = savedRc
    }
  })
})

// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
describe('the RevenueCat Test Store converges under local and preview (story 6.15 D15)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe.each(['local', 'preview'])('with TEST_ENV %s', (testEnv) => {
    beforeEach(() => {
      vi.stubEnv('TEST_ENV', testEnv)
    })

    it('maps TEST_STORE to test_store, in any case, and records it in the payload', () => {
      expect(mapRevenueCatStore('TEST_STORE')).toBe('test_store')
      expect(mapRevenueCatStore('test_store')).toBe('test_store')
      expect(projectRevenueCatEventPayload(rcEvent({ store: 'TEST_STORE' })).store).toBe(
        'test_store'
      )
    })

    it.each([
      ['INITIAL_PURCHASE', 'active', true],
      ['RENEWAL', 'active', true],
      ['CANCELLATION', 'active', false],
      ['EXPIRATION', 'expired', false],
    ] as const)('a TEST_STORE %s applies as test_store', (type, status, willRenew) => {
      expect(planRevenueCatTransition(rcEvent({ type, store: 'TEST_STORE' }))).toEqual({
        kind: 'apply',
        state: {
          status,
          store: 'test_store',
          productId: 'premium_monthly',
          willRenew,
          currentPeriodEnd: new Date(1_757_676_700_000),
        },
      })
    })

    it('a TEST_STORE TRANSFER moves the entitlement', () => {
      expect(
        planRevenueCatTransition(
          rcEvent({
            type: 'TRANSFER',
            store: 'TEST_STORE',
            transferred_from: ['paid-member'],
            transferred_to: ['other-member'],
          })
        )
      ).toEqual({ kind: 'transfer' })
    })

    it('every other store we do not sell stays record-only, a TRANSFER included', () => {
      for (const type of ['INITIAL_PURCHASE', 'TRANSFER']) {
        expect(planRevenueCatTransition(rcEvent({ type, store: 'AMAZON' }))).toEqual({
          kind: 'record-only',
        })
      }
    })

    it('real stores keep their mappings', () => {
      expect(mapRevenueCatStore('APP_STORE')).toBe('app_store')
      expect(mapRevenueCatStore('PLAY_STORE')).toBe('play_store')
      expect(mapRevenueCatStore('STRIPE')).toBe('stripe')
    })
  })

  it('a TEST_STORE TRANSFER under local revokes the loser and grants the gainer test_store', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const savedRc = process.env.REVENUECAT_WEBHOOK_AUTH
    delete process.env.REVENUECAT_WEBHOOK_AUTH
    try {
      const create = vi.fn().mockResolvedValue({})
      const losingRow = {
        user_id: 'paid-member',
        status: 'active',
        store: 'test_store',
        product_id: 'premium_monthly',
        current_period_end: new Date(1_757_676_700_000),
      }
      const prisma = {
        billingEvent: { findUnique: vi.fn().mockResolvedValue(null), create },
        user: {
          findUnique: vi.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve({ id: where.id })
          ),
        },
        $transaction: vi.fn((work: (tx: unknown) => unknown) =>
          work({
            billingEvent: { create },
            premiumEntitlement: { findUnique: vi.fn().mockResolvedValue(losingRow) },
          })
        ),
      }
      const applyLedgerEvent = vi.fn().mockResolvedValue(null)
      const service = new BillingWebhookService(
        prisma as unknown as PrismaClient,
        { applyLedgerEvent } as unknown as PremiumEntitlementService,
        { emitTransition: vi.fn() } as unknown as SubscriptionService,
        {} as RevenueCatClient
      )
      const body = {
        event: rcEvent({
          type: 'TRANSFER',
          store: 'TEST_STORE',
          transferred_from: ['paid-member'],
          transferred_to: ['other-member'],
        }),
      }

      await service.handleRevenueCatWebhook({
        authorization: buildTestOnlyRevenueCatWebhookAuth(),
        rawBody: Buffer.from(JSON.stringify(body)),
      })

      const recordedStores = create.mock.calls.map(
        ([input]) => (input as { data: { store: unknown } }).data.store
      )
      expect(recordedStores).toEqual(['test_store'])
      const applied = applyLedgerEvent.mock.calls.map(([, input]) => {
        const { userId, state } = input as {
          userId: string
          state: { status: string; store: string }
        }
        return { userId, status: state.status, store: state.store }
      })
      expect(applied).toEqual([
        { userId: 'paid-member', status: 'revoked', store: 'test_store' },
        { userId: 'other-member', status: 'active', store: 'test_store' },
      ])
    } finally {
      if (savedRc === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH
      else process.env.REVENUECAT_WEBHOOK_AUTH = savedRc
    }
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

describe('TRANSFER after a pldbgapi2 re-run (repeat safety)', () => {
  const savedRc = process.env.REVENUECAT_WEBHOOK_AUTH
  afterEach(() => {
    if (savedRc === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH
    else process.env.REVENUECAT_WEBHOOK_AUTH = savedRc
  })

  it('reports only the transitions the committed attempt made', async () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH
    // The aborted first attempt finds the loser's row and applies both sides; by the
    // committed second attempt the row is gone, so neither side transitions.
    const losingRow = {
      store: 'app_store',
      product_id: 'premium_monthly',
      current_period_end: new Date('2026-12-01T00:00:00.000Z'),
    }
    const tx = {
      billingEvent: { create: vi.fn().mockResolvedValue({}) },
      premiumEntitlement: {
        findUnique: vi.fn().mockResolvedValueOnce(losingRow).mockResolvedValueOnce(null),
      },
    }
    const prisma = {
      billingEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      user: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id })
        ),
      },
      $transaction: vi.fn(abortFirstRun(() => tx)),
    }
    const applyLedgerEvent = vi
      .fn()
      .mockResolvedValueOnce({ from: 'active', to: 'revoked' })
      .mockResolvedValueOnce({ from: 'none', to: 'active' })
    const emitTransition = vi.fn()
    const service = new BillingWebhookService(
      prisma as unknown as PrismaClient,
      { applyLedgerEvent } as unknown as PremiumEntitlementService,
      { emitTransition } as unknown as SubscriptionService,
      {} as RevenueCatClient
    )
    const warn = vi
      .spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined)
    const body = {
      event: rcEvent({
        type: 'TRANSFER',
        app_user_id: null,
        product_id: null,
        expiration_at_ms: null,
        store: null,
        transferred_from: ['loser'],
        transferred_to: ['gainer'],
      }),
    }

    await service.handleRevenueCatWebhook({
      authorization: buildTestOnlyRevenueCatWebhookAuth(),
      rawBody: Buffer.from(JSON.stringify(body)),
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(applyLedgerEvent).toHaveBeenCalledTimes(2)
    expect(emitTransition).not.toHaveBeenCalled()
    // The committed attempt skipped the gain, and only it reaches the log.
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('logs a gain skipped by both runs once, after commit', async () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH
    const tx = {
      billingEvent: { create: vi.fn().mockResolvedValue({}) },
      premiumEntitlement: { findUnique: vi.fn().mockResolvedValue(null) },
    }
    const prisma = {
      billingEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      user: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id })
        ),
      },
      $transaction: vi.fn(abortFirstRun(() => tx)),
    }
    const service = new BillingWebhookService(
      prisma as unknown as PrismaClient,
      { applyLedgerEvent: vi.fn() } as unknown as PremiumEntitlementService,
      { emitTransition: vi.fn() } as unknown as SubscriptionService,
      {} as RevenueCatClient
    )
    const warn = vi
      .spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined)
    const body = {
      event: rcEvent({
        type: 'TRANSFER',
        app_user_id: null,
        product_id: null,
        expiration_at_ms: null,
        store: null,
        transferred_from: ['loser'],
        transferred_to: ['gainer'],
      }),
    }
    await service.handleRevenueCatWebhook({
      authorization: buildTestOnlyRevenueCatWebhookAuth(),
      rawBody: Buffer.from(JSON.stringify(body)),
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
