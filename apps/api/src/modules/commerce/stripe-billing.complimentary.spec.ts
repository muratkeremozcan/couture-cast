import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { ConflictException, ServiceUnavailableException } from '@nestjs/common'
import {
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE,
  SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
} from '@couture/api-client/contracts/http'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { PremiumEntitlementService } from './premium-entitlement.service.js'
import { FakeStripeBillingClient } from './stripe-client.js'
import { StripeBillingService } from './stripe-billing.service.js'

/**
 * Story 6.14 D5, TEA-07 (U-CHECKOUT-ORDER, U-PORTAL-UNCHANGED): checkout refusal order
 * for a complimentary member. The purchasing-flag 503 comes first, the paid-active 409
 * second, the complimentary 409 third, and nothing reaches Stripe or writes a billing
 * customer for a member who already has access.
 */
describe('StripeBillingService for a complimentary member', () => {
  const featureFlags = { getFeatureFlag: vi.fn() }
  const entitlements = {
    getEntitlement: vi.fn(),
    premiumAccessSource: vi.fn(),
    hasPremiumAccess: vi.fn(),
  }
  const telemetry = { captureEvent: vi.fn() }
  const billingCustomer = { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn() }
  const prisma = { billingCustomer } as unknown as PrismaClient
  let stripeClient: FakeStripeBillingClient
  let service: StripeBillingService

  const grantee = (paid: 'active' | 'grace_period' | null) => {
    entitlements.getEntitlement.mockResolvedValue(
      paid ? { status: paid, store: 'stripe' } : null
    )
    entitlements.premiumAccessSource.mockResolvedValue('complimentary')
    entitlements.hasPremiumAccess.mockResolvedValue(true)
  }

  const messageOf = (attempt: Promise<unknown>) =>
    attempt.then(
      () => 'resolved',
      (error: Error) => error.message
    )

  const expectNoStripeOrCustomerWrite = () => {
    expect(stripeClient.checkoutSessions).toHaveLength(0)
    expect(billingCustomer.upsert).not.toHaveBeenCalled()
    expect(billingCustomer.create).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    entitlements.getEntitlement.mockReset().mockResolvedValue(null)
    entitlements.premiumAccessSource.mockReset().mockResolvedValue('none')
    entitlements.hasPremiumAccess.mockReset().mockResolvedValue(false)
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    billingCustomer.findUnique.mockReset().mockResolvedValue(null)
    billingCustomer.create.mockReset()
    billingCustomer.upsert
      .mockReset()
      .mockImplementation(
        (args: { create: { user_id: string; stripe_customer_id: string } }) =>
          Promise.resolve({
            user_id: args.create.user_id,
            stripe_customer_id: args.create.stripe_customer_id,
          })
      )
    stripeClient = new FakeStripeBillingClient()
    service = new StripeBillingService(
      prisma,
      featureFlags as unknown as FeatureFlagsService,
      entitlements as unknown as PremiumEntitlementService,
      telemetry as unknown as TelemetryService,
      stripeClient
    )
  })

  describe('U-CHECKOUT-ORDER', () => {
    it('purchasing off: a grantee gets the existing 503 before any 409', async () => {
      featureFlags.getFeatureFlag.mockResolvedValue(false)
      grantee(null)

      const attempt = service.createCheckoutSession('member-1', 'premium_monthly')

      await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableException)
      await expect(messageOf(attempt)).resolves.toBe(
        COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE
      )
      expectNoStripeOrCustomerWrite()
    })

    it.each(['active', 'grace_period'] as const)(
      'purchasing on, paid %s and granted: the paid-active 409 wins',
      async (status) => {
        grantee(status)

        const attempt = service.createCheckoutSession('member-1', 'premium_monthly')

        await expect(attempt).rejects.toBeInstanceOf(ConflictException)
        await expect(messageOf(attempt)).resolves.toBe(
          SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE
        )
        expectNoStripeOrCustomerWrite()
      }
    )

    it('purchasing on, granted with no paid row: 409 complimentary, nothing reaches Stripe', async () => {
      grantee(null)

      const attempt = service.createCheckoutSession('member-1', 'premium_annual')

      await expect(attempt).rejects.toBeInstanceOf(ConflictException)
      await expect(messageOf(attempt)).resolves.toBe(COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE)
      expectNoStripeOrCustomerWrite()
      expect(telemetry.captureEvent).not.toHaveBeenCalled()
    })

    it.each(['expired', 'revoked'] as const)(
      'purchasing on, a lapsed (%s) paid row and granted: 409 complimentary',
      async (status) => {
        entitlements.getEntitlement.mockResolvedValue({ status, store: 'stripe' })
        entitlements.premiumAccessSource.mockResolvedValue('complimentary')
        entitlements.hasPremiumAccess.mockResolvedValue(true)

        const attempt = service.createCheckoutSession('member-1', 'premium_monthly')

        await expect(messageOf(attempt)).resolves.toBe(
          COMPLIMENTARY_ACCESS_ACTIVE_MESSAGE
        )
        expectNoStripeOrCustomerWrite()
      }
    )

    it('purchasing on, neither paid nor granted: proceeds to Stripe', async () => {
      const session = await service.createCheckoutSession('member-1', 'premium_monthly')

      expect(session.url).toContain('https://checkout.stripe.test/')
      expect(stripeClient.checkoutSessions).toHaveLength(1)
      expect(billingCustomer.upsert).toHaveBeenCalledTimes(1)
    })
  })

  describe('U-PORTAL-UNCHANGED', () => {
    it('a paid web subscriber who is also granted still reaches the portal', async () => {
      grantee('active')
      billingCustomer.findUnique.mockResolvedValue({
        user_id: 'member-1',
        stripe_customer_id: 'cus_existing',
      })

      const session = await service.createPortalSession('member-1')

      expect(session.url).toContain('https://portal.stripe.test/')
    })
  })
})
