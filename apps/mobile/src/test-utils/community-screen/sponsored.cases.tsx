/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.7b owner: sponsored community CTAs on the Community screen, through the
// real HTTP boundary. Each card is found by its loaded content first, so every
// absence asserted below is an absence on a rendered card.
import { feedJson, item, serveFeed, setMockParams } from './harness'
import { mockCapture, webBrowser } from './mock-state'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { CommunitySyncState } from '@couture/api-client'
import type { CommunitySponsorship } from '@couture/api-client/contracts/http'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { press } from '@/src/test-utils/press'
import { server } from '@/src/test-utils/msw/server'
import { mockAffiliateRedirectUrl } from '@/src/test-utils/msw/handlers'
import { screenFocus } from '@/src/test-utils/focus-effect'

const SPONSORSHIP: CommunitySponsorship = {
  partnerId: 'atelier-north',
  partnerDisplayName: 'Atelier North',
  offerId: 'offer-coat',
  offerTitle: 'Wool overcoat',
}

const ZERO = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  viewerReaction: null,
  revision: 0,
  generation: 0,
}

function serveClicks() {
  const bodies: unknown[] = []
  server.use(
    http.post('*/api/v1/commerce/affiliate/clicks', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(
        { data: { redirectUrl: mockAffiliateRedirectUrl } },
        { status: 201 }
      )
    })
  )
  return bodies
}

function serveSponsoredSpotlight() {
  server.use(
    http.get('*/api/v1/community/spotlight', () =>
      HttpResponse.json({
        data: {
          level: 'city',
          label: 'Lisbon',
          items: [
            {
              ...item({ id: 'spot-1', caption: 'Spotlight look' }),
              rank: 1,
              reactions: ZERO,
              sponsorship: SPONSORSHIP,
            },
          ],
          nextCursor: null,
        },
      })
    )
  )
}

const shown = () =>
  mockCapture.mock.calls
    .filter(([event]) => event === 'affiliate_cta_shown')
    .map(([, properties]) => properties as Record<string, unknown>)

