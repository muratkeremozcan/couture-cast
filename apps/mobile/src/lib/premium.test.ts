// Story 5.2 Task 6: the mobile premium boundary.
//
// The SDK under test is the vitest alias mock (`react-native-purchases`
// resolves to `../test-utils/mocks/react-native-purchases`); importing the
// mock file directly yields the same module instance, typed as the mock, so
// tests drive the exact functions `premium.ts` will lazily import. Poll tests
// run on fake timers — no wall-clock sleeps anywhere (story test-plan rule).
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Platform } from 'react-native'
import type { Subscription } from '@couture/api-client/contracts/http'

import { server } from '../test-utils/msw/server'
import { mockSubscriptionActive, mockSubscriptionNone } from '../test-utils/msw/handlers'
import PurchasesMock, {
  PURCHASES_ERROR_CODE,
} from '../test-utils/mocks/react-native-purchases'
import { setMobileAccessTokenResolver } from './mobile-auth'
import {
  PREMIUM_ENTITLEMENT_POLL_CAP_MS,
  PREMIUM_ENTITLEMENT_POLL_INTERVAL_MS,
  ensurePurchasesConfigured,
  getSubscriptionFromMobile,
  isEntitledSubscription,
  pollSubscriptionUntilEntitled,
  purchasePremiumPlan,
  refreshSubscriptionFromMobile,
  resetPremiumPurchasesForTests,
  resolvePremiumSectionState,
  restorePremiumPurchases,
  showManageSubscriptionsInStore,
} from './premium'

const activeSubscription = mockSubscriptionActive.data as Subscription
const noneSubscription = mockSubscriptionNone.data as Subscription

type EntitledSubscription = Exclude<Subscription, { status: 'none' }>

const entitled = (overrides: Partial<EntitledSubscription>) =>
  ({ ...mockSubscriptionActive.data, ...overrides }) as Subscription

const monthlyPackage = {
  identifier: '$rc_monthly',
  product: { identifier: 'premium_monthly' },
}
const annualPackage = {
  identifier: '$rc_annual',
  product: { identifier: 'premium_annual' },
}

const loadProfileStub = () =>
  Promise.resolve({
    user: {
      id: 'user-premium-1',
      email: 'premium@example.test',
      displayName: null,
      birthdate: null,
      role: 'guardian' as const,
    },
    linkedGuardians: [],
    linkedTeens: [],
  })

/** Puts the SDK boundary into the state a real iOS dev build would see. */
async function configureReady() {
  ;(Platform as { OS: string }).OS = 'ios'
  process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY = 'test-apple-sdk-key'
  await expect(ensurePurchasesConfigured(loadProfileStub)).resolves.toBe('ready')
}

