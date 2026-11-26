// Learning path Step 15: Validate, generate, and consume the canonical contract.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-15-validate-generate-and-consume-the-canonical-contract
// Learning path Step 22: Localization infrastructure and quality gates.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-22-localization-infrastructure-and-quality-gates
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Step 22 step 7 owner: verify Settings screen layout boundaries in headless Chromium in apps/mobile/src/screens/tab-two-screen.test.tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { TAB_BODY_INSET } from '@/src/theme/tokens'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as PremiumModule from '../lib/premium'

/*
 * Story 5.4: `settings.tsx` gained an `expo-router` import for the palette advisor
 * link row. `expo-router` transitively pulls in `expo-asset`, which cannot be
 * evaluated in this browser test bundle ("Cannot read properties of undefined
 * (reading 'EventEmitter')"), so every suite that renders the settings screen has to
 * stub it. Navigation itself is not what these suites are about; the row's own
 * behaviour is covered by `palette-advisor-screen.test.tsx` and the Maestro flow.
 */
vi.mock('expo-router', async () => ({
  router: { push: vi.fn() },
  // Story CC-7.7 D5: Profile re-reads its sections when the tab regains focus.
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))

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
  resolveMobileAccessTokenMock,
  getUserProfileMock,
  identityEpochMock,
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
  resolveMobileAccessTokenMock: vi.fn(),
  getUserProfileMock: vi.fn(),
  identityEpochMock: vi.fn<() => number>(),
}))

// The member's session is a boundary too: shopping preferences and the subscription
// belong to a signed-in member, so the screen only reads them with an access token.
vi.mock('@/src/lib/mobile-auth', () => ({
  resolveMobileAccessToken: resolveMobileAccessTokenMock,
  subscribeMobileApplicationUser: () => () => undefined,
  mobileApplicationUserId: () => null,
  // Advances on a sign-out or account switch; a case moves it to change hands mid-read.
  mobileIdentityEpoch: identityEpochMock,
  setMobileApplicationUserId: vi.fn(),
  setMobileAccessTokenResolver: vi.fn(),
}))

vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock({
    capture: analyticsCaptureMock,
    getDistinctId: analyticsDistinctIdMock,
  })
)

vi.mock('@/src/lib/api-health', () => ({
  loadMobileApiHealth: loadMobileApiHealthMock,
}))

vi.mock('@/src/lib/user', () => ({
  updatePreferredLocaleFromMobile: updatePreferredLocaleMock,
  // The real premium lib (loaded via vi.importActual for its pure exports)
  // imports this from './user'; the mocked module has to keep the name. The
  // Profile header reads it too.
  getUserProfileFromMobile: getUserProfileMock,
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
  // Story 6.14: the access source; these suites cover members with no grant.
  getPremiumAccessFromMobile: () => Promise.resolve({ premium: false, source: 'none' }),
  isComplimentaryAccess: () => false,
  ensurePurchasesConfigured: ensurePurchasesConfiguredMock,
  ...premiumPassthroughMocks,
}))

import i18n, { initI18n } from '../lib/i18n'
import { mockSubscriptionNone } from '../test-utils/msw/handlers'
import { getSavedSettings } from '../lib/settings-storage'
import { setMobileAnalyticsDiagnosticsEnabled } from '../analytics/mobile-analytics-diagnostics'
import { router } from 'expo-router'
import SettingsScreen, { API_HEALTH_TIMEOUT_MS } from '../../app/(tabs)/settings'
import { screenFocus } from '../test-utils/focus-effect'

const SUBPIXEL_ROUNDING_SLACK_PX = 2

