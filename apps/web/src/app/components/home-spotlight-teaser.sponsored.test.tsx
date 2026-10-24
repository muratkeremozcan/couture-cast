// Story 6.7b: the sponsored CTA on the web Home spotlight teaser, inside the real
// Lookbook Prism layout and through the real web transport and MSW.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
  communitySponsoredSpotlightResponseSchema,
  type CommunitySponsoredSpotlightItem,
} from '@couture/api-client/contracts/http'
import { CommunitySyncState } from '@couture/api-client'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { CLICKS_PATH, SPONSORSHIP } from '../../test-utils/community-lookbook-grid'
import { LookbookPrismLayout } from './lookbook-prism-layout'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

const SPOTLIGHT_PATH = '/api/v1/community/spotlight'
const OPENED_PATH = '/api/v1/community/posts/:postId/opened'
const REDIRECT_URL = 'https://partner.example/offer?click=teaser-1'
const LINK_NAME = 'Standout look in Lisbon by Ana, 3 reactions. Opens the City Spotlight.'
const LOADING_COPY = 'Opening partner site'
const ERROR_COPY = 'Unable to open the partner site. Please try again.'

function spotlightItem(
  overrides: Partial<CommunitySponsoredSpotlightItem> = {}
): CommunitySponsoredSpotlightItem {
  return {
    id: 'look-1',
    caption: 'Private caption that the teaser never shows.',
    altText: 'A camel coat over a grey knit.',
    climateBand: 'temperate_wet',
    imageAccess: {
      url: 'https://storage.local/community/look-1.jpg',
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    publishedAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T08:59:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Ana', isSelf: false },
    rank: 1,
    reactions: {
      counts: { applause: 2, love: 1, inspiration: 0 },
      total: 3,
      viewerReaction: null,
      revision: 1,
      generation: 1,
    },
    ...overrides,
  }
}

/** Serves the teaser and the module the same opted-in page, recording each read. */
function useSpotlight(item: CommunitySponsoredSpotlightItem) {
  const reads: { surface: string | null; sponsorship: string | null }[] = []
  useMswHandlers(
    http.get(SPOTLIGHT_PATH, ({ request }) => {
      reads.push({
        surface: new URL(request.url).searchParams.get('surface'),
        sponsorship: request.headers.get('x-couture-sponsorship'),
      })
      return HttpResponse.json(
        communitySponsoredSpotlightResponseSchema.parse({
          data: { level: 'city', label: 'Lisbon', items: [item], nextCursor: null },
        }) as unknown as Record<string, unknown>
      )
    })
  )
  return reads
}

function useClicks(answer: () => Response) {
  const bodies: unknown[] = []
  const opens: string[] = []
  useMswHandlers(
    http.post(CLICKS_PATH, async ({ request }) => {
      bodies.push(await request.json())
      return answer()
    }),
    http.post(OPENED_PATH, ({ params }) => {
      opens.push(String(params.postId))
      return HttpResponse.json({ tracked: true })
    })
  )
  return { bodies, opens }
}

function minted() {
  return HttpResponse.json({ data: { redirectUrl: REDIRECT_URL } }, { status: 201 })
}

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
  window.dispatchEvent(new Event('couture:session'))
}

function shownEvents() {
  return (window.__capturedAnalyticsEvents ?? []).filter(
    (event) => event.event === 'affiliate_cta_shown'
  )
}