describe('mobile premium boundary', () => {
  let restoreAccessTokenResolver: (() => void) | undefined
  const originalPlatformOs = Platform.OS

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    resetPremiumPurchasesForTests()
    PurchasesMock.configure.mockResolvedValue(undefined)
    PurchasesMock.getOfferings.mockResolvedValue({
      current: { availablePackages: [monthlyPackage, annualPackage] },
    })
    PurchasesMock.purchasePackage.mockResolvedValue({})
    PurchasesMock.restorePurchases.mockResolvedValue({})
    PurchasesMock.showManageSubscriptions.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(Platform as { OS: string }).OS = originalPlatformOs
    delete process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY
    delete process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  describe('subscription reads', () => {
    it('parses the none variant off the status endpoint', async () => {
      await expect(getSubscriptionFromMobile()).resolves.toEqual(noneSubscription)
    })

    it('parses the entitled variant off the refresh endpoint', async () => {
      server.use(
        http.post('*/api/v1/commerce/subscription/refresh', () =>
          HttpResponse.json(mockSubscriptionActive)
        )
      )

      await expect(refreshSubscriptionFromMobile()).resolves.toEqual(activeSubscription)
    })

    it('rejects when the status endpoint fails', async () => {
      server.use(
        http.get(
          '*/api/v1/commerce/subscription',
          () => new HttpResponse(null, { status: 500 })
        )
      )

      await expect(getSubscriptionFromMobile()).rejects.toBeDefined()
    })

    it('rejects a response that violates the wire union', async () => {
      // Types are not a trust boundary; the contract schema is. A `none`
      // response carrying a store is unrepresentable and must not parse.
      server.use(
        http.get('*/api/v1/commerce/subscription', () =>
          HttpResponse.json({
            data: { ...mockSubscriptionNone.data, store: 'app_store' },
          })
        )
      )

      await expect(getSubscriptionFromMobile()).rejects.toBeDefined()
    })
  })

  describe('isEntitledSubscription', () => {
    it('passes active and grace_period, denies the rest', () => {
      expect(isEntitledSubscription(activeSubscription)).toBe(true)
      expect(isEntitledSubscription(entitled({ status: 'grace_period' }))).toBe(true)
      expect(isEntitledSubscription(noneSubscription)).toBe(false)
      expect(isEntitledSubscription(entitled({ status: 'expired' }))).toBe(false)
      expect(isEntitledSubscription(entitled({ status: 'revoked' }))).toBe(false)
    })
  })

  describe('resolvePremiumSectionState', () => {
    it('resolves loading, then load-error taking precedence', () => {
      expect(resolvePremiumSectionState(null, false)).toEqual({ kind: 'loading' })
      expect(resolvePremiumSectionState(null, true)).toEqual({ kind: 'load-error' })
      expect(resolvePremiumSectionState(activeSubscription, true)).toEqual({
        kind: 'load-error',
      })
    })

    it('resolves none to a fresh subscribe state carrying the kill switch', () => {
      expect(resolvePremiumSectionState(noneSubscription, false)).toEqual({
        kind: 'subscribe',
        ended: false,
        purchasesEnabled: true,
      })
      expect(
        resolvePremiumSectionState(
          { ...mockSubscriptionNone.data, purchasesEnabled: false } as Subscription,
          false
        )
      ).toEqual({ kind: 'subscribe', ended: false, purchasesEnabled: false })
    })

    it('resolves expired and revoked to the ended subscribe state', () => {
      for (const status of ['expired', 'revoked'] as const) {
        expect(resolvePremiumSectionState(entitled({ status }), false)).toEqual({
          kind: 'subscribe',
          ended: true,
          purchasesEnabled: true,
        })
      }
    })

    it('maps the manage entry by store: native for stores, web hint for Stripe, none for promotional', () => {
      expect(resolvePremiumSectionState(activeSubscription, false)).toMatchObject({
        kind: 'entitled',
        plan: 'premium_monthly',
        manageEntry: 'store',
        showGraceBanner: false,
      })
      expect(
        resolvePremiumSectionState(entitled({ store: 'play_store' }), false)
      ).toMatchObject({ manageEntry: 'store' })
      expect(
        resolvePremiumSectionState(entitled({ store: 'stripe' }), false)
      ).toMatchObject({ manageEntry: 'web' })
      expect(
        resolvePremiumSectionState(entitled({ store: 'promotional' }), false)
      ).toMatchObject({ manageEntry: 'none' })
    })

    it('keeps grace period entitled with the banner on', () => {
      expect(
        resolvePremiumSectionState(entitled({ status: 'grace_period' }), false)
      ).toMatchObject({ kind: 'entitled', showGraceBanner: true })
    })

    it('passes an operator-added product id through with no plan mapping', () => {
      expect(
        resolvePremiumSectionState(entitled({ productId: 'premium_lifetime' }), false)
      ).toMatchObject({ plan: null, productId: 'premium_lifetime' })
    })
  })

  describe('ensurePurchasesConfigured', () => {
    it('is unavailable on a platform with no store SDK key (web / Expo Go)', async () => {
      // Platform.OS is 'web' under vitest and no EXPO_PUBLIC key is set: the
      // same shape as Expo Go, where the native module is absent.
      await expect(ensurePurchasesConfigured(loadProfileStub)).resolves.toBe(
        'unavailable'
      )
      expect(PurchasesMock.configure).not.toHaveBeenCalled()
    })

    it('configures once with the user id as app_user_id and memoizes ready', async () => {
      await configureReady()
      await expect(ensurePurchasesConfigured(loadProfileStub)).resolves.toBe('ready')

      expect(PurchasesMock.configure).toHaveBeenCalledTimes(1)
      expect(PurchasesMock.configure).toHaveBeenCalledWith({
        apiKey: 'test-apple-sdk-key',
        appUserID: 'user-premium-1',
      })
    })

    it('reports a transient error without memoizing it, so a retry can succeed', async () => {
      ;(Platform as { OS: string }).OS = 'ios'
      process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY = 'test-apple-sdk-key'
      const failingProfile = vi
        .fn()
        .mockRejectedValueOnce(new Error('profile service down'))

      await expect(ensurePurchasesConfigured(failingProfile)).resolves.toBe('error')
      failingProfile.mockImplementation(loadProfileStub)
      await expect(ensurePurchasesConfigured(failingProfile)).resolves.toBe('ready')
    })
  })

  describe('purchasePremiumPlan — the five-outcome machine', () => {
    it('5.2-MOB-002 resolves success when the store confirms the purchase', async () => {
      await configureReady()

      await expect(purchasePremiumPlan('premium_annual')).resolves.toEqual({
        kind: 'success',
      })
      expect(PurchasesMock.purchasePackage).toHaveBeenCalledWith(annualPackage)
    })

    it('5.2-MOB-003 resolves user-cancelled from the SDK cancel signal', async () => {
      await configureReady()
      PurchasesMock.purchasePackage.mockRejectedValue({
        code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
        userCancelled: true,
      })

      await expect(purchasePremiumPlan('premium_monthly')).resolves.toEqual({
        kind: 'user-cancelled',
      })
    })

    it('5.2-MOB-004 resolves sdk-unavailable when the build has no store SDK', async () => {
      await expect(purchasePremiumPlan('premium_monthly')).resolves.toEqual({
        kind: 'sdk-unavailable',
      })
      expect(PurchasesMock.purchasePackage).not.toHaveBeenCalled()
    })

    it('5.2-MOB-005 resolves deferred on Ask to Buy (payment pending)', async () => {
      await configureReady()
      PurchasesMock.purchasePackage.mockRejectedValue({
        code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR,
        userCancelled: false,
      })

      await expect(purchasePremiumPlan('premium_monthly')).resolves.toEqual({
        kind: 'deferred',
      })
    })

    it('5.2-MOB-006 resolves error for any other store failure, never throwing', async () => {
      await configureReady()
      PurchasesMock.purchasePackage.mockRejectedValue({
        code: PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,
        userCancelled: false,
      })

      await expect(purchasePremiumPlan('premium_monthly')).resolves.toEqual({
        kind: 'error',
      })
    })

    it('resolves error when the offering does not carry the plan', async () => {
      await configureReady()
      PurchasesMock.getOfferings.mockResolvedValue({
        current: { availablePackages: [annualPackage] },
      })

      await expect(purchasePremiumPlan('premium_monthly')).resolves.toEqual({
        kind: 'error',
      })
      expect(PurchasesMock.purchasePackage).not.toHaveBeenCalled()
    })

    it('resolves error when fetching offerings fails', async () => {
      await configureReady()
      PurchasesMock.getOfferings.mockRejectedValue(new Error('offerings down'))

      await expect(purchasePremiumPlan('premium_monthly')).resolves.toEqual({
        kind: 'error',
      })
    })
  })

  describe('restorePremiumPurchases', () => {
    it('resolves success after the store sync runs', async () => {
      await configureReady()

      await expect(restorePremiumPurchases()).resolves.toEqual({ kind: 'success' })
      expect(PurchasesMock.restorePurchases).toHaveBeenCalledTimes(1)
    })

    it('resolves sdk-unavailable without the store SDK', async () => {
      await expect(restorePremiumPurchases()).resolves.toEqual({
        kind: 'sdk-unavailable',
      })
    })

    it('resolves error when the store sync fails', async () => {
      await configureReady()
      PurchasesMock.restorePurchases.mockRejectedValue(new Error('store down'))

      await expect(restorePremiumPurchases()).resolves.toEqual({ kind: 'error' })
    })
  })

  describe('showManageSubscriptionsInStore', () => {
    it('opens the native manage flow once configured', async () => {
      await configureReady()

      await expect(showManageSubscriptionsInStore()).resolves.toBe(true)
      expect(PurchasesMock.showManageSubscriptions).toHaveBeenCalledTimes(1)
    })

    it('answers false before configuration and on SDK failure', async () => {
      await expect(showManageSubscriptionsInStore()).resolves.toBe(false)

      await configureReady()
      PurchasesMock.showManageSubscriptions.mockRejectedValue(new Error('no UI'))
      await expect(showManageSubscriptionsInStore()).resolves.toBe(false)
    })
  })

  describe('pollSubscriptionUntilEntitled (5.2-MOB-001)', () => {
    it('polls on the fixed interval and resolves when the entitlement lands', async () => {
      vi.useFakeTimers()
      const fetchSubscription = vi
        .fn<typeof getSubscriptionFromMobile>()
        .mockResolvedValueOnce(noneSubscription)
        .mockResolvedValueOnce(noneSubscription)
        .mockResolvedValue(activeSubscription)

      const poll = pollSubscriptionUntilEntitled({ fetchSubscription })
      await vi.advanceTimersByTimeAsync(PREMIUM_ENTITLEMENT_POLL_INTERVAL_MS * 3)

      await expect(poll).resolves.toEqual(activeSubscription)
      expect(fetchSubscription).toHaveBeenCalledTimes(3)
    })

    it('hard-stops at the 2-minute cap with a null result after exactly 24 polls', async () => {
      vi.useFakeTimers()
      const fetchSubscription = vi
        .fn<typeof getSubscriptionFromMobile>()
        .mockResolvedValue(noneSubscription)

      const poll = pollSubscriptionUntilEntitled({ fetchSubscription })
      await vi.advanceTimersByTimeAsync(PREMIUM_ENTITLEMENT_POLL_CAP_MS)

      await expect(poll).resolves.toBeNull()
      expect(fetchSubscription).toHaveBeenCalledTimes(
        PREMIUM_ENTITLEMENT_POLL_CAP_MS / PREMIUM_ENTITLEMENT_POLL_INTERVAL_MS
      )
    })

    it('keeps polling through transient read failures until the cap', async () => {
      vi.useFakeTimers()
      const fetchSubscription = vi
        .fn<typeof getSubscriptionFromMobile>()
        .mockRejectedValueOnce(new Error('blip'))
        .mockResolvedValue(activeSubscription)

      const poll = pollSubscriptionUntilEntitled({ fetchSubscription })
      await vi.advanceTimersByTimeAsync(PREMIUM_ENTITLEMENT_POLL_INTERVAL_MS * 2)

      await expect(poll).resolves.toEqual(activeSubscription)
      expect(fetchSubscription).toHaveBeenCalledTimes(2)
    })

    it('resolves null promptly when the caller aborts mid-wait', async () => {
      vi.useFakeTimers()
      const controller = new AbortController()
      const fetchSubscription = vi
        .fn<typeof getSubscriptionFromMobile>()
        .mockResolvedValue(noneSubscription)

      const poll = pollSubscriptionUntilEntitled({
        fetchSubscription,
        signal: controller.signal,
      })
      await vi.advanceTimersByTimeAsync(PREMIUM_ENTITLEMENT_POLL_INTERVAL_MS)
      controller.abort()

      await expect(poll).resolves.toBeNull()
      expect(fetchSubscription).toHaveBeenCalledTimes(1)
    })
  })
})

