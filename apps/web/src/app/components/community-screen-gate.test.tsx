// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 D3 test owner: the Community screen gate waits for the first feed page and the
// City Spotlight above it, so neither lands after the body appeared and moves the other. A
// Spotlight that fails is part of what the body shows at reveal, never hidden by the gate.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-CMP-007). The measured budget is 7.7-E2E-001.
// Codex review of 8327b4fb: 7.7-CMP-012 pins realtime cancelling or refusing the first feed read
// (P1-1), 7.7-CMP-013 the deep-link focus that waits for the gate (P2-8), 7.7-CMP-014 the return
// with its filter, paged rows and scroll (P2-5), 7.7-CMP-015 losing access (P3-1).
import { CommunitySyncState, type CommunitySyncCallbacks } from '@couture/api-client'
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  POST_PATH,
  cursorFor,
  feedBody,
  item,
  postBody,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import {
  SPOTLIGHT_PATH,
  ranked,
  spotlightBody,
} from '../../test-utils/community-spotlight'
import {
  COMMUNITY_GRID_SNAPSHOT_PART,
  HOME_TEASER_SNAPSHOT_PART,
  screenSnapshot,
} from '../../lib/screen-snapshot'
import { currentWebSessionScope } from '../../lib/use-web-session'
import { CommunityLookbookGrid } from './community-lookbook-grid'
import { ScreenGate } from './screen-gate'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

setupCommunityGridClock()

/** Feed and Spotlight reads held until the test answers each. */
function useHeldReads() {
  const feed = Promise.withResolvers<void>()
  const spotlight = Promise.withResolvers<'ok' | 'fail'>()
  useMswHandlers(
    http.get(FEED_PATH, async () => {
      await feed.promise
      return feedBody({ items: [item({ id: 'post-1' })] })
    }),
    http.get(SPOTLIGHT_PATH, async () => {
      const outcome = await spotlight.promise
      return outcome === 'ok'
        ? spotlightBody({ items: [ranked(1)] })
        : HttpResponse.json({ message: 'Unavailable' }, { status: 503 })
    })
  )
  return { feed, spotlight }
}

function renderCommunity(highlightedCardId?: string) {
  return render(
    <ScreenGate screen="community" reads={['feed', 'spotlight']}>
      <CommunityLookbookGrid
        showFilterNav
        returnPath="/community"
        highlightedCardId={highlightedCardId}
      />
    </ScreenGate>
  )
}

/** The realtime sync the grid starts, kept un-started so the test drives its callbacks. */
function useCapturedSync() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  return () =>
    (syncs.at(-1) as unknown as { callbacks: CommunitySyncCallbacks }).callbacks
}

const never = () => new Promise<never>(() => undefined)

type StreamEvents = Parameters<CommunitySyncCallbacks['changed']>[0]