describe('6.7b web Home teaser sponsored CTA', () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  )
  let openSpy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
    window.sessionStorage.clear()
    // Below the 1280px split, so the layout stacks and the teaser reads.
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    window.__enableAnalyticsTestHook = true
    window.__capturedAnalyticsEvents = []
    // A real browser returns null for a tab opened with `noopener`.
    openSpy = vi.fn(() => null)
    vi.stubGlobal('open', openSpy)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.__enableAnalyticsTestHook
    delete window.__capturedAnalyticsEvents
    window.sessionStorage.clear()
    if (scrollIntoView)
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  it('6.7b-WEB-030 discloses the partner and renders the CTA beside the link, never inside it', async () => {
    signIn()
    const reads = useSpotlight(spotlightItem({ sponsorship: SPONSORSHIP }))
    render(<LookbookPrismLayout />)

    const cta = await screen.findByTestId('home-spotlight-teaser-sponsored-cta-look-1')
    const link = screen.getByTestId('home-spotlight-teaser-link')
    const root = screen.getByTestId('home-spotlight-teaser')
    expect(link).toHaveAccessibleName(`${LINK_NAME} Partnered with Atelier North`)
    expect(within(link).getByTestId('home-spotlight-teaser-sponsored').textContent).toBe(
      'Partnered'
    )
    expect(cta).toHaveAccessibleName('Shop this look at Atelier North')
    expect(cta).toHaveAccessibleDescription('Opens the partner site in a new tab')
    expect(link.contains(cta)).toBe(false)
    expect(root.contains(cta)).toBe(true)
    expect(cta.closest('a')).toBeNull()
    expect(link.querySelectorAll('a, button, [tabindex]')).toHaveLength(0)
    expect(reads.find((read) => read.surface === 'home_teaser')).toEqual({
      surface: 'home_teaser',
      sponsorship: '1',
    })
  })

  it('6.7b-WEB-031 an unsponsored teaser has no label and no CTA', async () => {
    signIn()
    useSpotlight(spotlightItem())
    render(<LookbookPrismLayout />)

    const link = await screen.findByTestId('home-spotlight-teaser-link')
    await screen.findByTestId('spotlight-lookbook-card-look-1')
    expect(link).toHaveAccessibleName(LINK_NAME)
    expect(screen.queryByTestId('home-spotlight-teaser-sponsored')).toBeNull()
    expect(screen.queryAllByRole('button', { name: /Shop this look/ })).toEqual([])
    expect(screen.getByTestId('home-spotlight-teaser').childElementCount).toBe(1)
    expect(shownEvents()).toEqual([])
  })

  it('6.7b-WEB-032 activation mints a home_teaser click, opens the partner and leaves the link alone', async () => {
    signIn()
    useSpotlight(spotlightItem({ sponsorship: SPONSORSHIP }))
    const clicks = useClicks(minted)
    const user = userEvent.setup()
    render(<LookbookPrismLayout />)

    const cta = await screen.findByTestId('home-spotlight-teaser-sponsored-cta-look-1')
    await user.click(cta)

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1))
    expect(clicks.bodies).toEqual([
      {
        offerId: SPONSORSHIP.offerId,
        recommendationId: 'look-1',
        surface: 'home_teaser',
        platform: 'web',
      },
    ])
    expect(openSpy).toHaveBeenCalledWith(REDIRECT_URL, '_blank', 'noopener,noreferrer')
    expect(cta).toHaveFocus()
    await waitFor(() => expect(cta).not.toHaveAttribute('aria-busy'))
    expect(
      screen.queryByTestId('home-spotlight-teaser-sponsored-cta-look-1-status')
    ).not.toBeInTheDocument()
    // The CTA is not the teaser's open action: no spotlight open is recorded.
    expect(clicks.opens).toEqual([])
  })

  it('6.7b-WEB-033 an ended link (404) shows the error once, keeps focus and lets the reader retry', async () => {
    signIn()
    useSpotlight(spotlightItem({ sponsorship: SPONSORSHIP }))
    let calls = 0
    const clicks = useClicks(() =>
      calls++ === 0
        ? HttpResponse.json(
            {
              statusCode: 404,
              message: COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
              error: 'Not Found',
            },
            { status: 404 }
          )
        : minted()
    )
    const user = userEvent.setup()
    render(<LookbookPrismLayout />)

    const cta = await screen.findByTestId('home-spotlight-teaser-sponsored-cta-look-1')
    const live = screen.getByTestId('home-spotlight-teaser-cta-live')
    const seen: string[] = []
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node.textContent) seen.push(node.textContent)
    })
    observer.observe(live, { childList: true, subtree: true })
    await user.click(cta)

    const status = await screen.findByTestId(
      'home-spotlight-teaser-sponsored-cta-look-1-status'
    )
    await waitFor(() => expect(status).toHaveAttribute('data-state', 'error'))
    expect(status.textContent).toBe(ERROR_COPY)
    expect(cta).toHaveFocus()
    expect(openSpy).not.toHaveBeenCalled()
    expect(seen).toEqual([LOADING_COPY, ERROR_COPY])
    observer.disconnect()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1))
    expect(clicks.bodies).toHaveLength(2)
  })

  it('6.7b-WEB-034 reports the teaser block once with the strict community payload', async () => {
    signIn()
    useSpotlight(spotlightItem({ sponsorship: SPONSORSHIP }))
    render(<LookbookPrismLayout />)

    await screen.findByTestId('home-spotlight-teaser-sponsored-cta-look-1')
    await screen.findByTestId('spotlight-sponsored-cta-look-1')

    const events = shownEvents()
    // The teaser and the spotlight module are two blocks on two surfaces.
    expect(events.map((event) => event.properties)).toEqual(
      expect.arrayContaining([
        {
          partner_id: SPONSORSHIP.partnerId,
          offer_id: SPONSORSHIP.offerId,
          surface: 'home_teaser',
          locale_region: 'US',
        },
        {
          partner_id: SPONSORSHIP.partnerId,
          offer_id: SPONSORSHIP.offerId,
          surface: 'community_spotlight',
          locale_region: 'US',
        },
      ])
    )
    expect(events).toHaveLength(2)
  })
})
