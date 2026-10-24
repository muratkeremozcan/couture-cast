// Story 6.7b: the sponsored "Shop this look" CTA on feed cards, spotlight cards
// and the detail dialog, through the real web transport and MSW.
import axe from 'axe-core'
import { http, HttpResponse } from 'msw'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
  communitySponsoredFeedResponseSchema,
  communitySponsoredSpotlightResponseSchema,
  type CommunitySponsoredSpotlightItem,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { stubPartnerTab, type PartnerTabStub } from '../../test-utils/partner-tab'
import {
  CLICKS_PATH,
  FEED_PATH,
  OPENED_PATH,
  SPONSORSHIP,
  errorBody,
  feed,
  item,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
  sponsoredFeedHandler,
  sponsoredItem,
} from '../../test-utils/community-lookbook-grid'
import {
  SPOTLIGHT_PATH,
  ZERO,
  captureSync,
  ranked,
  recordAnnouncements,
} from '../../test-utils/community-spotlight'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

const REDIRECT_URL = 'https://partner.example/offer?click=token-1'
const CTA_LABEL = 'Shop this look at Atelier North'
const OPENS_COPY = 'Opens the partner site in a new tab'
const LOADING_COPY = 'Opening partner site'
const ERROR_COPY = 'Unable to open the partner site. Please try again.'

function sponsoredSpotlight(items: CommunitySponsoredSpotlightItem[]) {
  return http.get(SPOTLIGHT_PATH, () =>
    HttpResponse.json(
      communitySponsoredSpotlightResponseSchema.parse({
        data: { level: 'city', label: 'Lisbon', items, nextCursor: null },
      }) as unknown as Record<string, unknown>
    )
  )
}

/** The partner tab stand-in for the running test. */
let partner: PartnerTabStub

/**
 * Records every click body, and how many partner tabs were already claimed when
 * the mint request arrived, then answers with the next scripted response.
 */
function clickHandler(...answers: (() => Response)[]) {
  const bodies: unknown[] = []
  const claimedAtMint: number[] = []
  const handler = http.post(CLICKS_PATH, async ({ request }) => {
    claimedAtMint.push(partner.openSpy.mock.calls.length)
    bodies.push(await request.json())
    const answer = answers[Math.min(bodies.length - 1, answers.length - 1)]
    return answer
      ? answer()
      : HttpResponse.json({ data: { redirectUrl: REDIRECT_URL } }, { status: 201 })
  })
  return { bodies, claimedAtMint, handler }
}

function minted() {
  return HttpResponse.json({ data: { redirectUrl: REDIRECT_URL } }, { status: 201 })
}

function shownEvents() {
  return (window.__capturedAnalyticsEvents ?? []).filter(
    (event) => event.event === 'affiliate_cta_shown'
  )
}

