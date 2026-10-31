// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
import { delay, http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  communityReactionFeedResponseSchema,
  type CommunityReactionSummary,
  type SetCommunityReactionInput,
  COMMUNITY_FEED_DISABLED_MESSAGE,
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

describe('Story 6.3 reactions through the web client', () => {
  const initial: CommunityReactionSummary = {
    counts: { applause: 0, love: 0, inspiration: 0 },
    total: 0,
    revision: 0,
    generation: 0,
    viewerReaction: null,
  }
  beforeEach(() => {
    window.sessionStorage.clear()
    signIn()
  })
  function useReactionHandlers(failFirst = false) {
    let summary = initial
    const requests: SetCommunityReactionInput[] = []
    useMswHandlers(
      http.get(FEED_PATH, ({ request }) => {
        expect(request.headers.get('x-couture-reactions')).toBe('1')
        expect(request.headers.get('x-couture-platform')).toBe('web')
        return HttpResponse.json(
          communityReactionFeedResponseSchema.parse({
            data: feed({ items: [Object.assign(item(), { reactions: summary })] }),
          })
        )
      }),
      http.put('/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        const intent = (await request.json()) as SetCommunityReactionInput
        requests.push(intent)
        if (failFirst && requests.length === 1) return HttpResponse.error()
        summary = {
          counts: {
            applause: intent.selection === 'applause' ? 1 : 0,
            love: intent.selection === 'love' ? 1 : 0,
            inspiration: intent.selection === 'inspiration' ? 1 : 0,
          },
          total: intent.selection === null ? 0 : 1,
          revision: summary.revision + 1,
          generation: summary.generation + 1,
          viewerReaction: intent.selection,
        }
        return HttpResponse.json({ data: summary })
      })
    )
    return requests
  }
  it('uses labeled toggles and keeps the card and detail in sync for add, replace and removal', async () => {
    const requests = useReactionHandlers()
    const user = userEvent.setup()
    renderGrid()
    const controls = await screen.findByTestId('community-reactions-post-1')
    const applause = within(controls).getByRole('button', { name: 'Applaud, 0' })
    applause.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(applause).toHaveAttribute('aria-pressed', 'true'))
    await user.click(within(controls).getByRole('button', { name: 'Love, 0' }))
    await waitFor(() =>
      expect(within(controls).getByRole('button', { name: 'Love, 1' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    )
    await user.click(screen.getByTestId('lookbook-open-post-1'))
    const detail = await screen.findByTestId('community-detail')
    await user.click(within(detail).getByRole('button', { name: 'Love, 1' }))
    // The open look modal hides the grid card from assistive tech
    // (accessible-modal.tsx L51-71), so the synced card control is a hidden node.
    await waitFor(() =>
      expect(
        within(controls).getByRole('button', { name: 'Love, 0', hidden: true })
      ).toHaveAttribute('aria-pressed', 'false')
    )
    expect(requests.map((request) => request.selection)).toEqual([
      'applause',
      'love',
      null,
    ])
    expect(requests.map((request) => request.baseRevision)).toEqual([0, 1, 2])
  })
  it('updates each repeated success announcement only on the active surface', async () => {
    useReactionHandlers()
    const user = userEvent.setup()
    renderGrid()
    const controls = await screen.findByTestId('community-reactions-post-1')
    const live = screen.getByTestId('community-live-region')
    await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
    await waitFor(() => expect(live.textContent).toBe('Reaction saved.'))
    const first = live.firstChild
    await user.click(within(controls).getByRole('button', { name: 'Love, 0' }))
    await within(controls).findByRole('button', { name: 'Love, 1' })
    expect(screen.getByTestId('community-live-region')).toBe(live)
    expect(live.textContent).toBe('Reaction saved.')
    expect(live.firstChild).not.toBe(first)
    await user.click(screen.getByTestId('lookbook-open-post-1'))
    const detail = screen.getByTestId('community-detail')
    const feedback = screen.getByTestId('community-detail-feedback')
    await user.click(within(detail).getByRole('button', { name: 'Love, 1' }))
    await waitFor(() => expect(feedback.textContent).toBe('Reaction saved.'))
    const second = feedback.firstChild
    await user.click(within(detail).getByRole('button', { name: 'Applaud, 0' }))
    await within(detail).findByRole('button', { name: 'Applaud, 1' })
    expect(screen.getByTestId('community-detail-feedback')).toBe(feedback)
    expect(feedback.textContent).toBe('Reaction saved.')
    expect(feedback.firstChild).not.toBe(second)
    expect(live.textContent).toBe('')
  })
  it('bounds malformed conflict fallback and retries the original intent after timeout', async () => {
    const requests = useReactionHandlers()
    const signals: AbortController[] = []
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController()
      signals.push(controller)
      return controller.signal
    })
    let detailStarted = false
    let first = true
    useMswHandlers(
      http.put('/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        const intent = (await request.json()) as SetCommunityReactionInput
        requests.push(intent)
        if (first) {
          first = false
          return HttpResponse.json({ message: 'Malformed conflict' }, { status: 409 })
        }
        return HttpResponse.json({
          data: {
            ...initial,
            counts: { applause: 1, love: 0, inspiration: 0 },
            total: 1,
            viewerReaction: 'applause',
            revision: 1,
            generation: 1,
          },
        })
      }),
      http.get(POST_PATH, async () => {
        detailStarted = true
        await delay(200)
        return HttpResponse.json({ data: { ...item(), reactions: initial } })
      })
    )
    try {
      const user = userEvent.setup()
      renderGrid()
      const controls = await screen.findByTestId('community-reactions-post-1')
      await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(detailStarted).toBe(true))
      expect(timeout).toHaveBeenNthCalledWith(2, 15000)
      signals[1]!.abort(new DOMException('Timed out', 'TimeoutError'))
      await user.click(
        await within(controls).findByRole('button', { name: 'Retry reaction' })
      )
      await within(controls).findByRole('button', { name: 'Applaud, 1' })
      expect(requests[1]).toEqual(requests[0])
    } finally {
      timeout.mockRestore()
    }
  })
  it('keeps confirmed counts on failure and retains the mutation ID for retry', async () => {
    const requests = useReactionHandlers(true)
    const user = userEvent.setup()
    renderGrid()
    const controls = await screen.findByTestId('community-reactions-post-1')
    await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
    await user.click(
      await within(controls).findByRole('button', { name: 'Retry reaction' })
    )
    await waitFor(() =>
      expect(
        within(controls).getByRole('button', { name: 'Applaud, 1' })
      ).toHaveAttribute('aria-pressed', 'true')
    )
    expect(requests[0]).toEqual(requests[1])
  })
  it('reconciles a conflict and evicts a post that becomes hidden', async () => {
    useReactionHandlers()
    const newer: CommunityReactionSummary = {
      counts: { applause: 0, love: 1, inspiration: 0 },
      total: 1,
      revision: 2,
      generation: 2,
      viewerReaction: 'love',
    }
    useMswHandlers(
      http.put('/api/v1/community/posts/:postId/reaction', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            error: 'Conflict',
            message: 'Reaction changed. Refresh and try again.',
            data: newer,
          },
          { status: 409 }
        )
      )
    )
    const user = userEvent.setup()
    renderGrid()
    const controls = await screen.findByTestId('community-reactions-post-1')
    await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
    await waitFor(() =>
      expect(within(controls).getByRole('button', { name: 'Love, 1' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    )
    expect(
      within(controls).getByText('Your reaction changed on another device. Choose again.')
    ).toBeVisible()
    useMswHandlers(
      http.put('/api/v1/community/posts/:postId/reaction', () =>
        errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
      )
    )
    await user.click(within(controls).getByRole('button', { name: 'Love, 1' }))
    await waitFor(() =>
      expect(screen.queryByTestId('lookbook-card-post-1')).not.toBeInTheDocument()
    )
  })

  it('allows retraction after a write freeze refuses a replacement', async () => {
    const requests = useReactionHandlers()
    const user = userEvent.setup()
    renderGrid()
    const controls = await screen.findByTestId('community-reactions-post-1')
    await user.click(within(controls).getByRole('button', { name: 'Applaud, 0' }))
    await waitFor(() =>
      expect(
        within(controls).getByRole('button', { name: 'Applaud, 1' })
      ).toHaveAttribute('aria-pressed', 'true')
    )
    useMswHandlers(
      http.put('/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        const intent = (await request.json()) as SetCommunityReactionInput
        requests.push(intent)
        if (intent.selection !== null)
          return errorBody(503, COMMUNITY_FEED_DISABLED_MESSAGE, 'Service Unavailable')
        return HttpResponse.json({ data: { ...initial, revision: 2, generation: 2 } })
      })
    )
    await user.click(within(controls).getByRole('button', { name: 'Love, 0' }))
    await within(controls).findByText('The community feed is temporarily unavailable.')
    await user.click(within(controls).getByRole('button', { name: 'Applaud, 1' }))
    await waitFor(() =>
      expect(
        within(controls).getByRole('button', { name: 'Applaud, 0' })
      ).toHaveAttribute('aria-pressed', 'false')
    )
    expect(requests.map((request) => request.selection)).toEqual([
      'applause',
      'love',
      null,
    ])
  })
})
