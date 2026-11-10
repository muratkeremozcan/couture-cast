// Story 6.14 TEA, slice 11: the complimentary states of the mobile settings Premium section.
//
// Same boundary as settings-premium-section.test.tsx: the premium network and SDK seams are
// mocked, the render-state resolver and entitlement predicate stay real, and copy comes from
// the real locale catalog. Scenario ids are the plan's (`cc614-complimentary-access-test-design.md`).
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccess } from '@couture/api-client/contracts/http'
import type * as PremiumModule from '../lib/premium'

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
  getPremiumAccessMock,
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
  getPremiumAccessMock: vi.fn(),
  ensurePurchasesConfiguredMock: vi.fn(),
  refreshSubscriptionMock: vi.fn(),
  pollSubscriptionMock: vi.fn(),
  purchasePremiumPlanMock: vi.fn(),
  restorePremiumPurchasesMock: vi.fn(),
  showManageSubscriptionsMock: vi.fn(),
  resolvePremiumSectionStateMock: vi.fn(),
  isEntitledSubscriptionMock: vi.fn(),
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
  getUserProfileFromMobile: vi.fn(),
}))

vi.mock('@/src/lib/commerce', () => ({
  getCommercePreferenceFromMobile: getCommercePreferenceMock,
  updateCommercePreferenceFromMobile: updateCommercePreferenceMock,
  withRequestTimeout: vi.fn(),
}))

vi.mock('@/src/lib/mobile-auth', () => ({
  resolveMobileAccessToken: () => Promise.resolve('member-token'),
  subscribeMobileApplicationUser: () => () => undefined,
  mobileApplicationUserId: () => null,
  setMobileApplicationUserId: () => undefined,
  setMobileAccessTokenResolver: () => undefined,
}))

vi.mock('@/src/lib/premium', () => ({
  getSubscriptionFromMobile: getSubscriptionMock,
  getPremiumAccessFromMobile: getPremiumAccessMock,
  ensurePurchasesConfigured: ensurePurchasesConfiguredMock,
  refreshSubscriptionFromMobile: refreshSubscriptionMock,
  pollSubscriptionUntilEntitled: pollSubscriptionMock,
  purchasePremiumPlan: purchasePremiumPlanMock,
  restorePremiumPurchases: restorePremiumPurchasesMock,
  showManageSubscriptionsInStore: showManageSubscriptionsMock,
  resolvePremiumSectionState: resolvePremiumSectionStateMock,
  isEntitledSubscription: isEntitledSubscriptionMock,
  // Plain function, not vi.fn: restoreMocks would strip a mock implementation per test.
  isComplimentaryAccess: (access: PremiumAccess | null) =>
    access !== null && access.source === 'complimentary',
}))

import i18n, { initI18n } from '../lib/i18n'
import enUS from '../../assets/locales/en-US.json'
import { mockSubscriptionActive, mockSubscriptionNone } from '../test-utils/msw/handlers'
import SettingsScreen from '../../app/(tabs)/settings'

const premiumCopy = (
  enUS as unknown as {
    commerce: { premium: { status: Record<string, string>; complimentaryNote: string } }
  }
).commerce.premium
const COMPLIMENTARY_STATUS = premiumCopy.status.complimentary!
const COMPLIMENTARY_NOTE = premiumCopy.complimentaryNote

