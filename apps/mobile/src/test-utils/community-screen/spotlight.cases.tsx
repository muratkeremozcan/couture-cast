// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-72-calm-community-with-an-empty-state
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.6 owner: the mobile City Spotlight module through the real HTTP boundary.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-030..032 on the Community screen: the post detail layer
// (D12) closes by its top bar back, system back or a header swipe, and focus returns to its card.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import {
  communityGateOpen,
  item,
  errorEnvelope,
  feedJson,
  imageEvents,
  serveFeed,
} from './harness'
import { refreshEvents } from './mock-state'
import { CommunitySyncState } from '@couture/api-client'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { dragFrom } from '@/src/test-utils/layer-swipe'
import { LAYER_SWIPE_CLOSE_PX } from '@/components/edge-to-edge-modal'
import { expect, it, vi } from 'vitest'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
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
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { SaveFeedbackProvider } from '@/components/save-feedback'
import enUS from '@/assets/locales/en-US.json'

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

const ZERO = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  viewerReaction: null,
  revision: 0,
  generation: 0,
}

/** A ranked look with its own id, for cases that need more than `spot-<rank>`. */
function rankedLook(
  id: string,
  rank: number,
  overrides: Partial<CommunityReactionSpotlightItem> = {}
): CommunityReactionSpotlightItem {
  return { ...spotlightItem(rank), ...item({ id }), reactions: ZERO, rank, ...overrides }
}

/** iOS focus plumbing: every node handed to findNodeHandle gets a stable handle. */
function iosFocusHandles() {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
  const handles = new Map<unknown, number>()
  vi.mocked(findNodeHandle).mockImplementation((node: unknown) => {
    if (!handles.has(node)) handles.set(node, 700 + handles.size)
    return handles.get(node) ?? null
  })
  return handles
}

function announcementsOf(text: string) {
  return vi
    .mocked(AccessibilityInfo.announceForAccessibility)
    .mock.calls.filter(([announced]) => announced === text)
}

/** Captures the realtime coordinator the screen starts, so a case can run a catch-up. */
function captureCatchUp() {
  let catchUp: (() => Promise<void>) | undefined
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    catchUp = () => this.catchUp()
  })
  return async () => {
    await waitFor(() => expect(catchUp).toBeTypeOf('function'))
    await act(async () => {
      await catchUp!()
    })
  }
}

