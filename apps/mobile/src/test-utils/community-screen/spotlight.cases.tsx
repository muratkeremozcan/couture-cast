/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.6 owner: the mobile City Spotlight module through the real HTTP boundary.
import { item, errorEnvelope } from './harness'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  communityReactionSpotlightResponseSchema,
  type CommunityReactionSpotlight,
  type CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { press } from '@/src/test-utils/press'
import { server } from '@/src/test-utils/msw/server'

const SPOTLIGHT_ROUTE = '*/api/v1/community/spotlight'

function spotlightItem(rank: number): CommunityReactionSpotlightItem {
  return {
    ...item({ id: `spot-${rank}`, caption: `Spotlight caption ${rank}` }),
    rank,
    reactions: {
      counts: { applause: rank, love: 0, inspiration: 0 },
      total: rank,
      viewerReaction: null,
      revision: 0,
      generation: 1,
    },
  }
}

function page(overrides: Partial<CommunityReactionSpotlight> = {}) {
  // Parsed through the contract so a drifted fixture fails loudly.
  return HttpResponse.json(
    communityReactionSpotlightResponseSchema.parse({
      data: {
        level: 'city',
        label: 'Lisbon',
        items: [spotlightItem(1), spotlightItem(2)],
        nextCursor: null,
        ...overrides,
      },
    })
  )
}

function serveSpotlight(respond: (url: URL, request: Request) => Response) {
  const urls: URL[] = []
  const requests: Request[] = []
  server.use(
    http.get(SPOTLIGHT_ROUTE, ({ request }) => {
      const url = new URL(request.url)
      urls.push(url)
      requests.push(request)
      return respond(url, request)
    })
  )
  return { urls, requests }
}

export function registerCommunitySpotlightCases() {
  it('6.6-MOB-001 heads the list with the area heading and ranked reused cards', async () => {
    const { requests } = serveSpotlight(() => page())
    await render(<CommunityScreen />)
    const first = await screen.findByTestId('community-spotlight-item-spot-1')
    const heading = screen.getByTestId('community-spotlight-heading')
    expect(heading.textContent).toBe('Spotlight in Lisbon')
    expect(heading.getAttribute('role')).toBe('heading')
    expect(within(first).getByTestId('community-post-card-spot-1')).toBeVisible()
    expect(screen.getByTestId('community-spotlight-rank-spot-1').textContent).toBe('#1')
    expect(
      screen.getByTestId('community-spotlight-rank-spot-2').getAttribute('aria-label')
    ).toBe('Rank 2')
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()
    // Reaction summaries are negotiated exactly like the feed.
    expect(requests[0]?.headers.get('x-couture-reactions')).toBe('1')
    expect(requests[0]?.headers.get('x-couture-platform')).toBe('mobile')
  })

  it('6.6-MOB-002 renders the empty state for level none without a heading place', async () => {
    serveSpotlight(() => page({ level: 'none', label: null, items: [] }))
    await render(<CommunityScreen />)
    const empty = await screen.findByTestId('community-spotlight-empty')
    expect(empty.textContent).toContain('No spotlight near you yet')
    expect(screen.getByTestId('community-spotlight-heading').textContent).toBe(
      'City Spotlight'
    )
  })

  it('6.6-MOB-003 shows the localized disabled state for the read rollout refusal', async () => {
    serveSpotlight(() =>
      HttpResponse.json(
        { statusCode: 403, code: 'denied', message: COMMUNITY_FEED_DISABLED_MESSAGE },
        { status: 403 }
      )
    )
    await render(<CommunityScreen />)
    const disabled = await screen.findByTestId('community-spotlight-disabled')
    expect(disabled.textContent).toBe('The City Spotlight is temporarily unavailable.')
    expect(screen.queryByTestId('community-spotlight-error')).toBeNull()
  })

  it('6.6-MOB-004 shows an error with a retry that reloads page one', async () => {
    let calls = 0
    serveSpotlight(() => {
      calls += 1
      return calls === 1 ? errorEnvelope(500, 'Internal server error') : page()
    })
    await render(<CommunityScreen />)
    await screen.findByTestId('community-spotlight-error')
    press(screen.getByTestId('community-spotlight-retry'))
    await screen.findByTestId('community-spotlight-item-spot-1')
    expect(calls).toBe(2)
  })

  it('6.6-MOB-005 View more appends the next page, announces once and focuses the first new card', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    const handles = new Map<unknown, number>()
    vi.mocked(findNodeHandle).mockImplementation((node: unknown) => {
      if (!handles.has(node)) handles.set(node, 700 + handles.size)
      return handles.get(node) ?? null
    })
    const { urls } = serveSpotlight((url) =>
      url.searchParams.get('cursor') === 'cursor-2'
        ? page({ items: [spotlightItem(3), spotlightItem(4)], nextCursor: null })
        : page({ nextCursor: 'cursor-2' })
    )
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-spotlight-view-more'))
    const newRank = await screen.findByTestId('community-spotlight-rank-spot-3')
    expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'cursor-2'])
    await waitFor(() => expect(findNodeHandle).toHaveBeenLastCalledWith(newRank))
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
      handles.get(newRank)
    )
    const announcements = vi
      .mocked(AccessibilityInfo.announceForAccessibility)
      .mock.calls.filter(([text]) => text === 'Loaded 2 more spotlight looks.')
    expect(announcements).toHaveLength(1)
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()
  })

  it('6.6-MOB-006 restarts from page one when the server refuses a stale cursor', async () => {
    const { urls } = serveSpotlight((url) =>
      url.searchParams.get('cursor')
        ? HttpResponse.json(
            {
              statusCode: 400,
              code: 'invalid_cursor',
              message: COMMUNITY_CURSOR_INVALID_MESSAGE,
            },
            { status: 400 }
          )
        : page({ nextCursor: 'stale' })
    )
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-spotlight-view-more'))
    await waitFor(() => expect(urls).toHaveLength(3))
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([
      null,
      'stale',
      null,
    ])
    expect(await screen.findByTestId('community-spotlight-item-spot-1')).toBeVisible()
    expect(screen.queryByTestId('community-spotlight-more-error')).toBeNull()
  })

  it('6.6-MOB-007 opening a card records only the spotlight branch and opens the detail', async () => {
    const opened: unknown[] = []
    serveSpotlight(() => page())
    server.use(
      http.post(
        '*/api/v1/community/posts/:postId/opened',
        async ({ request, params }) => {
          opened.push({ postId: params.postId, body: await request.json() })
          return HttpResponse.json({ tracked: true })
        }
      )
    )
    await render(<CommunityScreen />)
    const card = await screen.findByTestId('community-spotlight-item-spot-2')
    press(within(card).getByTestId('community-card-open-spot-2'))
    const title = await screen.findByTestId('community-spotlight-detail-title')
    expect(title.textContent).toBe('City Spotlight')
    expect(screen.getByTestId('community-spotlight-detail-rank').textContent).toBe(
      'Rank 2'
    )
    await waitFor(() =>
      expect(opened).toEqual([
        { postId: 'spot-2', body: { surface: 'spotlight', rank: 2 } },
      ])
    )
    press(screen.getByTestId('community-spotlight-detail-close'))
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail-title')).toBeNull()
    )
    // The detail's own copy of the card cannot record a second open.
    expect(opened).toHaveLength(1)
  })
}
