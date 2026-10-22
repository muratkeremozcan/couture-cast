// Story 6.5 (D3/D9): a reconnect keeps a feed whose access was verified within the 8 s
// bound, hides it once that lapses or on a foreground restore, and announces an outage
// until verified content is visible again.
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

const OUTAGE = 'Community is temporarily unavailable. Your draft is saved.'

/** Serves one post under a sync whose catch-ups the test drives. */
function useVerifiedFeedHandlers() {
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
  let held: Promise<void> | undefined
  let releaseHeld = () => undefined as void
  useMswHandlers(
    http.get(FEED_PATH, () =>
      HttpResponse.json({ data: feed({ items: [post], nextCursor: null }) })
    ),
    http.get('/api/v1/community/events', async () => {
      if (held) await held
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
  return {
    sync: () => syncs[0]!,
    /** Holds every later event page until the returned release runs. */
    hold: () => {
      held = new Promise<void>((resolve) => {
        releaseHeld = () => {
          held = undefined
          resolve()
        }
      })
      return () => releaseHeld()
    },
  }
}

/** Renders the feed and lets one catch-up verify access. */
async function openVerifiedFeed(handlers: ReturnType<typeof useVerifiedFeedHandlers>) {
  renderGrid()
  const card = await screen.findByTestId('lookbook-card-post-1')
  await act(async () => {
    await handlers.sync().catchUp()
  })
  return { ...handlers, card }
}

it('keeps the feed, an open thread and its draft while recovering within the verification bound', async () => {
  const user = userEvent.setup()
  const view = await openVerifiedFeed(useVerifiedFeedHandlers())
  await user.click(screen.getByTestId('comments-button-post-1'))
  const composer = await screen.findByLabelText('Add a comment')
  await user.type(composer, 'Draft survives a reconnect')
  const dialog = screen.getByRole('dialog')

  const release = view.hold()
  let pending!: Promise<void>
  await act(async () => {
    // foreground() reports 'recovering' and starts a catch-up that is still in flight.
    view.sync().foreground()
    pending = view.sync().catchUp()
    await Promise.resolve()
  })
  try {
    expect(screen.getByTestId('lookbook-card-post-1')).toBe(view.card)
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(dialog).not.toHaveAttribute('aria-hidden')
    expect(dialog).toBeVisible()
    expect(composer).toHaveValue('Draft survives a reconnect')
    // A reconnect is not an outage and is not announced as one.
    expect(screen.queryByText(OUTAGE)).toBeNull()
  } finally {
    release()
    await act(() => pending)
  }
  expect(screen.getByTestId('lookbook-card-post-1')).toBe(view.card)
})

it('hides recovering content once its last authorization is older than the bound', async () => {
  const view = await openVerifiedFeed(useVerifiedFeedHandlers())
  const release = view.hold()
  const verifiedAt = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(verifiedAt + 9000)
  let pending!: Promise<void>
  await act(async () => {
    view.sync().foreground()
    pending = view.sync().catchUp()
    await Promise.resolve()
  })
  try {
    expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
  } finally {
    release()
    await act(() => pending)
  }
  expect(await screen.findByTestId('lookbook-card-post-1')).toBeVisible()
})

it('keeps content hidden through a foreground restore until a catch-up verifies access', async () => {
  const view = await openVerifiedFeed(useVerifiedFeedHandlers())
  const release = view.hold()
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
  })
  try {
    expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
    expect(screen.queryByText(OUTAGE)).toBeNull()
  } finally {
    release()
  }
  expect(await screen.findByTestId('lookbook-card-post-1')).toBeVisible()
})

it('keeps announcing an outage through a later recovering signal until content is visible', async () => {
  const view = await openVerifiedFeed(useVerifiedFeedHandlers())
  await act(async () => {
    view.sync().recover()
    await Promise.resolve()
  })
  expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
  expect(await screen.findByText(OUTAGE)).toBeVisible()
  const release = view.hold()
  let pending!: Promise<void>
  await act(async () => {
    // A transport retry that fails without a control reports 'recovering'.
    view.sync().foreground()
    pending = view.sync().catchUp()
    await Promise.resolve()
  })
  try {
    expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
    expect(screen.getByText(OUTAGE)).toBeVisible()
  } finally {
    release()
    await act(() => pending)
  }
  expect(await screen.findByTestId('lookbook-card-post-1')).toBeVisible()
  expect(screen.queryByText(OUTAGE)).toBeNull()
})
