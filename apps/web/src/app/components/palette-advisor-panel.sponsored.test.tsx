// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
// Story 5.4 Task 7 owner: the `/palette` panel's sponsored-CTA handoff, through
// MSW and the partner tab stand-in. Split from palette-advisor-panel.test.tsx.
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ADVISOR_RULES,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { stubPartnerTab } from '../../test-utils/partner-tab'
import {
  card,
  errorBody,
  getHandler,
  readyAnalysis,
  renderPanel,
  signIn,
  type ProfileOverrides,
} from '../../test-utils/palette-advisor-panel'

const FOUNDATION_WARM_MEDIUM = ADVISOR_RULES.warm.foundation.withDepth.medium

describe('PaletteAdvisorPanel sponsored handoff (Story 5.4)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  /**
   * The sponsored handoff's failure doors. `handleSponsoredActivate` refuses to
   * navigate unless the click was attributed first: "traffic the partner cannot
   * attribute is worth nothing to them and cannot be audited by us". Both ways that
   * can fail were untested.
   */
  describe('sponsored handoff failures', () => {
    const sponsoredProfile: ProfileOverrides = {
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
      ],
    }

    it('5.4-WEB-039 surfaces a failed mint on the card, closes the claimed tab and never navigates it', async () => {
      signIn()
      const partner = stubPartnerTab()
      useMswHandlers(
        getHandler(sponsoredProfile),
        http.post('/api/v1/commerce/affiliate/clicks', () =>
          errorBody(403, PALETTE_CONSENT_REQUIRED_MESSAGE, 'Forbidden')
        )
      )
      renderPanel()

      await userEvent.click(
        await screen.findByTestId(
          `palette-advisor-sponsored-cta-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      await screen.findByTestId(
        `palette-advisor-sponsored-error-${FOUNDATION_WARM_MEDIUM.itemKey}`
      )
      expect(partner.navigations).toEqual([])
      expect(partner.tab.close).toHaveBeenCalledTimes(1)
    })

    it('5.4-WEB-040 claims the tab inside the gesture and navigates it with no opener and no referrer', async () => {
      signIn()
      const partner = stubPartnerTab()
      const claimedAtMint: number[] = []
      useMswHandlers(
        getHandler(sponsoredProfile),
        http.post('/api/v1/commerce/affiliate/clicks', () => {
          claimedAtMint.push(partner.openSpy.mock.calls.length)
          return HttpResponse.json({
            data: { redirectUrl: 'https://partner.example.com/offer?click=token' },
          })
        })
      )
      renderPanel()

      await userEvent.click(
        await screen.findByTestId(
          `palette-advisor-sponsored-cta-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      )

      await waitFor(() => expect(partner.navigations).toHaveLength(1))
      // A popup blocker only allows the open during the press, before the mint.
      expect(claimedAtMint).toEqual([1])
      expect(partner.openSpy).toHaveBeenCalledWith('about:blank', '_blank')
      expect(partner.tab.opener).toBeNull()
      expect(partner.navigations).toEqual([
        { href: 'https://partner.example.com/offer?click=token', rel: 'noreferrer' },
      ])
      expect(
        screen.queryByTestId(
          `palette-advisor-sponsored-error-${FOUNDATION_WARM_MEDIUM.itemKey}`
        )
      ).not.toBeInTheDocument()
    })

    it('5.4-WEB-045 a blocked tab surfaces the error and mints nothing', async () => {
      signIn()
      stubPartnerTab({ blocked: true })
      let mints = 0
      useMswHandlers(
        getHandler(sponsoredProfile),
        http.post('/api/v1/commerce/affiliate/clicks', () => {
          mints += 1
          return HttpResponse.json({
            data: { redirectUrl: 'https://partner.example.com/offer?click=token' },
          })
        })
      )
      renderPanel()

      const cta = await screen.findByTestId(
        `palette-advisor-sponsored-cta-${FOUNDATION_WARM_MEDIUM.itemKey}`
      )
      await userEvent.click(cta)

      await screen.findByTestId(
        `palette-advisor-sponsored-error-${FOUNDATION_WARM_MEDIUM.itemKey}`
      )
      expect(cta).toHaveFocus()
      expect(mints).toBe(0)
    })
  })
})
