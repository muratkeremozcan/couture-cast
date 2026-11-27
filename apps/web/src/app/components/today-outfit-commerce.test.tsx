// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import type { ScenarioOutfit, ShopThisLook } from '@couture/api-client/contracts/http'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { TodayOutfitCommerce } from './today-outfit-commerce'

const mocks = vi.hoisted(() => ({
  live: vi.fn(),
  capture: vi.fn(),
  distinctId: vi.fn(),
  begin: vi.fn(),
  mint: vi.fn(),
  cancel: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('../../lib/use-web-session', () => ({ isLiveScope: mocks.live }))
vi.mock('../../analytics/browser-analytics', () => ({
  browserAnalytics: { capture: mocks.capture, getDistinctId: mocks.distinctId },
}))
vi.mock('../../lib/commerce', () => ({
  beginAffiliatePartnerHandoff: mocks.begin,
  mintAffiliateClickFromWeb: mocks.mint,
  resolveAffiliateLocaleRegion: () => 'US',
}))

const offer: ShopThisLook = {
  partnerId: 'fixture-partner',
  partnerDisplayName: 'Fixture partner',
  offerId: 'offer-1',
  offerTitle: 'Warm layer',
  garmentCategory: 'top',
}
const outfit: ScenarioOutfit = {
  id: 'look-1',
  scenario: 'morning',
  garmentIds: ['default-top'],
  comfortNotes: 'Warm layer',
  reasoningBadges: [],
  shopThisLook: offer,
}
const redirect = 'https://partner.example.test/warm-layer'
const button = () => screen.getByTestId('shop-this-look-cta')

beforeEach(() => {
  vi.resetAllMocks()
  mocks.live.mockReturnValue(true)
  mocks.begin.mockReturnValue({ navigate: mocks.navigate, cancel: mocks.cancel })
  mocks.mint.mockResolvedValue(redirect)
})

it('discloses, records one impression and mints the web Today click before navigating', async () => {
  const shown = new Set<string>()
  const view = render(
    <TodayOutfitCommerce outfit={outfit} offer={offer} scope="member" shown={shown} />
  )
  view.rerender(
    <TodayOutfitCommerce
      outfit={{ ...outfit }}
      offer={offer}
      scope="member"
      shown={shown}
    />
  )
  expect(mocks.capture.mock.calls).toMatchObject([
    ['affiliate_cta_shown', { surface: 'web_hero' }],
  ])
  expect(screen.getByTestId('shop-this-look-disclosure')).toHaveTextContent(
    /paid partnership/i
  )

  await userEvent.setup().click(button())
  expect(mocks.mint).toHaveBeenCalledExactlyOnceWith(
    { offerId: offer.offerId, recommendationId: outfit.id, surface: 'web_hero' },
    expect.any(AbortSignal)
  )
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(redirect)
})

it('reports popup and network failures while leaving navigation untouched', async () => {
  mocks.begin.mockReturnValueOnce(null)
  mocks.mint.mockRejectedValueOnce(new Error('Offline'))
  render(
    <TodayOutfitCommerce outfit={outfit} offer={offer} scope="member" shown={new Set()} />
  )
  const user = userEvent.setup()
  await user.click(button())
  expect(screen.getByRole('alert')).toBeVisible()
  expect(mocks.mint).not.toHaveBeenCalled()
  await user.click(button())
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(mocks.cancel).toHaveBeenCalledOnce()
  expect(mocks.navigate).not.toHaveBeenCalled()
})

it.each(['scope change', 'unmount'] as const)(
  'cancels a late handoff after %s',
  async (reason) => {
    let resolve!: (url: string) => void
    mocks.mint.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done
      })
    )
    const view = render(
      <TodayOutfitCommerce
        outfit={outfit}
        offer={offer}
        scope="member"
        shown={new Set()}
      />
    )
    const user = userEvent.setup()
    await user.click(button())
    await waitFor(() => expect(button()).toHaveAttribute('aria-busy', 'true'))
    if (reason === 'unmount') view.unmount()
    else mocks.live.mockReturnValue(false)
    await act(() => Promise.resolve().then(() => resolve(redirect)))
    expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(mocks.navigate).not.toHaveBeenCalled()
  }
)

it('keeps the offer functional when impression tracking throws', async () => {
  mocks.distinctId.mockReturnValue('fixture-identity')
  mocks.capture.mockImplementation(() => {
    throw new Error('Analytics unavailable')
  })
  render(
    <TodayOutfitCommerce outfit={outfit} offer={offer} scope="member" shown={new Set()} />
  )
  await userEvent.setup().click(button())
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(redirect)
})