const COMPLIMENTARY: PremiumAccess = { premium: true, source: 'complimentary' }
const PURCHASE_CONTROLS = [
  'premium-subscribe-monthly',
  'premium-subscribe-annual',
  'premium-restore',
] as const

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('SettingsScreen premium section, complimentary access', () => {
  let actualPremium: typeof PremiumModule

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
    actualPremium = await vi.importActual<typeof PremiumModule>('@/src/lib/premium')
  })

  beforeEach(() => {
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
    getPremiumAccessMock.mockReset()
    getPremiumAccessMock.mockResolvedValue(COMPLIMENTARY)
    ensurePurchasesConfiguredMock.mockReset()
    ensurePurchasesConfiguredMock.mockResolvedValue('ready')
    refreshSubscriptionMock.mockReset()
    pollSubscriptionMock.mockReset()
    purchasePremiumPlanMock.mockReset()
    restorePremiumPurchasesMock.mockReset()
    showManageSubscriptionsMock.mockReset()
    showManageSubscriptionsMock.mockResolvedValue(true)
  })

  it('M-COMPLIMENTARY: an unpaid complimentary member sees the complimentary status and no purchase or manage control', async () => {
    await render(<SettingsScreen />)

    await waitFor(() =>
      expect(screen.getByTestId('premium-status-line').textContent).toBe(
        COMPLIMENTARY_STATUS
      )
    )
    for (const id of [
      ...PURCHASE_CONTROLS,
      'premium-manage',
      'premium-complimentary-note',
    ])
      expect({ id, present: screen.queryByTestId(id) !== null }).toEqual({
        id,
        present: false,
      })
  })

  it('M-DISCLOSURE-HIDDEN: an unpaid complimentary member never sees the billing disclosure, not even while the access read is pending', async () => {
    const access = deferred<PremiumAccess>()
    getPremiumAccessMock.mockReturnValue(access.promise)
    let flashed = false
    const observer = new MutationObserver(() => {
      if (screen.queryByTestId('premium-settings-disclosure')) flashed = true
    })
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      await render(<SettingsScreen />)
      await waitFor(() =>
        expect(getSubscriptionMock.mock.settledResults[0]?.type).toBe('fulfilled')
      )
      expect(screen.queryByTestId('premium-settings-disclosure')).toBeNull()
      access.resolve(COMPLIMENTARY)
      await waitFor(() =>
        expect(screen.getByTestId('premium-status-line').textContent).toBe(
          COMPLIMENTARY_STATUS
        )
      )
    } finally {
      observer.disconnect()
    }
    expect(flashed).toBe(false)
    expect(screen.queryByTestId('premium-settings-disclosure')).toBeNull()
  })

  it.each([
    [
      'a paying grantee',
      () => mockSubscriptionActive.data,
      () => Promise.resolve(COMPLIMENTARY),
    ],
    [
      'a free member',
      () => mockSubscriptionNone.data,
      () => Promise.resolve({ premium: false, source: 'none' } satisfies PremiumAccess),
    ],
    [
      'a free member whose access read fails',
      () => mockSubscriptionNone.data,
      () => Promise.reject(new Error('network')),
    ],
  ])(
    'M-DISCLOSURE-SHOWN: %s still sees the billing disclosure once the reads settle',
    async (_label, subscription, answer) => {
      getSubscriptionMock.mockResolvedValue(subscription())
      getPremiumAccessMock.mockImplementation(answer)

      await render(<SettingsScreen />)

      expect((await screen.findByTestId('premium-settings-disclosure')).textContent).toBe(
        enUS.commerce.premium.disclosure
      )
    }
  )

  it('M-BOTH: a paying complimentary member sees the complimentary note and the manage control', async () => {
    getSubscriptionMock.mockResolvedValue(mockSubscriptionActive.data)

    await render(<SettingsScreen />)

    expect((await screen.findByTestId('premium-complimentary-note')).textContent).toBe(
      COMPLIMENTARY_NOTE
    )
    expect(screen.getByTestId('premium-manage')).toBeTruthy()
    for (const id of PURCHASE_CONTROLS) expect(screen.queryByTestId(id)).toBeNull()
  })

  it('M-MANAGE-TAP: a paying grantee can still open the store manage flow from the Manage button', async () => {
    getSubscriptionMock.mockResolvedValue(mockSubscriptionActive.data)

    await render(<SettingsScreen />)

    await screen.findByTestId('premium-complimentary-note')
    // Nothing configured the SDK on entry; the tap path owns that now.
    expect(ensurePurchasesConfiguredMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('premium-manage'))
    await waitFor(() => expect(showManageSubscriptionsMock).toHaveBeenCalledTimes(1))
    expect(purchasePremiumPlanMock).not.toHaveBeenCalled()
  })

  it('M-HIDE-PURCHASE: a complimentary member never configures the RevenueCat SDK (TEA-07, Boundaries: no RevenueCat call)', async () => {
    await render(<SettingsScreen />)

    await waitFor(() =>
      expect(screen.getByTestId('premium-status-line').textContent).toBe(
        COMPLIMENTARY_STATUS
      )
    )
    expect(ensurePurchasesConfiguredMock).not.toHaveBeenCalled()
    expect(purchasePremiumPlanMock).not.toHaveBeenCalled()
  })

  it('M-NO-FLASH: while the access read is pending, no purchase control renders for a member it will show as complimentary', async () => {
    const access = deferred<PremiumAccess>()
    getPremiumAccessMock.mockReturnValue(access.promise)

    // Record every purchase control that ever appears, so a flash between two renders
    // is caught without timing the check to land inside it.
    const flashed = new Set<string>()
    const record = () => {
      for (const id of PURCHASE_CONTROLS) if (screen.queryByTestId(id)) flashed.add(id)
    }
    const observer = new MutationObserver(record)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })

    try {
      await render(<SettingsScreen />)
      // The subscription read has settled; only the access read is pending. The member
      // cannot be known as complimentary yet, so the SDK must not be configured either.
      await waitFor(() => expect(getSubscriptionMock).toHaveBeenCalled())
      await getSubscriptionMock.mock.results[0]!.value
      await waitFor(() =>
        expect(getSubscriptionMock.mock.settledResults[0]?.type).toBe('fulfilled')
      )
      record()
      expect(ensurePurchasesConfiguredMock).not.toHaveBeenCalled()

      access.resolve(COMPLIMENTARY)
      await waitFor(() =>
        expect(screen.getByTestId('premium-status-line').textContent).toBe(
          COMPLIMENTARY_STATUS
        )
      )
      record()
    } finally {
      observer.disconnect()
    }
    expect([...flashed]).toEqual([])
    expect(ensurePurchasesConfiguredMock).not.toHaveBeenCalled()
  })

  it.each([
    ['rejected', () => Promise.reject(new Error('network'))],
    [
      'none',
      () => Promise.resolve({ premium: false, source: 'none' } satisfies PremiumAccess),
    ],
  ])(
    'M-ACCESS-FAIL (%s): the section renders as it does without a grant, with no complimentary text',
    async (_label, answer) => {
      getPremiumAccessMock.mockImplementation(answer)

      await render(<SettingsScreen />)

      const statusLine = await screen.findByTestId('premium-status-line')
      await waitFor(() =>
        expect(screen.getByTestId('premium-subscribe-monthly')).toBeTruthy()
      )
      expect(statusLine.textContent).toBe('You don’t have a Premium subscription.')
      expect(screen.getByTestId('premium-subscribe-annual')).toBeTruthy()
      expect(screen.getByTestId('premium-restore')).toBeTruthy()
      expect(screen.queryByTestId('premium-complimentary-note')).toBeNull()
      const section = screen.getByTestId('premium-settings-section').textContent ?? ''
      expect(section).not.toContain(COMPLIMENTARY_STATUS)
      expect(section).not.toContain(COMPLIMENTARY_NOTE)
    }
  )
})
