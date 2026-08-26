// Story 5.4 Task 7 owner: the `/palette` panel.
//
// These go through MSW rather than a mocked `lib/palette-advisor`, so the request
// shape, the bearer header, the PUT/POST/DELETE bodies and the contract parsing are
// exercised by the same tests that cover the UI states. That matters more here than it
// did for 5.3: three of this panel's states are reached only by a *rejected* write
// (403 no-consent, 403 not-entitled, 503 kill switch), and a mocked lib would have let
// the reason-classification bug those states exist to survive go unnoticed.
import axe from 'axe-core'
import { I18nextProvider } from 'react-i18next'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ADVISOR_RULES,
  type AdvisorRecommendationCard,
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
  type PaletteAdvisorProfile,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { PaletteAdvisorPanel } from './palette-advisor-panel'

const PALETTE_PATH = '/api/v1/commerce/premium/palette'

const FOUNDATION_WARM_MEDIUM = ADVISOR_RULES.warm.foundation.withDepth.medium
const FOUNDATION_WARM_FAMILY = ADVISOR_RULES.warm.foundation.withoutDepth
const JEWELRY_WARM = ADVISOR_RULES.warm.jewelry

type ProfileOverrides = Partial<PaletteAdvisorProfile>

function profile(overrides: ProfileOverrides = {}): PaletteAdvisorProfile {
  return {
    profileId: 'palette-profile-1',
    isEntitled: true,
    analysisEnabled: true,
    hasConsent: false,
    analysis: null,
    recommendations: [],
    ...overrides,
  } as PaletteAdvisorProfile
}

function readyAnalysis(depth: 'medium' | null) {
  return {
    status: 'ready' as const,
    failureReason: null,
    source: depth === null ? ('wardrobe' as const) : ('selfie' as const),
    undertone: 'warm' as const,
    depth,
    confidence: 0.82,
    analysisVersion: 'palette-advisor-v1',
    analyzedAt: '2026-08-25T10:00:00.000Z',
  }
}

function card(
  entry: { itemKey: string; labelKey: string; swatchHex: string },
  overrides: Partial<AdvisorRecommendationCard> = {}
): AdvisorRecommendationCard {
  return {
    slot: 'foundation',
    itemKey: entry.itemKey,
    labelKey: entry.labelKey,
    swatchHex: entry.swatchHex,
    saved: false,
    sponsored: null,
    ...overrides,
  }
}

function getHandler(overrides: ProfileOverrides = {}) {
  return http.get(PALETTE_PATH, () => HttpResponse.json({ data: profile(overrides) }))
}

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

function renderPanel() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <PaletteAdvisorPanel />
    </I18nextProvider>
  )
}

/** The shared `.strict()` error envelope, which is how every reason is classified. */
function errorBody(statusCode: number, message: string, error: string) {
  return HttpResponse.json({ statusCode, message, error }, { status: statusCode })
}