export function registerCommunitySpotlightCases() {
  it('6.6-MOB-001 keeps the ranked feed in the server order and negotiates reactions', async () => {
    const { requests } = serveSpotlight(() => page())
    await render(<CommunityScreen />)
    const first = await screen.findByTestId('community-spotlight-item-spot-1')
    const second = screen.getByTestId('community-spotlight-item-spot-2')
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(within(first).getByTestId('community-card-near-you-spot-1')).toHaveTextContent(
      'Near you'
    )
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()
    expect(requests[0]?.headers.get('x-couture-reactions')).toBe('1')
    expect(requests[0]?.headers.get('x-couture-platform')).toBe('mobile')
  })

  it('6.6-MOB-002 leaves the ordinary feed available without an eligible area', async () => {
    serveSpotlight(() => page({ level: 'none', label: null, items: [] }))
    await render(<CommunityScreen />)
    await communityGateOpen()
    expect(screen.getByTestId('community-post-card-post-a')).toBeVisible()
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()
    expect(screen.queryAllByTestId(/^community-spotlight-item-/)).toHaveLength(0)
  })

  it('6.6-MOB-003 hides ranked rows on the Spotlight rollout refusal', async () => {
    serveSpotlight(() =>
      HttpResponse.json(
        { statusCode: 403, code: 'denied', message: COMMUNITY_FEED_DISABLED_MESSAGE },
        { status: 403 }
      )
    )
    await render(<CommunityScreen />)
    await communityGateOpen()
    expect(screen.getByTestId('community-post-card-post-a')).toBeVisible()
    expect(screen.queryAllByTestId(/^community-spotlight-item-/)).toHaveLength(0)
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
    const viewMore = await screen.findByTestId('community-spotlight-view-more')
    const list = screen.getByTestId('community-feed-list')
    expect(list).toContainElement(viewMore)
    press(viewMore)
    const newRank = await screen.findByTestId('community-card-title-spot-3')
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
    )
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
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
    )
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
    // Story CC-7.11 D12: the layer's title is its top bar's; an untitled look reads the
    // Spotlight label.
    const detail = await screen.findByTestId('community-spotlight-detail')
    expect(within(detail).getByTestId('app-top-bar-title').textContent).toBe(
      'City Spotlight'
    )
    expect(screen.getByTestId('community-spotlight-detail-rank').textContent).toBe(
      'Rank 2'
    )
    await waitFor(() =>
      expect(opened).toEqual([
        // Story 6.6 R3: the open carries the level the page was served at.
        { postId: 'spot-2', body: { surface: 'spotlight', rank: 2, level: 'city' } },
      ])
    )
    press(within(detail).getByTestId('app-top-bar-back'))
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()
    )
    // The detail's own copy of the card cannot record a second open.
    expect(opened).toHaveLength(1)
  })

  // --- Story 6.6 code review round 1 remedies (TEA) ---------------------------

  it('6.6-MOB-030 loads page one when a member signs in on a mounted screen (R8)', async () => {
    let token: string | undefined = undefined
    const restore = setMobileAccessTokenResolver(() => token)
    try {
      const { requests } = serveSpotlight((_url, request) =>
        request.headers.get('authorization')
          ? page({ items: [rankedLook('member-1', 1)] })
          : errorEnvelope(401, 'Unauthorized')
      )
      await render(<CommunityScreen />)
      // Signed out on a mounted screen: the module idles and reads nothing.
      await screen.findByTestId('community-feed-error')
      await waitFor(() => expect(screen.queryByTestId('community-spotlight')).toBeNull())
      expect(requests).toHaveLength(0)
      token = 'session-token'
      expect(
        await screen.findByTestId('community-spotlight-item-member-1', undefined, {
          timeout: 4000,
        })
      ).toBeVisible()
      expect(screen.queryByTestId('community-spotlight-error')).toBeNull()
      // The sign-in made the first and only spotlight read, and it carried the session.
      expect(requests.map((request) => request.headers.get('authorization'))).toEqual([
        'Bearer session-token',
      ])
    } finally {
      restore()
    }
  })

  it('6.6-MOB-031 a member change through sign-out reloads page one for the new member only (R8)', async () => {
    let token: string | undefined = 'session-token'
    const restore = setMobileAccessTokenResolver(() => token)
    try {
      const { requests } = serveSpotlight((_url, request) => {
        const authorization = request.headers.get('authorization')
        if (!authorization) return errorEnvelope(401, 'Unauthorized')
        return page({
          items: [
            rankedLook(authorization.endsWith('next-session-token') ? 'b-1' : 'a-1', 1),
          ],
        })
      })
      await render(<CommunityScreen />)
      await screen.findByTestId('community-spotlight-item-a-1')

      token = undefined
      await waitFor(
        () => expect(screen.queryByTestId('community-spotlight-item-a-1')).toBeNull(),
        {
          timeout: 4000,
        }
      )
      token = 'next-session-token'
      expect(
        await screen.findByTestId('community-spotlight-item-b-1', undefined, {
          timeout: 4000,
        })
      ).toBeVisible()
      expect(screen.queryByTestId('community-spotlight-error')).toBeNull()
      // Nothing reads the spotlight without a member.
      expect(requests.every((request) => request.headers.get('authorization'))).toBe(true)
      expect(requests.at(-1)?.headers.get('authorization')).toBe(
        'Bearer next-session-token'
      )
    } finally {
      restore()
    }
  })

  it('6.6-MOB-032 a realtime unavailable target evicts the spotlight copy and closes its open detail (R9)', async () => {
    const catchUp = captureCatchUp()
    let phase: 'ready' | 'removed' = 'ready'
    serveFeed(() =>
      feedJson({
        items: phase === 'removed' ? [] : [item({ id: 'spot-1', reactions: ZERO })],
      })
    )
    let spotlightReads = 0
    serveSpotlight(() => {
      spotlightReads += 1
      return page({ items: [rankedLook('spot-1', 1), rankedLook('spot-2', 2)] })
    })
    server.use(
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events:
              phase === 'removed'
                ? [
                    {
                      version: 1,
                      kind: 'reactions.changed',
                      postId: 'spot-1',
                      communityRevision: '1',
                    },
                  ]
                : [],
            nextCursor: `cursor-${phase}`,
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as {
          targets: { key: string; postId: string }[]
        }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) =>
              phase === 'removed' && target.postId === 'spot-1'
                ? { key: target.key, status: 'unavailable' }
                : {
                    key: target.key,
                    status: 'available',
                    communityRevision: '0',
                    post: item({ id: target.postId, reactions: ZERO }),
                    comment: null,
                    parent: null,
                    pageCursor: null,
                    parentPageCursor: null,
                    threadPosition: null,
                  }
            ),
          },
        })
      })
    )
    await render(<CommunityScreen />)
    const card = await screen.findByTestId('community-spotlight-item-spot-1')
    await catchUp()
    press(within(card).getByTestId('community-card-open-spot-1'))
    await screen.findByTestId('community-spotlight-detail')

    phase = 'removed'
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-item-spot-1')).toBeNull()
    )
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()
    )
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-spot-2')).toBeVisible()
    )
    // Evicted in place: no spotlight re-read stood in for the realtime removal.
    expect(spotlightReads).toBe(1)
  })

  it('6.6-MOB-033 withdrawing an own look from its open spotlight detail closes the detail and evicts it (R9)', async () => {
    let withdrawn: string | null = null
    serveFeed(() => feedJson({ items: [] }))
    serveSpotlight(() =>
      page({
        items: [
          rankedLook('spot-1', 1),
          rankedLook('spot-self', 2, { author: { displayName: 'You', isSelf: true } }),
        ],
      })
    )
    server.use(
      http.post('*/api/v1/community/posts/:postId/withdraw', ({ params }) => {
        withdrawn = params.postId as string
        return HttpResponse.json({ tracked: true })
      })
    )
    await render(<CommunityScreen />)
    const card = await screen.findByTestId('community-spotlight-item-spot-self')
    press(within(card).getByTestId('community-card-open-spot-self'))
    const detail = await screen.findByTestId('community-spotlight-detail')
    press(within(detail).getByTestId('community-card-withdraw-spot-self'))

    await waitFor(() => expect(withdrawn).toBe('spot-self'))
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()
    )
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-item-spot-self')).toBeNull()
    )
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
    )
  })

  it('6.6-MOB-034 an expired spotlight image re-reads only that post and keeps every loaded page (R9)', async () => {
    const REFRESHED = 'https://storage.test/refreshed-spot-1.png'
    serveFeed(() => feedJson({ items: [] }))
    const postReads: string[] = []
    const { urls } = serveSpotlight((url) =>
      url.searchParams.get('cursor') === 'cursor-2'
        ? page({ items: [rankedLook('spot-3', 3)], nextCursor: null })
        : page({
            items: [rankedLook('spot-1', 1), rankedLook('spot-2', 2)],
            nextCursor: 'cursor-2',
          })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', ({ params }) => {
        postReads.push(params.postId as string)
        return HttpResponse.json({
          data: {
            ...item({ id: params.postId as string }),
            imageAccess: { url: REFRESHED, expiresAt: '2030-01-01T00:00:00.000Z' },
            reactions: ZERO,
          },
        })
      })
    )
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-spotlight-view-more'))
    await screen.findByTestId('community-spotlight-item-spot-3')
    await waitFor(() =>
      expect(imageEvents.errors.get('community-card-image-spot-1')).toBeTypeOf('function')
    )
    act(() => {
      imageEvents.errors.get('community-card-image-spot-1')!()
    })
    await waitFor(() =>
      expect(
        screen
          .getByTestId('community-spotlight-item-spot-1')
          .querySelector(`img[src="${REFRESHED}"]`)
      ).not.toBeNull()
    )
    expect(postReads).toEqual(['spot-1'])
    // No page-one reload stood in for the single-post read: page two and the rank stay.
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'cursor-2'])
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-spot-3')).toBeVisible()
    )
    expect(screen.getByTestId('community-card-near-you-spot-1')).toHaveTextContent(
      'Near you'
    )
  })

  it('6.6-MOB-076 a reaction 404 on a spotlight card evicts that copy in place', async () => {
    serveFeed(() => feedJson({ items: [] }))
    const { urls } = serveSpotlight(() =>
      page({ items: [rankedLook('spot-1', 1), rankedLook('spot-2', 2)] })
    )
    const reacted: string[] = []
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', ({ params }) => {
        reacted.push(params.postId as string)
        return errorEnvelope(404, 'Community post not found.')
      })
    )
    await render(<CommunityScreen />)
    const card = await screen.findByTestId('community-spotlight-item-spot-1')
    press(within(card).getByRole('button', { name: 'Applaud, 0' }))

    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-item-spot-1')).toBeNull()
    )
    expect(reacted).toEqual(['spot-1'])
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-spot-2')).toBeVisible()
    )
    expect(urls).toHaveLength(1)
  })

  it('6.6-MOB-079 pull to refresh re-reads spotlight page one with the feed', async () => {
    let reads = 0
    serveSpotlight(() => {
      reads += 1
      return page({ items: [rankedLook(reads === 1 ? 'before-1' : 'after-1', 1)] })
    })
    await render(<CommunityScreen />)
    await screen.findByTestId('community-spotlight-item-before-1')
    await waitFor(() => expect(refreshEvents.onRefresh).toBeTypeOf('function'))
    act(() => refreshEvents.onRefresh!())

    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-after-1')).toBeVisible()
    )
    expect(screen.queryByTestId('community-spotlight-item-before-1')).toBeNull()
    expect(reads).toBe(2)
  })

  // Story CC-7.7 D4 (review P2-7): a failed refresh keeps the shown row, inserts nothing
  // above the feed, and offers Retry in the root status bar's floating slot.
  it('7.7-NAT-004 a failed Spotlight refresh keeps the row and reports in the status bar with Retry', async () => {
    let reads = 0
    serveSpotlight(() => {
      reads += 1
      if (reads === 2) return errorEnvelope(500, 'Internal server error')
      return page({ items: [rankedLook(reads === 1 ? 'before-1' : 'after-1', 1)] })
    })
    await render(
      <SaveFeedbackProvider>
        <CommunityScreen />
      </SaveFeedbackProvider>
    )
    const shown = await screen.findByTestId('community-spotlight-item-before-1')
    await waitFor(() => expect(shown).toBeVisible())
    await waitFor(() => expect(refreshEvents.onRefresh).toBeTypeOf('function'))
    act(() => refreshEvents.onRefresh!())

    const bar = await screen.findByTestId('status-feedback-bar')
    expect(bar).toHaveTextContent(enUS.community.spotlight.error)
    expect(reads).toBe(2)
    // The row kept its card and grew no inline error above the feed.
    expect(screen.getByTestId('community-spotlight-item-before-1')).toBe(shown)
    expect(shown).toBeVisible()
    expect(screen.queryByTestId('community-spotlight-retry')).toBeNull()

    press(screen.getByTestId('status-bar-action-retry'))

    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-after-1')).toBeVisible()
    )
    expect(reads).toBe(3)
  })

  it('6.6-MOB-080 pull to refresh while signed out reads no spotlight', async () => {
    const restore = setMobileAccessTokenResolver(() => undefined)
    try {
      const { requests } = serveSpotlight(() => page())
      let feedReads = 0
      serveFeed(() => {
        feedReads += 1
        return feedJson({ items: [] })
      })
      await render(<CommunityScreen />)
      await screen.findByTestId('community-feed-error')
      await waitFor(() => expect(refreshEvents.onRefresh).toBeTypeOf('function'))
      act(() => refreshEvents.onRefresh!())
      // Barrier: the refresh settles back to the signed-out feed state.
      await screen.findByTestId('community-feed-error')
      await act(async () => {
        await Promise.resolve()
      })
      expect(requests).toHaveLength(0)
      expect(feedReads).toBe(0)
      expect(screen.queryByTestId('community-spotlight')).toBeNull()
    } finally {
      restore()
    }
  })

  it('6.6-MOB-081 reporting from the spotlight detail waits for its dismissal and returns focus to the rank', async () => {
    const handles = iosFocusHandles()
    serveFeed(() => feedJson({ items: [] }))
    serveSpotlight(() => page())
    server.use(
      http.post('*/api/v1/community/posts/:postId/opened', () =>
        HttpResponse.json({ tracked: true })
      )
    )
    await render(<CommunityScreen />)
    const card = await screen.findByTestId('community-spotlight-item-spot-2')
    press(within(card).getByTestId('community-card-open-spot-2'))
    const detail = await screen.findByTestId('community-spotlight-detail')
    press(within(detail).getByTestId('community-card-report-spot-2'))

    // iOS presents one modal at a time: the report opens once the detail has left.
    await screen.findByTestId('community-report-modal')
    expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()

    press(screen.getByTestId('cancel-report-button'))
    const rank = screen.getByTestId('community-card-title-spot-2')
    await waitFor(() => {
      expect(handles.get(rank)).toBeTypeOf('number')
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(rank)
      )
    })
  })

  it('6.6-MOB-078 an age-gate refusal shows the disabled state, never the error', async () => {
    serveSpotlight(() =>
      HttpResponse.json(
        { statusCode: 403, code: 'denied', message: COMMUNITY_AGE_GATE_DENIED_MESSAGE },
        { status: 403 }
      )
    )
    await render(<CommunityScreen />)
    await communityGateOpen()
    expect(screen.getByTestId('community-post-card-post-a')).toBeVisible()
    expect(screen.queryAllByTestId(/^community-spotlight-item-/)).toHaveLength(0)
    expect(screen.queryByTestId('community-spotlight-error')).toBeNull()
    expect(screen.queryByTestId('community-spotlight-retry')).toBeNull()
  })

  it('6.6-MOB-035 a cursor-invalid restart focuses the first card and announces the refresh once (R11)', async () => {
    const handles = iosFocusHandles()
    let reads = 0
    serveSpotlight((url) => {
      reads += 1
      if (url.searchParams.get('cursor'))
        return HttpResponse.json(
          {
            statusCode: 400,
            code: 'invalid_cursor',
            message: COMMUNITY_CURSOR_INVALID_MESSAGE,
          },
          { status: 400 }
        )
      return page({
        items: [rankedLook(reads === 1 ? 'old-1' : 'new-1', 1)],
        nextCursor: reads === 1 ? 'stale' : null,
      })
    })
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-spotlight-view-more'))

    const rank = await screen.findByTestId('community-card-title-new-1')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(rank)
      )
    )
    const refreshed = 'The City Spotlight was refreshed with the latest ranking.'
    await waitFor(() => expect(announcementsOf(refreshed)).toHaveLength(1))
    expect(
      vi
        .mocked(AccessibilityInfo.announceForAccessibility)
        .mock.calls.filter(([text]) => /^Loaded/.test(String(text)))
    ).toEqual([])
  })

  it('6.6-MOB-036 a View more page that adds nothing announces nothing and keeps View more while a cursor remains (R11)', async () => {
    const urls = serveSpotlight((url) => {
      const cursor = url.searchParams.get('cursor')
      if (cursor === null) return page({ nextCursor: 'cursor-2' })
      if (cursor === 'cursor-2') return page({ items: [], nextCursor: 'cursor-3' })
      return page({ items: [rankedLook('spot-9', 9)], nextCursor: null })
    }).urls
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-spotlight-view-more'))
    await waitFor(() =>
      expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([
        null,
        'cursor-2',
      ])
    )
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-loading-more')).toBeNull()
    )
    expect(
      vi
        .mocked(AccessibilityInfo.announceForAccessibility)
        .mock.calls.filter(([text]) => /^Loaded/.test(String(text)))
    ).toEqual([])

    press(await screen.findByTestId('community-spotlight-view-more'))
    await screen.findByTestId('community-spotlight-item-spot-9')
    await waitFor(() =>
      expect(announcementsOf('Loaded 1 more spotlight look.')).toHaveLength(1)
    )
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([
      null,
      'cursor-2',
      'cursor-3',
    ])
  })

  it('6.6-MOB-037 counts and focus use only newly appended looks when a page repeats one (R11)', async () => {
    const handles = iosFocusHandles()
    serveSpotlight((url) =>
      url.searchParams.get('cursor')
        ? page({ items: [spotlightItem(2), spotlightItem(3)], nextCursor: null })
        : page({ nextCursor: 'cursor-2' })
    )
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-spotlight-view-more'))

    const third = await screen.findByTestId('community-card-title-spot-3')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(third)
      )
    )
    await waitFor(() =>
      expect(announcementsOf('Loaded 1 more spotlight look.')).toHaveLength(1)
    )
    expect(announcementsOf('Loaded 2 more spotlight looks.')).toHaveLength(0)
    expect(screen.getAllByTestId('community-spotlight-item-spot-2')).toHaveLength(1)
  })

  it('6.6-MOB-038 an empty first page with a next cursor keeps View more and never shows the empty state (R12)', async () => {
    serveSpotlight((url) =>
      url.searchParams.get('cursor')
        ? page({ items: [rankedLook('spot-7', 7)], nextCursor: null })
        : page({ items: [], nextCursor: 'cursor-2' })
    )
    await render(<CommunityScreen />)
    const viewMore = await screen.findByTestId('community-spotlight-view-more')
    expect(screen.queryByTestId('community-spotlight-empty')).toBeNull()
    press(viewMore)
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-spot-7')).toBeVisible()
    )
    expect(screen.queryByTestId('community-spotlight-empty')).toBeNull()
  })

  it('6.6-MOB-039 closing the spotlight detail returns focus to the card it was opened from (R20)', async () => {
    const handles = iosFocusHandles()
    serveSpotlight(() => page())
    server.use(
      http.post('*/api/v1/community/posts/:postId/opened', () =>
        HttpResponse.json({ tracked: true })
      )
    )
    await render(<CommunityScreen />)
    const card = await screen.findByTestId('community-spotlight-item-spot-2')
    press(within(card).getByTestId('community-card-open-spot-2'))
    await screen.findByTestId('community-spotlight-detail')
    press(
      within(screen.getByTestId('community-spotlight-detail')).getByTestId(
        'app-top-bar-back'
      )
    )
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()
    )
    const rank = screen.getByTestId('community-card-title-spot-2')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(rank)
      )
    )
  })

  // Story CC-7.11 D13: every way out of the post detail layer hands focus back to the card's rank,
  // as the top bar back above does.
  it.each([
    [
      '7.11-NAT-030',
      'system back',
      (): void | Promise<void> => {
        // react-native-web calls the Modal's onRequestClose on Escape, as Android does on back.
        fireEvent.keyUp(document.body, { key: 'Escape' })
      },
    ],
    [
      '7.11-NAT-032',
      'a swipe down on its top bar',
      async (detail: HTMLElement) => {
        await dragFrom(within(detail).getByTestId('app-top-bar-title'), {
          dy: LAYER_SWIPE_CLOSE_PX + 40,
        })
      },
    ],
  ] as const)(
    '[%s] %s closes the spotlight detail and returns focus to the card it was opened from',
    async (_id, _way, close) => {
      const handles = iosFocusHandles()
      serveSpotlight(() => page())
      server.use(
        http.post('*/api/v1/community/posts/:postId/opened', () =>
          HttpResponse.json({ tracked: true })
        )
      )
      await render(<CommunityScreen />)
      const card = await screen.findByTestId('community-spotlight-item-spot-2')
      press(within(card).getByTestId('community-card-open-spot-2'))
      const detail = await screen.findByTestId('community-spotlight-detail')
      vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()

      await close(detail)

      await waitFor(() =>
        expect(screen.queryByTestId('community-spotlight-detail')).toBeNull()
      )
      const rank = screen.getByTestId('community-card-title-spot-2')
      await waitFor(() =>
        expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
          handles.get(rank)
        )
      )
    }
  )

  it('6.6-MOB-050 a spotlight-only post that becomes unavailable over realtime leaves the module (R25)', async () => {
    const catchUp = captureCatchUp()
    let phase: 'ready' | 'removed' = 'ready'
    const resolved: string[] = []
    // The feed never carries the spotlight-only post.
    serveFeed(() => feedJson({ items: [item({ reactions: ZERO })] }))
    let spotlightReads = 0
    serveSpotlight(() => {
      spotlightReads += 1
      return page({ items: [rankedLook('spot-only', 1), rankedLook('spot-2', 2)] })
    })
    server.use(
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events:
              phase === 'removed'
                ? [
                    {
                      version: 1,
                      kind: 'reactions.changed',
                      postId: 'spot-only',
                      communityRevision: '1',
                    },
                  ]
                : [],
            nextCursor: `cursor-${phase}`,
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as {
          targets: { key: string; postId: string }[]
        }
        resolved.push(...targets.map((target) => target.postId))
        return HttpResponse.json({
          data: {
            targets: targets.map((target) =>
              phase === 'removed' && target.postId === 'spot-only'
                ? { key: target.key, status: 'unavailable' }
                : {
                    key: target.key,
                    status: 'available',
                    communityRevision: '0',
                    post: item({ id: target.postId, reactions: ZERO }),
                    comment: null,
                    parent: null,
                    pageCursor: null,
                    parentPageCursor: null,
                    threadPosition: null,
                  }
            ),
          },
        })
      })
    )
    await render(<CommunityScreen />)
    await screen.findByTestId('community-spotlight-item-spot-only')
    await screen.findByTestId('community-post-card-post-a')
    await catchUp()
    phase = 'removed'
    await catchUp()

    expect(resolved).toContain('spot-only')
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-item-spot-only')).toBeNull()
    )
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-item-spot-2')).toBeVisible()
    )
    expect(spotlightReads).toBe(1)
  })

  it('[Codex 7.11 #10] keeps newer author edits across a delayed Spotlight load and shows Edited and the title in Spotlight detail', async () => {
    const base = item({
      id: 'spot-edit',
      title: 'Initial spotlight title',
      caption: 'Initial spotlight caption',
      textRevision: 0,
      author: { displayName: 'You', isSelf: true },
      reactions: ZERO,
    })
    let releaseSpotlight!: () => void
    const spotlightHeld = new Promise<void>((resolve) => {
      releaseSpotlight = resolve
    })
    serveFeed(() => feedJson({ items: [base] }))
    server.use(
      http.get(SPOTLIGHT_ROUTE, async () => {
        await spotlightHeld
        return page({ items: [{ ...base, rank: 1 }] })
      }),
      http.patch('*/api/v1/community/posts/spot-edit/text', () =>
        HttpResponse.json({
          data: {
            title: 'Updated spotlight title',
            caption: 'Updated spotlight caption',
            textRevision: 1,
          },
        })
      )
    )

    await render(<CommunityScreen />)
    expect(await screen.findByTestId('community-card-title-spot-edit')).toHaveTextContent(
      'Initial spotlight title'
    )
    press(screen.getByTestId('community-card-open-spot-edit'))
    const ordinaryDetail = await screen.findByTestId('community-post-detail')
    press(within(ordinaryDetail).getByTestId('community-edit-text'))
    const titleInput = screen.getByTestId('community-edit-title')
    const captionInput = screen.getByTestId('community-edit-description')
    act(() => {
      titleInput.focus()
    })
    fireEvent.change(titleInput, { target: { value: 'Updated spotlight title' } })
    fireEvent.change(captionInput, { target: { value: 'Updated spotlight caption' } })
    press(screen.getByTestId('community-edit-save'))
    await waitFor(() =>
      expect(
        within(ordinaryDetail).getByTestId('community-card-title-spot-edit')
      ).toHaveTextContent('Updated spotlight title')
    )

    press(within(ordinaryDetail).getByTestId('app-top-bar-back'))
    await waitFor(() => expect(ordinaryDetail).not.toBeInTheDocument())

    // Delayed Spotlight first-page response carries stale textRevision: 0.
    releaseSpotlight()
    const spotCard = await screen.findByTestId('community-spotlight-item-spot-edit')
    expect(
      within(spotCard).getByTestId('community-card-title-spot-edit')
    ).toHaveTextContent('Updated spotlight title')

    // Open Spotlight detail and confirm it renders the updated title and Edited label.
    press(within(spotCard).getByTestId('community-card-open-spot-edit'))
    const detail = await screen.findByTestId('community-spotlight-detail')
    // Codex 7.11 #10 (D12): a titled look names the layer's top bar, the edited title included.
    expect(within(detail).getByTestId('app-top-bar-title').textContent).toBe(
      'Updated spotlight title'
    )
    expect(
      within(detail).getByTestId('community-card-title-spot-edit')
    ).toHaveTextContent('Updated spotlight title')
    expect(
      within(detail).getByTestId('community-card-edited-spot-edit')
    ).toHaveTextContent('Edited')
  })

  it('prevents a delayed non-author Spotlight image refresh from overwriting newer realtime text', async () => {
    const catchUp = captureCatchUp()
    const base = item({
      id: 'spot-viewer',
      title: 'Original viewer title',
      caption: 'Original viewer caption',
      author: { displayName: 'Maya', isSelf: false },
      reactions: ZERO,
    })
    delete base.textRevision
    const realtimeUpdated = {
      ...base,
      title: 'Realtime viewer title',
      caption: 'Realtime viewer caption',
    }
    let phase: 'idle' | 'updated' = 'idle'
    let releaseRefresh!: () => void
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let refreshStarted = false
    serveFeed(() => feedJson({ items: [] }))
    serveSpotlight(() => page({ items: [{ ...base, rank: 1 }] }))
    server.use(
      http.get('*/api/v1/community/posts/spot-viewer', async () => {
        refreshStarted = true
        await refreshHeld
        return HttpResponse.json({
          data: {
            ...base,
            imageAccess: {
              ...base.imageAccess,
              url: 'https://fixtures.invalid/refreshed.jpg',
            },
          },
        })
      }),
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events:
              phase === 'updated'
                ? [
                    {
                      version: 1,
                      kind: 'post.text_changed',
                      postId: 'spot-viewer',
                      communityRevision: '2',
                    },
                  ]
                : [],
            nextCursor: `cursor-${phase}`,
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('*/api/v1/community/targets/resolve', ({ request }) =>
        request.json().then((body) => {
          const { targets } = body as { targets: { key: string; postId: string }[] }
          return HttpResponse.json({
            data: {
              targets: targets.map((target) => ({
                key: target.key,
                status: 'available',
                communityRevision: phase === 'updated' ? '2' : '1',
                post: phase === 'updated' ? realtimeUpdated : base,
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
    )

    await render(<CommunityScreen />)
    const spotCard = await screen.findByTestId('community-spotlight-item-spot-viewer')
    await catchUp()

    // Trigger expired-image refresh on Spotlight card.
    await waitFor(() =>
      expect(imageEvents.errors.get('community-card-image-spot-viewer')).toBeTypeOf(
        'function'
      )
    )
    act(() => {
      imageEvents.errors.get('community-card-image-spot-viewer')!()
    })
    await waitFor(() => expect(refreshStarted).toBe(true))

    // Realtime text update lands before the image refresh settles.
    phase = 'updated'
    await catchUp()
    await waitFor(() =>
      expect(
        within(spotCard).getByTestId('community-card-title-spot-viewer')
      ).toHaveTextContent('Realtime viewer title')
    )

    // Delayed image refresh carries stale text (without owner textRevision).
    releaseRefresh()
    await waitFor(() =>
      expect(imageEvents.sources.get('community-card-image-spot-viewer')).toBe(
        'https://fixtures.invalid/refreshed.jpg'
      )
    )
    expect(
      within(spotCard).getByTestId('community-card-title-spot-viewer')
    ).toHaveTextContent('Realtime viewer title')
    press(within(spotCard).getByTestId('community-card-open-spot-viewer'))
    const detail = await screen.findByTestId('community-spotlight-detail')
    expect(
      within(detail).getByTestId('community-card-caption-spot-viewer')
    ).toHaveTextContent('Realtime viewer caption')
  })
}
