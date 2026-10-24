/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.7b owner: sponsored community CTAs on the Community screen, through the
// real HTTP boundary. Each card is found by its loaded content first, so every
// absence asserted below is an absence on a rendered card.
import { feedJson, feedUrls, item, serveFeed, setMockParams } from './harness'
import { mockCapture, refreshEvents, webBrowser } from './mock-state'
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

/**
 * The real sync coordinator: its bootstrap rebuilds the feed with a live read,
 * then resolves every rendered post through `targets/resolve`, which takes no
 * sponsorship opt-in, and applies each copy over every surface.
 */
function serveRealSync() {
  let resolves = 0
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    void this.catchUp()
  })
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
  return { resolves: () => resolves }
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
    const sync = serveRealSync()
    serveFeed(() =>
      feedJson({ items: [item({ id: 'post-a', sponsorship: SPONSORSHIP })] })
    )
    serveSponsoredSpotlight()

    await render(<CommunityScreen />)

    // The resolved copies landed: their captions replaced the live ones.
    await screen.findByText('Resolved post-a')
    await waitFor(() =>
      expect(screen.getAllByText('Resolved spot-1').length).toBeGreaterThan(0)
    )
    expect(sync.resolves()).toBeGreaterThan(0)
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

  it('6.7b-MOB-055 a live rebuild without the block removes it from the feed and the spotlight', async () => {
    const sync = serveRealSync()
    // The first feed read carries the block for both posts; the sync's rebuild,
    // a later live read, carries none (the link ended or the viewer opted out).
    serveFeed((_url, index) =>
      feedJson({
        items:
          index === 0
            ? [
                item({ id: 'post-a', sponsorship: SPONSORSHIP }),
                item({ id: 'spot-1', caption: 'Spot in feed', sponsorship: SPONSORSHIP }),
              ]
            : [item({ id: 'post-a' }), item({ id: 'spot-1', caption: 'Spot in feed' })],
      })
    )
    serveSponsoredSpotlight()

    await render(<CommunityScreen />)
    // The live block rendered first, on both surfaces.
    await screen.findByTestId('community-card-shop-post-a')
    const moduleItem = await screen.findByTestId('community-spotlight-item-spot-1')
    await within(moduleItem).findByTestId('community-card-shop-spot-1')

    // The rebuild and the resolve both landed.
    await screen.findByText('Resolved post-a')
    await waitFor(() => expect(sync.resolves()).toBeGreaterThan(0))
    await waitFor(() =>
      expect(screen.queryByTestId('community-card-shop-post-a')).toBeNull()
    )
    expect(screen.queryByTestId('community-card-partnered-post-a')).toBeNull()
    expect(
      screen.getByTestId('community-post-card-post-a').getAttribute('aria-label')
    ).toBe('Look by Style Explorer A1B2')
    const module = screen.getByTestId('community-spotlight-item-spot-1')
    expect(within(module).queryByTestId('community-card-shop-spot-1')).toBeNull()
    expect(within(module).queryByTestId('community-card-partnered-spot-1')).toBeNull()
    expect(within(module).getByTestId('community-post-card-spot-1')).toBeInTheDocument()
  })

  it.each([
    ['the newer read answers first', true],
    ['the older read answers first', false],
  ] as const)(
    '6.7b-MOB-056 the newest live answer wins when two reads of one post overlap (%s)',
    async (_case, newerFirst) => {
      // The older read: the notification's single-post read, held open. It
      // carries the block the link had when it started.
      let releaseOlder!: () => void
      const olderHeld = new Promise<void>((resolve) => {
        releaseOlder = resolve
      })
      let postReads = 0
      setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
      server.use(
        http.get('*/api/v1/community/posts/post-a', async () => {
          postReads++
          if (postReads === 1) {
            await olderHeld
            return HttpResponse.json({
              data: item({ id: 'post-a', sponsorship: SPONSORSHIP }),
            })
          }
          return HttpResponse.json({ data: item({ id: 'post-a' }) })
        })
      )
      // The newer reads: a pull to refresh started after the older read went
      // out; the link ended in between, so they carry no block.
      serveFeed(() => feedJson({ items: [item({ id: 'post-a' })] }))

      await render(<CommunityScreen />)
      await screen.findByTestId('community-post-card-post-a')
      await waitFor(() => expect(postReads).toBe(1))
      await waitFor(() => expect(refreshEvents.onRefresh).toBeTypeOf('function'))

      if (!newerFirst) {
        releaseOlder()
        await screen.findByTestId('community-card-shop-post-a')
      }
      // Opening the comments retires the notification intent, so the older read
      // is not re-requested once it lands: its answer is the last word from
      // that call site, and only its start order can say it is stale.
      press(screen.getByTestId('community-card-comments-post-a'))
      // The single-post read gives up after 2 s, so the refresh's feed read
      // must land inside that window for the two reads to overlap.
      const feedReadsBefore = feedUrls.length
      act(() => refreshEvents.onRefresh!())
      await waitFor(() => expect(feedUrls.length).toBeGreaterThan(feedReadsBefore), {
        interval: 10,
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      if (newerFirst) releaseOlder()

      // Let every response land, then let any late record reach the cards.
      await act(async () => {
        await olderHeld
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(screen.getByTestId('community-post-card-post-a')).toBeInTheDocument()
      expect(screen.queryByTestId('community-card-shop-post-a')).toBeNull()
      expect(screen.queryByTestId('community-card-partnered-post-a')).toBeNull()
    }
  )

  it('6.7b-MOB-057 a sponsored look revealed through New looks shows Partnered and the CTA', async () => {
    const sync = serveRealSync()
    // The first read shows post-a; the sync's rebuild, a live read, carries a
    // newly published sponsored look that waits in New looks. Its later copies
    // come from `targets/resolve`, which never carries the block.
    serveFeed((_url, index) =>
      feedJson({
        items:
          index === 0
            ? [item({ id: 'post-a' })]
            : [
                item({ id: 'post-new', caption: 'New look', sponsorship: SPONSORSHIP }),
                item({ id: 'post-a' }),
              ],
      })
    )

    await render(<CommunityScreen />)
    const reveal = await screen.findByRole('button', { name: 'Show 1 new looks' })
    await waitFor(() => expect(sync.resolves()).toBeGreaterThan(0))
    expect(screen.queryByTestId('community-post-card-post-new')).toBeNull()

    press(reveal)

    // The revealed card is the resolved copy, with the rebuild's live answer.
    await screen.findByText('Resolved post-new')
    const card = screen.getByTestId('community-post-card-post-new')
    expect(
      within(card).getByTestId('community-card-partnered-post-new').textContent
    ).toBe('Partnered')
    expect(within(card).getByTestId('community-card-shop-post-new').textContent).toBe(
      'Shop this look at Atelier North'
    )
    expect(card.getAttribute('aria-label')).toBe(
      'Look by Style Explorer A1B2. Partnered with Atelier North'
    )
  })
}
