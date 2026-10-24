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
  eventsBody,
  ranked,
  recordAnnouncements,
  resolveBody,
  resolvedTarget,
  sponsoredSpotlightBody,
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
  return http.get(SPOTLIGHT_PATH, () => sponsoredSpotlightBody(items))
}

/**
 * Serves targets/resolve and records whether each request carried the
 * sponsorship opt-in; the resolve route never asks for a block.
 */
function resolveHandler(answer: (keys: string[]) => ReturnType<typeof resolvedTarget>[]) {
  const resolved: string[][] = []
  const optIns: (string | null)[] = []
  const handler = http.post('/api/v1/community/targets/resolve', async ({ request }) => {
    optIns.push(request.headers.get('x-couture-sponsorship'))
    const { targets } = (await request.json()) as { targets: { key: string }[] }
    const keys = targets.map((target) => target.key)
    resolved.push(keys)
    return resolveBody(answer(keys))
  })
  return { handler, resolved, optIns }
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

  it('6.7b-WEB-027 the CTA is its own Tab stop after the card open control, and Enter mints', async () => {
    signIn()
    const clicks = clickHandler(minted)
    useMswHandlers(sponsoredFeedHandler({ items: [sponsoredItem()] }), clicks.handler)
    const user = userEvent.setup()
    renderGrid()

    const cta = await screen.findByTestId('sponsored-cta-post-1')
    act(() => screen.getByTestId('lookbook-open-post-1').focus())
    await user.tab()
    expect(cta).toHaveFocus()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(partner.navigations).toHaveLength(1))
    expect(clicks.bodies).toEqual([
      {
        offerId: SPONSORSHIP.offerId,
        recommendationId: 'post-1',
        surface: 'community_feed',
        platform: 'web',
      },
    ])
    expect(cta).toHaveFocus()
    expect(screen.queryByTestId('community-detail')).not.toBeInTheDocument()
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
    // The resolve route does not opt in, so it carries no block.
    const resolve = resolveHandler(() => [
      resolvedTarget(
        {
          ...item(),
          reactions: {
            ...ZERO,
            counts: { applause: 4, love: 0, inspiration: 0 },
            total: 4,
            revision: 1,
          },
        },
        '1'
      ),
    ])
    useMswHandlers(
      sponsoredFeedHandler({ items: [sponsoredItem({ reactions: ZERO })] }),
      http.get('/api/v1/community/events', () =>
        eventsBody(
          [
            {
              version: 1,
              kind: 'reactions.changed',
              postId: 'post-1',
              communityRevision: '1',
            },
          ],
          'cursor-1'
        )
      ),
      resolve.handler
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
    expect(resolve.optIns.length).toBeGreaterThan(0)
    expect(resolve.optIns.filter((optIn) => optIn !== null)).toEqual([])
  })

  it('6.7b-WEB-022 a live rebuild without the block removes the CTA, and a realtime copy does not bring it back', async () => {
    signIn()
    const catchUp = captureSync()
    const state = { ended: false }
    const resolve = resolveHandler((keys) =>
      keys.map((id) => resolvedTarget({ ...item({ id }), reactions: ZERO }, '1'))
    )
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
        eventsBody(
          state.ended
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
          `cursor-${state.ended ? 'ended' : 'live'}`
        )
      ),
      resolve.handler
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
    expect(resolve.optIns.filter((optIn) => optIn !== null)).toEqual([])
  })

  it.each([
    ['keeps the live block across both resolves', false],
    ['takes a removal read before the reveal', true],
  ])(
    '6.7b-WEB-023 a sponsored look revealed through Show new looks %s',
    async (_label, endsBeforeReveal) => {
      signIn()
      const catchUp = captureSync()
      const state = { published: false, ended: false, cursor: 0, feedReads: 0 }
      // The resolve route does not opt in, so it never carries a block.
      const resolve = resolveHandler((keys) =>
        keys.map((id) => resolvedTarget({ ...item({ id }), reactions: ZERO }, '1'))
      )
      const resolved = resolve.resolved
      useMswHandlers(
        http.get(FEED_PATH, () => {
          state.feedReads += 1
          return HttpResponse.json(
            communitySponsoredFeedResponseSchema.parse({
              data: feed({
                items: state.published
                  ? [
                      state.ended
                        ? { ...item({ id: 'post-new' }), reactions: ZERO }
                        : sponsoredItem({ id: 'post-new', reactions: ZERO }),
                      { ...item(), reactions: ZERO },
                    ]
                  : [{ ...item(), reactions: ZERO }],
              }),
            }) as unknown as Record<string, unknown>
          )
        }),
        http.get('/api/v1/community/events', () =>
          eventsBody(
            state.published
              ? [
                  {
                    version: 1,
                    kind: 'post.published',
                    postId: 'post-new',
                    communityRevision: state.ended ? '2' : '1',
                  },
                  {
                    version: 1,
                    kind: 'reactions.changed',
                    postId: 'post-new',
                    communityRevision: state.ended ? '2' : '1',
                  },
                ]
              : [],
            `cursor-${(state.cursor += 1)}`
          )
        ),
        resolve.handler
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await catchUp()
      state.published = true
      await catchUp()

      // The opted-in rebuild buffered the sponsored look, and target validation
      // resolved the buffered copy without a block.
      const reveal = await screen.findByRole('button', { name: 'Show 1 new looks' })
      await waitFor(() => expect(resolved.flat()).toContain('post-new'))
      if (endsBeforeReveal) {
        // The owner ends the link; the next opted-in rebuild answers no block.
        state.ended = true
        const reads = state.feedReads
        await catchUp()
        await waitFor(() => expect(state.feedReads).toBeGreaterThan(reads))
      }
      const resolvesBeforeReveal = resolved.length
      await user.click(reveal)
      // The reveal resolves the look again before inserting it.
      await waitFor(() => expect(resolved.length).toBeGreaterThan(resolvesBeforeReveal))

      const card = await screen.findByTestId('lookbook-card-post-new')
      expect(resolve.optIns.filter((optIn) => optIn !== null)).toEqual([])
      if (endsBeforeReveal) {
        expect(screen.queryByTestId('sponsored-cta-post-new')).not.toBeInTheDocument()
        expect(screen.queryByTestId('sponsored-badge-post-new')).not.toBeInTheDocument()
        expect(card).toHaveAttribute('aria-labelledby', 'lookbook-card-title-post-new')
        return
      }
      const cta = await screen.findByTestId('sponsored-cta-post-new')
      expect(cta).toHaveAccessibleName(CTA_LABEL)
      expect(
        within(screen.getByTestId('sponsored-badge-post-new')).getByText('Partnered')
      ).toBeVisible()
      expect(card).toHaveAttribute(
        'aria-labelledby',
        'lookbook-card-title-post-new lookbook-card-sponsored-post-new'
      )
      expect(screen.queryByTestId('sponsored-cta-post-1')).not.toBeInTheDocument()
      await waitFor(() =>
        expect(shownEvents().map((event) => event.properties.surface)).toEqual([
          'community_feed',
        ])
      )
    }
  )

  it.each([
    ['the newer read answers no block first, the older read a block later', false],
    ['the newer read answers a block first, the older read no block later', true],
  ])(
    '6.7b-WEB-024 overlapping live reads of one post: %s; the read that started last wins',
    async (_label, newerHasBlock) => {
      signIn()
      let releaseFeed!: () => void
      const feedHeld = new Promise<void>((resolve) => {
        releaseFeed = resolve
      })
      const answered: string[] = []
      useMswHandlers(
        // The older read: the feed starts at mount and is held.
        http.get(FEED_PATH, async () => {
          await feedHeld
          answered.push('feed')
          const post = newerHasBlock
            ? { ...item({ id: 'spot-2' }) }
            : sponsoredItem({ id: 'spot-2' })
          return HttpResponse.json(
            communitySponsoredFeedResponseSchema.parse({
              data: feed({ items: [post] }),
            }) as unknown as Record<string, unknown>
          )
        }),
        // The newer read: View more starts after the feed read and answers at once.
        http.get(SPOTLIGHT_PATH, ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          const items =
            cursor === null
              ? [ranked(1)]
              : [ranked(2, newerHasBlock ? { sponsorship: SPONSORSHIP } : {})]
          if (cursor !== null) answered.push('spotlight')
          return sponsoredSpotlightBody(items, {
            nextCursor: cursor === null ? 'cursor-2' : null,
          })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('community-spotlight-view-more'))
      await screen.findByTestId('spotlight-lookbook-card-spot-2')
      // Only now does the older feed read answer, about the same post.
      releaseFeed()
      await screen.findByTestId('lookbook-card-spot-2')
      expect(answered).toEqual(['spotlight', 'feed'])
      await waitFor(() =>
        expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
          'aria-busy',
          'false'
        )
      )

      for (const scope of ['', 'spotlight-']) {
        const cta = screen.queryByTestId(`${scope}sponsored-cta-spot-2`)
        const badge = screen.queryByTestId(`${scope}sponsored-badge-spot-2`)
        if (newerHasBlock) {
          expect(cta, `${scope || 'feed '}CTA`).toBeInTheDocument()
          expect(badge, `${scope || 'feed '}badge`).toBeInTheDocument()
        } else {
          expect(cta, `${scope || 'feed '}CTA`).not.toBeInTheDocument()
          expect(badge, `${scope || 'feed '}badge`).not.toBeInTheDocument()
        }
      }
    }
  )

  it.each([
    ['an older spotlight block after a newer feed absence', false],
    ['an older spotlight absence after a newer feed block', true],
  ])(
    '6.7b-WEB-025 %s never reaches the screen; every copy shows the newer answer',
    async (_label, newerHasBlock) => {
      signIn()
      let releaseSpotlight!: () => void
      const spotlightHeld = new Promise<void>((resolve) => {
        releaseSpotlight = resolve
      })
      useMswHandlers(
        // The newer read: the "Every climate" feed, started after View more.
        http.get(FEED_PATH, ({ request }) => {
          const all = new URL(request.url).searchParams.get('mode') === 'all'
          const post = newerHasBlock
            ? sponsoredItem({ id: 'spot-2' })
            : { ...item({ id: 'spot-2' }) }
          return HttpResponse.json(
            communitySponsoredFeedResponseSchema.parse({
              data: feed({ items: all ? [post] : [], mode: all ? 'all' : 'auto' }),
            }) as unknown as Record<string, unknown>
          )
        }),
        // The older read: View more starts first and is held until the feed answered.
        http.get(SPOTLIGHT_PATH, async ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          if (cursor !== null) await spotlightHeld
          const items =
            cursor === null
              ? [ranked(1)]
              : [ranked(2, newerHasBlock ? {} : { sponsorship: SPONSORSHIP })]
          return sponsoredSpotlightBody(items, {
            nextCursor: cursor === null ? 'cursor-2' : null,
          })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('community-spotlight-view-more'))
      await user.click(screen.getByTestId('community-filter-all'))
      await screen.findByTestId('lookbook-card-spot-2')

      // From here on, any frame that shows the stale answer is recorded.
      const staleFrames: string[] = []
      const observer = new MutationObserver(() => {
        const badges = document.querySelectorAll(
          '[data-testid$="sponsored-badge-spot-2"]'
        )
        if (
          newerHasBlock
            ? badges.length < 2 &&
              document.querySelector('[data-testid="spotlight-lookbook-card-spot-2"]')
            : badges.length > 0
        )
          staleFrames.push(String(badges.length))
      })
      observer.observe(document.body, { childList: true, subtree: true })
      releaseSpotlight()
      await screen.findByTestId('spotlight-lookbook-card-spot-2')
      await waitFor(() =>
        expect(screen.getByTestId('community-spotlight')).toHaveAttribute(
          'aria-busy',
          'false'
        )
      )
      observer.disconnect()
      expect(staleFrames).toEqual([])

      for (const scope of ['', 'spotlight-']) {
        const cta = screen.queryByTestId(`${scope}sponsored-cta-spot-2`)
        if (newerHasBlock) expect(cta, `${scope || 'feed '}CTA`).toBeInTheDocument()
        else expect(cta, `${scope || 'feed '}CTA`).not.toBeInTheDocument()
      }
    }
  )

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
