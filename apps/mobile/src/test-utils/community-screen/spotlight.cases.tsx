/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.6 owner: the mobile City Spotlight module through the real HTTP boundary.
import { item, errorEnvelope, feedJson, imageEvents, serveFeed } from './harness'
import { CommunitySyncState } from '@couture/api-client'
import { act, screen, waitFor, within } from '@testing-library/react'
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
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'

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
    ).toBe('Rank 2, Position 2 of 2')
    // One horizontal carousel: the second card sits beside the first.
    const second = screen.getByTestId('community-spotlight-item-spot-2')
    expect(second.getBoundingClientRect().top).toBe(first.getBoundingClientRect().top)
    expect(second.getBoundingClientRect().left).toBeGreaterThan(
      first.getBoundingClientRect().left
    )
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
    const viewMore = await screen.findByTestId('community-spotlight-view-more')
    const row = screen.getByTestId('community-spotlight-row')
    // View more trails the cards inside the carousel.
    expect(row.contains(viewMore)).toBe(true)
    const scroll = vi.spyOn(row, 'scroll')
    press(viewMore)
    const newRank = await screen.findByTestId('community-spotlight-rank-spot-3')
    expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'cursor-2'])
    await waitFor(() => expect(findNodeHandle).toHaveBeenLastCalledWith(newRank))
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
      handles.get(newRank)
    )
    // The carousel brought the first new card to its start before focus moved.
    const firstNew = screen.getByTestId('community-spotlight-item-spot-3')
    const firstCard = screen.getByTestId('community-spotlight-item-spot-1')
    const offset = Math.round(
      firstNew.getBoundingClientRect().left - firstCard.getBoundingClientRect().left
    )
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ left: offset, top: 0 }))
    expect(scroll.mock.invocationCallOrder.at(-1)).toBeLessThan(
      vi.mocked(AccessibilityInfo.setAccessibilityFocus).mock.invocationCallOrder.at(-1)!
    )
    expect(newRank.getAttribute('aria-label')).toBe('Rank 3, Position 3 of 4')
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
        // Story 6.6 R3: the open carries the level the page was served at.
        { postId: 'spot-2', body: { surface: 'spotlight', rank: 2, level: 'city' } },
      ])
    )
    press(screen.getByTestId('community-spotlight-detail-close'))
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail-title')).toBeNull()
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
      token = 'session-token'
      expect(
        await screen.findByTestId('community-spotlight-item-member-1', undefined, {
          timeout: 4000,
        })
      ).toBeVisible()
      expect(screen.queryByTestId('community-spotlight-error')).toBeNull()
      expect(requests.at(-1)?.headers.get('authorization')).toBe('Bearer session-token')
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
    await screen.findByTestId('community-spotlight-detail-title')

    phase = 'removed'
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-item-spot-1')).toBeNull()
    )
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail-title')).toBeNull()
    )
    expect(screen.getByTestId('community-spotlight-item-spot-2')).toBeVisible()
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
      expect(screen.queryByTestId('community-spotlight-detail-title')).toBeNull()
    )
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-item-spot-self')).toBeNull()
    )
    expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
  })

  it('6.6-MOB-034 an expired spotlight image refreshes the spotlight, not only the feed (R9)', async () => {
    serveFeed(() => feedJson({ items: [] }))
    let spotlightReads = 0
    let postReads = 0
    serveSpotlight(() => {
      spotlightReads += 1
      return page({ items: [rankedLook('spot-1', 1)] })
    })
    server.use(
      http.get('*/api/v1/community/posts/:postId', ({ params }) => {
        postReads += 1
        return HttpResponse.json({
          data: { ...item({ id: params.postId as string }), reactions: ZERO },
        })
      })
    )
    await render(<CommunityScreen />)
    await screen.findByTestId('community-spotlight-item-spot-1')
    const before = spotlightReads + postReads
    await waitFor(() =>
      expect(imageEvents.errors.get('community-card-image-spot-1')).toBeTypeOf('function')
    )
    act(() => {
      imageEvents.errors.get('community-card-image-spot-1')!()
    })
    await waitFor(() => expect(spotlightReads + postReads).toBeGreaterThan(before))
    expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
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

    const rank = await screen.findByTestId('community-spotlight-rank-new-1')
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

    const third = await screen.findByTestId('community-spotlight-rank-spot-3')
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
    expect(await screen.findByTestId('community-spotlight-item-spot-7')).toBeVisible()
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
    await screen.findByTestId('community-spotlight-detail-title')
    press(screen.getByTestId('community-spotlight-detail-close'))
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-detail-title')).toBeNull()
    )
    const rank = screen.getByTestId('community-spotlight-rank-spot-2')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(rank)
      )
    )
  })

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
    expect(screen.getByTestId('community-spotlight-item-spot-2')).toBeVisible()
    expect(spotlightReads).toBe(1)
  })
}
