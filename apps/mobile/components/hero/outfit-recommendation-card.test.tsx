// Story 5.1 Task 6: the affiliate "Shop this look" block on the outfit card.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScenarioOutfit } from '@couture/api-client/contracts/http'
import type * as CommerceModule from '@/src/lib/commerce'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const { mintAffiliateClickMock, openAffiliatePartnerSiteMock } = vi.hoisted(() => ({
  mintAffiliateClickMock: vi.fn(),
  openAffiliatePartnerSiteMock: vi.fn(),
}))

// Only the two network/navigation boundaries are owned here. The eligibility
// predicate stays real, because "may this card show a CTA" is the behaviour
// under test and mocking it would assert nothing.
vi.mock('@/src/lib/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof CommerceModule>()
  return {
    ...actual,
    mintAffiliateClickFromMobile: mintAffiliateClickMock,
    openAffiliatePartnerSite: openAffiliatePartnerSiteMock,
  }
})

import { OutfitRecommendationCard } from './outfit-recommendation-card'
import { mockShopThisLook } from '@/src/test-utils/msw/handlers'
import i18n, { initI18n } from '@/src/lib/i18n'

const REDIRECT_URL = 'https://partner.couturecast.test/go?token=mock-click-token'

const eligibleOutfit: ScenarioOutfit = {
  id: 'morning-outfit-id',
  scenario: 'morning',
  garmentIds: ['classic-trench-coat'],
  reasoningBadges: [],
  comfortNotes: 'Mild morning with gentle winds.',
  shopThisLook: mockShopThisLook,
}

const ineligibleOutfit: ScenarioOutfit = {
  ...eligibleOutfit,
  id: 'evening-outfit-id',
  scenario: 'evening',
  shopThisLook: null,
}

function renderCard(
  props: Partial<React.ComponentProps<typeof OutfitRecommendationCard>>
) {
  return render(
    <OutfitRecommendationCard
      outfit={eligibleOutfit}
      onSwapGarment={vi.fn()}
      {...props}
    />
  )
}

