// Story 5.3 Task 6: the settings "Interface palettes" section.
//
// The mobile counterpart of `apps/web/src/app/components/premium-theme-section.test.tsx`,
// and the mobile half of AC 4, 6 and 7. The network boundary stays REAL here and is
// driven through MSW: the section's whole job is turning HTTP outcomes into rendered
// states, so stubbing the lib would leave the interesting half unproven. Only the
// unrelated parts of the settings screen are mocked — analytics, the health probe, and
// the 5.2 premium/RevenueCat section, whose own suite owns it.
//
// `AppThemeProvider` wraps the screen deliberately rather than being mocked. It holds the
// applied palette, so the preview card re-coloring on selection is what proves AC 4's
// instant apply end to end; a mocked context would prove only that the section calls a
// setter.
/* eslint-disable @typescript-eslint/await-thenable */
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

// The 5.2 section is mocked at its own boundary — `settings-premium-section.test.tsx`
// owns it. A static factory, because browser-mode module mocking cannot resolve
// importOriginal factories; the two pure exports get their real implementations wired in
// `beforeAll` so the neighbouring section still renders from the actual logic.
//
// `@/src/lib/commerce` is deliberately NOT mocked here: `premium-theme.ts` imports
// `withRequestTimeout` from it, and replacing that with a `vi.fn()` would silently stop
// every request this suite is meant to make.
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
import { server } from '../test-utils/msw/server'
import { mockSubscriptionNone } from '../test-utils/msw/handlers'
import { press } from '../test-utils/press'
import { setMobileAccessTokenResolver } from '../lib/mobile-auth'
import { AppThemeProvider } from '../theme/theme-context'
import SettingsScreen from '../../app/(tabs)/settings'

const THEME_ROUTE = '*/api/v1/commerce/premium/theme'

/** The `[data-theme]` values the web surface carries, as react-native-web renders them. */
const DEFAULT_CARD_BG = 'rgb(245, 245, 247)'
const JEWEL_CARD_BG = 'rgb(244, 246, 251)'

const themeResponse = (
  overrides: Partial<{
    theme: string | null
    isEntitled: boolean
    themesEnabled: boolean
  }> = {}
) => ({
  data: { theme: null, isEntitled: true, themesEnabled: true, ...overrides },
})

/** Serves the GET only; suites that press a card add their own PUT handler. */
function serveTheme(body: ReturnType<typeof themeResponse>) {
  server.use(http.get(THEME_ROUTE, () => HttpResponse.json(body)))
}

const errorEnvelope = (statusCode: number, message: string) =>
  HttpResponse.json({ statusCode, message, error: 'Error' }, { status: statusCode })

function renderSettings() {
  return render(
    <AppThemeProvider>
      <SettingsScreen />
    </AppThemeProvider>
  )
}

