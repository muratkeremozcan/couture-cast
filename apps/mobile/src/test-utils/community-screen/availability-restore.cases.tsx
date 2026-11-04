/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.5 R43: a client-side deadline is transient and keeps verified content, and a
// required D3 hide gives the member back their place in the feed when the same items return.
// R46: the same hide gives back an unsent comment and the composer focus it had.
// R48: and only on Community, when access returns while another tab is on screen.
import { CommunitySyncState } from '@couture/api-client'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { actStep } from '@/src/test-utils/act-step'
import { View } from 'react-native'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { server } from '@/src/test-utils/msw/server'
import { press } from '@/src/test-utils/press'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { COMMUNITY_BANNED_MESSAGE } from '@couture/api-client/contracts/http'
import { feedJson, item, serveFeed } from './harness'
import { refreshEvents } from './mock-state'

const summary = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  viewerReaction: null,
  revision: 0,
  generation: 0,
}
const POST_IDS = ['post-a', 'post-b', 'post-c', 'post-d', 'post-e', 'post-f']

/** Serves a verified feed under a sync whose catch-ups the test drives. */
function verifiedFeed() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  const look = (id: string) => item({ id, reactions: summary })
  serveFeed(() => feedJson({ items: POST_IDS.map(look) }))
  let held: Promise<void> | undefined
  server.use(
    http.get('*/api/v1/community/events', async () => {
      if (held) await held
      return HttpResponse.json({
        data: {
          events: [],
          nextCursor: 'verified',
          hasMore: false,
          resyncRequired: false,
        },
      })
    }),
    http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
      const { targets } = (await request.json()) as {
        targets: { key: string; postId: string }[]
      }
      return HttpResponse.json({
        data: {
          targets: targets.map((target) => ({
            key: target.key,
            status: 'available',
            communityRevision: '0',
            post: look(target.postId),
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
  return {
    sync: () => syncs[0]!,
    latest: () => syncs.at(-1)!,
    started: () => syncs.length,
    /** Holds every later event page past its 2 s client deadline until released. */
    hold: () => {
      let release!: () => void
      held = new Promise<void>((resolve) => {
        release = () => {
          held = undefined
          resolve()
        }
      })
      return release
    },
  }
}

/** Renders the screen in a phone-sized frame and lets one catch-up verify access. */
async function openVerifiedFeed(feed: ReturnType<typeof verifiedFeed>) {
  await render(
    <View style={{ height: 640 }}>
      <CommunityScreen />
    </View>
  )
  await screen.findByTestId('community-post-card-post-a')
  await act(async () => {
    const sync = feed.sync()
    sync.foreground()
    await sync.catchUp()
  })
  return screen.findByTestId('community-post-card-post-a')
}

/**
 * Opens the post-a comments sheet, types into its focused composer, and lets the
 * verification's stale timer hide the content (D3). `whileHidden` runs during the hide,
 * before access returns.
 */
async function typeThroughStaleHide(whileHidden?: () => void) {
  const feed = verifiedFeed()
  server.use(
    http.get('*/api/v1/community/posts/post-a/comments', () =>
      HttpResponse.json({
        data: { items: [], nextCursor: null, snapshot: 1, hasNewer: false },
      })
    ),
    http.get('*/api/v1/community/posts/post-a/comment-submissions', () =>
      HttpResponse.json({ data: { items: [], nextCursor: null } })
    )
  )
  await openVerifiedFeed(feed)
  press(screen.getByTestId('community-card-comments-post-a'))
  const composer = await screen.findByTestId<HTMLInputElement>('comment-body')
  composer.focus()
  fireEvent.change(composer, { target: { value: 'Typing on a slow phone' } })

  // This catch-up verifies access at `verifiedFrom` or a little later.
  const verifiedFrom = Date.now()
  await act(() => feed.sync().catchUp())
  const release = feed.hold()
  let pending!: Promise<void>
  // The socket drops 7.8 s after that verification. Content stays for the rest of the
  // 8 s bound (D3), then the verification's stale timer hides it while the held
  // catch-up still cannot verify access.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(verifiedFrom + 7_800)
  try {
    await actStep(() => {
      const sync = feed.sync()
      sync.foreground()
      pending = sync.catchUp()
    })
    expect(screen.getByTestId('comment-body')).toBe(composer)
    await waitFor(() => expect(screen.queryByTestId('comment-body')).toBeNull())
    expect(screen.getByTestId('community-feed-unavailable')).toBeTruthy()
    whileHidden?.()
  } finally {
    clock.mockRestore()
    release()
    await act(() => pending)
  }
}

const DENIED = () =>
  HttpResponse.json(
    { statusCode: 403, code: 'community_access_denied', message: 'Denied' },
    { status: 403 }
  )
const BANNED = () =>
  HttpResponse.json(
    {
      statusCode: 403,
      code: 'community_banned',
      message: COMMUNITY_BANNED_MESSAGE,
      sanction: {
        kind: 'temporary',
        expiresAt: '2026-11-11T12:00:00.000Z',
        appealStatus: 'not_requested',
      },
    },
    { status: 403 }
  )

export function registerCommunityAvailabilityRestoreCases() {
  it('R3-4 a refresh after a ban ends brings back the cards, the actions and the sync', async () => {
    const feed = verifiedFeed()
    await openVerifiedFeed(feed)
    const look = () => item({ id: 'post-a', reactions: summary })

    // The real sync takes the denial and stops itself. The screen's probe finds the ban.
    server.use(
      http.get('*/api/v1/community/events', DENIED),
      http.get('*/api/v1/community/feed', BANNED)
    )
    await act(async () => {
      await feed.latest().catchUp()
    })
    await screen.findByTestId('community-banned-notice')
    expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()

    // The ban ends with no change of account or mode.
    let eventReads = 0
    server.use(
      http.get('*/api/v1/community/events', () => {
        eventReads += 1
        return HttpResponse.json({
          data: {
            events: [],
            nextCursor: 'after-ban',
            hasMore: false,
            resyncRequired: false,
          },
        })
      }),
      http.get('*/api/v1/community/feed', () => feedJson({ items: [look()] }))
    )
    const startedBefore = feed.started()
    await waitFor(() => expect(refreshEvents.onRefresh).toBeTypeOf('function'))
    act(() => refreshEvents.onRefresh!())

    await screen.findByTestId('community-post-card-post-a')
    expect(screen.queryByTestId('community-banned-notice')).toBeNull()
    expect(screen.queryByTestId('community-feed-unavailable')).toBeNull()
    expect(screen.getByTestId('community-card-comments-post-a')).toBeVisible()
    expect(screen.getByTestId('community-new-post-button')).toBeVisible()

    await waitFor(() => expect(feed.started()).toBeGreaterThan(startedBefore))
    await act(async () => {
      const sync = feed.latest()
      sync.foreground()
      await sync.catchUp()
    })
    expect(eventReads).toBeGreaterThan(0)
    expect(screen.getByTestId('community-post-card-post-a')).toBeVisible()
  }, 15_000)

  it('R3-4 a refresh after a plain denial ends brings the feed back too', async () => {
    const feed = verifiedFeed()
    await openVerifiedFeed(feed)
    server.use(http.get('*/api/v1/community/events', DENIED))
    await act(async () => {
      await feed.latest().catchUp()
    })
    await screen.findByTestId('community-feed-unavailable')

    server.use(
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events: [],
            nextCursor: 'after-denial',
            hasMore: false,
            resyncRequired: false,
          },
        })
      )
    )
    const startedBefore = feed.started()
    await waitFor(() => expect(refreshEvents.onRefresh).toBeTypeOf('function'))
    act(() => refreshEvents.onRefresh!())
    await screen.findByTestId('community-post-card-post-a')
    expect(screen.queryByTestId('community-feed-unavailable')).toBeNull()
    await waitFor(() => expect(feed.started()).toBeGreaterThan(startedBefore))
  }, 15_000)

  it('6.5-R43-MOB-001 a catch-up aborted at its 2 s client deadline keeps the verified feed', async () => {
    const feed = verifiedFeed()
    const card = await openVerifiedFeed(feed)
    // The server answers, but the response lands after the client's 2 s deadline.
    const release = feed.hold()
    let pending!: Promise<void>
    try {
      await actStep(() => {
        pending = feed.sync().catchUp()
      })
      await act(() => pending)
      expect(screen.getByTestId('community-post-card-post-a')).toBe(card)
      expect(screen.queryByTestId('community-feed-unavailable')).toBeNull()
    } finally {
      release()
    }
  }, 15_000)

  it('6.5-R43-MOB-002 restores the feed scroll offset when the same items return after a required hide', async () => {
    const feed = verifiedFeed()
    await openVerifiedFeed(feed)
    const list = screen.getByTestId('community-feed-list')
    await waitFor(() =>
      expect(list.scrollHeight - list.clientHeight).toBeGreaterThan(600)
    )
    list.scrollTop = 600
    fireEvent.scroll(list)
    expect(list.scrollTop).toBe(600)

    const release = feed.hold()
    let pending!: Promise<void>
    // The last successful authorization is now older than the 8 s bound (D3).
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9000)
    try {
      await actStep(() => {
        const sync = feed.sync()
        sync.foreground()
        pending = sync.catchUp()
      })
      // Content still unmounts while unverified, and the emptied list loses its offset.
      expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      expect(screen.getByTestId('community-feed-unavailable')).toBeTruthy()
      await waitFor(() => expect(list.scrollTop).toBe(0))
    } finally {
      clock.mockRestore()
      release()
      await act(() => pending)
    }
    await screen.findByTestId('community-post-card-post-a')
    await waitFor(() => expect(list.scrollTop).toBe(600))
  })

  it('6.5-R46-MOB-001 gives the composer back its draft and focus after a stale-access hide', async () => {
    await typeThroughStaleHide()
    const restored = await screen.findByTestId<HTMLInputElement>('comment-body')
    expect(restored.value).toBe('Typing on a slow phone')
    await waitFor(() => expect(document.activeElement).toBe(restored))
  })

  it('6.5-R48-MOB-001 keeps the comments sheet off Home when access returns there', async () => {
    // The member leaves for the Home tab while the hide is up.
    await typeThroughStaleHide(() => act(() => screenFocus.set(false)))
    // Access is back: the feed renders behind Home, and the sheet waits for Community.
    await screen.findByTestId('community-post-card-post-a')
    expect(screen.queryByTestId('comment-body')).toBeNull()
    expect(screen.queryByTestId('comments-close')).toBeNull()

    act(() => screenFocus.set(true))
    const restored = await screen.findByTestId<HTMLInputElement>('comment-body')
    expect(restored.value).toBe('Typing on a slow phone')
    await waitFor(() => expect(document.activeElement).toBe(restored))
  })
}