describe('OutfitRecommendationCard affiliate CTA', () => {
  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    mintAffiliateClickMock.mockReset()
    mintAffiliateClickMock.mockResolvedValue(REDIRECT_URL)
    openAffiliatePartnerSiteMock.mockReset()
    openAffiliatePartnerSiteMock.mockResolvedValue(undefined)
    await i18n.changeLanguage('en-US')
  })

  it('5.1-MOB-CTA-01 renders the disclosure ahead of the control, with the partner and the handoff line', () => {
    const { container } = renderCard({})

    const block = screen.getByTestId('shop-this-look-block')
    expect(screen.getByTestId('shop-this-look-disclosure').textContent).toBe(
      'Paid partnership. CoutureCast may earn a commission.'
    )
    expect(screen.getByTestId('shop-this-look-partner').textContent).toBe(
      'Presented by Sample Partner'
    )
    expect(screen.getByTestId('shop-this-look-opens-in-browser').textContent).toBe(
      'Opens in an in-app browser'
    )

    // PRD FR5.1 accepts only a disclosure that is visible before the click, so
    // document order, not merely presence, is the assertion.
    const order = Array.from(block.querySelectorAll('[data-testid]')).map(
      (node: Element) => node.getAttribute('data-testid')
    )
    expect(order.indexOf('shop-this-look-disclosure')).toBeLessThan(
      order.indexOf('shop-this-look-cta')
    )
    expect(order.indexOf('shop-this-look-partner')).toBeLessThan(
      order.indexOf('shop-this-look-cta')
    )
    expect(container.querySelector('[data-testid="shop-this-look-error"]')).toBeNull()
  })

  it('5.1-MOB-CTA-02 composes the accessible name as control, partner, then handoff', () => {
    renderCard({})

    expect(screen.getByTestId('shop-this-look-cta')).toHaveAttribute(
      'aria-label',
      'Shop this look. Presented by Sample Partner. Opens in an in-app browser'
    )
  })

  it('5.1-MOB-CTA-02b never hides the disclosure from assistive technology', () => {
    const { container } = renderCard({})

    // Decision 17 forbids the disclosure existing only as an accessibility
    // label, and equally forbids the reverse: a visible paragraph that screen
    // readers skip. `accessibilityElementsHidden`,
    // `importantForAccessibility="no-hide-descendants"` and a bare `aria-hidden`
    // all land on the DOM as aria-hidden, so walking the ancestor chain catches
    // every form of it. Asserting only on the node itself would miss a wrapper.
    for (const testId of ['shop-this-look-disclosure', 'shop-this-look-partner']) {
      let node: HTMLElement | null = screen.getByTestId(testId)
      while (node && node !== container) {
        expect(
          node.getAttribute('aria-hidden'),
          `${testId} ancestor aria-hidden`
        ).not.toBe('true')
        node = node.parentElement
      }
    }
  })

  it('5.1-MOB-CTA-03 renders no block when the card carries no offer', () => {
    renderCard({ outfit: ineligibleOutfit })

    expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
  })

  it('5.1-MOB-CTA-04 renders no block from a cache-served payload even when an offer is present', () => {
    // The device cache outlives an opt-out by fifteen minutes online and
    // indefinitely offline, so a CTA drawn from it reads as a broken opt-out.
    renderCard({ isCacheServed: true })

    expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
  })

  it('5.1-MOB-CTA-05 mints the click, then hands the minted URL to the in-app browser', async () => {
    renderCard({})

    fireEvent.click(screen.getByTestId('shop-this-look-cta'))

    await waitFor(() => {
      expect(openAffiliatePartnerSiteMock).toHaveBeenCalledWith(REDIRECT_URL)
    })
    expect(mintAffiliateClickMock).toHaveBeenCalledWith({
      offerId: 'offer-morning-outerwear',
      recommendationId: 'morning-outfit-id',
      // `scenario` and `localeRegion` are derived server-side; sending them
      // would open a spoofable path into the attribution record.
      surface: 'mobile_hero',
    })
  })

  it('5.1-MOB-CTA-06 marks the control busy and relabels it while the click is in flight', async () => {
    let releaseMint: (url: string) => void = () => undefined
    mintAffiliateClickMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseMint = resolve
        })
    )

    renderCard({})
    fireEvent.click(screen.getByTestId('shop-this-look-cta'))

    await waitFor(() => {
      expect(screen.getByTestId('shop-this-look-cta')).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
    expect(screen.getByTestId('shop-this-look-cta').textContent).toContain(
      'Opening partner site'
    )

    await act(async () => {
      releaseMint(REDIRECT_URL)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('shop-this-look-cta').textContent).toContain(
        'Shop this look'
      )
    })
  })

  it('5.1-MOB-CTA-07 mints exactly once when the control is double-tapped', async () => {
    let releaseMint: (url: string) => void = () => undefined
    mintAffiliateClickMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseMint = resolve
        })
    )

    renderCard({})
    const cta = screen.getByTestId('shop-this-look-cta')
    fireEvent.click(cta)
    fireEvent.click(cta)

    await act(async () => {
      releaseMint(REDIRECT_URL)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(openAffiliatePartnerSiteMock).toHaveBeenCalledTimes(1)
    })
    // A second durable click row would double-count the impression-to-click
    // rate the PRD metric is built on.
    expect(mintAffiliateClickMock).toHaveBeenCalledTimes(1)
  })

  it('5.1-MOB-CTA-08 shows an inline alert and does not navigate when the mint fails', async () => {
    mintAffiliateClickMock.mockRejectedValue(new Error('offer not found'))

    renderCard({})
    fireEvent.click(screen.getByTestId('shop-this-look-cta'))

    const alert = await screen.findByTestId('shop-this-look-error')
    expect(alert.textContent).toBe('Unable to open the partner site. Please try again.')
    expect(alert).toHaveAttribute('role', 'alert')
    // Traffic the partner cannot attribute is worthless to them and
    // unauditable for us, so an unminted click must never navigate.
    expect(openAffiliatePartnerSiteMock).not.toHaveBeenCalled()
  })

  it('5.1-MOB-CTA-09 shows the same alert when the browser handoff fails after a successful mint', async () => {
    openAffiliatePartnerSiteMock.mockRejectedValue(new Error('no browser available'))

    renderCard({})
    fireEvent.click(screen.getByTestId('shop-this-look-cta'))

    await screen.findByTestId('shop-this-look-error')
    // The click row and its event stand; no compensating event is emitted.
    expect(mintAffiliateClickMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('shop-this-look-cta')).not.toHaveAttribute(
      'aria-busy',
      'true'
    )
  })

  it('5.1-MOB-CTA-10 leaves the failure behind when the user moves to another card', async () => {
    mintAffiliateClickMock.mockRejectedValue(new Error('offer not found'))
    const secondOffer: ScenarioOutfit = {
      ...eligibleOutfit,
      id: 'evening-outfit-id',
      scenario: 'evening',
    }

    const { rerender } = render(
      <OutfitRecommendationCard outfit={eligibleOutfit} onSwapGarment={vi.fn()} />
    )
    fireEvent.click(screen.getByTestId('shop-this-look-cta'))
    await screen.findByTestId('shop-this-look-error')

    // This component instance survives a scenario toggle, so an unstamped error
    // would follow the user onto a card whose offer was never even tapped.
    rerender(<OutfitRecommendationCard outfit={secondOffer} onSwapGarment={vi.fn()} />)

    expect(screen.queryByTestId('shop-this-look-error')).toBeNull()
    expect(screen.getByTestId('shop-this-look-cta').textContent).toContain(
      'Shop this look'
    )
  })

  it('5.1-MOB-CTA-11 gives the control a touch target of at least 44 by 44 pixels', () => {
    renderCard({})

    const cta = screen.getByTestId('shop-this-look-cta')
    const style = window.getComputedStyle(cta)
    expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(44)
  })

  it('5.1-MOB-CTA-12 keeps the skeleton and empty branches free of the block', () => {
    const { unmount } = renderCard({ isLoading: true })
    expect(screen.getByTestId('outfit-recommendation-card-skeleton')).toBeTruthy()
    expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
    unmount()

    const { container } = renderCard({ outfit: undefined })
    expect(container.innerHTML).toBe('')
  })

  it('5.1-MOB-CTA-13 localizes the whole block', async () => {
    await act(async () => {
      await i18n.changeLanguage('tr-TR')
    })

    renderCard({})

    expect(screen.getByTestId('shop-this-look-disclosure').textContent).toBe(
      'Ücretli iş birliği. CoutureCast komisyon kazanabilir.'
    )
    expect(screen.getByTestId('shop-this-look-partner').textContent).toBe(
      'Sample Partner sunar'
    )
    expect(screen.getByTestId('shop-this-look-cta').textContent).toContain(
      'Bu kombini satın al'
    )
  })
})
