// Story 5.2 Task 6: the settings Premium section.
//
// The premium network/SDK boundary is owned here the way the commerce
// preference boundary is owned in `tab-two-screen.test.tsx`; the render-state
// resolver and entitlement predicate stay real. Purchase outcome mapping from
// the raw SDK is covered in `src/lib/premium.test.ts` — this suite drives the
// section through all five purchase outcomes and the per-status renders. The
// bounded poll is mocked at the boundary (its timing contract is fake-timer
// tested in the lib suite), so nothing here sleeps.
/* eslint-disable @typescript-eslint/await-thenable */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Subscription } from '@couture/api-client/contracts/http'
import type * as PremiumModule from '../lib/premium'

/*
 * Story 5.4: `settings.tsx` gained an `expo-router` import for the palette advisor
 * link row. `expo-router` transitively pulls in `expo-asset`, which cannot be
 * evaluated in this browser test bundle ("Cannot read properties of undefined
 * (reading 'EventEmitter')"), so every suite that renders the settings screen has to
 * stub it. Navigation itself is not what these suites are about; the row's own
 * behaviour is covered by `palette-advisor-screen.test.tsx` and the Maestro flow.
 */
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

vi.mock('@/components/edit-screen-info', () => ({
  default: () => null,
}))

const {
  analyticsCaptureMock,
  analyticsDistinctIdMock,
  loadMobileApiHealthMock,
  updatePreferredLocaleMock,
  getCommercePreferenceMock,
  updateCommercePreferenceMock,
  getSubscriptionMock,
  ensurePurchasesConfiguredMock,
  refreshSubscriptionMock,
  pollSubscriptionMock,
  purchasePremiumPlanMock,
  restorePremiumPurchasesMock,
  showManageSubscriptionsMock,
  resolvePremiumSectionStateMock,
  isEntitledSubscriptionMock,
} = vi.hoisted(() => ({
  analyticsCaptureMock: vi.fn(),
  analyticsDistinctIdMock: vi.fn(() => 'test-user-id'),
  loadMobileApiHealthMock: vi.fn(),
  updatePreferredLocaleMock: vi.fn(),
  getCommercePreferenceMock: vi.fn(),
  updateCommercePreferenceMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  ensurePurchasesConfiguredMock: vi.fn(),
  refreshSubscriptionMock: vi.fn(),
  pollSubscriptionMock: vi.fn(),
  purchasePremiumPlanMock: vi.fn(),
  restorePremiumPurchasesMock: vi.fn(),
  showManageSubscriptionsMock: vi.fn(),
  resolvePremiumSectionStateMock: vi.fn(),
  isEntitledSubscriptionMock: vi.fn(),
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: analyticsCaptureMock,
    getDistinctId: analyticsDistinctIdMock,
  }),
}))

vi.mock('@/src/lib/api-health', () => ({
  loadMobileApiHealth: loadMobileApiHealthMock,
}))

vi.mock('@/src/lib/user', () => ({
  updatePreferredLocaleFromMobile: updatePreferredLocaleMock,
  // The real premium lib (loaded via vi.importActual for its pure exports)
  // imports this from './user'; the mocked module has to keep the name.
  getUserProfileFromMobile: vi.fn(),
}))

vi.mock('@/src/lib/commerce', () => ({
  getCommercePreferenceFromMobile: getCommercePreferenceMock,
  updateCommercePreferenceFromMobile: updateCommercePreferenceMock,
  // The real premium lib (loaded via vi.importActual for its pure exports)
  // imports this from './commerce'; the mocked module has to keep the name.
  withRequestTimeout: vi.fn(),
}))

// A static factory: browser-mode module mocking cannot resolve importOriginal
// factories. The two pure exports (resolver + entitlement predicate) get their
// REAL implementations wired in beforeAll via vi.importActual, so the section
// still renders from the actual render-state logic.
vi.mock('@/src/lib/premium', () => ({
  getSubscriptionFromMobile: getSubscriptionMock,
  ensurePurchasesConfigured: ensurePurchasesConfiguredMock,
  refreshSubscriptionFromMobile: refreshSubscriptionMock,
  pollSubscriptionUntilEntitled: pollSubscriptionMock,
  purchasePremiumPlan: purchasePremiumPlanMock,
  restorePremiumPurchases: restorePremiumPurchasesMock,
  showManageSubscriptionsInStore: showManageSubscriptionsMock,
  resolvePremiumSectionState: resolvePremiumSectionStateMock,
  isEntitledSubscription: isEntitledSubscriptionMock,
}))

import i18n, { initI18n } from '../lib/i18n'
import { mockSubscriptionActive, mockSubscriptionNone } from '../test-utils/msw/handlers'
import SettingsScreen from '../../app/(tabs)/settings'

