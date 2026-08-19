// Learning path Step 34: Premium subscription lifecycle.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-34-premium-subscription-lifecycle
// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'
import {
  createBillingCustomer,
  createBillingEvent,
  createPremiumEntitlement,
  createPremiumThemePreference,
  persistBillingCustomer,
  persistBillingEvent,
  persistPremiumEntitlement,
  persistPremiumThemePreference,
} from '../src/factories/premium.factory.js'

/**
 * Story 5.2 premium billing factories.
 *
 * The defaults encode migration constraints and Decision 6's allowlist rule, so
 * a fixture that drifts fails in an assertion here rather than at the database
 * with an opaque error. Persistence is asserted against a stubbed Prisma
 * client: these are unit tests of the camelCase-to-snake_case mapping and the
 * cleanup registration; whether the columns actually exist is the schema
 * suite's job in `packages/db/test`.
 */

type CreateStub = { create: ReturnType<typeof vi.fn> }

function stubPrisma(): {
  prisma: PrismaClient
  premiumEntitlement: CreateStub
  billingEvent: CreateStub
  billingCustomer: CreateStub
  premiumThemePreference: CreateStub
} {
  const make = (): CreateStub => ({
    create: vi.fn(({ data }: { data: { id: string } }) => Promise.resolve(data)),
  })
  const premiumEntitlement = make()
  const billingEvent = make()
  const billingCustomer = make()
  const premiumThemePreference = make()

  return {
    prisma: {
      premiumEntitlement,
      billingEvent,
      billingCustomer,
      premiumThemePreference,
    } as unknown as PrismaClient,
    premiumEntitlement,
    billingEvent,
    billingCustomer,
    premiumThemePreference,
  }
}

