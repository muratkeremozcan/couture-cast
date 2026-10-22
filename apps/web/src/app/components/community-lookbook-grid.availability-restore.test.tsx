// Story 6.5 R43: a client-side request deadline is transient and keeps verified content,
// and a required D3 hide returns the reader to the same place once the same items return.
import { CommunitySyncState } from '@couture/api-client'
import { act, screen } from '@testing-library/react'
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
const scrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
)
beforeEach(() => {
  window.sessionStorage.clear()
  signIn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  vi.useRealTimers()
  if (scrollIntoView)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

const OUTAGE = 'Community is temporarily unavailable. Your draft is saved.'
const POST_IDS = ['post-1', 'post-2', 'post-3']
const reactions = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  revision: 0,
  generation: 0,
  viewerReaction: null,
}

/** Serves three posts under a sync whose catch-ups the test drives. */
function useVerifiedFeedHandlers() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  const post = (id: string) => ({ ...item({ id }), reactions })
  const removed = new Set<string>()
  let held: Promise<void> | undefined
  let releaseHeld = () => undefined as void
  useMswHandlers(
    http.get(FEED_PATH, () =>
      HttpResponse.json({ data: feed({ items: POST_IDS.map(post), nextCursor: null }) })
    ),
    http.get('/api/v1/community/events', async () => {
      if (held) await held
      return HttpResponse.json({
        data: { events: [], nextCursor: 'cursor', hasMore: false, resyncRequired: false },
      })
    }),
    http.post('/api/v1/community/targets/resolve', async ({ request }) => {
      const { targets } = (await request.json()) as {
        targets: { key: string; postId: string }[]
      }
      return HttpResponse.json({
        data: {
          targets: targets.map((target) =>
            removed.has(target.postId)
              ? { key: target.key, status: 'unavailable' }
              : {
                  key: target.key,
                  status: 'available',
                  communityRevision: '0',
                  post: post(target.postId),
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
  return {
    sync: () => syncs[0]!,
    /** Marks a post as no longer visible to the reader. */
    remove: (id: string) => removed.add(id),
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
  await screen.findByTestId('lookbook-card-post-3')
  await act(async () => {
    await handlers.sync().catchUp()
  })
  return handlers
}

/**
 * jsdom has no layout. Cards sit 600 px apart in the document, and the window scroll
 * position moves them, as a browser would.
 */
function layoutWindow() {
  const page = { scrollY: 0 }
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => page.scrollY)
  const scrollBy = vi.fn((options?: ScrollToOptions) => {
    page.scrollY += options?.top ?? 0
  })
  vi.spyOn(window, 'scrollBy').mockImplementation(scrollBy as typeof window.scrollBy)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const index = POST_IDS.indexOf(
      (this.dataset.testid ?? '').replace('lookbook-card-', '')
    )
    const top = index < 0 ? 0 : 400 + index * 600 - page.scrollY
    const height = index < 0 ? 0 : 560
    return {
      top,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  })
  return { page, scrollBy }
}

/** Hides the feed as D3 requires: its last authorization is older than the 8 s bound. */
async function hideAsUnverified(handlers: ReturnType<typeof useVerifiedFeedHandlers>) {
  const release = handlers.hold()
  const verifiedAt = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(verifiedAt + 9000)
  let pending!: Promise<void>
  await act(async () => {
    handlers.sync().foreground()
    pending = handlers.sync().catchUp()
    await Promise.resolve()
  })
  return async () => {
    release()
    await act(() => pending)
  }
}

it('6.5-R43-WEB-001 a catch-up aborted at its 2 s client deadline keeps the verified feed', async () => {
  const handlers = await openVerifiedFeed(useVerifiedFeedHandlers())
  const card = screen.getByTestId('lookbook-card-post-1')
  // The server answers, but the response lands after the client's 2 s deadline.
  const release = handlers.hold()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    let pending!: Promise<void>
    await act(async () => {
      pending = handlers.sync().catchUp()
      await vi.advanceTimersByTimeAsync(2000)
      await pending
    })
    expect(screen.getByTestId('lookbook-card-post-1')).toBe(card)
    expect(screen.queryByText(OUTAGE)).toBeNull()
  } finally {
    vi.useRealTimers()
    release()
  }
})

it('6.5-R43-WEB-002 returns the reader to the same card when the same items come back after a required hide', async () => {
  const handlers = await openVerifiedFeed(useVerifiedFeedHandlers())
  const { page, scrollBy } = layoutWindow()
  // The reader is on the second card, 300 px of it above the top of the window.
  page.scrollY = 1300
  // Focus sits on a control outside the feed, which the restore must not move.
  const settings = document.querySelector<HTMLAnchorElement>(
    'a[href="/notification-settings"]'
  )!
  settings.focus()
  expect(document.activeElement).toBe(settings)

  const restore = await hideAsUnverified(handlers)
  // Content still unmounts while unverified, and the shorter page clamps the scroll.
  expect(screen.queryByTestId('lookbook-card-post-2')).toBeNull()
  page.scrollY = 0
  await restore()

  expect(await screen.findByTestId('lookbook-card-post-2')).toBeVisible()
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 1300, behavior: 'instant' })
  expect(page.scrollY).toBe(1300)
  expect(document.activeElement).toBe(settings)
})

it('6.5-R43-WEB-003 leaves the scroll alone when the returning items no longer include what was shown', async () => {
  const handlers = await openVerifiedFeed(useVerifiedFeedHandlers())
  const { page, scrollBy } = layoutWindow()
  page.scrollY = 1300

  const restore = await hideAsUnverified(handlers)
  expect(screen.queryByTestId('lookbook-card-post-2')).toBeNull()
  page.scrollY = 0
  handlers.remove('post-3')
  await restore()

  expect(await screen.findByTestId('lookbook-card-post-2')).toBeVisible()
  expect(screen.queryByTestId('lookbook-card-post-3')).toBeNull()
  expect(scrollBy).not.toHaveBeenCalled()
})
