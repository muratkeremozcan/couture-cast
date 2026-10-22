// Story 6.6: the City Spotlight module through the real web transport and MSW.
import axe from 'axe-core'
import { CommunitySyncState } from '@couture/api-client'
import { http, HttpResponse } from 'msw'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  communityReactionFeedResponseSchema,
  communityReactionSpotlightResponseSchema,
  type CommunityReactionFeedItem,
  type CommunityReactionSpotlight,
  type CommunityReactionSpotlightItem,
  type CommunityReactionSummary,
  type SetCommunityReactionInput,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  OPENED_PATH,
  POST_PATH,
  WITHDRAW_PATH,
  errorBody,
  feed,
  feedHandler,
  item,
  postBody,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

const SPOTLIGHT_PATH = '/api/v1/community/spotlight'

setupCommunityGridClock()

function ranked(rank: number, overrides: Partial<CommunityReactionSpotlightItem> = {}) {
  return {
    ...item({
      id: `spot-${rank}`,
      caption: `Spotlight look ${rank}`,
      author: { displayName: `Explorer ${rank}`, isSelf: false },
    }),
    rank,
    ...overrides,
  } satisfies CommunityReactionSpotlightItem
}

function spotlightBody(overrides: Partial<CommunityReactionSpotlight> = {}) {
  return HttpResponse.json(
    communityReactionSpotlightResponseSchema.parse({
      data: {
        level: 'city',
        label: 'Lisbon',
        items: [],
        nextCursor: null,
        ...overrides,
      },
    }) as unknown as Record<string, unknown>
  )
}

function liveRegionText() {
  return screen.getByTestId('community-live-region').textContent
}

const ZERO: CommunityReactionSummary = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  revision: 0,
  generation: 0,
  viewerReaction: null,
}

/** A feed body that carries reaction summaries, like the negotiated wire shape. */
function reactionFeedBody(items: CommunityReactionFeedItem[]) {
  return HttpResponse.json(
    communityReactionFeedResponseSchema.parse({
      data: feed({ items, nextCursor: null }),
    }) as unknown as Record<string, unknown>
  )
}

/** Captures the realtime coordinator the grid starts, so a test can run a catch-up. */
function captureSync() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  return async () => {
    await waitFor(() => expect(syncs.length).toBeGreaterThan(0))
    await act(async () => {
      await syncs.at(-1)!.catchUp()
    })
  }
}

/** Every spotlight page-one read (no cursor) the grid made. */
function pageOneReads(cursors: (string | null)[]) {
  return cursors.filter((cursor) => cursor === null).length
}

/** Every text the one live region takes, so a repeated or empty announcement shows. */
function recordAnnouncements() {
  const seen: string[] = []
  const region = screen.getByTestId('community-live-region')
  const observer = new MutationObserver(() => seen.push(region.textContent ?? ''))
  observer.observe(region, { childList: true, subtree: true, characterData: true })
  return { seen, stop: () => observer.disconnect() }
}

