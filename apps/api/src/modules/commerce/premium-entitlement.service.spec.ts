import { describe, expect, it, vi } from 'vitest'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  PremiumEntitlementService,
  resolveEntitlementEmission,
  type EntitlementTransition,
} from './premium-entitlement.service.js'
import { FakeRevenueCatClient } from './revenuecat-client.js'
import { FakeStripeBillingClient } from './stripe-client.js'

/**
 * Story 5.2: unit coverage for the entitlement core's decision logic. The
 * database-visible behaviour (real upserts, audit rows, the guard over HTTP)
 * is proven in `integration/premium-subscription.integration.spec.ts`; these
 * cases pin the pure rules the CI unit tier must keep honest, because the
 * integration tier does not run there (deferred-work #10).
 */

type StubTx = {
  premiumEntitlement: {
    findUnique: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  auditLog: { create: ReturnType<typeof vi.fn> }
}

function stubTx(existing: Record<string, unknown> | null): StubTx {
  return {
    premiumEntitlement: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
}

const T0 = new Date('2026-08-10T10:00:00.000Z')

const existingRow = (overrides: Record<string, unknown> = {}) => ({
  user_id: 'user-1',
  status: 'active',
  store: 'stripe',
  product_id: 'premium_monthly',
  will_renew: true,
  current_period_end: new Date('2030-01-01T00:00:00.000Z'),
  last_event_occurred_at: T0,
  last_event_id: 'evt-base',
  ...overrides,
})

const activeState = {
  status: 'active' as const,
  store: 'stripe' as const,
  productId: 'premium_monthly',
  willRenew: true,
  currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
}

function service(): PremiumEntitlementService {
  return new PremiumEntitlementService(
    {} as unknown as PrismaClient,
    new FakeRevenueCatClient(),
    new FakeStripeBillingClient()
  )
}

async function apply(
  tx: StubTx,
  occurredAt: Date,
  eventId: string
): Promise<EntitlementTransition> {
  return service().applyLedgerEvent(tx as unknown as Prisma.TransactionClient, {
    userId: 'user-1',
    state: activeState,
    occurredAt,
    eventId,
    provider: 'revenuecat',
  })
}

describe('applyLedgerEvent ordering guard (Decision 8)', () => {
  it('drops a strictly-older event without writing', async () => {
    const tx = stubTx(existingRow())

    const result = await apply(tx, new Date(T0.getTime() - 1), 'evt-older')

    expect(result.applied).toBe(false)
    expect(tx.premiumEntitlement.upsert).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('applies an equal-timestamp event with a DISTINCT id (the RC same-instant pair)', async () => {
    const tx = stubTx(existingRow())

    const result = await apply(tx, T0, 'evt-distinct')

    expect(result.applied).toBe(true)
    expect(tx.premiumEntitlement.upsert).toHaveBeenCalledTimes(1)
  })

  it('drops an equal-timestamp event with the SAME id', async () => {
    const tx = stubTx(existingRow())

    const result = await apply(tx, T0, 'evt-base')

    expect(result.applied).toBe(false)
    expect(tx.premiumEntitlement.upsert).not.toHaveBeenCalled()
  })

  it('applies a strictly-newer event and creates the row when none exists', async () => {
    const newer = await apply(
      stubTx(existingRow()),
      new Date(T0.getTime() + 1),
      'evt-new'
    )
    expect(newer.applied).toBe(true)

    const fresh = stubTx(null)
    const created = await apply(fresh, T0, 'evt-first')
    expect(created).toMatchObject({ applied: true, from: 'none', to: 'active' })
  })

  it('writes the audit row only when the status actually changes', async () => {
    // active -> active (a RENEWAL): applied, no audit noise.
    const renewal = stubTx(existingRow())
    await apply(renewal, new Date(T0.getTime() + 1), 'evt-renewal')
    expect(renewal.auditLog.create).not.toHaveBeenCalled()

    // expired -> active: applied with an audit row carrying from/to.
    const reactivation = stubTx(existingRow({ status: 'expired' }))
    await apply(reactivation, new Date(T0.getTime() + 1), 'evt-react')
    expect(reactivation.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 'premium_entitlement_changed',
        event_data: expect.objectContaining({ from: 'expired', to: 'active' }) as unknown,
      }) as unknown,
    })
  })
})

describe('resolveEntitlementEmission (AC 6 emission rules)', () => {
  const transition = (
    from: EntitlementTransition['from'],
    to: EntitlementTransition['to'],
    applied = true
  ): EntitlementTransition => ({
    applied,
    from,
    to,
    store: 'stripe',
    productId: 'premium_monthly',
  })

  it('fires activated on transitions into active from absent, expired, and revoked', () => {
    for (const from of ['none', 'expired', 'revoked'] as const) {
      expect(resolveEntitlementEmission(transition(from, 'active'))).toMatchObject({
        event: 'premium_entitlement_activated',
      })
    }
  })

  it('fires nothing for grace-period entry, exit, or unapplied events', () => {
    expect(resolveEntitlementEmission(transition('active', 'grace_period'))).toBeNull()
    expect(resolveEntitlementEmission(transition('grace_period', 'active'))).toBeNull()
    expect(resolveEntitlementEmission(transition('none', 'active', false))).toBeNull()
    expect(resolveEntitlementEmission(transition('active', 'active'))).toBeNull()
  })

  it('fires deactivated with the right reason for expiry, revocation, and transfer', () => {
    expect(resolveEntitlementEmission(transition('active', 'expired'))).toMatchObject({
      event: 'premium_entitlement_deactivated',
      reason: 'expired',
    })
    expect(resolveEntitlementEmission(transition('active', 'revoked'))).toMatchObject({
      reason: 'revoked',
    })
    expect(
      resolveEntitlementEmission(transition('active', 'revoked'), 'transferred')
    ).toMatchObject({ reason: 'transferred' })
  })
})

describe('eraseProcessorData (Decision 7, Open question 5)', () => {
  /**
   * The privacy path with no production caller yet: the future account-deletion
   * story is contractually told to call this, so it has to be proven now rather
   * than when someone wires it up. It is deliberately NOT fail-open — a
   * swallowed failure would leave personal data at a processor while the
   * deletion flow reported success.
   */
  function eraseFixture(stripeCustomerId: string | null) {
    const revenueCat = new FakeRevenueCatClient()
    const stripeBilling = new FakeStripeBillingClient()
    const prisma = {
      billingCustomer: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : null
          ),
      },
    } as unknown as PrismaClient

    return {
      service: new PremiumEntitlementService(prisma, revenueCat, stripeBilling),
      revenueCat,
      stripeBilling,
    }
  }

  it('deletes the subscriber at BOTH processors when a Stripe customer is mapped', async () => {
    const { service, revenueCat, stripeBilling } = eraseFixture('cus_test_erase')
    revenueCat.setEntitlement('user-1', {
      status: 'active',
      store: 'stripe',
      productId: 'premium_monthly',
      willRenew: true,
      currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
    })

    await service.eraseProcessorData('user-1')

    await expect(revenueCat.getSubscriberEntitlement('user-1')).resolves.toBeNull()
    expect(stripeBilling.deletedCustomerIds).toEqual(['cus_test_erase'])
  })

  it('skips Stripe when the account never had a billing profile', async () => {
    // A store-only subscriber has no Stripe customer; calling Stripe with a
    // null id would be an error, and skipping RevenueCat would leave data.
    const { service, stripeBilling } = eraseFixture(null)

    await service.eraseProcessorData('user-1')

    expect(stripeBilling.deletedCustomerIds).toEqual([])
  })

  it('propagates a RevenueCat failure instead of reporting a clean erasure', async () => {
    const { service, revenueCat, stripeBilling } = eraseFixture('cus_test_erase')
    revenueCat.failNextCall()

    await expect(service.eraseProcessorData('user-1')).rejects.toThrow()
    // Stripe is never reached, so the caller cannot mistake a partial erasure
    // for a complete one.
    expect(stripeBilling.deletedCustomerIds).toEqual([])
  })

  it('propagates a Stripe failure even after RevenueCat succeeded', async () => {
    const { service, stripeBilling } = eraseFixture('cus_test_erase')
    stripeBilling.failNextCall()

    await expect(service.eraseProcessorData('user-1')).rejects.toThrow()
  })
})
