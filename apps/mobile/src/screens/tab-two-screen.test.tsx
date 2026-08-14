// Learning path Step 15: Validate, generate, and consume the canonical contract.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-15-validate-generate-and-consume-the-canonical-contract
// Learning path Step 22: Localization infrastructure and quality gates.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-22-localization-infrastructure-and-quality-gates
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Step 22 step 7 owner: verify Settings screen layout boundaries in headless Chromium in apps/mobile/src/screens/tab-two-screen.test.tsx
/* eslint-disable @typescript-eslint/await-thenable */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as PremiumModule from '../lib/premium'

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
  premiumPassthroughMocks,
} = vi.hoisted(() => ({
  analyticsCaptureMock: vi.fn(),
  analyticsDistinctIdMock: vi.fn(() => 'test-user-id'),
  loadMobileApiHealthMock: vi.fn(),
  updatePreferredLocaleMock: vi.fn(),
  getCommercePreferenceMock: vi.fn(),
  updateCommercePreferenceMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  ensurePurchasesConfiguredMock: vi.fn(),
  premiumPassthroughMocks: {
    refreshSubscriptionFromMobile: vi.fn(),
    pollSubscriptionUntilEntitled: vi.fn(),
    purchasePremiumPlan: vi.fn(),
    restorePremiumPurchases: vi.fn(),
    showManageSubscriptionsInStore: vi.fn(),
    resolvePremiumSectionState: vi.fn(),
    isEntitledSubscription: vi.fn(),
  },
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

// The commerce preference is a network boundary. Owning it here keeps the
// locale tests deterministic and lets the opt-out tests drive both round trips.
vi.mock('@/src/lib/commerce', () => ({
  getCommercePreferenceFromMobile: getCommercePreferenceMock,
  updateCommercePreferenceFromMobile: updateCommercePreferenceMock,
  // The real premium lib (loaded via vi.importActual for its pure exports)
  // imports this from './commerce'; the mocked module has to keep the name.
  withRequestTimeout: vi.fn(),
}))

// Story 5.2: the premium boundary is owned the same way. The factory has to be
// static (browser-mode mocking cannot resolve importOriginal factories); the
// resolver and entitlement predicate get their REAL implementations wired in
// beforeAll/beforeEach via vi.importActual, so the section still renders from
// actual render-state logic. The dedicated premium suite
// (`settings-premium-section.test.tsx`) drives the purchase flows; here the
// section only has to render deterministically.
vi.mock('@/src/lib/premium', () => ({
  getSubscriptionFromMobile: getSubscriptionMock,
  ensurePurchasesConfigured: ensurePurchasesConfiguredMock,
  ...premiumPassthroughMocks,
}))

import i18n, { initI18n } from '../lib/i18n'
import { mockSubscriptionNone } from '../test-utils/msw/handlers'
import { getSavedSettings } from '../lib/settings-storage'
import { setMobileAnalyticsDiagnosticsEnabled } from '../analytics/mobile-analytics-diagnostics'
import SettingsScreen, { API_HEALTH_TIMEOUT_MS } from '../../app/(tabs)/settings'

/** jsdom reports integer scroll/client widths; see the overflow assertion. */
const SUBPIXEL_ROUNDING_SLACK_PX = 2

const SETTINGS_STORAGE_KEY = 'couture-cast-settings.json'

describe('SettingsScreen', () => {
  let actualPremium: typeof PremiumModule

  beforeAll(async () => {
    await initI18n()
    actualPremium = await vi.importActual<typeof PremiumModule>('@/src/lib/premium')
  })

  beforeEach(async () => {
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
    updateCommercePreferenceMock.mockImplementation((affiliateCtasEnabled: boolean) =>
      Promise.resolve({ affiliateCtasEnabled })
    )
    getSubscriptionMock.mockReset()
    getSubscriptionMock.mockResolvedValue(mockSubscriptionNone.data)
    ensurePurchasesConfiguredMock.mockReset()
    ensurePurchasesConfiguredMock.mockResolvedValue('ready')
    // Re-wired every test: restoreMocks strips implementations between tests.
    premiumPassthroughMocks.resolvePremiumSectionState.mockImplementation(
      actualPremium.resolvePremiumSectionState
    )
    premiumPassthroughMocks.isEntitledSubscription.mockImplementation(
      actualPremium.isEntitledSubscription
    )
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
    setMobileAnalyticsDiagnosticsEnabled(false)
  })

  it('renders API health loaded from the generated client', async () => {
    loadMobileApiHealthMock.mockResolvedValue({
      status: 'ok',
    })

    await render(<SettingsScreen />)

    await screen.findByText('API health: ok')
  })

  it('falls back to unavailable when the API health request never resolves', async () => {
    vi.useFakeTimers()
    loadMobileApiHealthMock.mockImplementation(() => new Promise(() => undefined))

    await render(<SettingsScreen />)

    await act(async () => {
      // The screen's own bound, imported rather than mirrored: a change there
      // must not leave this test silently advancing past a different timeout.
      await vi.advanceTimersByTimeAsync(API_HEALTH_TIMEOUT_MS)
    })

    expect(screen.getByText('API health unavailable')).toBeTruthy()
  })

  it('persists, profiles, tracks, and renders a selected locale', async () => {
    await render(<SettingsScreen />)

    fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))

    await screen.findByText('Dil')
    await waitFor(() => {
      expect(updatePreferredLocaleMock).toHaveBeenCalledWith('tr-TR')
    })
    expect(await getSavedSettings()).toEqual({
      locale: 'tr-TR',
      localeSyncPending: false,
    })
    expect(analyticsCaptureMock).toHaveBeenCalledWith(
      'locale_switched',
      expect.objectContaining({
        user_id: 'test-user-id',
        from_locale: 'en-US',
        to_locale: 'tr-TR',
      })
    )
  })

  it('surfaces persistence failures without syncing an unpersisted locale', async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('storage unavailable')
      })

    try {
      await render(<SettingsScreen />)

      fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))

      await screen.findByText('Unable to change language. Please try again.')
      expect(updatePreferredLocaleMock).not.toHaveBeenCalled()
      expect(i18n.resolvedLanguage).toBe('en-US')
    } finally {
      setItemSpy.mockRestore()
    }
  })

  it('retries a locale sync that was left pending by an earlier session', async () => {
    // A locale change that could not reach the profile API is stored with
    // localeSyncPending so the next launch finishes it; without this the
    // user's profile silently keeps the old language forever.
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ locale: 'tr-TR', localeSyncPending: true })
    )

    await render(<SettingsScreen />)

    await waitFor(() => {
      expect(updatePreferredLocaleMock).toHaveBeenCalledWith('tr-TR')
    })
    expect(await getSavedSettings()).toEqual({
      locale: 'tr-TR',
      localeSyncPending: false,
    })
  })

  it('keeps the pending flag and explains the delay when the startup retry fails', async () => {
    updatePreferredLocaleMock.mockRejectedValue(new Error('profile service down'))
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ locale: 'tr-TR', localeSyncPending: true })
    )

    await render(<SettingsScreen />)

    await screen.findByText(
      'Language changed on this device. Profile sync will retry later.'
    )
    // Still pending, so a later launch tries again rather than dropping it.
    expect(await getSavedSettings()).toEqual({
      locale: 'tr-TR',
      localeSyncPending: true,
    })
  })

  it('applies a language change locally even when the profile sync is rejected', async () => {
    updatePreferredLocaleMock.mockRejectedValue(new Error('profile service down'))

    await render(<SettingsScreen />)

    fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))

    await screen.findByText('Dil')
    await waitFor(async () => {
      // The language is applied and the sync stays queued; asserting on the
      // stored state keeps this independent of the now-Turkish alert copy.
      expect(await getSavedSettings()).toEqual({
        locale: 'tr-TR',
        localeSyncPending: true,
      })
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(i18n.resolvedLanguage).toBe('tr-TR')
  })

  it('falls back to unavailable when the API health request is rejected', async () => {
    loadMobileApiHealthMock.mockRejectedValue(new Error('health endpoint down'))

    await render(<SettingsScreen />)

    await screen.findByText('API health unavailable')
  })

  it('records a weather alert from the diagnostics action when diagnostics are on', async () => {
    // The diagnostics button is the only in-app way to prove the
    // alert_received analytics contract without a real push notification.
    setMobileAnalyticsDiagnosticsEnabled(true)

    await render(<SettingsScreen />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Record weather alert analytics' })
    )

    expect(analyticsCaptureMock).toHaveBeenCalledWith(
      'alert_received',
      expect.objectContaining({
        user_id: 'test-user-id',
        alert_type: 'weather_alert',
      })
    )
  })

  it('attributes analytics to an anonymous id when the session has no distinct id', async () => {
    // A first-run device has no analytics identity yet; events still have to
    // carry a stable user_id or they cannot be funnelled at all.
    analyticsDistinctIdMock.mockReturnValue('')
    setMobileAnalyticsDiagnosticsEnabled(true)

    await render(<SettingsScreen />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Record weather alert analytics' })
    )
    expect(analyticsCaptureMock).toHaveBeenCalledWith(
      'alert_received',
      expect.objectContaining({ user_id: 'mobile-anonymous-user' })
    )

    fireEvent.click(screen.getByTestId('locale-btn-tr-TR'))
    await waitFor(() => {
      expect(analyticsCaptureMock).toHaveBeenCalledWith(
        'locale_switched',
        expect.objectContaining({ user_id: 'mobile-anonymous-user' })
      )
    })
  })

  it('5.1-MOB-SET-01 discloses the integration above the toggle and reflects the stored value', async () => {
    await render(<SettingsScreen />)

    const section = await screen.findByTestId('commerce-settings-section')
    expect(screen.getByText('Shopping and partners')).toBeTruthy()
    expect(screen.getByTestId('commerce-settings-disclosure').textContent).toContain(
      'CoutureCast may earn a commission'
    )

    // PRD NFR Security 4 asks for disclosure *and* a toggle, so the paragraph
    // has to precede the control rather than sit behind it.
    const order = Array.from(section.querySelectorAll('[data-testid]')).map(
      (node: Element) => node.getAttribute('data-testid')
    )
    expect(order.indexOf('commerce-settings-disclosure')).toBeLessThan(
      order.indexOf('commerce-opt-out-toggle')
    )

    await waitFor(() => {
      expect(screen.getByTestId('commerce-opt-out-toggle')).toHaveAttribute(
        'aria-checked',
        'true'
      )
    })
  })

  it('5.1-MOB-SET-02 turns the affiliate suggestions off and confirms the round trip', async () => {
    await render(<SettingsScreen />)

    const toggle = await screen.findByTestId('commerce-opt-out-toggle')
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(updateCommercePreferenceMock).toHaveBeenCalledWith(false)
    })
    await screen.findByText('Shopping preferences updated')
    expect(screen.getByTestId('commerce-opt-out-toggle')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('5.1-MOB-SET-03 turns them back on again', async () => {
    getCommercePreferenceMock.mockResolvedValue({ affiliateCtasEnabled: false })

    await render(<SettingsScreen />)

    const toggle = await screen.findByTestId('commerce-opt-out-toggle')
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false')
    })

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(updateCommercePreferenceMock).toHaveBeenCalledWith(true)
    })
    expect(screen.getByTestId('commerce-opt-out-toggle')).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('5.1-MOB-SET-04 reverts the optimistic switch and alerts when the write fails', async () => {
    updateCommercePreferenceMock.mockRejectedValue(new Error('preferences unavailable'))

    await render(<SettingsScreen />)
    const toggle = await screen.findByTestId('commerce-opt-out-toggle')
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })

    fireEvent.click(toggle)

    const alert = await screen.findByTestId('commerce-settings-error')
    expect(alert.textContent).toBe('Unable to update shopping preferences.')
    expect(alert).toHaveAttribute('role', 'alert')
    // Leaving the switch in the position the user chose would claim a
    // preference the server never stored.
    expect(screen.getByTestId('commerce-opt-out-toggle')).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('5.1-MOB-SET-05 keeps the toggle inert while the stored value is unknown', async () => {
    getCommercePreferenceMock.mockRejectedValue(new Error('preferences unavailable'))

    await render(<SettingsScreen />)

    await screen.findByTestId('commerce-settings-error')
    const toggle = screen.getByTestId('commerce-opt-out-toggle')
    // A failed read is not an opt-out. Rendering the switch as "off" would show
    // the user a preference they never set.
    expect(toggle).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(toggle)
    expect(updateCommercePreferenceMock).not.toHaveBeenCalled()
  })

  it('5.1-MOB-SET-06 gives the toggle a touch target of at least 44 by 44 pixels', async () => {
    await render(<SettingsScreen />)

    const toggle = await screen.findByTestId('commerce-opt-out-toggle')
    const style = window.getComputedStyle(toggle)
    expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(44)
  })

  it('does not cause layout overflow or text truncation in any locale', async () => {
    loadMobileApiHealthMock.mockResolvedValue({ status: 'ok' })

    const expectedLocales = [
      'en-US',
      'en-CA',
      'es-419',
      'fr-CA',
      'fr-FR',
      'tr-TR',
      'de-DE',
      'it-IT',
      'pt-BR',
      'pt-PT',
    ]

    for (const locale of expectedLocales) {
      await act(async () => {
        await i18n.changeLanguage(locale)
      })

      const { container, unmount } = await render(<SettingsScreen />)

      // The commerce section carries the longest string on this screen, a
      // multi-sentence disclosure, so it is named explicitly: without this the
      // loop would still pass if the section vanished from a locale entirely.
      const disclosure = await screen.findByTestId('commerce-settings-disclosure')
      expect(
        disclosure.textContent?.trim().length,
        `${locale} disclosure`
      ).toBeGreaterThan(0)

      // Story 5.2: the premium section carries the other multi-sentence
      // disclosure plus the subscribe controls; named for the same reason —
      // the loop must not pass because the section vanished from a locale.
      const premiumDisclosure = await screen.findByTestId('premium-settings-disclosure')
      expect(
        premiumDisclosure.textContent?.trim().length,
        `${locale} premium disclosure`
      ).toBeGreaterThan(0)
      const subscribeControl = await screen.findByTestId('premium-subscribe-monthly')
      expect(
        subscribeControl.textContent?.trim().length,
        `${locale} premium plan label`
      ).toBeGreaterThan(0)

      const allElements = container.querySelectorAll('*')
      allElements.forEach((el: Element) => {
        if (el.children.length === 0 && el.textContent && el.textContent.trim()) {
          const scrollWidth = el.scrollWidth
          const clientWidth = el.clientWidth
          // 2px of slack for sub-pixel rounding: jsdom reports integer
          // scroll/client widths, so a fractional layout can round one up and
          // the other down without any real overflow.
          expect(scrollWidth).toBeLessThanOrEqual(
            clientWidth + SUBPIXEL_ROUNDING_SLACK_PX
          )
        }
      })

      unmount()
    }
  })
})