describe('ensurePurchasesConfigured concurrency', () => {
  it('configures once when two callers race the profile read', async () => {
    // The reachable shape for CC-5.3+ surfaces: two premium mounts calling
    // this in the same tick. Memoizing only the settled result let both past
    // the guard and into Purchases.configure, which the SDK rejects.
    resetPremiumPurchasesForTests()
    // This describe sits outside the main block, so it arranges its own SDK
    // readiness rather than inheriting that beforeEach.
    const platformOsBefore = (Platform as { OS: string }).OS
    ;(Platform as { OS: string }).OS = 'ios'
    process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY = 'test-apple-sdk-key'
    PurchasesMock.configure.mockResolvedValue(undefined)
    let releaseProfile: (value: { user: { id: string } }) => void = () => undefined
    const loadProfile = vi.fn().mockReturnValue(
      new Promise<{ user: { id: string } }>((resolve) => {
        releaseProfile = resolve
      })
    )

    const first = ensurePurchasesConfigured(
      loadProfile as unknown as Parameters<typeof ensurePurchasesConfigured>[0]
    )
    const second = ensurePurchasesConfigured(
      loadProfile as unknown as Parameters<typeof ensurePurchasesConfigured>[0]
    )

    releaseProfile({ user: { id: 'user-1' } })
    const [a, b] = await Promise.all([first, second])

    expect(a).toBe('ready')
    expect(b).toBe('ready')
    expect(loadProfile).toHaveBeenCalledTimes(1)
    expect(PurchasesMock.configure).toHaveBeenCalledTimes(1)

    delete process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY
    ;(Platform as { OS: string }).OS = platformOsBefore
    resetPremiumPurchasesForTests()
  })
})
