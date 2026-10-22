// Story 6.5 (D3/D9): a reconnecting socket never blanks a feed HTTP is serving.
import { CommunitySyncState } from '@couture/api-client'
import { act, screen } from '@testing-library/react'
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

it('keeps the feed, an open thread and its draft while the socket recovers', async () => {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  const post = {
    ...item(),
    reactions: {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      revision: 0,
      generation: 0,
      viewerReaction: null,
    },
  }
  let holdEvents = false
  let releaseEvents!: () => void
  const held = new Promise<void>((resolve) => {
    releaseEvents = resolve
  })
  useMswHandlers(
    http.get(FEED_PATH, () =>
      HttpResponse.json({ data: feed({ items: [post], nextCursor: null }) })
    ),
    http.get('/api/v1/community/events', async () => {
      if (holdEvents) await held
      return HttpResponse.json({
        data: { events: [], nextCursor: 'cursor', hasMore: false, resyncRequired: false },
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
        data: { items: [], nextCursor: null, snapshot: 1, hasNewer: false },
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
  const composer = await screen.findByLabelText('Add a comment')
  await user.type(composer, 'Draft survives a reconnect')
  const dialog = screen.getByRole('dialog')

  holdEvents = true
  let pending!: Promise<void>
  await act(async () => {
    // foreground() reports 'recovering' and starts a catch-up that is still in flight.
    syncs[0]!.foreground()
    pending = syncs[0]!.catchUp()
    await Promise.resolve()
  })
  try {
    expect(screen.getByTestId('lookbook-card-post-1')).toBe(card)
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(dialog).not.toHaveAttribute('aria-hidden')
    expect(dialog).toBeVisible()
    expect(composer).toHaveValue('Draft survives a reconnect')
    // A reconnect is not an outage and is not announced as one.
    expect(
      screen.queryByText('Community is temporarily unavailable. Your draft is saved.')
    ).toBeNull()
  } finally {
    releaseEvents()
    await act(() => pending)
  }
  expect(screen.getByTestId('lookbook-card-post-1')).toBe(card)
})