export function registerCommunitySponsoredCases() {
  it('6.7b-MOB-050 shows Partnered and the CTA on the sponsored feed card only', async () => {
    const bodies = serveClicks()
    serveFeed(() =>
      feedJson({
        items: [
          item({ id: 'post-a', sponsorship: SPONSORSHIP }),
          item({ id: 'post-b', caption: 'Plain look' }),
        ],
      })
    )

    await render(<CommunityScreen />)

    const sponsored = await screen.findByTestId('community-post-card-post-a')
    const plain = await screen.findByTestId('community-card-caption-post-b')
    expect(plain.textContent).toBe('Plain look')
    expect(
      within(sponsored).getByTestId('community-card-partnered-post-a').textContent
    ).toBe('Partnered')
    expect(sponsored.getAttribute('aria-label')).toBe(
      'Look by Style Explorer A1B2. Partnered with Atelier North'
    )
    expect(screen.queryByTestId('community-card-partnered-post-b')).toBeNull()
    expect(screen.queryByTestId('community-card-shop-post-b')).toBeNull()
    await waitFor(() =>
      expect(shown()).toEqual([
        {
          partner_id: 'atelier-north',
          offer_id: 'offer-coat',
          surface: 'community_feed',
          locale_region: 'US',
        },
      ])
    )

    press(within(sponsored).getByTestId('community-card-shop-post-a'))

    await waitFor(() =>
      expect(webBrowser.openBrowserAsync).toHaveBeenCalledWith(mockAffiliateRedirectUrl)
    )
    expect(bodies).toEqual([
      { offerId: 'offer-coat', recommendationId: 'post-a', surface: 'community_feed' },
    ])
  })

  it('6.7b-MOB-051 reports community_spotlight from the module card and its detail', async () => {
    const bodies = serveClicks()
    serveSponsoredSpotlight()

    await render(<CommunityScreen />)

    const moduleItem = await screen.findByTestId('community-spotlight-item-spot-1')
    press(within(moduleItem).getByTestId('community-card-shop-spot-1'))
    await waitFor(() => expect(bodies).toHaveLength(1))

    press(within(moduleItem).getByTestId('community-card-open-spot-1'))
    await screen.findByTestId('community-spotlight-detail-title')
    const copies = await screen.findAllByTestId('community-card-shop-spot-1')
    expect(copies).toHaveLength(2)
    const detailCopy = copies.find((copy) => !moduleItem.contains(copy))
    expect(detailCopy).toBeDefined()
    press(detailCopy as HTMLElement)
    await waitFor(() => expect(bodies).toHaveLength(2))

    expect(bodies).toEqual([
      {
        offerId: 'offer-coat',
        recommendationId: 'spot-1',
        surface: 'community_spotlight',
      },
      {
        offerId: 'offer-coat',
        recommendationId: 'spot-1',
        surface: 'community_spotlight',
      },
    ])
    // The detail's copy is the same block on the same visit: one impression.
    expect(shown()).toEqual([
      {
        partner_id: 'atelier-north',
        offer_id: 'offer-coat',
        surface: 'community_spotlight',
        locale_region: 'US',
      },
    ])
  })

  it('6.7b-MOB-052 offers the CTA on a deep-linked card as a feed surface', async () => {
    const bodies = serveClicks()
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-z' })
    server.use(
      http.get('*/api/v1/community/posts/post-z', () =>
        HttpResponse.json({
          data: item({ id: 'post-z', sponsorship: SPONSORSHIP }),
        })
      )
    )

    await render(<CommunityScreen />)

    const target = await screen.findByTestId('highlighted-community-card-post-z')
    expect(
      within(target).getByTestId('community-card-partnered-post-z').textContent
    ).toBe('Partnered')
    press(within(target).getByTestId('community-card-shop-post-z'))

    await waitFor(() =>
      expect(bodies).toEqual([
        { offerId: 'offer-coat', recommendationId: 'post-z', surface: 'community_feed' },
      ])
    )
  })

  it('6.7b-MOB-053 counts a block again on a new visit to the screen', async () => {
    serveFeed(() =>
      feedJson({ items: [item({ id: 'post-a', sponsorship: SPONSORSHIP })] })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-card-shop-post-a')
    await waitFor(() => expect(shown()).toHaveLength(1))

    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))

    await waitFor(() => expect(shown()).toHaveLength(2))
    expect(shown()[1]).toEqual(shown()[0])
  })

  it('6.7b-MOB-054 keeps the live block when the sync revalidates rendered posts', async () => {
    // The real coordinator: its bootstrap resolves every rendered post through
    // `targets/resolve`, which takes no sponsorship opt-in, and applies each copy
    // over the feed, the deep-link card and the spotlight.
    let resolves = 0
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
      this: CommunitySyncState
    ) {
      void this.catchUp()
    })
    serveFeed(() =>
      feedJson({ items: [item({ id: 'post-a', sponsorship: SPONSORSHIP })] })
    )
    serveSponsoredSpotlight()
    server.use(
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events: [],
            nextCursor: 'sponsored',
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
        resolves++
        const body = (await request.json()) as { targets: { key: string }[] }
        return HttpResponse.json({
          data: {
            targets: body.targets.map(({ key }) => ({
              key,
              status: 'available',
              communityRevision: '1',
              post: item({ id: key, caption: `Resolved ${key}`, reactions: ZERO }),
              comment: null,
              parent: null,
              pageCursor: null,
              parentPageCursor: null,
              threadPosition: null,
            })),
          },
        })
      })
    )

    await render(<CommunityScreen />)

    // The resolved copies landed: their captions replaced the live ones.
    await screen.findByText('Resolved post-a')
    await waitFor(() =>
      expect(screen.getAllByText('Resolved spot-1').length).toBeGreaterThan(0)
    )
    expect(resolves).toBeGreaterThan(0)
    expect(screen.getByTestId('community-card-shop-post-a').textContent).toBe(
      'Shop this look at Atelier North'
    )
    const moduleItem = screen.getByTestId('community-spotlight-item-spot-1')
    expect(
      within(moduleItem).getByTestId('community-card-partnered-spot-1').textContent
    ).toBe('Partnered')
    expect(
      within(moduleItem).getByTestId('community-card-shop-spot-1')
    ).toBeInTheDocument()
  })
}
