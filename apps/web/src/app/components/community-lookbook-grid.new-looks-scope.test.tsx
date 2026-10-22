// Story 6.5 (PR #157 review P2): new looks buffered under one feed filter never land in
// another. A filter change drops the buffer and retires an insertion already under way;
// target resolution itself stays filter-agnostic.
import { CommunitySyncState } from '@couture/api-client'
import { act, screen, waitFor } from '@testing-library/react'
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

const reactions = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  revision: 0,
  generation: 0,
  viewerReaction: null,
}
const look = (id: string) => ({ ...item({ id }), reactions })

/** A cold_dry feed that gains one published look, and a warm_wet feed beside it. */
function useTwoFilterFeeds() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  const state = { published: false, resolveHeld: undefined as Promise<void> | undefined }
  useMswHandlers(
    http.get(FEED_PATH, ({ request }) => {
      const warm = new URL(request.url).searchParams.get('mode') === 'warm_wet'
      const items = warm
        ? [look('post-warm')]
        : [look('post-cold'), ...(state.published ? [look('post-cold-new')] : [])]
      return HttpResponse.json({
        data: feed({ items, mode: warm ? 'warm_wet' : 'cold_dry' }),
      })
    }),
    http.get('/api/v1/community/events', () =>
      HttpResponse.json({
        data: {
          events: state.published
            ? [
                {
                  version: 1,
                  kind: 'post.published',
                  postId: 'post-cold-new',
                  communityRevision: '1',
                },
              ]
            : [],
          nextCursor: 'scope',
          hasMore: false,
          resyncRequired: false,
        },
      })
    ),
    // Resolution answers for any public post, whatever filter is selected.
    http.post('/api/v1/community/targets/resolve', async ({ request }) => {
      const { targets } = (await request.json()) as {
        targets: { key: string; postId: string }[]
      }
      if (targets.some((target) => target.postId === 'post-cold-new'))
        await state.resolveHeld
      return HttpResponse.json({
        data: {
          targets: targets.map((target) => ({
            key: target.key,
            status: 'available',
            communityRevision: '1',
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
  return { syncs, state }
}

/** Opens cold_dry, then lets a catch-up buffer the newly published look. */
async function bufferColdLook(feeds: ReturnType<typeof useTwoFilterFeeds>) {
  const user = userEvent.setup()
  renderGrid()
  await user.click(await screen.findByTestId('community-filter-cold_dry'))
  await screen.findByTestId('lookbook-card-post-cold')
  await act(async () => {
    await feeds.syncs.at(-1)!.catchUp()
  })
  feeds.state.published = true
  await act(async () => {
    await feeds.syncs.at(-1)!.catchUp()
  })
  await screen.findByRole('button', { name: 'Show 1 new looks' })
  return user
}

it('drops looks buffered under the previous filter when the filter changes', async () => {
  const feeds = useTwoFilterFeeds()
  const user = await bufferColdLook(feeds)
  await user.click(screen.getByTestId('community-filter-warm_wet'))
  await screen.findByTestId('lookbook-card-post-warm')
  expect(screen.queryByRole('button', { name: 'Show 1 new looks' })).toBeNull()
  expect(screen.queryByTestId('lookbook-card-post-cold-new')).toBeNull()
})

it('never inserts looks from an insertion started before the filter changed', async () => {
  const feeds = useTwoFilterFeeds()
  const user = await bufferColdLook(feeds)
  let release!: () => void
  feeds.state.resolveHeld = new Promise<void>((resolve) => {
    release = resolve
  })
  await user.click(screen.getByRole('button', { name: 'Show 1 new looks' }))
  await user.click(screen.getByTestId('community-filter-warm_wet'))
  await screen.findByTestId('lookbook-card-post-warm')
  release()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  await waitFor(() =>
    expect(screen.getByTestId('lookbook-card-post-warm')).toBeInTheDocument()
  )
  expect(screen.queryByTestId('lookbook-card-post-cold-new')).toBeNull()
})