type EntitledSubscription = Exclude<Subscription, { status: 'none' }>

const entitled = (overrides: Partial<EntitledSubscription> = {}) => ({
  ...mockSubscriptionActive.data,
  ...overrides,
})

describe('SettingsScreen premium section', () => {
  let actualPremium: typeof PremiumModule

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
    actualPremium = await vi.importActual<typeof PremiumModule>('@/src/lib/premium')
  })

  beforeEach(() => {
    // Re-wired every test: restoreMocks strips implementations between tests.
    resolvePremiumSectionStateMock.mockImplementation(
      actualPremium.resolvePremiumSectionState
    )
    isEntitledSubscriptionMock.mockImplementation(actualPremium.isEntitledSubscription)
    localStorage.clear()
    analyticsCaptureMock.mockReset()
    analyticsDistinctIdMock.mockReturnValue('test-user-id')
    loadMobileApiHealthMock.mockReset()
    loadMobileApiHealthMock.mockResolvedValue({ status: 'ok' })
    updatePreferredLocaleMock.mockReset()
    updatePreferredLocaleMock.mockResolvedValue({ success: true })
    getCommercePreferenceMock.mockReset()
    getCommercePreferenceMock.mockResolvedValue({ affiliateCtasEnabled: true })
    updateCommercePreferenceMock.mockReset()
    getSubscriptionMock.mockReset()
    getSubscriptionMock.mockResolvedValue(mockSubscriptionNone.data)
    ensurePurchasesConfiguredMock.mockReset()
    ensurePurchasesConfiguredMock.mockResolvedValue('ready')
    refreshSubscriptionMock.mockReset()
    refreshSubscriptionMock.mockResolvedValue(mockSubscriptionNone.data)
    pollSubscriptionMock.mockReset()
    pollSubscriptionMock.mockResolvedValue(null)
    purchasePremiumPlanMock.mockReset()
    restorePremiumPurchasesMock.mockReset()
    showManageSubscriptionsMock.mockReset()
    showManageSubscriptionsMock.mockResolvedValue(true)
  })

  describe('per-status rendering', () => {
    it('renders both plan CTAs, restore, and the none status for a fresh account', async () => {
      await render(<SettingsScreen />)

      const statusLine = await screen.findByTestId('premium-status-line')
      expect(statusLine.textContent).toBe('You don’t have a Premium subscription.')
      expect(await screen.findByTestId('premium-subscribe-monthly')).toBeTruthy()
      expect(screen.getByTestId('premium-subscribe-annual')).toBeTruthy()
      expect(screen.getByTestId('premium-restore')).toBeTruthy()
      expect(screen.getByTestId('premium-settings-disclosure').textContent).toContain(
        'RevenueCat'
      )
    })

    it('hides the buy controls when the kill switch is off but KEEPS restore', async () => {
      // AC 5: purchasesEnabled on the status response is the ONLY kill-switch
      // exposure, read before rendering any subscribe control.
      //
      // Restore is deliberately NOT gated. It mints no purchase — it re-reads
      // what the store already sold this user — so gating it would strand a
      // subscriber whose entitlement is missing from our mirror with no way to
      // recover access while the switch is off, which is precisely the
      // lock-out AC 5 forbids. AC 1 lists restore as its own entry point, and
      // Decision 11 gates "the subscribe CTA", not this.
      getSubscriptionMock.mockResolvedValue({
        ...mockSubscriptionNone.data,
        purchasesEnabled: false,
      })

      await render(<SettingsScreen />)

      await screen.findByTestId('premium-status-line')
      expect(screen.queryByTestId('premium-subscribe-monthly')).toBeNull()
      expect(screen.queryByTestId('premium-subscribe-annual')).toBeNull()
      expect(screen.queryByTestId('premium-restore')).not.toBeNull()
      expect(screen.queryByTestId('premium-unavailable')).toBeNull()
    })

    it('renders the graceful fallback instead of CTAs when the SDK is absent (Expo Go)', async () => {
      ensurePurchasesConfiguredMock.mockResolvedValue('unavailable')

      await render(<SettingsScreen />)

      const fallback = await screen.findByTestId('premium-unavailable')
      expect(fallback.textContent).toContain('Purchases')
      expect(screen.queryByTestId('premium-subscribe-monthly')).toBeNull()
      expect(screen.queryByTestId('premium-subscribe-annual')).toBeNull()
    })

    it('renders plan, period end, and a native manage entry for an active store subscription', async () => {
      getSubscriptionMock.mockResolvedValue(entitled())

      await render(<SettingsScreen />)

      const statusLine = await screen.findByTestId('premium-status-line')
      expect(statusLine.textContent).toContain('Premium Monthly')
      expect(statusLine.textContent).toContain('September')
      expect(screen.queryByTestId('premium-subscribe-monthly')).toBeNull()
      expect(screen.queryByTestId('premium-grace-banner')).toBeNull()

      fireEvent.click(screen.getByTestId('premium-manage'))
      await waitFor(() => {
        expect(showManageSubscriptionsMock).toHaveBeenCalledTimes(1)
      })
    })

    it('renders a web-manage hint instead of the native flow for a Stripe subscription', async () => {
      getSubscriptionMock.mockResolvedValue(entitled({ store: 'stripe' }))

      await render(<SettingsScreen />)

      const hint = await screen.findByTestId('premium-manage-web-hint')
      expect(hint.textContent).toContain('web')
      expect(screen.queryByTestId('premium-manage')).toBeNull()
    })

    it('keeps the active UI and adds the payment-issue banner in a grace period', async () => {
      getSubscriptionMock.mockResolvedValue(entitled({ status: 'grace_period' }))

      await render(<SettingsScreen />)

      const banner = await screen.findByTestId('premium-grace-banner')
      expect(banner.textContent).toContain('payment')
      expect(screen.getByTestId('premium-manage')).toBeTruthy()
      expect(screen.queryByTestId('premium-subscribe-monthly')).toBeNull()
    })

    it('renders the ended note plus subscribe CTAs after expiry', async () => {
      getSubscriptionMock.mockResolvedValue(
        entitled({ status: 'expired', willRenew: false })
      )

      await render(<SettingsScreen />)

      expect(await screen.findByTestId('premium-ended-note')).toBeTruthy()
      expect((await screen.findByTestId('premium-status-line')).textContent).toContain(
        'expired'
      )
      expect(await screen.findByTestId('premium-subscribe-monthly')).toBeTruthy()
    })

    it('alerts when the subscription status cannot be loaded', async () => {
      getSubscriptionMock.mockRejectedValue(new Error('status down'))

      await render(<SettingsScreen />)

      const alert = await screen.findByTestId('premium-load-error')
      expect(alert).toHaveAttribute('role', 'alert')
      expect(screen.queryByTestId('premium-subscribe-monthly')).toBeNull()
    })
  })

  describe('purchase outcomes (5.2-MOB-002..006)', () => {
    it('5.2-MOB-002 success: tracks the tap, refreshes, and renders the entitlement without polling', async () => {
      purchasePremiumPlanMock.mockResolvedValue({ kind: 'success' })
      refreshSubscriptionMock.mockResolvedValue(entitled())

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-subscribe-monthly'))

      const statusLine = await screen.findByTestId('premium-status-line')
      await waitFor(() => {
        expect(statusLine.textContent).toContain('Premium Monthly')
      })
      expect(analyticsCaptureMock).toHaveBeenCalledWith('premium_subscribe_tapped', {
        plan: 'premium_monthly',
        surface: 'mobile_settings',
      })
      // The refresh already answered entitled; the poll must not start.
      expect(pollSubscriptionMock).not.toHaveBeenCalled()
      expect(screen.queryByTestId('premium-still-processing')).toBeNull()
    })

    it('5.2-MOB-002a success with webhook lag: polls after refresh and renders the polled entitlement', async () => {
      purchasePremiumPlanMock.mockResolvedValue({ kind: 'success' })
      refreshSubscriptionMock.mockResolvedValue(mockSubscriptionNone.data)
      pollSubscriptionMock.mockResolvedValue(entitled({ productId: 'premium_annual' }))

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-subscribe-annual'))

      await waitFor(() => {
        expect(screen.getByTestId('premium-status-line').textContent).toContain(
          'Premium Annual'
        )
      })
      expect(pollSubscriptionMock).toHaveBeenCalledTimes(1)
    })

    it('5.2-MOB-001 terminal state: renders "still processing" when the bounded poll caps out', async () => {
      purchasePremiumPlanMock.mockResolvedValue({ kind: 'success' })
      refreshSubscriptionMock.mockRejectedValue(new Error('refresh down'))
      pollSubscriptionMock.mockResolvedValue(null)

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-subscribe-monthly'))

      const terminal = await screen.findByTestId('premium-still-processing')
      expect(terminal.textContent).toContain('Still processing')
      // A none mid-poll never renders as failure (Decision 11).
      expect(screen.queryByTestId('premium-purchase-error')).toBeNull()
    })

    it('5.2-MOB-003 user-cancelled: returns quietly to idle with no error banner', async () => {
      purchasePremiumPlanMock.mockResolvedValue({ kind: 'user-cancelled' })

      await render(<SettingsScreen />)
      const monthly = await screen.findByTestId('premium-subscribe-monthly')
      fireEvent.click(monthly)

      await waitFor(() => {
        expect(purchasePremiumPlanMock).toHaveBeenCalledTimes(1)
      })
      await waitFor(() => {
        // react-native-web drops aria-disabled entirely once false.
        expect(monthly).not.toHaveAttribute('aria-disabled', 'true')
      })
      expect(screen.queryByTestId('premium-purchase-error')).toBeNull()
      expect(refreshSubscriptionMock).not.toHaveBeenCalled()
      expect(pollSubscriptionMock).not.toHaveBeenCalled()
    })

    it('5.2-MOB-004 sdk-unavailable: swaps the CTAs for the informational fallback', async () => {
      purchasePremiumPlanMock.mockResolvedValue({ kind: 'sdk-unavailable' })

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-subscribe-monthly'))

      expect(await screen.findByTestId('premium-unavailable')).toBeTruthy()
      expect(screen.queryByTestId('premium-subscribe-monthly')).toBeNull()
      expect(screen.queryByTestId('premium-purchase-error')).toBeNull()
    })

    it('5.2-MOB-005 deferred (Ask to Buy): shows pending approval and never starts the poll', async () => {
      purchasePremiumPlanMock.mockResolvedValue({ kind: 'deferred' })

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-subscribe-monthly'))

      const pending = await screen.findByTestId('premium-pending-approval')
      expect(pending.textContent).toContain('approval')
      expect(refreshSubscriptionMock).not.toHaveBeenCalled()
      expect(pollSubscriptionMock).not.toHaveBeenCalled()
      expect(screen.queryByTestId('premium-purchase-error')).toBeNull()
    })

    it('5.2-MOB-006 error: renders the localized purchase error as an alert', async () => {
      purchasePremiumPlanMock.mockResolvedValue({ kind: 'error' })

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-subscribe-monthly'))

      const alert = await screen.findByTestId('premium-purchase-error')
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert.textContent).toBe(
        'The purchase could not be completed. Please try again.'
      )
      expect(pollSubscriptionMock).not.toHaveBeenCalled()
    })

    it('marks the tapped CTA busy while the store is answering, with no optimistic UI', async () => {
      let resolvePurchase: (outcome: { kind: 'user-cancelled' }) => void = () => undefined
      purchasePremiumPlanMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePurchase = resolve
          })
      )

      await render(<SettingsScreen />)
      const monthly = await screen.findByTestId('premium-subscribe-monthly')
      fireEvent.click(monthly)

      await waitFor(() => {
        expect(monthly).toHaveAttribute('aria-busy', 'true')
      })
      expect(monthly).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('premium-restore')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      // Still the none status: nothing pretended the purchase already worked.
      expect(screen.getByTestId('premium-status-line').textContent).toBe(
        'You don’t have a Premium subscription.'
      )

      resolvePurchase({ kind: 'user-cancelled' })
      await waitFor(() => {
        expect(monthly).toHaveAttribute('aria-busy', 'false')
      })
    })

    it('ignores a second tap while a purchase is already in flight', async () => {
      let resolvePurchase: (outcome: { kind: 'user-cancelled' }) => void = () => undefined
      purchasePremiumPlanMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePurchase = resolve
          })
      )

      await render(<SettingsScreen />)
      const monthly = await screen.findByTestId('premium-subscribe-monthly')
      fireEvent.click(monthly)
      fireEvent.click(monthly)
      fireEvent.click(screen.getByTestId('premium-subscribe-annual'))

      resolvePurchase({ kind: 'user-cancelled' })
      await waitFor(() => {
        expect(monthly).toHaveAttribute('aria-busy', 'false')
      })
      expect(purchasePremiumPlanMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('restore purchases', () => {
    it('refreshes the server state after a successful store restore', async () => {
      restorePremiumPurchasesMock.mockResolvedValue({ kind: 'success' })
      refreshSubscriptionMock.mockResolvedValue(entitled())

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-restore'))

      await waitFor(() => {
        expect(screen.getByTestId('premium-status-line').textContent).toContain(
          'Premium Monthly'
        )
      })
      expect(refreshSubscriptionMock).toHaveBeenCalledTimes(1)
    })

    it('surfaces a restore failure as the purchase error alert', async () => {
      restorePremiumPurchasesMock.mockResolvedValue({ kind: 'error' })

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-restore'))

      expect(await screen.findByTestId('premium-purchase-error')).toBeTruthy()
    })

    it('falls back to the unavailable state when restore finds no SDK', async () => {
      restorePremiumPurchasesMock.mockResolvedValue({ kind: 'sdk-unavailable' })

      await render(<SettingsScreen />)
      fireEvent.click(await screen.findByTestId('premium-restore'))

      expect(await screen.findByTestId('premium-unavailable')).toBeTruthy()
    })
  })
})
