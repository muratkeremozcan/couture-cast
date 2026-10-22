/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.5 R43: a client-side deadline is transient and keeps verified content, and a
// required D3 hide gives the member back their place in the feed when the same items return.
import { CommunitySyncState } from '@couture/api-client'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { View } from 'react-native'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { server } from '@/src/test-utils/msw/server'
import { feedJson, item, serveFeed } from './harness'

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

export function registerCommunityAvailabilityRestoreCases() {
  it('6.5-R43-MOB-001 a catch-up aborted at its 2 s client deadline keeps the verified feed', async () => {
    const feed = verifiedFeed()
    const card = await openVerifiedFeed(feed)
    // The server answers, but the response lands after the client's 2 s deadline.
    const release = feed.hold()
    let pending!: Promise<void>
    try {
      await act(() => {
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
      await act(() => {
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
}
