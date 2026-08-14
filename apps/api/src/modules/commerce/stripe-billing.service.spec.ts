import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE,
} from '../../contracts/http.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { PremiumEntitlementService } from './premium-entitlement.service.js'
import { FakeStripeBillingClient } from './stripe-client.js'
import { StripeBillingService } from './stripe-billing.service.js'

/**
 * Story 5.2 Task 4: the checkout/portal decision logic against mocks. The
 * HTTP-visible behaviour (status precedence over real routes, cache headers)
 * is proven in `integration/premium-stripe-rail.integration.spec.ts`; these
 * cases keep the CI unit tier honest on every error branch (deferred-work #10:
 * the integration tier does not run there).
 */
describe('StripeBillingService', () => {
  const featureFlags = { getFeatureFlag: vi.fn() }
  const entitlements = { getEntitlement: vi.fn() }
  const telemetry = { captureEvent: vi.fn() }
  const billingCustomer = { findUnique: vi.fn(), upsert: vi.fn() }
  const prisma = { billingCustomer } as unknown as PrismaClient
  let stripeClient: FakeStripeBillingClient
  let service: StripeBillingService

  beforeEach(() => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    entitlements.getEntitlement.mockReset().mockResolvedValue(null)
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    billingCustomer.findUnique.mockReset().mockResolvedValue(null)
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

  describe('checkout-session', () => {
    it('answers 503 with the disabled message while the kill switch is off', async () => {
      featureFlags.getFeatureFlag.mockResolvedValue(false)

      const attempt = service.createCheckoutSession('user-1', 'premium_monthly')

      await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableException)
      await expect(
        service
          .createCheckoutSession('user-1', 'premium_monthly')
          .catch((e: Error) => e.message)
      ).resolves.toContain(COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE)
      expect(stripeClient.checkoutSessions).toHaveLength(0)
    })

    it.each(['active', 'grace_period'] as const)(
      'answers 409 when the entitlement is already %s',
      async (status) => {
        entitlements.getEntitlement.mockResolvedValue({ status, store: 'stripe' })

        const attempt = service.createCheckoutSession('user-1', 'premium_monthly')

        await expect(attempt).rejects.toBeInstanceOf(ConflictException)
        await expect(attempt.catch((e: Error) => e.message)).resolves.toBe(
          SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE
        )
      }
    )

    it.each(['expired', 'revoked'] as const)(
      'lets a %s subscriber buy again',
      async (status) => {
        entitlements.getEntitlement.mockResolvedValue({ status, store: 'stripe' })

        const session = await service.createCheckoutSession('user-1', 'premium_annual')

        expect(session.url).toContain('https://checkout.stripe.test/')
      }
    )

    it('creates the customer once and links the session both ways', async () => {
      const session = await service.createCheckoutSession('user-1', 'premium_monthly')

      expect(session.url).toContain('https://checkout.stripe.test/')
      expect(billingCustomer.upsert).toHaveBeenCalledTimes(1)
      const created = stripeClient.checkoutSessions[0]
      expect(created).toMatchObject({
        userId: 'user-1',
        plan: 'premium_monthly',
        priceId: 'price_test_premium_monthly',
      })
      expect(created?.successUrl).toContain('/settings?checkout=success')
      expect(created?.cancelUrl).toContain('/settings?checkout=cancelled')
    })

    it('reuses an existing BillingCustomer instead of minting a second Stripe customer', async () => {
      billingCustomer.findUnique.mockResolvedValue({
        user_id: 'user-1',
        stripe_customer_id: 'cus_existing',
      })

      await service.createCheckoutSession('user-1', 'premium_monthly')

      expect(billingCustomer.upsert).not.toHaveBeenCalled()
      expect(stripeClient.checkoutSessions[0]?.customerId).toBe('cus_existing')
    })

    it('turns a Stripe API failure into the honest 500', async () => {
      stripeClient.failNextCall()

      await expect(
        service.createCheckoutSession('user-1', 'premium_monthly')
      ).rejects.toBeInstanceOf(InternalServerErrorException)
    })

    it('emits premium_checkout_started after the session exists', async () => {
      await service.createCheckoutSession('user-1', 'premium_annual')

      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        'user-1',
        'premium_checkout_started',
        { plan: 'premium_annual' }
      )
    })

    it('fail-open: a degraded telemetry sink never fails a created session', async () => {
      telemetry.captureEvent.mockRejectedValue(new Error('posthog down'))

      const session = await service.createCheckoutSession('user-1', 'premium_monthly')

      expect(session.url).toContain('https://checkout.stripe.test/')
    })
  })

  describe('portal-session', () => {
    it('answers 404 with the not-found message when no billing profile exists', async () => {
      const attempt = service.createPortalSession('user-1')

      await expect(attempt).rejects.toBeInstanceOf(NotFoundException)
      await expect(attempt.catch((e: Error) => e.message)).resolves.toBe(
        SUBSCRIPTION_NOT_FOUND_MESSAGE
      )
    })

    it('answers 409 when the entitlement is store-managed', async () => {
      billingCustomer.findUnique.mockResolvedValue({
        user_id: 'user-1',
        stripe_customer_id: 'cus_existing',
      })
      entitlements.getEntitlement.mockResolvedValue({
        status: 'active',
        store: 'app_store',
      })

      const attempt = service.createPortalSession('user-1')

      await expect(attempt).rejects.toBeInstanceOf(ConflictException)
      await expect(attempt.catch((e: Error) => e.message)).resolves.toBe(
        SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE
      )
    })

    it('serves the portal to a lapsed web subscriber with no entitlement row', async () => {
      billingCustomer.findUnique.mockResolvedValue({
        user_id: 'user-1',
        stripe_customer_id: 'cus_existing',
      })
      entitlements.getEntitlement.mockResolvedValue(null)

      const session = await service.createPortalSession('user-1')

      expect(session.url).toContain('https://portal.stripe.test/')
    })

    it('works regardless of the kill switch: a paying user can always cancel', async () => {
      featureFlags.getFeatureFlag.mockResolvedValue(false)
      billingCustomer.findUnique.mockResolvedValue({
        user_id: 'user-1',
        stripe_customer_id: 'cus_existing',
      })
      entitlements.getEntitlement.mockResolvedValue({ status: 'active', store: 'stripe' })

      const session = await service.createPortalSession('user-1')

      expect(session.url).toContain('https://portal.stripe.test/')
    })

    it('turns a Stripe portal failure into the honest 500', async () => {
      billingCustomer.findUnique.mockResolvedValue({
        user_id: 'user-1',
        stripe_customer_id: 'cus_existing',
      })
      entitlements.getEntitlement.mockResolvedValue({ status: 'active', store: 'stripe' })
      stripeClient.failNextCall()

      await expect(service.createPortalSession('user-1')).rejects.toBeInstanceOf(
        InternalServerErrorException
      )
    })
  })
})