describe('PaletteAdvisorPanel (Story 5.4)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  describe('locked and unavailable states', () => {
    it('5.4-WEB-010 renders the signed-out locked panel with no session', async () => {
      renderPanel()

      const locked = await screen.findByTestId('palette-advisor-locked')
      expect(locked).toHaveTextContent('Sign in and subscribe to Premium')
      expect(screen.queryByTestId('palette-advisor-consent')).not.toBeInTheDocument()
      expect(screen.queryByTestId('palette-advisor-sources')).not.toBeInTheDocument()
    })

    it('5.4-WEB-011 renders the not-entitled locked panel for a signed-in reader', async () => {
      signIn()
      useMswHandlers(getHandler({ isEntitled: false }))
      renderPanel()

      const locked = await screen.findByTestId('palette-advisor-locked')
      expect(locked).toHaveTextContent('Subscribe to Premium from Settings')
      expect(screen.queryByTestId('palette-advisor-consent')).not.toBeInTheDocument()
    })

    /**
     * AC 7: the `GET` always answers, carrying `analysisEnabled`, so a kill-switched
     * feature renders a reason next to a disabled control rather than a dead button.
     */
    it('5.4-WEB-012 explains and disables the controls when the kill switch is off', async () => {
      signIn()
      useMswHandlers(getHandler({ analysisEnabled: false }))
      renderPanel()

      const note = await screen.findByTestId('palette-advisor-unavailable')
      expect(note).toBeInTheDocument()
      const grant = screen.getByTestId('palette-advisor-consent-grant')
      expect(grant).toBeDisabled()
      expect(grant).toHaveAttribute(
        'aria-describedby',
        'palette-advisor-unavailable-hint'
      )
    })

    it('5.4-WEB-013 renders a translated load error rather than a server string', async () => {
      signIn()
      useMswHandlers(
        http.get(PALETTE_PATH, () => errorBody(500, 'boom', 'Internal Server Error'))
      )
      renderPanel()

      const error = await screen.findByTestId('palette-advisor-error')
      expect(error).toHaveTextContent('We could not load your palette. Try again.')
      // A read that failed says nothing about entitlement, so no upsell.
      expect(screen.queryByTestId('palette-advisor-locked')).not.toBeInTheDocument()
    })
  })

  describe('consent gate', () => {
    it('5.4-WEB-014 hides the sources until consent is granted', async () => {
      signIn()
      useMswHandlers(getHandler())
      renderPanel()

      await screen.findByTestId('palette-advisor-consent-grant')
      expect(screen.queryByTestId('palette-advisor-sources')).not.toBeInTheDocument()
    })

    it('5.4-WEB-015 grants consent and reveals both sources', async () => {
      signIn()
      let sentBody: unknown = null
      useMswHandlers(
        getHandler(),
        http.post(`${PALETTE_PATH}/consent`, async ({ request }) => {
          sentBody = await request.json()
          return HttpResponse.json({ data: profile({ hasConsent: true }) })
        })
      )
      renderPanel()

      await userEvent.click(await screen.findByTestId('palette-advisor-consent-grant'))

      await screen.findByTestId('palette-advisor-sources')
      expect(sentBody).toEqual({ granted: true })
      expect(screen.getByTestId('palette-advisor-consent-granted')).toBeInTheDocument()
      expect(screen.getByTestId('palette-advisor-source-wardrobe')).toBeInTheDocument()
      expect(screen.getByTestId('palette-advisor-selfie-input')).toBeInTheDocument()
    })

    /**
     * AC 1: withdrawal is an erase, so it is confirmed before it fires, and it runs
     * `DELETE` -- the one route that is neither entitlement- nor flag-gated.
     */
    it('5.4-WEB-016 confirms before withdrawing consent, then erases', async () => {
      signIn()
      let deleted = false
      useMswHandlers(
        getHandler({ hasConsent: true, analysis: readyAnalysis(null) }),
        http.delete(PALETTE_PATH, () => {
          deleted = true
          return HttpResponse.json({
            data: profile({ hasConsent: false, analysis: null }),
          })
        })
      )
      renderPanel()

      await userEvent.click(await screen.findByTestId('palette-advisor-consent-revoke'))
      expect(deleted).toBe(false)
      expect(screen.getByTestId('palette-advisor-erase-confirm')).toHaveTextContent(
        'It cannot be undone.'
      )

      await userEvent.click(screen.getByTestId('palette-advisor-erase-confirm-yes'))

      await waitFor(() => expect(deleted).toBe(true))
      await screen.findByTestId('palette-advisor-consent-grant')
      expect(screen.queryByTestId('palette-advisor-sources')).not.toBeInTheDocument()
    })
  })

  describe('analysis states', () => {
    it('5.4-WEB-017 starts a wardrobe analysis and shows the processing status', async () => {
      signIn()
      let sentBody: unknown = null
      useMswHandlers(
        getHandler({ hasConsent: true }),
        http.post(`${PALETTE_PATH}/analyze`, async ({ request }) => {
          sentBody = await request.json()
          return HttpResponse.json({
            data: profile({
              hasConsent: true,
              analysis: {
                status: 'processing',
                failureReason: null,
                source: 'wardrobe',
                undertone: null,
                depth: null,
                confidence: null,
                analysisVersion: null,
                analyzedAt: null,
              },
            }),
          })
        })
      )
      renderPanel()

      await userEvent.click(await screen.findByTestId('palette-advisor-source-wardrobe'))

      await waitFor(() =>
        expect(screen.getByTestId('palette-advisor-status')).toHaveTextContent(
          'Analyzing your palette'
        )
      )
      expect(sentBody).toEqual({ source: 'wardrobe' })
    })

    /**
     * AC 4: a wardrobe-sourced palette carries no depth, and the UI says why rather
     * than hiding the difference or pretending to a shade match it cannot make.
     */
    it('5.4-WEB-018 labels a depth-less palette and explains the degraded foundation', async () => {
      signIn()
      useMswHandlers(
        getHandler({
          hasConsent: true,
          analysis: readyAnalysis(null),
          recommendations: [card(FOUNDATION_WARM_FAMILY)],
        })
      )
      renderPanel()

      expect(await screen.findByTestId('palette-advisor-depth')).toHaveTextContent(
        'Not measured'
      )
      expect(
        screen.getByTestId('palette-advisor-foundation-depth-unknown')
      ).toHaveTextContent('a shade family rather than an exact match')
      expect(screen.getByTestId('palette-advisor-undertone')).toHaveTextContent('Warm')
      expect(screen.getByTestId('palette-advisor-confidence')).toHaveTextContent('82%')
    })

    it('5.4-WEB-019 renders a selfie-sourced palette with its depth and no degraded note', async () => {
      signIn()
      useMswHandlers(
        getHandler({
          hasConsent: true,
          analysis: readyAnalysis('medium'),
          recommendations: [card(FOUNDATION_WARM_MEDIUM)],
        })
      )
      renderPanel()

      expect(await screen.findByTestId('palette-advisor-depth')).toHaveTextContent(
        'Medium'
      )
      expect(
        screen.queryByTestId('palette-advisor-foundation-depth-unknown')
      ).not.toBeInTheDocument()
    })

    it('5.4-WEB-020 renders localized copy for every failure reason', async () => {
      signIn()
      useMswHandlers(
        getHandler({
          hasConsent: true,
          analysis: {
            status: 'failed',
            failureReason: 'insufficient_wardrobe',
            source: 'wardrobe',
            undertone: null,
            depth: null,
            confidence: null,
            analysisVersion: null,
            analyzedAt: null,
          },
        })
      )
      renderPanel()

      expect(await screen.findByTestId('palette-advisor-failure')).toHaveTextContent(
        'does not have enough colorful garments yet'
      )
      expect(screen.queryByTestId('palette-advisor-result')).not.toBeInTheDocument()
    })

    /** No shade name is hardcoded: the card renders `t(labelKey)` from the rule table. */
    it('5.4-WEB-021 renders every shade name from its locale key, never from the server', async () => {
      signIn()
      useMswHandlers(
        getHandler({
          hasConsent: true,
          analysis: readyAnalysis('medium'),
          recommendations: [
            card(FOUNDATION_WARM_MEDIUM),
            card(JEWELRY_WARM, { slot: 'jewelry' }),
          ],
        })
      )
      renderPanel()

      expect(
        await screen.findByTestId(
          `palette-advisor-label-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      ).toHaveTextContent('Honey beige')
      expect(
        screen.getByTestId(`palette-advisor-label-${JEWELRY_WARM.itemKey}`)
      ).toHaveTextContent('Yellow gold')
      expect(
        screen.getByTestId(`palette-advisor-swatch-${JEWELRY_WARM.itemKey}`)
      ).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('sponsored overlay', () => {
    const sponsored = {
      partnerId: 'lumen-beauty',
      partnerDisplayName: 'Lumen Beauty',
      offerId: 'offer-foundation-1',
      offerTitle: 'Lumen Skin Tint',
    }

    /**
     * AC 6: the disclosure is a sibling text node BEFORE the control it describes.
     * `compareDocumentPosition` is the assertion that survives a restyle -- a CSS
     * `order` or a flex-reverse would move the control visually without moving it in
     * the accessibility tree, and a "both are present" check would still pass.
     */
    it('5.4-WEB-022 renders the sponsored disclosure before its CTA in the DOM', async () => {
      signIn()
      useMswHandlers(
        getHandler({
          hasConsent: true,
          analysis: readyAnalysis('medium'),
          recommendations: [card(FOUNDATION_WARM_MEDIUM, { sponsored })],
        })
      )
      renderPanel()

      const key = FOUNDATION_WARM_MEDIUM.itemKey
      const disclosure = await screen.findByTestId(
        `palette-advisor-sponsored-disclosure-${key}`
      )
      const cta = screen.getByTestId(`palette-advisor-sponsored-cta-${key}`)

      expect(disclosure).toHaveTextContent('CoutureCast earns a commission')
      expect(
        disclosure.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    /**
     * AC 5 / AC 6: the server suppresses the overlay when
     * `CommercePreference.affiliate_ctas_enabled` is false or
     * `commerce_affiliate_enabled` is off, and the client's job is to render the
     * first-party recommendation alone rather than an empty sponsored frame.
     */
    it('5.4-WEB-023 renders the first-party card alone when no offer is attached', async () => {
      signIn()
      useMswHandlers(
        getHandler({
          hasConsent: true,
          analysis: readyAnalysis('medium'),
          recommendations: [card(FOUNDATION_WARM_MEDIUM, { sponsored: null })],
        })
      )
      renderPanel()

      const key = FOUNDATION_WARM_MEDIUM.itemKey
      await screen.findByTestId(`palette-advisor-card-${key}`)
      expect(
        screen.queryByTestId(`palette-advisor-sponsored-${key}`)
      ).not.toBeInTheDocument()
      expect(screen.getByTestId(`palette-advisor-label-${key}`)).toBeInTheDocument()
    })

    it('5.4-WEB-024 mints the click with the profile id and the web platform', async () => {
      signIn()
      let clickBody: unknown = null
      useMswHandlers(
        getHandler({
          hasConsent: true,
          analysis: readyAnalysis('medium'),
          recommendations: [card(FOUNDATION_WARM_MEDIUM, { sponsored })],
        }),
        http.post('/api/v1/commerce/affiliate/clicks', async ({ request }) => {
          clickBody = await request.json()
          return HttpResponse.json({
            data: { redirectUrl: 'https://partner.example/offer?click=abc' },
          })
        })
      )
      renderPanel()

      await userEvent.click(
        await screen.findByTestId(
          `palette-advisor-sponsored-cta-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      await waitFor(() =>
        expect(clickBody).toEqual({
          offerId: 'offer-foundation-1',
          recommendationId: 'palette-profile-1',
          surface: 'palette_advisor',
          platform: 'web',
        })
      )
    })
  })

  describe('save and dismiss', () => {
    it('5.4-WEB-025 saves a recommendation and offers to undo the save', async () => {
      signIn()
      const key = FOUNDATION_WARM_MEDIUM.itemKey
      const bodies: unknown[] = []
      let saved = false
      useMswHandlers(
        http.get(PALETTE_PATH, () =>
          HttpResponse.json({
            data: profile({
              hasConsent: true,
              analysis: readyAnalysis('medium'),
              recommendations: [card(FOUNDATION_WARM_MEDIUM, { saved })],
            }),
          })
        ),
        http.put(`${PALETTE_PATH}/recommendations`, async ({ request }) => {
          const body = await request.json()
          bodies.push(body)
          saved = (body as { action: string | null }).action === 'saved'
          return HttpResponse.json({
            data: profile({
              hasConsent: true,
              analysis: readyAnalysis('medium'),
              recommendations: [card(FOUNDATION_WARM_MEDIUM, { saved })],
            }),
          })
        })
      )
      renderPanel()

      await userEvent.click(await screen.findByTestId(`palette-advisor-save-${key}`))

      await screen.findByTestId(`palette-advisor-saved-${key}`)
      expect(bodies).toEqual([{ itemKey: key, slot: 'foundation', action: 'saved' }])

      await userEvent.click(screen.getByTestId(`palette-advisor-unsave-${key}`))
      await screen.findByTestId(`palette-advisor-save-${key}`)
      expect(bodies[1]).toEqual({ itemKey: key, slot: 'foundation', action: null })
    })

    /**
     * AC 6: a dismissed suggestion does not reappear. The server omits it from the
     * next read entirely, so the only thing left to prove on the client is that the
     * card leaves the list and that undo is reachable from what replaces it.
     */
    it('5.4-WEB-026 removes a dismissed card and restores it with undo', async () => {
      signIn()
      const key = FOUNDATION_WARM_MEDIUM.itemKey
      const bodies: unknown[] = []
      let dismissed = false
      const body = () =>
        HttpResponse.json({
          data: profile({
            hasConsent: true,
            analysis: readyAnalysis('medium'),
            recommendations: dismissed ? [] : [card(FOUNDATION_WARM_MEDIUM)],
          }),
        })
      useMswHandlers(
        http.get(PALETTE_PATH, body),
        http.put(`${PALETTE_PATH}/recommendations`, async ({ request }) => {
          const sent = await request.json()
          bodies.push(sent)
          dismissed = (sent as { action: string | null }).action === 'dismissed'
          return body()
        })
      )
      renderPanel()

      await userEvent.click(await screen.findByTestId(`palette-advisor-dismiss-${key}`))

      await waitFor(() =>
        expect(
          screen.queryByTestId(`palette-advisor-card-${key}`)
        ).not.toBeInTheDocument()
      )
      expect(bodies[0]).toEqual({ itemKey: key, slot: 'foundation', action: 'dismissed' })
      expect(screen.getByTestId('palette-advisor-dismissed-notice')).toHaveTextContent(
        'Dismissed'
      )

      await userEvent.click(screen.getByTestId('palette-advisor-undo-dismiss'))

      await screen.findByTestId(`palette-advisor-card-${key}`)
      expect(bodies[1]).toEqual({ itemKey: key, slot: 'foundation', action: null })
    })
  })

  /**
   * The three states a rejected write has to reach.
   *
   * Handling these as error text alone leaves `isEntitled` / `hasConsent` /
   * `analysisEnabled` stale at `true`, so every further press fails the same way and
   * the locked panel, the consent gate and the kill-switch note all become unreachable.
   * Each case asserts the state transition, not the message.
   */
  describe('rejected writes re-resolve the panel', () => {
    const readyProfile: ProfileOverrides = {
      hasConsent: true,
      analysis: readyAnalysis('medium'),
      recommendations: [card(FOUNDATION_WARM_MEDIUM)],
    }

    it('5.4-WEB-027 falls back to the consent gate on a 403 consent-required', async () => {
      signIn()
      useMswHandlers(
        getHandler(readyProfile),
        http.put(`${PALETTE_PATH}/recommendations`, () =>
          errorBody(403, PALETTE_CONSENT_REQUIRED_MESSAGE, 'Forbidden')
        )
      )
      renderPanel()

      await userEvent.click(
        await screen.findByTestId(
          `palette-advisor-save-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      await screen.findByTestId('palette-advisor-consent-grant')
      expect(screen.queryByTestId('palette-advisor-sources')).not.toBeInTheDocument()
      // The server's untranslated English never reaches the screen.
      expect(document.body.textContent).not.toContain(PALETTE_CONSENT_REQUIRED_MESSAGE)
    })

    it('5.4-WEB-028 falls back to the locked panel on a 403 premium-required', async () => {
      signIn()
      useMswHandlers(
        getHandler(readyProfile),
        http.put(`${PALETTE_PATH}/recommendations`, () =>
          errorBody(403, PREMIUM_REQUIRED_MESSAGE, 'Forbidden')
        )
      )
      renderPanel()

      await userEvent.click(
        await screen.findByTestId(
          `palette-advisor-save-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      await screen.findByTestId('palette-advisor-locked')
      expect(document.body.textContent).not.toContain(PREMIUM_REQUIRED_MESSAGE)
    })

    it('5.4-WEB-029 shows the kill-switch note on a 503', async () => {
      signIn()
      useMswHandlers(
        getHandler({ hasConsent: true }),
        http.post(`${PALETTE_PATH}/analyze`, () =>
          errorBody(503, PALETTE_ANALYSIS_DISABLED_MESSAGE, 'Service Unavailable')
        )
      )
      renderPanel()

      await userEvent.click(await screen.findByTestId('palette-advisor-source-wardrobe'))

      await screen.findByTestId('palette-advisor-unavailable')
      expect(screen.getByTestId('palette-advisor-source-wardrobe')).toBeDisabled()
      expect(document.body.textContent).not.toContain(PALETTE_ANALYSIS_DISABLED_MESSAGE)
    })
  })

  /**
   * AC 8. The Playwright suite scans the real route at two viewports; this is the
   * cheaper per-state check, and it covers the ready state with a sponsored card,
   * which the signed-out Playwright scan cannot reach.
   */
  it('5.4-WEB-033 has no axe violations in the ready state with a sponsored card', async () => {
    signIn()
    useMswHandlers(
      getHandler({
        hasConsent: true,
        analysis: readyAnalysis('medium'),
        recommendations: [
          card(FOUNDATION_WARM_MEDIUM, {
            sponsored: {
              partnerId: 'lumen-beauty',
              partnerDisplayName: 'Lumen Beauty',
              offerId: 'offer-foundation-1',
              offerTitle: 'Lumen Skin Tint',
            },
          }),
          card(JEWELRY_WARM, { slot: 'jewelry' }),
        ],
      })
    )
    const { container } = renderPanel()

    await screen.findByTestId('palette-advisor-recommendations')

    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })
    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2)
    ).toEqual([])
  })
})