describe('CommunitySpotlightSection (Story 6.6)', () => {
  setupCommunityGridSurface()

  it('6.6-WEB-001 heads the section with the viewer area and the ranked cards in order', async () => {
    signIn()
    const headers: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [item({ id: 'spot-1' })] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        headers.push(request.headers.get('x-couture-reactions'))
        return spotlightBody({ items: [ranked(1), ranked(2), ranked(3)] })
      })
    )
    renderGrid()

    const section = await screen.findByTestId('community-spotlight')
    const heading = within(section).getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Spotlight in Lisbon')
    expect(section).toHaveAttribute('data-level', 'city')
    const list = await within(section).findByTestId('community-spotlight-list')
    const entries = within(list).getAllByRole('listitem')
    expect(entries.map((entry) => entry.getAttribute('data-rank'))).toEqual([
      '1',
      '2',
      '3',
    ])
    expect(entries.map((entry) => entry.querySelector('.sr-only')?.textContent)).toEqual([
      'Rank 1',
      'Rank 2',
      'Rank 3',
    ])
    // The spotlight copy of a post never shares an id with its feed copy.
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeInTheDocument()
    expect(await screen.findByTestId('lookbook-card-spot-1')).toBeInTheDocument()
    expect(document.querySelectorAll('#lookbook-card-spot-1')).toHaveLength(1)
    expect(document.querySelectorAll('#spotlight-lookbook-card-spot-1')).toHaveLength(1)
    // The module is the first thing in the community section.
    expect(section.parentElement?.firstElementChild).toBe(section)
    expect(headers).toEqual(['1'])
  })

  it('6.6-WEB-002 View more appends the next page, focuses its first card and announces once', async () => {
    signIn()
    const cursors: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor === null
          ? spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
          : // Rank 4 failed live visibility server-side and is skipped by index.
            spotlightBody({ items: [ranked(3), ranked(5)], nextCursor: null })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const firstNew = await screen.findByTestId('spotlight-lookbook-card-spot-3')
    await waitFor(() => {
      expect(document.activeElement).toBe(firstNew)
    })
    expect(liveRegionText()).toBe('Loaded 2 more spotlight looks.')
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['1', '2', '3', '5'])
    expect(cursors).toEqual([null, 'cursor-2'])
    // The last page carries no cursor, so the control retires.
    expect(screen.queryByTestId('community-spotlight-view-more')).not.toBeInTheDocument()
  })

  it('6.6-WEB-003 opens the existing detail and records only the spotlight open with its rank', async () => {
    signIn()
    const opened: { postId: string; body: unknown }[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1), ranked(2)] })),
      http.post(OPENED_PATH, async ({ request, params }) => {
        opened.push({ postId: String(params.postId), body: await request.json() })
        return HttpResponse.json({ tracked: true })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-2'))

    const detail = await screen.findByTestId('community-detail')
    expect(within(detail).getByTestId('community-detail-caption').textContent).toBe(
      'Spotlight look 2'
    )
    await waitFor(() => {
      expect(opened).toHaveLength(1)
    })
    expect(opened).toEqual([
      // Story 6.6 R3: the open carries the level the page was served at.
      { postId: 'spot-2', body: { surface: 'spotlight', rank: 2, level: 'city' } },
    ])
  })

  it('6.6-WEB-004 shows the empty state when no level meets the privacy cohort', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ level: 'none', label: null }))
    )
    renderGrid()

    const empty = await screen.findByTestId('community-spotlight-empty')
    expect(empty).toHaveTextContent('No spotlight near you yet')
    expect(screen.getByTestId('community-spotlight-heading').textContent).toBe(
      'City Spotlight'
    )
    expect(screen.queryByTestId('community-spotlight-list')).not.toBeInTheDocument()
  })

  it('6.6-WEB-005 renders the localized disabled state for the read rollout refusal', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () =>
        HttpResponse.json(
          { statusCode: 403, code: 'denied', message: COMMUNITY_FEED_DISABLED_MESSAGE },
          { status: 403 }
        )
      )
    )
    renderGrid()

    expect((await screen.findByTestId('community-spotlight-disabled')).textContent).toBe(
      'The City Spotlight is temporarily unavailable.'
    )
    expect(screen.queryByTestId('community-spotlight-error')).not.toBeInTheDocument()
  })

  it('6.6-WEB-006 recovers from a failed read through its retry control', async () => {
    signIn()
    let attempts = 0
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () => {
        attempts += 1
        return attempts === 1
          ? errorBody(500, 'Internal server error', 'Internal Server Error', {
              status: 500,
            })
          : spotlightBody({ items: [ranked(1)] })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    const failure = await screen.findByTestId('community-spotlight-error')
    expect(failure).toHaveTextContent('We could not load the City Spotlight.')
    await user.click(screen.getByTestId('community-spotlight-retry-button'))
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-1')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('community-spotlight-error')).not.toBeInTheDocument()
  })

  it('6.6-WEB-007 restarts from page one when the server refuses a stale cursor', async () => {
    signIn()
    const cursors: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        if (cursor === 'stale')
          return HttpResponse.json(
            {
              statusCode: 400,
              code: 'invalid_cursor',
              message: COMMUNITY_CURSOR_INVALID_MESSAGE,
            },
            { status: 400 }
          )
        return cursors.length === 1
          ? spotlightBody({ items: [ranked(1)], nextCursor: 'stale' })
          : spotlightBody({
              level: 'region',
              label: 'Lisboa',
              items: [ranked(1, { id: 'fresh-1' })],
            })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const fresh = await screen.findByTestId('spotlight-lookbook-card-fresh-1')
    expect(screen.queryByTestId('spotlight-lookbook-card-spot-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('community-spotlight-heading').textContent).toBe(
      'Spotlight in Lisboa'
    )
    await waitFor(() => {
      expect(document.activeElement).toBe(fresh)
    })
    expect(liveRegionText()).toBe(
      'The City Spotlight was refreshed with the latest ranking.'
    )
    expect(cursors).toEqual([null, 'stale', null])
  })

  it('6.6-WEB-008 keeps loaded looks and offers View more again when a page fails', async () => {
    signIn()
    let failed = false
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        if (cursor === null)
          return spotlightBody({ items: [ranked(1)], nextCursor: 'cursor-2' })
        if (!failed) {
          failed = true
          return new HttpResponse(null, { status: 500 })
        }
        return spotlightBody({ items: [ranked(2)], nextCursor: null })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    expect(
      (await screen.findByTestId('community-spotlight-more-error')).textContent
    ).toBe('We could not load the City Spotlight.')
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeInTheDocument()
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-2')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('community-spotlight-more-error')).not.toBeInTheDocument()
  })

  it('6.6-WEB-009 has no axe violations with ranked looks and an open detail', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [item()] }),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
      ),
      http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true }))
    )
    const user = userEvent.setup()
    const { container } = renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await screen.findByTestId('lookbook-card-post-1')
    const run = async () => {
      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(
        results.violations.map((violation) => violation.id),
        JSON.stringify(results.violations, null, 2)
      ).toEqual([])
    }
    await run()
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-1'))
    await screen.findByTestId('community-detail')
    await run()
  })

  // --- Story 6.6 code review round 1 remedies (TEA) ---------------------------

  it('6.6-WEB-030 an age-gated viewer gets the localized disabled state, never an error with retry (R7)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () =>
        HttpResponse.json(
          { statusCode: 403, code: 'denied', message: COMMUNITY_AGE_GATE_DENIED_MESSAGE },
          { status: 403 }
        )
      )
    )
    renderGrid()

    expect((await screen.findByTestId('community-spotlight-disabled')).textContent).toBe(
      'The City Spotlight is temporarily unavailable.'
    )
    expect(screen.queryByTestId('community-spotlight-error')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('community-spotlight-retry-button')
    ).not.toBeInTheDocument()
  })

  it('6.6-WEB-031 a reaction on the spotlight copy updates the feed copy of the same post (R10)', async () => {
    signIn()
    let summary = ZERO
    const requests: SetCommunityReactionInput[] = []
    useMswHandlers(
      http.get(FEED_PATH, () =>
        reactionFeedBody([{ ...item({ id: 'spot-1' }), reactions: summary }])
      ),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({ items: [ranked(1, { reactions: summary })] })
      ),
      http.put(
        '/api/v1/community/posts/:postId/reaction',
        async ({ request, params }) => {
          expect(params.postId).toBe('spot-1')
          const intent = (await request.json()) as SetCommunityReactionInput
          requests.push(intent)
          summary = {
            counts: { applause: 1, love: 0, inspiration: 0 },
            total: 1,
            revision: summary.revision + 1,
            generation: summary.generation + 1,
            viewerReaction: 'applause',
          }
          return HttpResponse.json({ data: summary })
        }
      )
    )
    const user = userEvent.setup()
    renderGrid()

    const spotlightCopy = await screen.findByTestId(
      'spotlight-community-reactions-spot-1'
    )
    const feedCopy = await screen.findByTestId('community-reactions-spot-1')
    await user.click(within(spotlightCopy).getByRole('button', { name: 'Applaud, 0' }))

    for (const copy of [spotlightCopy, feedCopy])
      await waitFor(() =>
        expect(within(copy).getByRole('button', { name: 'Applaud, 1' })).toHaveAttribute(
          'aria-pressed',
          'true'
        )
      )
    expect(requests.map((request) => request.selection)).toEqual(['applause'])
  })

  it('6.6-WEB-032 withdrawing an own look from the spotlight removes its spotlight copy (R10)', async () => {
    signIn()
    let withdrawn: string | null = null
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({
          items: [
            ranked(1),
            ranked(2, {
              id: 'spot-self',
              author: { displayName: 'You', isSelf: true },
            }),
          ],
        })
      ),
      http.post(WITHDRAW_PATH, ({ params }) => {
        withdrawn = String(params.postId)
        return HttpResponse.json({ tracked: true })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-self')
    await user.click(screen.getByTestId('spotlight-withdraw-button-spot-self'))

    await waitFor(() => expect(withdrawn).toBe('spot-self'))
    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-self')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['1'])
  })

  it('6.6-WEB-033 a realtime unavailable target removes the spotlight copy as well as the feed copy (R10)', async () => {
    signIn()
    const catchUp = captureSync()
    let phase: 'ready' | 'removed' = 'ready'
    let spotlightReads = 0
    useMswHandlers(
      http.get(FEED_PATH, () =>
        reactionFeedBody(
          phase === 'removed' ? [] : [{ ...item({ id: 'spot-1' }), reactions: ZERO }]
        )
      ),
      http.get(SPOTLIGHT_PATH, () => {
        spotlightReads += 1
        return spotlightBody({ items: [ranked(1, { reactions: ZERO }), ranked(2)] })
      }),
      http.get('/api/v1/community/events', () =>
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
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as { targets: { key: string }[] }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) =>
              phase === 'removed' && target.key === 'spot-1'
                ? { key: target.key, status: 'unavailable' }
                : {
                    key: target.key,
                    status: 'available',
                    communityRevision: '0',
                    post: { ...item({ id: target.key }), reactions: ZERO },
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
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await screen.findByTestId('lookbook-card-spot-1')
    await catchUp()
    phase = 'removed'
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('lookbook-card-spot-1')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-1')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('spotlight-lookbook-card-spot-2')).toBeInTheDocument()
    // Evicted in place: no spotlight re-read stood in for the realtime removal.
    expect(spotlightReads).toBe(1)
  })

  it('6.6-WEB-034 a View more page that adds nothing announces nothing and keeps View more while a cursor remains (R11)', async () => {
    signIn()
    const cursors: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        if (cursor === null)
          return spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
        // Every entry on this page failed live visibility server-side.
        if (cursor === 'cursor-2')
          return spotlightBody({ items: [], nextCursor: 'cursor-3' })
        return spotlightBody({ items: [ranked(9)], nextCursor: null })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    const announcements = recordAnnouncements()
    const viewMore = screen.getByTestId('community-spotlight-view-more')
    await user.click(viewMore)

    await waitFor(() => expect(cursors).toEqual([null, 'cursor-2']))
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-view-more')).not.toBeDisabled()
    )
    expect(announcements.seen.filter((text) => /Loaded/.test(text))).toEqual([])
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['1', '2'])

    // The remaining ranks stay reachable through the cursor the empty page returned.
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    const ninth = await screen.findByTestId('spotlight-lookbook-card-spot-9')
    await waitFor(() => expect(document.activeElement).toBe(ninth))
    expect(cursors).toEqual([null, 'cursor-2', 'cursor-3'])
    expect(announcements.seen.filter((text) => /Loaded/.test(text))).toEqual([
      'Loaded 1 more spotlight look.',
    ])
    announcements.stop()
  })

  it('6.6-WEB-035 counts and focus use only newly appended looks when a page repeats one (R11)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === null
          ? spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
          : spotlightBody({ items: [ranked(2), ranked(3)], nextCursor: null })
      )
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    const announcements = recordAnnouncements()
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const third = await screen.findByTestId('spotlight-lookbook-card-spot-3')
    await waitFor(() => expect(document.activeElement).toBe(third))
    expect(liveRegionText()).toBe('Loaded 1 more spotlight look.')
    expect(announcements.seen.filter((text) => /Loaded/.test(text))).toEqual([
      'Loaded 1 more spotlight look.',
    ])
    expect(screen.getAllByTestId('spotlight-lookbook-card-spot-2')).toHaveLength(1)
    announcements.stop()
  })

  it('6.6-WEB-036 a cursor-invalid restart focuses the first card and announces the refresh once (R11)', async () => {
    signIn()
    let reads = 0
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        reads += 1
        if (new URL(request.url).searchParams.get('cursor'))
          return HttpResponse.json(
            {
              statusCode: 400,
              code: 'invalid_cursor',
              message: COMMUNITY_CURSOR_INVALID_MESSAGE,
            },
            { status: 400 }
          )
        return spotlightBody({
          items: [ranked(1, { id: reads === 1 ? 'old-1' : 'new-1' })],
          nextCursor: reads === 1 ? 'stale' : null,
        })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-old-1')
    const announcements = recordAnnouncements()
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const fresh = await screen.findByTestId('spotlight-lookbook-card-new-1')
    await waitFor(() => expect(document.activeElement).toBe(fresh))
    const refreshed = 'The City Spotlight was refreshed with the latest ranking.'
    await waitFor(() => expect(liveRegionText()).toBe(refreshed))
    expect(announcements.seen.filter((text) => text === refreshed)).toHaveLength(1)
    expect(announcements.seen.filter((text) => /Loaded/.test(text))).toEqual([])
    announcements.stop()
  })

  it('6.6-WEB-037 an empty first page with a next cursor keeps View more and never shows the empty state (R12)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === null
          ? spotlightBody({ items: [], nextCursor: 'cursor-2' })
          : spotlightBody({ items: [ranked(7)], nextCursor: null })
      )
    )
    const user = userEvent.setup()
    renderGrid()

    const viewMore = await screen.findByTestId('community-spotlight-view-more')
    expect(screen.queryByTestId('community-spotlight-empty')).not.toBeInTheDocument()
    await user.click(viewMore)
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-7')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('community-spotlight-empty')).not.toBeInTheDocument()
  })

  it('6.6-WEB-038 the empty state shows only with no looks and no next cursor (R12)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [], nextCursor: null }))
    )
    renderGrid()

    expect(await screen.findByTestId('community-spotlight-empty')).toHaveTextContent(
      'No spotlight near you yet'
    )
    expect(screen.queryByTestId('community-spotlight-view-more')).not.toBeInTheDocument()
  })

  it('6.6-WEB-039 an image retry on a spotlight card retries that image and keeps every loaded page (R13)', async () => {
    signIn()
    const cursors: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor === null
          ? spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
          : spotlightBody({ items: [ranked(3)], nextCursor: null })
      }),
      http.get(POST_PATH, ({ params }) => postBody({ id: String(params.postId) }))
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    await screen.findByTestId('spotlight-lookbook-card-spot-3')

    const surface = screen.getByTestId('spotlight-lookbook-image-spot-1')
    fireEvent.error(surface.querySelector('img') as HTMLImageElement)
    await user.click(await screen.findByTestId('spotlight-image-retry-button-spot-1'))

    await waitFor(() =>
      expect(
        screen.getByTestId('spotlight-lookbook-image-spot-1').querySelector('img')
      ).not.toBeNull()
    )
    // No page-one reload: the appended page, its ranks and the reader's place survive.
    expect(pageOneReads(cursors)).toBe(1)
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['1', '2', '3'])
  })

  it('6.6-WEB-040 hides the module once community access is no longer verified, like mobile (R14)', async () => {
    signIn()
    const catchUp = captureSync()
    let unverified = false
    useMswHandlers(
      http.get(FEED_PATH, () => reactionFeedBody([{ ...item(), reactions: ZERO }])),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1)] })),
      http.get('/api/v1/community/events', () =>
        unverified
          ? HttpResponse.json(
              { statusCode: 503, error: 'Service Unavailable', message: 'Unavailable' },
              { status: 503 }
            )
          : HttpResponse.json({
              data: {
                events: [],
                nextCursor: 'verified',
                hasMore: false,
                resyncRequired: false,
              },
            })
      ),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as { targets: { key: string }[] }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) => ({
              key: target.key,
              status: 'available',
              communityRevision: '0',
              post: { ...item({ id: target.key }), reactions: ZERO },
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
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    // A verified catch-up keeps the ranked module on screen.
    await catchUp()
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-1')
    ).toBeInTheDocument()
    unverified = true
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight')).not.toBeInTheDocument()
    )
    expect(screen.queryByText('No spotlight near you yet')).not.toBeInTheDocument()
  })

  /** A spotlight-only post (absent from every feed page) that realtime later removes. */
  function useSpotlightOnlyRemoval() {
    const catchUp = captureSync()
    const state = { phase: 'ready' as 'ready' | 'removed', spotlightReads: 0 }
    const resolved: string[][] = []
    useMswHandlers(
      http.get(FEED_PATH, () => reactionFeedBody([{ ...item(), reactions: ZERO }])),
      http.get(SPOTLIGHT_PATH, () => {
        state.spotlightReads += 1
        return spotlightBody({
          items: [
            ranked(1, { id: 'spot-only', reactions: ZERO }),
            ranked(2, { reactions: ZERO }),
          ],
        })
      }),
      http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true })),
      http.get('/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events:
              state.phase === 'removed'
                ? [
                    {
                      version: 1,
                      kind: 'reactions.changed',
                      postId: 'spot-only',
                      communityRevision: '1',
                    },
                  ]
                : [],
            nextCursor: `cursor-${state.phase}`,
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as { targets: { key: string }[] }
        resolved.push(targets.map((target) => target.key))
        return HttpResponse.json({
          data: {
            targets: targets.map((target) =>
              state.phase === 'removed' && target.key === 'spot-only'
                ? { key: target.key, status: 'unavailable' }
                : {
                    key: target.key,
                    status: 'available',
                    communityRevision: '0',
                    post: { ...item({ id: target.key }), reactions: ZERO },
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
    return { catchUp, state, resolved }
  }

  it('6.6-WEB-041 a spotlight-only post that becomes unavailable over realtime leaves the module (R25)', async () => {
    signIn()
    const { catchUp, state, resolved } = useSpotlightOnlyRemoval()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-only')
    await screen.findByTestId('lookbook-card-post-1')
    expect(screen.queryByTestId('lookbook-card-spot-only')).not.toBeInTheDocument()
    await catchUp()
    state.phase = 'removed'
    await catchUp()

    // The realtime coordinator must be asked about the spotlight-only post at all.
    expect(resolved.flat()).toContain('spot-only')
    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-only')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('spotlight-lookbook-card-spot-2')).toBeInTheDocument()
    expect(screen.getByTestId('lookbook-card-post-1')).toBeInTheDocument()
    // Evicted in place: no spotlight re-read stood in for the realtime removal.
    expect(state.spotlightReads).toBe(1)
  })

  it('6.6-WEB-042 an open detail for a spotlight-only post closes when realtime removes it (R25)', async () => {
    signIn()
    const { catchUp, state } = useSpotlightOnlyRemoval()
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-only')
    await catchUp()
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-only'))
    await screen.findByTestId('community-detail')
    state.phase = 'removed'
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('community-detail')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-only')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('spotlight-lookbook-card-spot-2')).toBeInTheDocument()
  })
})