describe('premium factories', () => {
  afterEach(() => {
    resetTrackedEntities()
  })

  describe('PremiumEntitlement', () => {
    it('5.2-FACTORY-01 defaults to an active stripe monthly entitlement', () => {
      const entitlement = createPremiumEntitlement()

      // Most consumers exercise the entitled branch; the deny branch is one
      // explicit override away.
      expect(entitlement.status).toBe('active')
      expect(entitlement.store).toBe('stripe')
      expect(entitlement.productId).toBe('premium_monthly')
      expect(entitlement.willRenew).toBe(true)
    })

    it('5.2-FACTORY-02 pins fixed instants so ordering tests never race the clock', () => {
      const entitlement = createPremiumEntitlement()

      // An ordering-guard test places events against lastEventOccurredAt; a
      // now()-relative default would make those placements racy.
      expect(entitlement.lastEventOccurredAt.toISOString()).toBe(
        '2026-08-01T00:00:00.000Z'
      )
      expect(entitlement.currentPeriodEnd.getTime()).toBeGreaterThan(
        entitlement.lastEventOccurredAt.getTime()
      )
      expect(entitlement.lastEventId.length).toBeGreaterThan(0)
    })

    it('5.2-FACTORY-03 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, premiumEntitlement } = stubPrisma()

      await persistPremiumEntitlement(
        prisma,
        createPremiumEntitlement({
          id: 'entitlement-1',
          userId: 'user-1',
          status: 'grace_period',
          store: 'app_store',
          productId: 'premium_annual',
          willRenew: false,
        })
      )

      expect(premiumEntitlement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'entitlement-1',
          user_id: 'user-1',
          status: 'grace_period',
          store: 'app_store',
          product_id: 'premium_annual',
          will_renew: false,
        }) as unknown,
      })
      expect(getTrackedEntityIds('premiumEntitlements')).toEqual(['entitlement-1'])
    })
  })

  describe('BillingEvent', () => {
    it('5.2-FACTORY-04 carries a non-empty external event id for the idempotency index', () => {
      const event = createBillingEvent()

      // (provider, external_event_id) is the replay barrier and the migration
      // rejects empty ids outright.
      expect(event.externalEventId.length).toBeGreaterThan(0)
      expect(event.provider).toBe('revenuecat')
    })

    it('5.2-FACTORY-05 defaults the payload to allowlisted projection keys only', () => {
      const event = createBillingEvent()

      // Decision 6: the payload is a projection, never a raw provider body. A
      // fixture default carrying a receipt id, email, or URL would let an
      // allowlist regression pass silently.
      expect(Object.keys(event.payload).sort()).toEqual(
        [
          'cancelReason',
          'environment',
          'eventType',
          'expirationAtMs',
          'periodType',
          'productId',
          'purchasedAtMs',
          'store',
        ].sort()
      )
      expect(JSON.stringify(event.payload)).not.toMatch(/@|https?:\/\/|receipt/i)
    })

    it('5.2-FACTORY-06 defaults to an unowned row with no forward obligation', () => {
      const event = createBillingEvent()

      // user_id NULL is the unknown-subject webhook case, which most failure
      // path tests need to reach; forward_due false means nothing to re-drive.
      expect(event.userId).toBeNull()
      expect(event.forwardDue).toBe(false)
      expect(event.forwardedAt).toBeNull()
      expect(event.forwardAttempts).toBe(0)
    })

    it('5.2-FACTORY-07 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, billingEvent } = stubPrisma()

      await persistBillingEvent(
        prisma,
        createBillingEvent({
          id: 'event-1',
          provider: 'stripe',
          externalEventId: 'evt_123',
          eventType: 'checkout.session.completed',
          userId: 'user-1',
          forwardDue: true,
        })
      )

      expect(billingEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'event-1',
          provider: 'stripe',
          external_event_id: 'evt_123',
          event_type: 'checkout.session.completed',
          user_id: 'user-1',
          forward_due: true,
          forwarded_at: null,
          forward_attempts: 0,
          forward_last_error: null,
        }) as unknown,
      })
      expect(getTrackedEntityIds('billingEvents')).toEqual(['event-1'])
    })
  })

  describe('BillingCustomer', () => {
    it('5.2-FACTORY-08 uses a synthetic stripe customer id', () => {
      const customer = createBillingCustomer()

      // Stripe-shaped so lookups behave, but unmistakably a test value.
      expect(customer.stripeCustomerId).toMatch(/^cus_test_/)
    })

    it('5.2-FACTORY-09 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, billingCustomer } = stubPrisma()

      await persistBillingCustomer(
        prisma,
        createBillingCustomer({
          id: 'customer-1',
          userId: 'user-1',
          stripeCustomerId: 'cus_test_abc',
        })
      )

      expect(billingCustomer.create).toHaveBeenCalledWith({
        data: {
          id: 'customer-1',
          user_id: 'user-1',
          stripe_customer_id: 'cus_test_abc',
        },
      })
      expect(getTrackedEntityIds('billingCustomers')).toEqual(['customer-1'])
    })
  })

  describe('PremiumThemePreference', () => {
    it('5.3-FACTORY-01 defaults to a chosen palette, not to Default', () => {
      const preference = createPremiumThemePreference()

      // The interesting fixture is a user who has actually picked a palette;
      // Default is one explicit `theme: null` away. Jewel Radiance is the only
      // primary accent that clears 4.5:1 against white text, so a fixture that
      // renders untouched renders an accessible pairing.
      expect(preference.theme).toBe('jewel_radiance')
    })

    it('5.3-FACTORY-02 keeps null as a real selection rather than an omitted field', async () => {
      const { prisma, premiumThemePreference } = stubPrisma()

      // Reset is an upsert to null, never a delete. If the factory dropped the
      // key when it is null, the column default would fill it in and a "reset"
      // fixture would be indistinguishable from a never-touched one.
      await persistPremiumThemePreference(
        prisma,
        createPremiumThemePreference({
          id: 'theme-preference-reset',
          userId: 'user-1',
          theme: null,
        })
      )

      expect(premiumThemePreference.create).toHaveBeenCalledWith({
        data: {
          id: 'theme-preference-reset',
          user_id: 'user-1',
          theme: null,
        },
      })
      const [call] = premiumThemePreference.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ]
      expect(Object.keys(call[0].data)).toContain('theme')
    })

    it('5.3-FACTORY-03 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, premiumThemePreference } = stubPrisma()

      await persistPremiumThemePreference(
        prisma,
        createPremiumThemePreference({
          id: 'theme-preference-1',
          userId: 'user-1',
          theme: 'winter_metallic',
        })
      )

      expect(premiumThemePreference.create).toHaveBeenCalledWith({
        data: {
          id: 'theme-preference-1',
          user_id: 'user-1',
          theme: 'winter_metallic',
        },
      })
      expect(getTrackedEntityIds('premiumThemePreferences')).toEqual([
        'theme-preference-1',
      ])
    })
  })
})