function memberProfile(displayName: string | null) {
  return {
    user: {
      id: 'member-1',
      email: 'jade@example.test',
      displayName,
      birthdate: null,
      role: 'guardian',
    },
    linkedGuardians: [],
    linkedTeens: [],
  }
}

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
    resolveMobileAccessTokenMock.mockReset()
    resolveMobileAccessTokenMock.mockResolvedValue('member-token')
    getUserProfileMock.mockReset()
    getUserProfileMock.mockResolvedValue(memberProfile(null))
    identityEpochMock.mockReset()
    identityEpochMock.mockReturnValue(0)
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
    screenFocus.reset()
  })

  /** A promise the test answers by hand, so one read can be held while the others settle. */
  function held<T>() {
    let release!: (value: T) => void
    const promise = new Promise<T>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }

  const placeholder = () => screen.queryByTestId('screen-placeholder')

  it('7.7-NAT-004 the Profile gate waits for the account header read, the first section', async () => {
    const profile = held<ReturnType<typeof memberProfile>>()
    getUserProfileMock.mockReturnValue(profile.promise)
    await render(<SettingsScreen />)

    // Every other gate read answered: the preference, the subscription, the store.
    expect(await screen.findByTestId('commerce-opt-out-toggle')).not.toBeVisible()
    expect(await screen.findByTestId('premium-restore')).not.toBeVisible()
    expect(placeholder()).toBeVisible()
    expect(screen.queryByTestId('profile-account')).toBeNull()

    act(() => profile.release(memberProfile('Jade')))

    // The header arrives with the body, so it never pushes the sections below it down. The
    // name mounts with the read's answer; the gate opens on the settle that follows it.
    const name = await screen.findByTestId('profile-account-name')
    await waitFor(() => expect(name).toBeVisible())
    expect(screen.getByTestId('commerce-opt-out-toggle')).toBeVisible()
    expect(placeholder()).toBeNull()
  })

  it('7.9-NAT-INSET-001 insets the Profile body once, 16 from each edge like every tab body', async () => {
    getUserProfileMock.mockResolvedValue(memberProfile('Jade'))
    await render(<SettingsScreen />)
    const body = await screen.findByTestId('settings-screen')
    await waitFor(() =>
      expect(screen.getByTestId('commerce-settings-section')).toBeVisible()
    )

    // CC-7.9 small-phone capture: 16 in the container plus a centered 90% section put the
    // body about 33 from the edge. Every tab body now shares TAB_BODY_INSET (web's px-4).
    expect(TAB_BODY_INSET).toBe(16)
    const style = getComputedStyle(body)
    expect(style.paddingLeft).toBe('16px')
    expect(style.paddingRight).toBe('16px')
    const frame = body.getBoundingClientRect()
    const section = screen
      .getByTestId('commerce-settings-section')
      .getBoundingClientRect()
    expect(section.left - frame.left).toBeCloseTo(16, 0)
    expect(frame.right - section.right).toBeCloseTo(16, 0)
  })

  it('7.7-NAT-004 the Profile gate waits for the store to answer whether purchases are available', async () => {
    const store = held<'ready'>()
    ensurePurchasesConfiguredMock.mockReturnValue(store.promise)
    await render(<SettingsScreen />)

    // Every other gate read answered: the header, the preference, the subscription access.
    expect(await screen.findByTestId('profile-account')).not.toBeVisible()
    expect(await screen.findByTestId('commerce-opt-out-toggle')).not.toBeVisible()
    await waitFor(() => expect(ensurePurchasesConfiguredMock).toHaveBeenCalled())
    expect(screen.getByTestId('premium-settings-section')).not.toBeVisible()
    expect(screen.queryByTestId('premium-restore')).toBeNull()
    expect(placeholder()).toBeVisible()

    act(() => store.release('ready'))

    // The subscribe controls appear with the section, never under the member's finger.
    const restore = await screen.findByTestId('premium-restore')
    await waitFor(() => expect(restore).toBeVisible())
    expect(placeholder()).toBeNull()
  })

  it('7.7-NAT-003 a return to Profile re-reads its sections in place', async () => {
    await render(<SettingsScreen />)
    const email = await screen.findByTestId('profile-account-email')
    await waitFor(() => expect(email).toBeVisible())
    expect(getUserProfileMock).toHaveBeenCalledTimes(1)
    expect(getCommercePreferenceMock).toHaveBeenCalledTimes(1)
    expect(getSubscriptionMock).toHaveBeenCalledTimes(1)

    const profile = held<ReturnType<typeof memberProfile>>()
    getUserProfileMock.mockReturnValue(profile.promise)
    // Leaving reads nothing: only the return does.
    act(() => screenFocus.set(false))
    expect(getUserProfileMock).toHaveBeenCalledTimes(1)
    act(() => screenFocus.set(true))

    await waitFor(() => expect(getUserProfileMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(getCommercePreferenceMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(getSubscriptionMock).toHaveBeenCalledTimes(2))
    // The header and the sections stay while the reads run: no placeholder, no empty header.
    expect(placeholder()).toBeNull()
    expect(screen.getByTestId('profile-account-email')).toBe(email)
    expect(email).toBeVisible()
    expect(screen.getByTestId('commerce-opt-out-toggle')).toBeVisible()

    act(() => profile.release(memberProfile('Jade')))
    expect(await screen.findByTestId('profile-account-name')).toHaveTextContent('Jade')
    expect(placeholder()).toBeNull()
  })

  /** Leaves Profile and comes back: the return re-reads every section in place. */
  function leaveAndReturn() {
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
  }

  // CodeRabbit r1: a return read that began before a toggle answers with the value the toggle
  // replaced. The saved choice stays.
  it('7.7-NAT-013 a return read that started before a toggle never lands over the saved choice', async () => {
    await render(<SettingsScreen />)
    const toggle = await screen.findByTestId('commerce-opt-out-toggle')
    await waitFor(() => {
      expect(toggle).toBeVisible()
      expect(toggle).toHaveAttribute('aria-checked', 'true')
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    })
    const stale = held<{ affiliateCtasEnabled: boolean }>()
    getCommercePreferenceMock.mockReturnValue(stale.promise)
    leaveAndReturn()
    await waitFor(() => expect(getCommercePreferenceMock).toHaveBeenCalledTimes(2))

    // react-native-web hands the enabled state to its press responder in a passive effect.
    await act(() => Promise.resolve())
    fireEvent.click(screen.getByTestId('commerce-opt-out-toggle'))
    await screen.findByText('Shopping preferences updated')
    expect(updateCommercePreferenceMock).toHaveBeenCalledWith(false)

    // The read from before the toggle answers with the old value.
    await act(async () => {
      stale.release({ affiliateCtasEnabled: true })
      // A task boundary: every promise step of the read's chain runs before it.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByTestId('commerce-opt-out-toggle')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  // CodeRabbit r1: a return read belongs to the member it started for. One that answers after
  // the device changed hands restores nothing of theirs.
  it('7.7-NAT-015 return reads that answer after the member changed leave the screen as it is', async () => {
    await render(<SettingsScreen />)
    const email = await screen.findByTestId('profile-account-email')
    const toggle = screen.getByTestId('commerce-opt-out-toggle')
    await waitFor(() => {
      expect(email).toBeVisible()
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })
    const profile = held<ReturnType<typeof memberProfile>>()
    getUserProfileMock.mockReturnValue(profile.promise)
    const preference = held<{ affiliateCtasEnabled: boolean }>()
    getCommercePreferenceMock.mockReturnValue(preference.promise)
    leaveAndReturn()
    await waitFor(() => {
      expect(getUserProfileMock).toHaveBeenCalledTimes(2)
      expect(getCommercePreferenceMock).toHaveBeenCalledTimes(2)
    })

    // Another identity takes the device while both reads are in flight.
    identityEpochMock.mockReturnValue(1)
    const previous = memberProfile('Previous member')
    await act(async () => {
      profile.release({
        ...previous,
        user: { ...previous.user, email: 'previous@example.test' },
      })
      preference.release({ affiliateCtasEnabled: false })
      // A task boundary: every promise step of both reads' chains runs before it.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.queryByTestId('profile-account-name')).toBeNull()
    expect(screen.getByTestId('profile-account-email')).toHaveTextContent(
      'jade@example.test'
    )
    expect(screen.getByTestId('commerce-opt-out-toggle')).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('6.5-MOB-POLISH-07 keeps API health and wiring notes out of the user build', async () => {
    // Diagnostics stay off unless EXPO_PUBLIC_MOBILE_ANALYTICS_DIAGNOSTICS=1, so users
    // never see developer status lines and the screen never polls the health route.
    await render(<SettingsScreen />)

    await screen.findByTestId('locale-btn-tr-TR')
    expect(screen.queryByText(/API health/)).toBeNull()
    expect(screen.queryByText(/alert_received/)).toBeNull()
    expect(loadMobileApiHealthMock).not.toHaveBeenCalled()
  })

  it('1.2b-MOB-SETTINGS-01 opens Locations from its Settings row', async () => {
    // Switching primary takes two taps from Settings: this row, then Make primary.
    await render(<SettingsScreen />)

    await userEvent.click(await screen.findByRole('link', { name: 'Locations' }))

    expect(vi.mocked(router.push)).toHaveBeenCalledWith('/locations')
  })

  it('renders API health loaded from the generated client', async () => {
    setMobileAnalyticsDiagnosticsEnabled(true)
    loadMobileApiHealthMock.mockResolvedValue({
      status: 'ok',
    })

    await render(<SettingsScreen />)

    await screen.findByText('API health: ok')
  })

  it('falls back to unavailable when the API health request never resolves', async () => {
    vi.useFakeTimers()
    setMobileAnalyticsDiagnosticsEnabled(true)
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
    setMobileAnalyticsDiagnosticsEnabled(true)
    loadMobileApiHealthMock.mockRejectedValue(new Error('health endpoint down'))

    await render(<SettingsScreen />)

    await screen.findByText('API health unavailable')
  })

  it('records a weather alert from the diagnostics action when diagnostics are on', async () => {
    // The diagnostics button is the only in-app way to prove the
    // alert_received analytics contract without a real push notification.
    setMobileAnalyticsDiagnosticsEnabled(true)

    await render(<SettingsScreen />)

    // Story CC-7.7: the Profile body shows once its gate reads settle.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record weather alert analytics' })
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

    // Story CC-7.7: the Profile body shows once its gate reads settle.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record weather alert analytics' })
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
      // Usable, not just rendered: an unknown stored value also reads aria-checked false.
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    })
    // react-native-web hands the enabled state to its press responder in a passive
    // effect after render; flush it so the click is not judged against the old config.
    await act(() => Promise.resolve())

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
      // Usable, not just rendered: an unknown stored value also reads aria-checked false.
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    })
    // react-native-web hands the enabled state to its press responder in a passive
    // effect after render; flush it so the click is not judged against the old config.
    await act(() => Promise.resolve())

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
      // Usable, not just rendered: an unknown stored value also reads aria-checked false.
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    })
    // react-native-web hands the enabled state to its press responder in a passive
    // effect after render; flush it so the click is not judged against the old config.
    await act(() => Promise.resolve())

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

    const alert = await screen.findByTestId('commerce-settings-error')
    // The load string, not the save string. This path reused
    // `commerce.settings.error` ("Unable to update shopping preferences."),
    // which names an action the user never took on a screen that had only just
    // opened.
    expect(alert.textContent).toBe('Unable to load shopping preferences.')
    const toggle = screen.getByTestId('commerce-opt-out-toggle')
    // A failed read is not an opt-out. Rendering the switch as "off" would show
    // the user a preference they never set.
    expect(toggle).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(toggle)
    expect(updateCommercePreferenceMock).not.toHaveBeenCalled()
  })

  it('6.5-MOB-POLISH-03 shows a signed-out device no load errors for member data it cannot have', async () => {
    resolveMobileAccessTokenMock.mockResolvedValue(undefined)
    // What the API answers without a bearer, so a read here would surface as an error.
    getCommercePreferenceMock.mockRejectedValue(new Error('401'))
    getSubscriptionMock.mockRejectedValue(new Error('401'))

    await render(<SettingsScreen />)

    expect(await screen.findByTestId('commerce-settings-signed-out')).toBeInTheDocument()
    expect(await screen.findByTestId('premium-signed-out')).toBeInTheDocument()
    expect(screen.queryByTestId('commerce-settings-error')).toBeNull()
    expect(screen.queryByTestId('premium-load-error')).toBeNull()
    expect(screen.queryByTestId('commerce-opt-out-toggle')).toBeNull()
    expect(getCommercePreferenceMock).not.toHaveBeenCalled()
    expect(getSubscriptionMock).not.toHaveBeenCalled()
  })

  /*
   * Production follow-up (2026-11-19): Jade could not find a profile. The tab reads Profile and
   * opens on whose account it is, above everything Settings already held.
   */
  it('PROFILE-MOB-01 opens on the member display name and email, above the language section', async () => {
    getUserProfileMock.mockResolvedValue(memberProfile('Jade'))

    await render(<SettingsScreen />)

    const header = await screen.findByTestId('profile-account')
    expect(screen.getByTestId('profile-account-name').textContent).toBe('Jade')
    expect(screen.getByTestId('profile-account-email').textContent).toBe(
      'jade@example.test'
    )
    expect(header).toHaveTextContent('Account')
    expect(
      header.compareDocumentPosition(screen.getByTestId('settings-language-title')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByTestId('locations-link')).toBeInTheDocument()
    expect(screen.getByTestId('commerce-settings-section')).toBeInTheDocument()
  })

  it('PROFILE-MOB-02 shows the email alone when the member set no display name', async () => {
    getUserProfileMock.mockResolvedValue(memberProfile('   '))

    await render(<SettingsScreen />)

    expect((await screen.findByTestId('profile-account-email')).textContent).toBe(
      'jade@example.test'
    )
    expect(screen.queryByTestId('profile-account-name')).toBeNull()
  })

  it('PROFILE-MOB-03 shows no account header signed out or when the profile read fails, and the rest still renders', async () => {
    resolveMobileAccessTokenMock.mockResolvedValue(undefined)

    const signedOut = await render(<SettingsScreen />)

    await screen.findByTestId('commerce-settings-signed-out')
    expect(getUserProfileMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('profile-account')).toBeNull()
    await signedOut.unmount()

    resolveMobileAccessTokenMock.mockResolvedValue('member-token')
    getUserProfileMock.mockRejectedValue(new Error('503'))

    await render(<SettingsScreen />)

    await waitFor(() => expect(getUserProfileMock).toHaveBeenCalled())
    expect(await screen.findByTestId('commerce-opt-out-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-account')).toBeNull()
  })

  it('6.5-MOB-POLISH-11 never tells a member they are signed out when the session read fails transiently', async () => {
    // A keychain read can fail once (device locked, storage busy). That is not proof of no
    // session: the screen must not show the signed-out hints, and it loads the member's
    // data once the read succeeds.
    resolveMobileAccessTokenMock.mockRejectedValueOnce(new Error('keychain busy'))

    await render(<SettingsScreen />)

    await waitFor(
      () => {
        expect(getCommercePreferenceMock).toHaveBeenCalled()
        expect(getSubscriptionMock).toHaveBeenCalled()
      },
      { timeout: 5_000 }
    )
    expect(await screen.findByTestId('commerce-opt-out-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('commerce-settings-signed-out')).toBeNull()
    expect(screen.queryByTestId('premium-signed-out')).toBeNull()
    expect(resolveMobileAccessTokenMock.mock.calls.length).toBeGreaterThanOrEqual(2)
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
      // disclosure plus the subscribe controls; named for the same reason:
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

      await unmount()
    }
  })
})
