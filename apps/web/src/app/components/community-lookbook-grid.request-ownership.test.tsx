import * as communityClient from '../../lib/community'
import { CommunityReactionState } from '@couture/api-client'
import { http, HttpResponse } from 'msw'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CommunityReactionSummary,
  type SetCommunityReactionInput,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  POST_PATH,
  item,
  feed,
  errorBody,
  signIn,
  renderGrid,
  setupCommunityGridClock,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('Story 6.3 screen request ownership', () => {
  const zero: CommunityReactionSummary = {
    counts: { applause: 0, love: 0, inspiration: 0 },
    total: 0,
    revision: 0,
    generation: 0,
    viewerReaction: null,
  }
  const one: CommunityReactionSummary = {
    counts: { applause: 1, love: 0, inspiration: 0 },
    total: 1,
    revision: 1,
    generation: 1,
    viewerReaction: 'applause',
  }
  const post = () => ({ ...item(), reactions: zero })
  function palette(controls: HTMLElement) {
    return {
      buttons: within(controls)
        .getAllByRole('button')
        .map((button) => ({
          label: button.getAttribute('aria-label'),
          pressed: button.getAttribute('aria-pressed'),
        })),
      total: within(controls).getByText(/^[0-9]+ reactions?$/).textContent,
    }
  }
  const confirmedPalette = {
    buttons: [
      { label: 'Applaud, 1', pressed: 'true' },
      { label: 'Love, 0', pressed: 'false' },
      { label: 'Inspired, 0', pressed: 'false' },
    ],
    total: '1 reaction',
  }
  beforeEach(() => {
    window.sessionStorage.clear()
    signIn()
  })
  /**
   * The modal header close. The in-thread comments close shares its name on
   * purpose (both close the look), so scope to the dialog's own control:
   * the one outside the detail body.
   */
  function detailHeaderClose() {
    const body = screen.getByTestId('community-detail')
    const closes = within(screen.getByRole('dialog'))
      .getAllByRole('button', { name: 'Close this look' })
      .filter((button) => !body.contains(button))
    expect(closes).toHaveLength(1)
    return closes[0]!
  }
  /**
   * The open look modal hides every body sibling, the grid included, from
   * assistive tech (accessible-modal.tsx L51-71), so the card image behind it
   * is reachable only as a hidden node.
   */
  const cardImage = () =>
    within(screen.getByTestId('lookbook-card-post-1')).getByRole('img', { hidden: true })
  function deferred() {
    let release!: () => void
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }
  it('preserves a discussion draft when the pending deep-link lookup fails on the network', async () => {
    const previousScroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView'
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const gate = deferred(),
      lookup = vi.spyOn(communityClient, 'getCommunityPostFromWeb')
    useMswHandlers(
      http.get(FEED_PATH, () => HttpResponse.json({ data: feed({ items: [post()] }) })),
      http.get(POST_PATH, async () => {
        await gate.promise
        return HttpResponse.error()
      })
    )
    try {
      const user = userEvent.setup()
      renderGrid({ highlightedCardId: 'post-1' })
      await user.click(await screen.findByTestId('comments-button-post-1'))
      await user.type(
        await screen.findByLabelText('Add a comment'),
        'Preserved discussion draft'
      )
      const pending = lookup.mock.results[0]!
      if (pending.type !== 'return') throw new Error('Deep-link lookup did not start')
      await act(async () => {
        gate.release()
        await pending.value.catch(() => undefined)
      })
      expect(screen.getByLabelText('Add a comment')).toHaveValue(
        'Preserved discussion draft'
      )
    } finally {
      gate.release()
      lookup.mockRestore()
      if (previousScroll)
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previousScroll)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('6.3-WEB closing detail during PUT retains accepted parent update', async () => {
    const gate = deferred()
    let sent = false
    useMswHandlers(
      http.get(FEED_PATH, () => HttpResponse.json({ data: feed({ items: [post()] }) })),
      http.put('/api/v1/community/posts/:postId/reaction', async () => {
        sent = true
        await gate.promise
        return HttpResponse.json({ data: one })
      })
    )
    try {
      const user = userEvent.setup()
      renderGrid()
      await user.click(await screen.findByTestId('lookbook-open-post-1'))
      const detail = await screen.findByTestId('community-detail')
      await user.click(within(detail).getByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(sent).toBe(true))
      await user.click(detailHeaderClose())
      expect(screen.queryByTestId('community-detail')).toBeNull()
      gate.release()
      const controls = screen.getByTestId('community-reactions-post-1')
      await within(controls).findByRole('button', { name: 'Applaud, 1' })
      expect(palette(controls)).toEqual(confirmedPalette)
    } finally {
      gate.release()
    }
  })
  it('6.3-WEB card and detail serialize intents for the same post', async () => {
    const gate = deferred()
    const requests: SetCommunityReactionInput[] = []
    useMswHandlers(
      http.get(FEED_PATH, () => HttpResponse.json({ data: feed({ items: [post()] }) })),
      http.put('/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        requests.push((await request.json()) as SetCommunityReactionInput)
        await gate.promise
        return HttpResponse.json({ data: one })
      })
    )
    try {
      const user = userEvent.setup()
      renderGrid()
      await user.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(requests).toHaveLength(1))
      await user.click(screen.getByTestId('lookbook-open-post-1'))
      const detail = await screen.findByTestId('community-detail')
      const love = within(detail).getByRole('button', { name: 'Love, 0' })
      expect(love).toHaveAttribute('aria-disabled', 'true')
      await user.click(love)
      gate.release()
      await within(detail).findByRole('button', { name: 'Applaud, 1' })
      expect(palette(within(detail).getByTestId('community-reactions-post-1'))).toEqual(
        confirmedPalette
      )
      expect(requests).toHaveLength(1)
    } finally {
      gate.release()
    }
  })
  it('6.3-WEB a feed started before mutation 404 cannot resurrect the post', async () => {
    const gate = deferred()
    let reads = 0
    useMswHandlers(
      http.get(FEED_PATH, async () => {
        const read = ++reads
        if (read > 1) await gate.promise
        return HttpResponse.json({
          data: feed({
            items:
              read > 1
                ? [
                    post(),
                    {
                      ...post(),
                      id: 'stale-feed-sentinel',
                      caption: 'Older feed completed.',
                    },
                  ]
                : [post()],
            mode: read > 1 ? 'all' : 'auto',
          }),
        })
      }),
      http.put('/api/v1/community/posts/:postId/reaction', () =>
        errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
      )
    )
    try {
      const user = userEvent.setup()
      renderGrid()
      const controls = await screen.findByTestId('community-reactions-post-1')
      await user.click(screen.getByTestId('community-filter-all'))
      await waitFor(() => expect(reads).toBe(2))
      await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull())
      gate.release()
      await screen.findByText('Older feed completed.')
      expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
    } finally {
      gate.release()
    }
  })
  it('6.3-WEB retained feed item protects confirmed summary against older feed', async () => {
    const gate = deferred()
    let reads = 0
    useMswHandlers(
      http.get(FEED_PATH, async () => {
        const read = ++reads
        if (read > 1) await gate.promise
        return HttpResponse.json({
          data: feed({
            items:
              read > 1
                ? [
                    post(),
                    {
                      ...post(),
                      id: 'stale-feed-sentinel',
                      caption: 'Older feed completed.',
                    },
                  ]
                : [post()],
            mode: read > 1 ? 'all' : 'auto',
          }),
        })
      }),
      http.put('/api/v1/community/posts/:postId/reaction', () =>
        HttpResponse.json({ data: one })
      )
    )
    try {
      const user = userEvent.setup()
      renderGrid()
      const controls = await screen.findByTestId('community-reactions-post-1')
      await user.click(screen.getByTestId('community-filter-all'))
      await waitFor(() => expect(reads).toBe(2))
      await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
      await within(controls).findByRole('button', { name: 'Applaud, 1' })
      gate.release()
      await screen.findByText('Older feed completed.')
      expect(palette(screen.getByTestId('community-reactions-post-1'))).toEqual(
        confirmedPalette
      )
    } finally {
      gate.release()
    }
  })
  it('6.3-WEB-021 reconciles an older detail response with the feed-confirmed reaction', async () => {
    const gate = deferred()
    const read = vi.spyOn(CommunityReactionState.prototype, 'read')
    let started = false
    useMswHandlers(
      http.get(FEED_PATH, () => HttpResponse.json({ data: feed({ items: [post()] }) })),
      http.get(POST_PATH, async () => {
        started = true
        await gate.promise
        return HttpResponse.json({
          data: { ...post(), caption: 'Older detail completed.' },
        })
      }),
      http.put('/api/v1/community/posts/:postId/reaction', () =>
        HttpResponse.json({ data: one })
      )
    )
    try {
      const user = userEvent.setup()
      renderGrid({ highlightedCardId: 'post-1' })
      const controls = await screen.findByTestId('community-reactions-post-1')
      await waitFor(() => expect(started).toBe(true))
      await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
      await within(controls).findByRole('button', { name: 'Applaud, 1' })
      gate.release()
      await waitFor(() =>
        expect(read).toHaveBeenCalledWith(
          expect.objectContaining({ caption: 'Older detail completed.' }),
          expect.any(Number)
        )
      )
      await act(async () => {
        await Promise.resolve()
      })
      // The consumed detail must preserve the feed-confirmed reaction.
      expect(palette(screen.getByTestId('community-reactions-post-1'))).toEqual(
        confirmedPalette
      )
    } finally {
      gate.release()
      read.mockRestore()
    }
  })
  it('6.3-WEB-022 preserves highlighted reaction focus and announces inside the modal', async () => {
    useMswHandlers(
      http.get(FEED_PATH, () => HttpResponse.json({ data: feed({ items: [post()] }) })),
      http.get(POST_PATH, () => HttpResponse.json({ data: post() })),
      http.put('/api/v1/community/posts/:postId/reaction', () =>
        HttpResponse.json({ data: one })
      )
    )
    const user = userEvent.setup()
    renderGrid({ highlightedCardId: 'post-1' })
    const card = await screen.findByTestId('lookbook-card-post-1')
    await waitFor(() => expect(card).toHaveFocus())
    const applause = within(card).getByRole('button', { name: 'Applaud, 0' })
    await user.click(applause)
    await within(card).findByRole('button', { name: 'Applaud, 1' })
    expect(applause).toHaveFocus()
    expect(screen.getByTestId('community-live-region')).toHaveTextContent(
      'Reaction saved.'
    )
    await user.click(screen.getByTestId('lookbook-open-post-1'))
    const detail = screen.getByTestId('community-detail')
    await user.click(within(detail).getByRole('button', { name: 'Love, 0' }))
    await waitFor(() =>
      expect(screen.getByTestId('community-detail-feedback')).toHaveTextContent(
        'Reaction saved.'
      )
    )
  })

  it('6.3-WEB-023 refreshes an off-page highlighted target and clears it on detail 404', async () => {
    let hidden = false
    useMswHandlers(
      http.get(FEED_PATH, () =>
        HttpResponse.json({ data: feed({ items: [], mode: hidden ? 'all' : 'auto' }) })
      ),
      http.get(POST_PATH, () =>
        hidden
          ? errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
          : HttpResponse.json({ data: post() })
      )
    )
    const user = userEvent.setup()
    renderGrid({ highlightedCardId: 'post-1' })
    await screen.findByTestId('lookbook-card-post-1')
    hidden = true
    await user.click(screen.getByTestId('community-filter-all'))
    await waitFor(() => expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull())
  })
  it('6.3-WEB-026 refresh evicts an ordinary open modal when detail returns 404', async () => {
    const gate = deferred()
    let hidden = false
    let detailStarted = false
    useMswHandlers(
      http.get(FEED_PATH, () =>
        HttpResponse.json({ data: feed({ items: hidden ? [] : [post()] }) })
      ),
      http.get(POST_PATH, async () => {
        detailStarted = true
        await gate.promise
        return errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
      })
    )
    try {
      const user = userEvent.setup()
      renderGrid()
      await user.click(await screen.findByTestId('lookbook-open-post-1'))
      expect(detailStarted).toBe(false)
      hidden = true
      fireEvent.error(cardImage())
      await waitFor(() => expect(detailStarted).toBe(true))
      expect(screen.getByTestId('community-detail')).toBeVisible()
      gate.release()
      await waitFor(() => expect(screen.queryByTestId('community-detail')).toBeNull())
      expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
    } finally {
      gate.release()
    }
  })
  it('6.3-WEB-024 rejects an older detail after mutation 404', async () => {
    const gate = deferred()
    const read = vi.spyOn(CommunityReactionState.prototype, 'read')
    let started = false
    useMswHandlers(
      http.get(FEED_PATH, () => HttpResponse.json({ data: feed({ items: [post()] }) })),
      http.get(POST_PATH, async () => {
        started = true
        await gate.promise
        return HttpResponse.json({
          data: { ...post(), caption: 'Fenced detail completed.' },
        })
      }),
      http.put('/api/v1/community/posts/:postId/reaction', () =>
        errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
      )
    )
    try {
      const user = userEvent.setup()
      renderGrid({ highlightedCardId: 'post-1' })
      const controls = await screen.findByTestId('community-reactions-post-1')
      await waitFor(() => expect(started).toBe(true))
      await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull())
      gate.release()
      // A fenced response has no renderable output. Observe the real coordinator
      // receiving this caption, then flush React before checking continued absence.
      await waitFor(() =>
        expect(read).toHaveBeenCalledWith(
          expect.objectContaining({ caption: 'Fenced detail completed.' }),
          expect.any(Number)
        )
      )
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
      expect(screen.queryByText('Fenced detail completed.')).toBeNull()
    } finally {
      gate.release()
      read.mockRestore()
    }
  })
  it.each(['withdrawn', 'published'] as const)(
    '6.3-WEB-025 clears cached aggregates when refresh returns an owner post with status %s and omitted reactions',
    async (status) => {
      let hidden = false
      const publicOwner = { ...post(), author: { displayName: 'You', isSelf: true } }
      const hiddenOwner = { ...publicOwner, status, reactions: undefined }
      useMswHandlers(
        http.get(FEED_PATH, () =>
          HttpResponse.json({
            data: feed({
              items: hidden ? [] : [publicOwner],
              mode: hidden ? 'all' : 'auto',
            }),
          })
        ),
        http.get(POST_PATH, () =>
          HttpResponse.json({ data: hidden ? hiddenOwner : publicOwner })
        )
      )
      const user = userEvent.setup()
      renderGrid({ highlightedCardId: 'post-1' })
      await user.click(await screen.findByTestId('lookbook-open-post-1'))
      const dialog = screen.getByTestId('community-detail')
      expect(within(dialog).getByTestId('community-reactions-post-1')).toBeVisible()
      hidden = true
      fireEvent.error(cardImage())
      await waitFor(() =>
        expect(
          screen
            .queryByTestId('community-card-grid')
            ?.querySelector('[data-testid="community-reactions-post-1"]')
        ).toBeNull()
      )
      await waitFor(() =>
        expect(
          screen
            .queryByTestId('community-detail')
            ?.querySelector('[data-testid="community-reactions-post-1"]') ?? null
        ).toBeNull()
      )
    }
  )
})
