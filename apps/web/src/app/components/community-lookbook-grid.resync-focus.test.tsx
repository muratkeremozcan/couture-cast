// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { CommunitySyncState } from '@couture/api-client'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  feed,
  item,
  renderGrid,
  setupCommunityGridClock,
  signIn,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()
const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  window.sessionStorage.clear()
  signIn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

it('F1 removal-marker rebuild preserves the mounted feed, sheet and focused composer', async () => {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  const summary = {
    counts: { applause: 0, love: 0, inspiration: 0 },
    total: 0,
    revision: 0,
    generation: 0,
    viewerReaction: null,
  }
  const post = { ...item(), reactions: summary }
  let removed = false,
    marker = false,
    rebuilding = false
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  useMswHandlers(
    http.get(FEED_PATH, async () => {
      if (removed) {
        rebuilding = true
        await held
      }
      return HttpResponse.json({ data: feed({ items: [post], nextCursor: null }) })
    }),
    http.get('/api/v1/community/events', () => {
      const resyncRequired = marker
      marker = false
      return HttpResponse.json({
        data: {
          events: resyncRequired
            ? [{ version: 1, kind: 'resync', resyncRequired: true }]
            : [],
          nextCursor: 'removal-cursor',
          hasMore: false,
          resyncRequired,
        },
      })
    }),
    http.post('/api/v1/community/targets/resolve', () =>
      HttpResponse.json({
        data: {
          targets: [
            {
              key: post.id,
              status: 'available',
              communityRevision: '0',
              post,
              comment: null,
              parent: null,
              pageCursor: null,
              parentPageCursor: null,
              threadPosition: null,
            },
          ],
        },
      })
    ),
    http.get('/api/v1/community/posts/post-1/comments', () =>
      HttpResponse.json({
        data: {
          items: removed
            ? []
            : [
                {
                  id: 'root',
                  postId: 'post-1',
                  parentId: null,
                  body: 'Visible comment before removal.',
                  author: 'Explorer',
                  isOwn: false,
                  unavailable: false,
                  publicationSequence: 1,
                  publishedAt: '2026-10-19T11:00:00Z',
                  replyCount: 0,
                },
              ],
          nextCursor: null,
          snapshot: removed ? 2 : 1,
          hasNewer: false,
        },
      })
    ),
    http.get('/api/v1/community/posts/post-1/comment-submissions', () =>
      HttpResponse.json({ data: { items: [], nextCursor: null } })
    )
  )
  const user = userEvent.setup()
  renderGrid()
  const card = await screen.findByTestId('lookbook-card-post-1')
  await act(async () => {
    await syncs[0]!.catchUp()
  })
  await user.click(screen.getByTestId('comments-button-post-1'))
  await screen.findByText('Visible comment before removal.')
  const composer = screen.getByLabelText('Add a comment')
  await act(async () => {
    composer.focus()
    fireEvent.change(composer, { target: { value: 'Keep my owned draft' } })
    return Promise.resolve()
  })
  const dialog = screen.getByRole('dialog')
  // A suspended modal stays in the DOM but is `aria-hidden`, `inert` and
  // `display: none`, so `getByRole` alone would stop finding it without saying
  // why. Resolve it with `hidden: true` and assert the live state directly.
  const expectDialogLive = () => {
    expect(screen.getByRole('dialog', { hidden: true })).toBe(dialog)
    expect(dialog).toBeVisible()
    expect(dialog).not.toHaveAttribute('aria-hidden')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(
      screen.queryByText('Community is temporarily unavailable. Your draft is saved.')
    ).toBeNull()
  }
  removed = true
  marker = true
  try {
    await act(async () => {
      await syncs[0]!.catchUp()
    })
    await waitFor(() => expect(rebuilding).toBe(true))
    expect(screen.getByLabelText('Add a comment')).toBe(composer)
    expect(composer).toHaveFocus()
    expectDialogLive()
    expect(screen.getByTestId('lookbook-card-post-1')).toBe(card)
  } finally {
    release()
  }
  await act(async () => {
    await syncs[0]!.catchUp()
  })
  await waitFor(() =>
    expect(screen.queryByText('Visible comment before removal.')).toBeNull()
  )
  expectDialogLive()
  expect(screen.getByTestId('lookbook-card-post-1')).toBe(card)
  expect(screen.getByLabelText('Add a comment')).toBe(composer)
  expect(composer).toHaveValue('Keep my owned draft')
  expect(composer).toHaveFocus()
})