describe('Sponsored community CTA (Story 6.7b)', () => {
  setupCommunityGridSurface()

  beforeEach(() => {
    window.__enableAnalyticsTestHook = true
    window.__capturedAnalyticsEvents = []
    partner = stubPartnerTab()
  })
  afterEach(() => {
    delete window.__enableAnalyticsTestHook
    delete window.__capturedAnalyticsEvents
  })

  it('6.7b-WEB-010 shows Partnered and a separate CTA on an eligible feed card only', async () => {
    signIn()
    useMswHandlers(
      sponsoredFeedHandler({ items: [sponsoredItem(), item({ id: 'post-2' })] })
    )
    renderGrid()

    const cta = await screen.findByTestId('sponsored-cta-post-1')
    const card = screen.getByTestId('lookbook-card-post-1')
    expect(cta).toHaveAccessibleName(CTA_LABEL)
    expect(cta).toHaveAccessibleDescription(OPENS_COPY)
    // The card's own name carries the disclosure and the partner.
    expect(card).toHaveAccessibleName(
      'Look by Style Explorer 4F2A Partnered with Atelier North'
    )
    expect(
      within(screen.getByTestId('sponsored-badge-post-1')).getByText('Partnered')
    ).toBeVisible()
    // Never nested in the card's open action or any other control or link.
    expect(screen.getByTestId('lookbook-open-post-1').contains(cta)).toBe(false)
    expect(cta.parentElement?.closest('button, a, [role="button"]')).toBeNull()
    expect(card.contains(cta)).toBe(true)

    // The unsponsored card is unchanged: no label, no CTA, its own plain name.
    const plain = screen.getByTestId('lookbook-card-post-2')
    expect(plain).toHaveAccessibleName('Look by Style Explorer 4F2A')
    expect(screen.queryByTestId('sponsored-badge-post-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sponsored-cta-post-2')).not.toBeInTheDocument()
    expect(within(plain).queryByText(/Partnered|Shop this look/)).toBeNull()
  })

  it('6.7b-WEB-011 renders no label, no CTA and no shown event without a block', async () => {
    signIn()
    useMswHandlers(
      sponsoredFeedHandler({ items: [item(), item({ id: 'post-2' })] }),
      sponsoredSpotlight([ranked(1, { id: 'post-1' })])
    )
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-post-1')
    await screen.findByTestId('lookbook-card-post-2')
    expect(screen.queryAllByText(/Partnered/)).toEqual([])
    expect(screen.queryAllByRole('button', { name: /Shop this look/ })).toEqual([])
    expect(shownEvents()).toEqual([])
  })

  it('6.7b-WEB-012 claims the tab inside the gesture, mints with the post id and navigates with no opener and no referrer', async () => {
    signIn()
    const clicks = clickHandler(minted)
    useMswHandlers(sponsoredFeedHandler({ items: [sponsoredItem()] }), clicks.handler)
    const user = userEvent.setup()
    renderGrid()

    const cta = await screen.findByTestId('sponsored-cta-post-1')
    await user.click(cta)

    await waitFor(() => expect(partner.navigations).toHaveLength(1))
    // R1: the tab was claimed before the mint request left, inside the press.
    expect(clicks.claimedAtMint).toEqual([1])
    expect(partner.openSpy).toHaveBeenCalledWith('about:blank', '_blank')
    expect(clicks.bodies).toEqual([
      {
        offerId: SPONSORSHIP.offerId,
        recommendationId: 'post-1',
        surface: 'community_feed',
        platform: 'web',
      },
    ])
    // noopener: the claimed tab holds no reference back; noreferrer: the
    // navigation is a `rel="noreferrer"` link activated inside that tab.
    expect(partner.tab.opener).toBeNull()
    expect(partner.navigations).toEqual([{ href: REDIRECT_URL, rel: 'noreferrer' }])
    expect(partner.tab.close).not.toHaveBeenCalled()
    expect(cta).toHaveFocus()
    // A click never opens the look underneath it.
    expect(screen.queryByTestId('community-detail')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByTestId('sponsored-cta-post-1-status')).not.toBeInTheDocument()
    )
  })

  it('6.7b-WEB-013 mints a spotlight card click as community_spotlight', async () => {
    signIn()
    const clicks = clickHandler(minted)
    useMswHandlers(
      sponsoredFeedHandler({ items: [] }),
      sponsoredSpotlight([ranked(1, { sponsorship: SPONSORSHIP })]),
      clicks.handler
    )
    const user = userEvent.setup()
    renderGrid()

    const cta = await screen.findByTestId('spotlight-sponsored-cta-spot-1')
    expect(cta).toHaveAccessibleName(CTA_LABEL)
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toHaveAccessibleName(
      'Look by Explorer 1 Partnered with Atelier North'
    )
    expect(screen.getByTestId('spotlight-lookbook-open-spot-1').contains(cta)).toBe(false)
    await user.click(cta)

    await waitFor(() => expect(clicks.bodies).toHaveLength(1))
    expect(clicks.bodies[0]).toEqual({
      offerId: SPONSORSHIP.offerId,
      recommendationId: 'spot-1',
      surface: 'community_spotlight',
      platform: 'web',
    })
    await waitFor(() => expect(partner.navigations).toHaveLength(1))
    expect(clicks.claimedAtMint).toEqual([1])
  })

  it('6.7b-WEB-014 the detail dialog discloses the partner and mints with the surface it opened from', async () => {
    signIn()
    const clicks = clickHandler(minted)
    useMswHandlers(
      sponsoredFeedHandler({ items: [sponsoredItem({ id: 'spot-1' })] }),
      sponsoredSpotlight([ranked(1, { sponsorship: SPONSORSHIP })]),
      http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true })),
      clicks.handler
    )
    const user = userEvent.setup()
    renderGrid()

    // From the feed.
    await user.click(await screen.findByTestId('lookbook-open-spot-1'))
    let detail = await screen.findByTestId('community-detail')
    expect(
      within(within(detail).getByTestId('community-detail-sponsored-spot-1')).getByText(
        'Partnered with Atelier North'
      )
    ).toHaveClass('sr-only')
    await user.click(within(detail).getByTestId('community-detail-sponsored-cta-spot-1'))
    await waitFor(() => expect(clicks.bodies).toHaveLength(1))
    expect(clicks.bodies[0]).toMatchObject({
      recommendationId: 'spot-1',
      surface: 'community_feed',
    })
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByTestId('community-detail')).not.toBeInTheDocument()
    )

    // From the spotlight.
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-1'))
    detail = await screen.findByTestId('community-detail')
    await user.click(within(detail).getByTestId('community-detail-sponsored-cta-spot-1'))
    await waitFor(() => expect(clicks.bodies).toHaveLength(2))
    expect(clicks.bodies[1]).toMatchObject({
      recommendationId: 'spot-1',
      surface: 'community_spotlight',
    })
  })

  it('6.7b-WEB-015 an ended link (404) shows the error, keeps focus and announces each state once; a retry opens', async () => {
    signIn()
    const clicks = clickHandler(
      () => errorBody(404, COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE, 'Not Found'),
      minted
    )
    useMswHandlers(sponsoredFeedHandler({ items: [sponsoredItem()] }), clicks.handler)
    const user = userEvent.setup()
    renderGrid()

    const cta = await screen.findByTestId('sponsored-cta-post-1')
    const announcements = recordAnnouncements()
    await user.click(cta)

    const status = await screen.findByTestId('sponsored-cta-post-1-status')
    await waitFor(() => expect(status).toHaveAttribute('data-state', 'error'))
    expect(status.textContent).toBe(ERROR_COPY)
    expect(cta).toHaveFocus()
    expect(cta).toHaveAccessibleDescription(`${OPENS_COPY} ${ERROR_COPY}`)
    // The claimed tab is closed and never navigated.
    expect(partner.navigations).toEqual([])
    expect(partner.tab.close).toHaveBeenCalledTimes(1)
    expect(announcements.seen.filter((text) => text === LOADING_COPY)).toHaveLength(1)
    expect(announcements.seen.filter((text) => text === ERROR_COPY)).toHaveLength(1)
    expect(screen.getByTestId('community-live-region').textContent).toBe(ERROR_COPY)
    announcements.stop()

    // The reader retries from where they are.
    await user.keyboard('{Enter}')
    await waitFor(() => expect(partner.navigations).toHaveLength(1))
    expect(partner.openSpy).toHaveBeenCalledTimes(2)
    expect(clicks.bodies).toHaveLength(2)
    expect(cta).toHaveFocus()
  })

  it.each([
    ['a 5xx', () => errorBody(500, 'Internal server error', 'Internal Server Error')],
    ['a network failure', () => HttpResponse.error()],
  ])(
    '6.7b-WEB-016 %s shows the localized error and leaves focus on the CTA',
    async (_label, answer) => {
      signIn()
      const clicks = clickHandler(answer)
      useMswHandlers(sponsoredFeedHandler({ items: [sponsoredItem()] }), clicks.handler)
      const user = userEvent.setup()
      renderGrid()

      const cta = await screen.findByTestId('sponsored-cta-post-1')
      await user.click(cta)

      const status = await screen.findByTestId('sponsored-cta-post-1-status')
      await waitFor(() => expect(status).toHaveAttribute('data-state', 'error'))
      expect(status.textContent).toBe(ERROR_COPY)
      expect(cta).toHaveFocus()
      expect(partner.navigations).toEqual([])
      expect(partner.tab.close).toHaveBeenCalledTimes(1)
    }
  )

  it('6.7b-WEB-017 a blocked tab shows the error once, keeps focus and mints nothing', async () => {
    signIn()
    partner = stubPartnerTab({ blocked: true })
    const clicks = clickHandler(minted)
    useMswHandlers(sponsoredFeedHandler({ items: [sponsoredItem()] }), clicks.handler)
    const user = userEvent.setup()
    renderGrid()

    const cta = await screen.findByTestId('sponsored-cta-post-1')
    const announcements = recordAnnouncements()
    await user.click(cta)

    const status = await screen.findByTestId('sponsored-cta-post-1-status')
    expect(status).toHaveAttribute('data-state', 'error')
    expect(status.textContent).toBe(ERROR_COPY)
    expect(cta).toHaveFocus()
    expect(partner.openSpy).toHaveBeenCalledTimes(1)
    expect(announcements.seen.filter((text) => text === ERROR_COPY)).toHaveLength(1)
    expect(announcements.seen).not.toContain(LOADING_COPY)
    announcements.stop()
    expect(clicks.bodies).toEqual([])
  })

  it('6.7b-WEB-018 ignores a second press while the first mint is in flight', async () => {
    signIn()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const bodies: unknown[] = []
    useMswHandlers(
      sponsoredFeedHandler({ items: [sponsoredItem()] }),
      http.post(CLICKS_PATH, async ({ request }) => {
        bodies.push(await request.json())
        await gate
        return minted()
      })
    )
    const user = userEvent.setup()
    renderGrid()

    const cta = await screen.findByTestId('sponsored-cta-post-1')
    await user.click(cta)
    await waitFor(() => expect(cta).toHaveAttribute('aria-busy', 'true'))
    expect(screen.getByTestId('sponsored-cta-post-1-status').textContent).toBe(
      LOADING_COPY
    )
    await user.click(cta)
    await act(async () => {
      release()
      await gate
    })

    await waitFor(() => expect(partner.navigations).toHaveLength(1))
    expect(partner.openSpy).toHaveBeenCalledTimes(1)
    expect(bodies).toHaveLength(1)
    expect(cta).not.toHaveAttribute('aria-busy')
  })

  it('6.7b-WEB-019 emits one strict shown event per block per visit, keyed by surface', async () => {
    signIn()
    useMswHandlers(
      sponsoredFeedHandler({ items: [sponsoredItem({ id: 'spot-1' })] }),
      sponsoredSpotlight([ranked(1, { sponsorship: SPONSORSHIP })]),
      http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true }))
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('sponsored-cta-spot-1')
    await screen.findByTestId('spotlight-sponsored-cta-spot-1')
    // Opening the detail re-renders both cards and adds the dialog's copy of the
    // feed block, none of which is a new block.
    await user.click(screen.getByTestId('lookbook-open-spot-1'))
    await screen.findByTestId('community-detail-sponsored-cta-spot-1')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByTestId('community-detail')).not.toBeInTheDocument()
    )

    const events = shownEvents()
    expect(events.map((event) => event.properties.surface).sort()).toEqual([
      'community_feed',
      'community_spotlight',
    ])
    for (const event of events) {
      // Exactly the community member: no post, author, caption or user id.
      expect(Object.keys(event.properties).sort()).toEqual([
        'locale_region',
        'offer_id',
        'partner_id',
        'surface',
      ])
      expect(event.properties).toMatchObject({
        partner_id: SPONSORSHIP.partnerId,
        offer_id: SPONSORSHIP.offerId,
        locale_region: 'US',
      })
      expect(JSON.stringify(event.properties)).not.toMatch(
        /spot-1|Explorer|Spotlight look|test-access-token/
      )
    }
  })

  it('6.7b-WEB-021 a realtime refresh of the post keeps the block from the live read', async () => {
    signIn()
    const catchUp = captureSync()
    useMswHandlers(
      sponsoredFeedHandler({ items: [sponsoredItem({ reactions: ZERO })] }),
      http.get('/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events: [
              {
                version: 1,
                kind: 'reactions.changed',
                postId: 'post-1',
                communityRevision: '1',
              },
            ],
            nextCursor: 'cursor-1',
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('/api/v1/community/targets/resolve', () =>
        HttpResponse.json({
          data: {
            targets: [
              {
                key: 'post-1',
                status: 'available',
                communityRevision: '1',
                // The resolve route does not opt in, so it carries no block.
                post: {
                  ...item(),
                  reactions: {
                    ...ZERO,
                    counts: { applause: 4, love: 0, inspiration: 0 },
                    total: 4,
                    revision: 1,
                  },
                },
                comment: null,
                parent: null,
                pageCursor: null,
                parentPageCursor: null,
                threadPosition: null,
              },
            ],
          },
        })
      )
    )
    renderGrid()

    await screen.findByTestId('sponsored-cta-post-1')
    await catchUp()

    // The refreshed summary landed, so the card was rebuilt from the resolve.
    const reactions = screen.getByTestId('community-reactions-post-1')
    await waitFor(() =>
      expect(
        within(reactions)
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label'))
      ).toContain('Applaud, 4')
    )
    expect(screen.getByTestId('lookbook-card-post-1')).toHaveAttribute(
      'aria-labelledby',
      'lookbook-card-title-post-1 lookbook-card-sponsored-post-1'
    )
    expect(screen.getByTestId('sponsored-cta-post-1')).toHaveAccessibleName(CTA_LABEL)
    expect(shownEvents()).toHaveLength(1)
  })

  it('6.7b-WEB-022 a live rebuild without the block removes the CTA, and a realtime copy does not bring it back', async () => {
    signIn()
    const catchUp = captureSync()
    const state = { ended: false }
    const resolvedPost = (id: string) => ({
      key: id,
      status: 'available',
      communityRevision: '1',
      post: { ...item({ id }), reactions: ZERO },
      comment: null,
      parent: null,
      pageCursor: null,
      parentPageCursor: null,
      threadPosition: null,
    })
    useMswHandlers(
      // The owner ends the link between the first read and the rebuild.
      http.get(FEED_PATH, () =>
        HttpResponse.json(
          communitySponsoredFeedResponseSchema.parse({
            data: feed({
              items: state.ended
                ? [
                    { ...item({ id: 'post-new' }), reactions: ZERO },
                    { ...item(), reactions: ZERO },
                  ]
                : [sponsoredItem({ reactions: ZERO })],
            }),
          }) as unknown as Record<string, unknown>
        )
      ),
      http.get('/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events: state.ended
              ? [
                  {
                    version: 1,
                    kind: 'post.published',
                    postId: 'post-new',
                    communityRevision: '1',
                  },
                  {
                    version: 1,
                    kind: 'reactions.changed',
                    postId: 'post-1',
                    communityRevision: '1',
                  },
                ]
              : [],
            nextCursor: `cursor-${state.ended ? 'ended' : 'live'}`,
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as { targets: { key: string }[] }
        return HttpResponse.json({
          data: { targets: targets.map((target) => resolvedPost(target.key)) },
        })
      })
    )
    renderGrid()

    await screen.findByTestId('sponsored-cta-post-1')
    await catchUp()
    state.ended = true
    await catchUp()

    // The rebuild landed: the newly published look is buffered behind its button.
    await screen.findByRole('button', { name: 'Show 1 new looks' })
    const card = screen.getByTestId('lookbook-card-post-1')
    await waitFor(() =>
      expect(screen.queryByTestId('sponsored-cta-post-1')).not.toBeInTheDocument()
    )
    expect(screen.queryByTestId('sponsored-badge-post-1')).not.toBeInTheDocument()
    expect(card).toHaveAttribute('aria-labelledby', 'lookbook-card-title-post-1')
  })

  it('6.7b-WEB-020 has no axe violations with sponsored feed and spotlight cards and an error state', async () => {
    signIn()
    const clicks = clickHandler(() => errorBody(500, 'Internal server error', 'Error'))
    useMswHandlers(
      sponsoredFeedHandler({ items: [sponsoredItem(), item({ id: 'post-2' })] }),
      sponsoredSpotlight([ranked(1, { sponsorship: SPONSORSHIP })]),
      clicks.handler
    )
    const user = userEvent.setup()
    const { container } = renderGrid()

    await screen.findByTestId('spotlight-sponsored-cta-spot-1')
    await user.click(await screen.findByTestId('sponsored-cta-post-1'))
    await waitFor(() =>
      expect(screen.getByTestId('sponsored-cta-post-1-status')).toHaveAttribute(
        'data-state',
        'error'
      )
    )

    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })
    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2)
    ).toEqual([])
  })
})
