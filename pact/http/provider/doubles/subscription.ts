import type { StripeBillingService } from '../../../../apps/api/src/modules/commerce/stripe-billing.service'
import type { SubscriptionService } from '../../../../apps/api/src/modules/commerce/subscription.service'
import {
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
} from '@couture/api-client/contracts/http'
import type { Subscription } from '@couture/api-client/contracts/http'
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  PACT_SUBSCRIPTION_CHECKOUT_URL,
  PACT_SUBSCRIPTION_PERIOD_END,
  PACT_SUBSCRIPTION_PORTAL_URL,
  PACT_SUBSCRIPTION_PRODUCT_ID,
  PACT_SUBSCRIPTION_SYNCED_AT,
} from '../fixtures'
import { getProviderSubscriptionState } from '../state'

/**
 * Provider doubles for the subscription surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createSubscriptionDoubles() {
  const requireSubscriptionScenario = () => {
    const state = getProviderSubscriptionState()
    if (!state) {
      throw new NotFoundException('SUBSCRIPTION_STATE_NOT_CONFIGURED')
    }
    return state
  }

  const subscriptionRepresentation = (): Subscription => {
    const state = requireSubscriptionScenario()
    if (state.scenario === 'entitled' || state.scenario === 'stripe-billing-profile') {
      return {
        status: 'active',
        store: state.store,
        productId: PACT_SUBSCRIPTION_PRODUCT_ID,
        willRenew: true,
        currentPeriodEnd: PACT_SUBSCRIPTION_PERIOD_END,
        syncedAt: PACT_SUBSCRIPTION_SYNCED_AT,
        purchasesEnabled: true,
      }
    }
    return {
      status: 'none',
      store: null,
      productId: null,
      willRenew: null,
      currentPeriodEnd: null,
      syncedAt: null,
      // The status endpoints stay reachable while purchasing is switched off;
      // the kill switch reaches a client only as this server-evaluated field.
      purchasesEnabled: state.scenario !== 'purchasing-disabled',
    }
  }

  /**
   * Refresh answers the same representation as status: the contract records
   * the body a client must understand after a pull, not the pull itself (the
   * ledger call, throttle window, and 503 timeout path live in
   * `subscription.service.spec.ts` against fake timers).
   */
  const mockSubscriptionService = {
    getSubscription: () => Promise.resolve(subscriptionRepresentation()),
    refreshSubscription: () => Promise.resolve(subscriptionRepresentation()),
  } as unknown as SubscriptionService

  /**
   * Decision 4's checkout status precedence, expressed as scenarios: the
   * controller runs `assertPurchasingEnabled` before parsing the body (503
   * outranks 400), and the service answers 409 for an already-entitled user
   * before any Stripe call. Portal access hinges on the billing profile, not
   * on the entitlement: only the `stripe-billing-profile` scenario has one,
   * so an App Store subscriber correctly gets the 404 the consumer records.
   */
  const mockStripeBillingService = {
    assertPurchasingEnabled: () => {
      if (requireSubscriptionScenario().scenario === 'purchasing-disabled') {
        throw new ServiceUnavailableException(COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE)
      }
      return Promise.resolve()
    },
    createCheckoutSession: () => {
      const { scenario } = requireSubscriptionScenario()
      if (scenario === 'entitled' || scenario === 'stripe-billing-profile') {
        throw new ConflictException(SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE)
      }
      return Promise.resolve({ url: PACT_SUBSCRIPTION_CHECKOUT_URL })
    },
    createPortalSession: () => {
      const { scenario } = requireSubscriptionScenario()
      if (scenario !== 'stripe-billing-profile') {
        throw new NotFoundException(SUBSCRIPTION_NOT_FOUND_MESSAGE)
      }
      return Promise.resolve({ url: PACT_SUBSCRIPTION_PORTAL_URL })
    },
  } as unknown as StripeBillingService

  /**
   * Story 5.3 premium theme switcher doubles, wired against the real
   * `PremiumThemeController` AND the real, un-mocked `PremiumEntitlementGuard`
   * -- the first Pact provider wiring of that guard (5.2's
   * `SubscriptionController` never mounted it). The guard's own
   * `canActivate` runs unmocked below (it is registered as a plain provider,
   * not overridden); only its dependency, `PremiumEntitlementService`, is a
   * scenario-driven double, same stance as `mockSubscriptionService` above.
   * WHEN each field resolves the way it does (Decision 7's entitlement-wins
   * rule, the P2023 stale-enum fallback, the flag-vs-body-parse precedence)
   * is proven in `premium-theme.service.spec.ts` and
   * `premium-theme.controller.spec.ts`; these doubles exist only to produce
   * the outcome the contract records.
   */

  return { mockSubscriptionService, mockStripeBillingService }
}