describe('7.7 Community screen gate', () => {
  setupCommunityGridSurface()

  afterEach(() => {
    document.documentElement.removeAttribute('data-session')
    screenSnapshot.clear()
  })

  it('7.7-CMP-007 waits for the first feed page and the Spotlight before the body appears', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const reads = useHeldReads()
    renderCommunity()

    const gate = screen.getByTestId('screen-gate')
    expect(gate).toHaveAttribute('data-screen', 'community')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()

    await act(async () => {
      reads.feed.resolve()
      await reads.feed.promise
    })
    expect(await screen.findByTestId('lookbook-card-post-1')).not.toBeVisible()
    expect(gate).not.toHaveAttribute('data-ready')

    await act(async () => {
      reads.spotlight.resolve('ok')
      await reads.spotlight.promise
    })
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    // Both are in place at reveal: the Spotlight row above the feed, no skeleton in between.
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeVisible()
    expect(screen.getByTestId('lookbook-card-post-1')).toBeVisible()
    expect(screen.queryByTestId('lookbook-card-skeleton')).toBeNull()
    expect(screen.getByTestId('screen-placeholder')).not.toBeVisible()
  })

  it('7.7-CMP-007 a failed Spotlight opens the gate with its error and Retry inside the body', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const reads = useHeldReads()
    renderCommunity()

    await act(async () => {
      reads.feed.resolve()
      reads.spotlight.resolve('fail')
      await Promise.all([reads.feed.promise, reads.spotlight.promise])
    })

    const gate = screen.getByTestId('screen-gate')
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(await screen.findByTestId('community-spotlight-error')).toBeVisible()
    expect(screen.getByTestId('community-spotlight-retry-button')).toBeVisible()
    expect(screen.getByTestId('lookbook-card-post-1')).toBeVisible()
    expect(gate.contains(screen.getByTestId('community-spotlight-error'))).toBe(true)
  })

  it('7.7-CMP-007 stays closed while the first feed page is unanswered and the Spotlight is in, then opens', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const reads = useHeldReads()
    renderCommunity()
    const gate = screen.getByTestId('screen-gate')

    await act(async () => {
      reads.spotlight.resolve('ok')
      await reads.spotlight.promise
    })
    expect(await screen.findByTestId('spotlight-lookbook-card-spot-1')).not.toBeVisible()
    expect(gate).not.toHaveAttribute('data-ready')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()

    await act(async () => {
      reads.feed.resolve()
      await reads.feed.promise
    })
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(screen.getByTestId('lookbook-card-post-1')).toBeVisible()
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeVisible()
    expect(screen.queryByTestId('lookbook-card-skeleton')).toBeNull()
  })

  it('7.7-CMP-012 a realtime change that cancels the first feed read starts a replacement, and the gate opens on its answer', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const sync = useCapturedSync()
    let feedReads = 0
    useMswHandlers(
      http.get(FEED_PATH, async () => {
        feedReads += 1
        // The first read never answers: realtime cancels it.
        if (feedReads === 1) await never()
        return feedBody({ items: [item({ id: 'post-2' })] })
      }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1)] }))
    )
    renderCommunity()
    const gate = screen.getByTestId('screen-gate')
    await waitFor(() => expect(feedReads).toBe(1))
    await waitFor(() => expect(sync()).toBeDefined())

    // A change that publishes nothing used to cancel the read and leave the gate closed.
    const reactions = [
      { version: 1, kind: 'reactions.changed', postId: 'post-9', communityRevision: '3' },
    ] as unknown as StreamEvents
    await act(async () => {
      await sync().changed(reactions)
    })

    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(feedReads).toBe(2)
    expect(screen.getByTestId('lookbook-card-post-2')).toBeVisible()
    expect(screen.getByTestId('screen-placeholder')).not.toBeVisible()
  })

  it('7.7-CMP-012 a realtime denial while the first feed read is out opens the gate with the load error and Retry', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const sync = useCapturedSync()
    const limits: string[] = []
    useMswHandlers(
      http.get(FEED_PATH, async ({ request }) => {
        const limit = new URL(request.url).searchParams.get('limit') ?? ''
        limits.push(limit)
        // The page read is held; the one-row probe the denial sends answers.
        if (limit !== '1') await never()
        return feedBody({ items: [item()] })
      }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1)] }))
    )
    renderCommunity()
    const gate = screen.getByTestId('screen-gate')
    await waitFor(() => expect(limits).toHaveLength(1))

    act(() => sync().availability('denied'))

    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(limits).toContain('1')
    expect(screen.getByTestId('community-feed-error')).toBeVisible()
    expect(screen.getByTestId('community-feed-retry-button')).toBeVisible()
  })

  it('7.7-CMP-013 a deep-link focus waits for the gate to open, then focuses the card', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const reads = useHeldReads()
    useMswHandlers(http.get(POST_PATH, () => postBody({ id: 'post-1' })))
    renderCommunity('post-1')
    const gate = screen.getByTestId('screen-gate')

    await act(async () => {
      reads.feed.resolve()
      await reads.feed.promise
    })
    const card = await screen.findByTestId('lookbook-card-post-1')
    // The card is mounted under the placeholder: focus there would be lost, so none is spent.
    expect(card).not.toBeVisible()
    expect(card).not.toHaveFocus()

    await act(async () => {
      reads.spotlight.resolve('ok')
      await reads.spotlight.promise
    })
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    await waitFor(() => expect(card).toHaveFocus())
  })

  it('7.7-CMP-014 a return after paging a non-default filter keeps the filter, the paged rows and the scroll through the page-one refresh', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    let returning = false
    const refresh = Promise.withResolvers<void>()
    const reads: { mode: string | null; cursor: boolean }[] = []
    useMswHandlers(
      http.get(FEED_PATH, async ({ request }) => {
        const params = new URL(request.url).searchParams
        const mode = params.get('mode')
        reads.push({ mode, cursor: params.has('cursor') })
        if (params.has('cursor'))
          return feedBody({
            mode: 'all',
            items: [item({ id: 'post-3' }), item({ id: 'post-4' })],
            nextCursor: null,
          })
        if (returning) {
          await refresh.promise
          // Page one now leads with a look published since the member left.
          return feedBody({
            mode: 'all',
            items: [item({ id: 'post-new' }), item(), item({ id: 'post-2' })],
            nextCursor: cursorFor({ mode: 'all' }),
          })
        }
        return feedBody({
          ...(mode === 'all' ? { mode: 'all' as const } : {}),
          items: [item(), item({ id: 'post-2' })],
          nextCursor: cursorFor({ mode: mode === 'all' ? 'all' : 'auto' }),
        })
      }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1)] }))
    )
    const user = userEvent.setup()

    // First visit: the member picks All and pages to the second page.
    const firstVisit = renderCommunity()
    const gate = () => screen.getByTestId('screen-gate')
    await waitFor(() => expect(gate()).toHaveAttribute('data-ready', 'true'))
    await user.click(screen.getByTestId('community-filter-all'))
    await waitFor(() => expect(reads.at(-1)).toEqual({ mode: 'all', cursor: false }))
    await user.click(await screen.findByTestId('load-more-button'))
    expect(await screen.findByTestId('lookbook-card-post-4')).toBeVisible()
    await waitFor(() =>
      expect(
        screenSnapshot.recall<{ items: unknown[] }>(
          currentWebSessionScope(),
          'community',
          COMMUNITY_GRID_SNAPSHOT_PART
        )?.items
      ).toHaveLength(4)
    )
    screenSnapshot.rememberScroll(currentWebSessionScope(), 'community', 900)
    firstVisit.unmount()

    // The return: its first frame holds the filter, the four rows and the scroll.
    returning = true
    const scrolledTo: number[] = []
    vi.spyOn(window, 'scrollTo').mockImplementation(((_x: number, y: number) => {
      scrolledTo.push(y)
    }) as typeof window.scrollTo)
    renderCommunity()
    const rowIds = () =>
      within(screen.getByTestId('community-card-grid'))
        .getAllByRole('article')
        .map((card) => card.id)
    const pagedRows = [
      'lookbook-card-post-1',
      'lookbook-card-post-2',
      'lookbook-card-post-3',
      'lookbook-card-post-4',
    ]

    expect(gate()).toHaveAttribute('data-ready', 'true')
    expect(scrolledTo).toEqual([900])
    expect(screen.getByTestId('community-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(rowIds()).toEqual(pagedRows)
    expect(screen.queryByTestId('lookbook-card-skeleton')).toBeNull()
    await waitFor(() => expect(reads.at(-1)).toEqual({ mode: 'all', cursor: false }))

    // Page one answers: the rows stay where they were and the new look waits in the pill.
    await act(async () => {
      refresh.resolve()
      await refresh.promise
    })
    expect(await screen.findByTestId('community-new-looks-pill')).toBeVisible()
    expect(rowIds()).toEqual(pagedRows)
    expect(screen.queryByTestId('lookbook-card-post-new')).toBeNull()
    expect(screen.getByTestId('community-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(scrolledTo).toEqual([900])
  })

  it('7.7-CMP-015 losing Community access drops the kept rows and teaser, and a return starts from the placeholder', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const sync = useCapturedSync()
    useMswHandlers(
      http.get(FEED_PATH, () => feedBody({ items: [item()] })),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1)] }))
    )
    const firstVisit = renderCommunity()
    await waitFor(() =>
      expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    )
    const scope = currentWebSessionScope()
    await waitFor(() =>
      expect(
        screenSnapshot.recall(scope, 'community', COMMUNITY_GRID_SNAPSHOT_PART)
      ).toBeDefined()
    )
    // Home's teaser, kept earlier in the session.
    screenSnapshot.remember(scope, 'home', HOME_TEASER_SNAPSHOT_PART, { value: 'teaser' })

    // The realtime session is refused: access is lost while the tab is open.
    act(() => sync().availability('denied'))
    expect(screenSnapshot.recall(scope, 'community', COMMUNITY_GRID_SNAPSHOT_PART)).toBe(
      undefined
    )
    expect(screenSnapshot.recall(scope, 'home', HOME_TEASER_SNAPSHOT_PART)).toBe(
      undefined
    )
    await screen.findByTestId('community-feed-error')
    firstVisit.unmount()

    // A return shows nothing from before the loss: the placeholder holds until the reads answer.
    renderCommunity()
    expect(screen.getByTestId('screen-gate')).not.toHaveAttribute('data-ready')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()
    expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
  })
})