describe('SettingsScreen interface palettes section', () => {
  let actualPremium: typeof PremiumModule
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
    await i18n.changeLanguage('en-US')
    actualPremium = await vi.importActual<typeof PremiumModule>('@/src/lib/premium')
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    resolvePremiumSectionStateMock.mockImplementation(
      actualPremium.resolvePremiumSectionState
    )
    isEntitledSubscriptionMock.mockImplementation(actualPremium.isEntitledSubscription)
    localStorage.clear()
    analyticsCaptureMock.mockReset()
    analyticsDistinctIdMock.mockReturnValue('test-user-id')
    loadMobileApiHealthMock.mockReset()
    loadMobileApiHealthMock.mockResolvedValue({ status: 'ok' })
    getSubscriptionMock.mockReset()
    getSubscriptionMock.mockResolvedValue(mockSubscriptionNone.data)
    ensurePurchasesConfiguredMock.mockReset()
    ensurePurchasesConfiguredMock.mockResolvedValue('unavailable')
    refreshSubscriptionMock.mockReset()
    pollSubscriptionMock.mockReset()
    purchasePremiumPlanMock.mockReset()
    restorePremiumPurchasesMock.mockReset()
    showManageSubscriptionsMock.mockReset()
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  describe('the gallery', () => {
    it('renders exactly the three shipped palettes plus Default, and no future one', async () => {
      serveTheme(themeResponse())
      await renderSettings()

      const gallery = await screen.findByTestId('premium-theme-gallery')
      for (const id of ['jewel_radiance', 'autumn_umber', 'winter_metallic', 'default']) {
        expect(screen.getByTestId(`premium-theme-option-${id}`), id).toBeTruthy()
      }
      // Spring Bloom is marked future in the UX spec: it has no contract member, no
      // palette and no label, and this is the assertion that keeps it that way.
      expect(gallery.textContent).not.toContain('Spring Bloom')
      expect(gallery.textContent).toContain('Jewel Radiance')
      expect(gallery.textContent).toContain('Autumn Umber')
      expect(gallery.textContent).toContain('Winter Metallic')
    })

    it('states the selection in words, not only in color', async () => {
      serveTheme(themeResponse({ theme: 'autumn_umber' }))
      await renderSettings()

      const selected = await screen.findByTestId('premium-theme-state-autumn_umber')
      expect(selected.textContent).toBe('Selected')
      expect(screen.getByTestId('premium-theme-state-jewel_radiance').textContent).toBe(
        'Apply'
      )
      expect(
        screen
          .getByTestId('premium-theme-option-autumn_umber')
          .getAttribute('aria-pressed')
      ).toBe('true')
    })

    /**
     * AC 4. The preview is the one element that pins no palette of its own, so its
     * background is the applied palette and nothing else. Asserting on it — rather than
     * on the "Selected" label alone — is what proves the choice reached `useAppTheme()`
     * and would re-color the rest of the app, not just this card.
     */
    it('5.3-MOB-010 re-colors the live preview from the context the moment a save lands', async () => {
      serveTheme(themeResponse())
      server.use(
        http.put(THEME_ROUTE, async ({ request }) => {
          const body = (await request.json()) as { theme: string | null }
          return HttpResponse.json(themeResponse({ theme: body.theme }))
        })
      )
      await renderSettings()

      const preview = await screen.findByTestId('premium-theme-preview')
      expect(getComputedStyle(preview).backgroundColor).toBe(DEFAULT_CARD_BG)

      press(screen.getByTestId('premium-theme-option-jewel_radiance'))

      await waitFor(() => {
        expect(getComputedStyle(preview).backgroundColor).toBe(JEWEL_CARD_BG)
      })
      expect(screen.getByTestId('premium-theme-state-jewel_radiance').textContent).toBe(
        'Selected'
      )
    })

    /**
     * Re-pressing the active card would issue a full PUT and emit a second
     * `premium_theme_selected` for one real choice, inflating exactly the adoption count
     * Decision 14 exists to measure. The server answers 200 for an unchanged value by
     * design, so the client is the only place this can be suppressed.
     */
    it('does not re-save the palette that is already selected', async () => {
      serveTheme(themeResponse({ theme: 'winter_metallic' }))
      let writes = 0
      server.use(
        http.put(THEME_ROUTE, () => {
          writes += 1
          return HttpResponse.json(themeResponse({ theme: 'winter_metallic' }))
        })
      )
      await renderSettings()

      const card = await screen.findByTestId('premium-theme-option-winter_metallic')
      press(card)
      await waitFor(() => {
        expect(
          screen.getByTestId('premium-theme-state-winter_metallic').textContent
        ).toBe('Selected')
      })
      expect(writes).toBe(0)
    })
  })

  describe('the locked state', () => {
    it('renders the upsell pointing at the subscribe controls above, and no gallery', async () => {
      serveTheme(themeResponse({ isEntitled: false }))
      await renderSettings()

      const locked = await screen.findByTestId('premium-theme-locked')
      expect(locked.textContent).toContain('Premium')
      // The names arrive through `{{palettes}}`, joined by `Intl.ListFormat`, so the
      // gallery and the upsell copy share one source of truth.
      expect(locked.textContent).toContain(
        'Jewel Radiance, Autumn Umber, and Winter Metallic'
      )
      expect(locked.textContent).toContain('controls above')
      expect(screen.queryByTestId('premium-theme-gallery')).toBeNull()
    })

    /**
     * A signed-out reader has no subscribe controls above them — the 5.2 section renders
     * its own signed-out state — so pointing at "the controls above" would name a control
     * that is not on the screen. The signed-out copy names the sign-in step first.
     */
    it('names the sign-in step first when there is no session', async () => {
      server.use(http.get(THEME_ROUTE, () => errorEnvelope(401, 'Unauthorized')))
      await renderSettings()

      const locked = await screen.findByTestId('premium-theme-locked')
      expect(locked.textContent).toContain('Sign in')
      expect(screen.queryByTestId('premium-theme-gallery')).toBeNull()
      expect(screen.queryByTestId('premium-theme-error')).toBeNull()
    })
  })

  /**
   * `Intl.ListFormat` is optional under ECMA-402 and Hermes ships without it, so a raw
   * `new Intl.ListFormat(...)` in this section threw on device, took `SettingsScreen`
   * and the whole tab layout down with it, and reached CI only as a Maestro failure
   * reading "Element not found: Id matching regex: tab-settings" — a message naming
   * nothing about the actual cause.
   *
   * This suite runs in Chromium, which does ship `Intl.ListFormat`, which is exactly
   * why the crash passed component tests and had to be found on an emulator. The
   * device runtime therefore has to be simulated for the regression to be reachable
   * at this level at all.
   */
  describe('runtimes that ship no Intl.ListFormat', () => {
    const withoutListFormat = async (assertions: () => Promise<void>) => {
      const listFormat = Intl.ListFormat
      Object.defineProperty(Intl, 'ListFormat', { configurable: true, value: undefined })
      try {
        await assertions()
      } finally {
        Object.defineProperty(Intl, 'ListFormat', {
          configurable: true,
          value: listFormat,
        })
      }
    }

    it('renders the locked copy, joining the palette names with the locale fallback', async () => {
      await withoutListFormat(async () => {
        serveTheme(themeResponse({ isEntitled: false }))
        await renderSettings()

        const locked = await screen.findByTestId('premium-theme-locked')
        // Identical to what Intl.ListFormat produces for en-US, so the fallback is a
        // faithful substitute rather than a degraded one.
        expect(locked.textContent).toContain(
          'Jewel Radiance, Autumn Umber, and Winter Metallic'
        )
      })
    })

    it('renders the gallery for an entitled reader', async () => {
      await withoutListFormat(async () => {
        serveTheme(themeResponse())
        await renderSettings()

        expect(await screen.findByTestId('premium-theme-gallery')).toBeTruthy()
      })
    })
  })

  describe('degraded states (AC 6)', () => {
    /**
     * The kill switch is reachable by an entitled subscriber, and it disables every card.
     * Every other disabled control in this app carries a reason next to it, so the note
     * is that reason and the cards point at it through `aria-describedby` and
     * `accessibilityHint` — a card is never disabled without a stated cause.
     */
    it('disables the cards and states the reason when the kill switch is off', async () => {
      serveTheme(themeResponse({ themesEnabled: false }))
      await renderSettings()

      const note = await screen.findByTestId('premium-theme-unavailable')
      expect(note.textContent).toContain('switched off')

      const card = screen.getByTestId('premium-theme-option-jewel_radiance')
      expect(card.getAttribute('aria-disabled')).toBe('true')
      expect(card.getAttribute('aria-describedby')).toBe(note.getAttribute('id'))
    })

    /**
     * A read that failed tells us nothing about entitlement, so the section shows the
     * error and Default rather than an upsell a paying subscriber would find insulting.
     */
    it('renders the load error with neither a gallery nor an upsell', async () => {
      server.use(http.get(THEME_ROUTE, () => errorEnvelope(500, 'Boom.')))
      await renderSettings()

      const error = await screen.findByTestId('premium-theme-error')
      expect(error.textContent).toContain('Unable to load your interface palette')
      expect(screen.queryByTestId('premium-theme-gallery')).toBeNull()
      expect(screen.queryByTestId('premium-theme-locked')).toBeNull()
    })

    /**
     * Entitlement can lapse while the screen is open. Handling that as error text alone
     * would leave `isEntitled` stale at true, so the gallery would stay enabled and every
     * further press would fail the same way, making the locked panel unreachable from the
     * state that most needs it.
     */
    it('re-resolves to the locked panel when a save is refused for entitlement', async () => {
      serveTheme(themeResponse())
      server.use(http.put(THEME_ROUTE, () => errorEnvelope(403, 'Premium required.')))
      await renderSettings()

      press(await screen.findByTestId('premium-theme-option-jewel_radiance'))

      await waitFor(() => {
        expect(screen.queryByTestId('premium-theme-locked')).not.toBeNull()
      })
      expect(screen.queryByTestId('premium-theme-gallery')).toBeNull()
      // Not an error banner: the locked panel IS the explanation, and it is localized.
      expect(screen.queryByTestId('premium-theme-error')).toBeNull()
    })

    it('5.3-MOB-011 renders Default for a stored palette this build cannot render', async () => {
      // A real Postgres enum makes this unreachable from the database today, so the
      // stubbed response is what actually exercises the client-side fallback — the same
      // reasoning the web Playwright spec records for its own stale-key test.
      serveTheme(themeResponse({ theme: 'spring_bloom' }))
      await renderSettings()

      const preview = await screen.findByTestId('premium-theme-preview')
      expect(getComputedStyle(preview).backgroundColor).toBe(DEFAULT_CARD_BG)
      expect(screen.getByTestId('premium-theme-state-default').textContent).toBe(
        'Selected'
      )
      expect(screen.queryByTestId('premium-theme-error')).toBeNull()
    })
  })

  /**
   * AC 7: what a palette is, where the choice is stored, and what it does not change —
   * in reading order before the gallery, never a tooltip and never only an accessible
   * name.
   */
  it('states the disclosure above the gallery for every reader', async () => {
    serveTheme(themeResponse({ isEntitled: false }))
    await renderSettings()

    const disclosure = await screen.findByTestId('premium-theme-disclosure')
    expect(disclosure.textContent).toContain('Premium feature')
    expect(disclosure.textContent).toContain('analytics provider')
    expect(disclosure.textContent).toContain(
      'never changes which outfits are recommended'
    )
  })
})
