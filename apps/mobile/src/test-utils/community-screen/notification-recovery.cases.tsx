/* eslint-disable @typescript-eslint/await-thenable */
// T05: actual screen/coordinator/HTTP wiring; only the external socket and native surfaces are controlled.
import { CommunitySyncState } from '@couture/api-client'
import type { ResolveCommunityTargetsInput } from '@couture/api-client/contracts/http'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import { render } from 'vitest-browser-react'
import { beforeAll, expect, it, vi } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { CommunityScreen } from '@/src/features/community/community-screen'
import * as community from '@/src/lib/community'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { server } from '@/src/test-utils/msw/server'
import { press } from '@/src/test-utils/press'
import {
  feedJson,
  item,
  serveFeed,
  setMockParams,
  mockCapture,
  errorEnvelope,
} from './harness'

vi.mock('socket.io-client', () => ({
  io: () => {
    const callbacks = new Map<string, (...args: unknown[]) => void>()
    const socket = {
      on: (event: string, callback: (...args: unknown[]) => void) => {
        callbacks.set(event, callback)
        return socket
      },
      connect: () => queueMicrotask(() => callbacks.get('connect')?.()),
      disconnect: () => undefined,
      removeAllListeners: () => callbacks.clear(),
    }
    return socket
  },
}))
// Captured once before per-test spies; invoked with the original coordinator receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const startCoordinator = CommunitySyncState.prototype.start
let actualCommunity: typeof community
const summary = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  viewerReaction: null,
  revision: 0,
  generation: 0,
}
const post = (id = 'post-a') => item({ id, reactions: summary })
const rootComment = {
  id: 'target-root',
  postId: 'post-a',
  parentId: null,
  body: 'Exact parent context',
  author: 'Explorer',
  isOwn: false,
  unavailable: false,
  publicationSequence: 1,
  publishedAt: '2026-10-19T11:00:00Z',
  replyCount: 1,
}
const reply = {
  ...rootComment,
  id: 'target-reply',
  parentId: 'target-root',
  body: 'Exact notification reply',
  publicationSequence: 2,
  replyCount: 0,
}
function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
function notification(kind: 'card' | 'reply' = 'reply') {
  setMockParams({
    source: 'notification',
    type: 'community',
    cardId: 'post-a',
    ...(kind === 'reply' ? { commentId: reply.id, parentId: rootComment.id } : {}),
  })
}
function available(
  target: ResolveCommunityTargetsInput['targets'][number],
  revision: number
) {
  return {
    key: target.key,
    status: 'available',
    communityRevision: String(revision),
    post: post(target.postId),
    comment: target.commentId ? reply : null,
    parent: target.commentId ? rootComment : null,
    pageCursor: null,
    parentPageCursor: null,
    threadPosition: target.commentId ? 1 : null,
  }
}
function journey(
  options: {
    live?: boolean
    notification?: (call: number) => Promise<void>
    unavailableNotification?: boolean
    removedChild?: boolean
  } = {}
) {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState,
    ...args: Parameters<CommunitySyncState['start']>
  ) {
    syncs.push(this)
    if (options.live) startCoordinator.apply(this, args)
  })
  const state = {
    revision: 0,
    hidden: false,
    published: false,
    failInsert: false,
    notificationCalls: 0,
  }
  const rootRequests: URL[] = [],
    replyRequests: URL[] = [],
    eventStarts: number[] = [],
    targetBodies: ResolveCommunityTargetsInput[] = []
  const pending: Promise<unknown>[] = []
  const realClient = actualCommunity.communitySyncFromMobile
  vi.spyOn(community, 'communitySyncFromMobile').mockImplementation((...args) => {
    const client = realClient(...args)
    return {
      ...client,
      resolve: (...input) => {
        const flight = client.resolve(...input)
        if (input[0].targets.some((target) => target.key === 'notification')) {
          pending.push(flight)
          void flight.catch(() => undefined)
        }
        return flight
      },
    }
  })
  serveFeed(() =>
    feedJson({
      items: [post(), ...(state.published ? [post('post-new')] : [post('post-b')])],
    })
  )
  server.use(
    http.get('*/api/v1/community/events', () => {
      eventStarts.push(performance.now())
      return HttpResponse.json({
        data: {
          events: state.revision
            ? [
                {
                  version: 1,
                  kind: state.published ? 'post.published' : 'reactions.changed',
                  postId: state.published ? 'post-new' : 'post-b',
                  communityRevision: String(state.revision),
                },
              ]
            : [],
          nextCursor: 'notification-recovery',
          hasMore: false,
          resyncRequired: false,
        },
      })
    }),
    http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
      const body = (await request.json()) as ResolveCommunityTargetsInput
      targetBodies.push(body)
      if (body.targets[0]?.key === 'notification')
        await options.notification?.(++state.notificationCalls)
      if (
        state.failInsert &&
        body.targets.length === 1 &&
        body.targets[0]?.postId === 'post-new'
      ) {
        state.failInsert = false
        return errorEnvelope(503, 'Unavailable')
      }
      return HttpResponse.json({
        data: {
          targets: body.targets.map((target) =>
            (state.hidden &&
              target.key !== 'notification' &&
              target.postId === 'post-a') ||
            (options.unavailableNotification && target.key === 'notification')
              ? { key: target.key, status: 'unavailable' }
              : options.removedChild && target.key === 'notification'
                ? { ...available(target, state.revision), comment: null, parent: null }
                : available(target, state.revision)
          ),
        },
      })
    }),
    http.get('*/api/v1/community/posts/:postId/comments', ({ request, params }) => {
      rootRequests.push(new URL(request.url))
      return state.hidden && params.postId === 'post-a'
        ? errorEnvelope(404, 'Community post not found.')
        : HttpResponse.json({
            data: {
              items: params.postId === 'post-a' ? [rootComment] : [],
              nextCursor: null,
              snapshot: 2,
              hasNewer: false,
            },
          })
    }),
    http.get(
      '*/api/v1/community/posts/post-a/comments/target-root/replies',
      ({ request }) => {
        replyRequests.push(new URL(request.url))
        return HttpResponse.json({
          data: { items: [reply], nextCursor: null, snapshot: 2, hasNewer: false },
        })
      }
    ),
    http.get('*/api/v1/community/posts/:postId/comment-submissions', () =>
      HttpResponse.json({ data: { items: [], nextCursor: null } })
    )
  )
  return {
    state,
    rootRequests,
    replyRequests,
    eventStarts,
    targetBodies,
    pending,
    sync: () => syncs[0]!,
    catchUp: () =>
      act(async () => {
        await syncs[0]!.catchUp()
      }),
  }
}
function recordFocus() {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
  const handles = new Map<unknown, number>()
  const handle = (node: unknown) => {
    if (!handles.has(node)) handles.set(node, handles.size + 700)
    return handles.get(node)!
  }
  vi.mocked(findNodeHandle).mockImplementation(handle)
  return handle
}
async function exactReplyFocus(handle: ReturnType<typeof recordFocus>) {
  const target = await screen.findByTestId('comment-target-reply')
  await waitFor(() =>
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(handle(target))
  )
  expect(screen.getByText(reply.body)).toBeVisible()
}

export function registerCommunityNotificationRecoveryCases() {
  beforeAll(async () => {
    actualCommunity = await vi.importActual<typeof community>('@/src/lib/community')
  })
  it.each(['current', 'post-a', 'post-b'] as const)(
    'T07 C02 unavailable notification evicts independently and retains intent ownership for %s',
    async (opened) => {
      const held = deferred(),
        f = journey({ notification: () => held.promise, unavailableNotification: true })
      notification()
      try {
        await render(<CommunityScreen />)
        await screen.findByTestId('community-post-card-post-a')
        await waitFor(() => expect(f.state.notificationCalls).toBe(1))
        if (opened !== 'current') {
          press(screen.getByTestId(`community-card-comments-${opened}`))
          await screen.findByRole('button', { name: 'Close comments' })
          fireEvent.change(screen.getByLabelText('Add a comment'), {
            target: { value: 'Unrelated owned draft' },
          })
          expect(screen.getByLabelText('Add a comment')).toHaveValue(
            'Unrelated owned draft'
          )
        }
        expect(f.pending.length).toBeGreaterThan(0)
        await act(async () => {
          held.release()
          await Promise.allSettled(f.pending)
        })
        if (opened === 'current') await screen.findByTestId('deep-link-info-banner')
        else expect.soft(screen.queryByTestId('deep-link-info-banner')).toBeNull()
        await waitFor(() =>
          expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
        )
        expect(screen.getByTestId('community-post-card-post-b')).toBeVisible()
        if (opened === 'post-b') {
          expect(screen.getByRole('button', { name: 'Close comments' })).toBeVisible()
          expect(screen.getByLabelText('Add a comment')).toHaveValue(
            'Unrelated owned draft'
          )
        } else expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull()
        expect(screen.queryByTestId('comment-target-reply')).toBeNull()
        expect(
          mockCapture.mock.calls.filter(([event]) => event === 'deep_link_invalid')
        ).toEqual([])
      } finally {
        held.release()
        await Promise.allSettled(f.pending)
      }
    }
  )

  it('T07 C02 an available post with a removed child keeps its visible card', async () => {
    const held = deferred(),
      f = journey({ notification: () => held.promise, removedChild: true })
    notification()
    try {
      await render(<CommunityScreen />)
      await screen.findByTestId('community-post-card-post-a')
      await waitFor(() => expect(f.state.notificationCalls).toBe(1))
      await act(async () => {
        held.release()
        await Promise.allSettled(f.pending)
      })
      expect(screen.getByTestId('community-post-card-post-a')).toBeVisible()
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
      expect(screen.queryByTestId('comment-target-reply')).toBeNull()
    } finally {
      held.release()
      await Promise.allSettled(f.pending)
    }
  })

  it('T05 A07 evicts an open post before same-pass reconciliation while a surviving card stays available', async () => {
    const f = journey()
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    await f.catchUp()
    press(screen.getByTestId('community-card-comments-post-a'))
    await screen.findByText(rootComment.body)
    const before = f.rootRequests.length
    f.state.hidden = true
    f.state.revision++
    await f.catchUp()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull()
    )
    expect(f.rootRequests).toHaveLength(before)
    expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
    expect(screen.getByTestId('community-post-card-post-b')).toBeVisible()
    expect(screen.getByTestId('community-card-comments-post-b')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('T05 A08 automatically recovers failed buffer insertion on a quiet healthy connection within the original bounds', async () => {
    const f = journey({ live: true })
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    await f.catchUp()
    f.state.published = true
    f.state.revision++
    await f.catchUp()
    f.state.failInsert = true
    const before = f.eventStarts.length
    const started = performance.now()
    press(await screen.findByRole('button', { name: 'Show 1 new looks' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Show 1 new looks' })).toBeNull()
    )
    expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
    const restored = await screen.findByRole(
      'button',
      { name: 'Show 1 new looks' },
      { timeout: 10000 }
    )
    expect(performance.now() - started).toBeLessThan(10000)
    expect(f.eventStarts[before]! - started).toBeLessThanOrEqual(8000)
    expect(screen.queryByTestId('community-post-card-post-new')).toBeNull()
    press(restored)
    await screen.findByTestId('community-post-card-post-new')
    expect(screen.getByTestId('community-post-card-post-a')).toBeVisible()
  }, 15000)

  it.each(['visible', 'withdrawn'] as const)(
    'T05 A10 held reply target retries unrelated invalidation and fences %s',
    async (outcome) => {
      const held = deferred(),
        handle = recordFocus()
      const f = journey({
        notification: async (call) => {
          if (call === 1) await held.promise
        },
      })
      notification()
      try {
        await render(<CommunityScreen />)
        await waitFor(() => expect(f.state.notificationCalls).toBe(1))
        await f.catchUp()
        f.state.revision++
        f.state.hidden = outcome === 'withdrawn'
        await f.catchUp()
        await act(async () => {
          held.release()
          await Promise.allSettled(f.pending)
        })
        await waitFor(() => expect(f.state.notificationCalls).toBe(2))
        if (outcome === 'visible') {
          await exactReplyFocus(handle)
          expect(f.replyRequests).toHaveLength(1)
        } else {
          await act(async () => {
            await Promise.allSettled(f.pending)
          })
          expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull()
          expect(f.rootRequests).toHaveLength(0)
          expect(screen.getByTestId('community-post-card-post-b')).toBeVisible()
        }
        expect(
          f.targetBodies.filter((body) => body.targets[0]?.key === 'notification')
        ).toEqual([
          {
            targets: [
              {
                key: 'notification',
                postId: 'post-a',
                commentId: reply.id,
                parentId: rootComment.id,
              },
            ],
          },
          {
            targets: [
              {
                key: 'notification',
                postId: 'post-a',
                commentId: reply.id,
                parentId: rootComment.id,
              },
            ],
          },
        ])
      } finally {
        held.release()
        await Promise.allSettled(f.pending)
      }
    }
  )

  it('T05 B05 a mutation-fenced held reply target cannot open a sheet or request ordinary roots', async () => {
    const held = deferred(),
      f = journey({ notification: () => held.promise })
    notification()
    server.use(
      http.put('*/api/v1/community/posts/post-a/reaction', () =>
        errorEnvelope(404, 'Community post not found.')
      )
    )
    try {
      await render(<CommunityScreen />)
      await waitFor(() => expect(f.state.notificationCalls).toBe(1))
      press(
        within(screen.getByTestId('community-post-card-post-a')).getByRole('button', {
          name: 'Applaud, 0',
        })
      )
      await waitFor(() =>
        expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      )
      await act(async () => {
        held.release()
        await Promise.allSettled(f.pending)
      })
      expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull()
      expect(f.rootRequests).toHaveLength(0)
      expect(screen.getByTestId('community-post-card-post-b')).toBeVisible()
    } finally {
      held.release()
      await Promise.allSettled(f.pending)
    }
  })

  it.each(['reply', 'card', 'missing-card'] as const)(
    'T05 A11 explicit close retires late %s intent while preserving authoritative card results',
    async (kind) => {
      const held = deferred(),
        f = journey({ notification: () => held.promise })
      notification(kind === 'reply' ? 'reply' : 'card')
      let cardStarted = false
      server.use(
        http.get('*/api/v1/community/posts/post-a', async () => {
          cardStarted = true
          await held.promise
          return kind === 'missing-card'
            ? errorEnvelope(404, 'Community post not found.')
            : HttpResponse.json({
                data: { ...post(), caption: 'Independent late card stays authoritative' },
              })
        })
      )
      try {
        await render(<CommunityScreen />)
        await waitFor(() =>
          expect(kind === 'reply' ? f.state.notificationCalls > 0 : cardStarted).toBe(
            true
          )
        )
        press(await screen.findByTestId('community-card-comments-post-a'))
        await screen.findByText(rootComment.body)
        press(screen.getByRole('button', { name: 'Close comments' }))
        const before = f.rootRequests.length
        await act(async () => {
          held.release()
          await Promise.allSettled(f.pending)
          await Promise.allSettled(
            vi
              .mocked(community.getCommunityPostFromMobile)
              .mock.results.map((result): unknown => result.value)
          )
        })
        expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull()
        expect(f.rootRequests).toHaveLength(before)
        if (kind === 'missing-card') {
          expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
          expect(screen.getByTestId('community-post-card-post-b')).toBeVisible()
        } else {
          if (kind === 'card')
            await screen.findByText('Independent late card stays authoritative')
          press(screen.getAllByTestId('community-card-comments-post-a')[0]!)
          await screen.findByText(rootComment.body)
          await f.catchUp()
          expect(
            f.rootRequests.slice(before).every((url) => !url.searchParams.has('cursor'))
          ).toBe(true)
          expect(f.replyRequests).toHaveLength(0)
          expect(screen.queryByTestId('comment-target-reply')).toBeNull()
        }
      } finally {
        held.release()
        await Promise.allSettled(f.pending)
      }
    }
  )

  it.each(['card', 'reply'] as const)(
    'T05 B04 retries a timed-out %s notification attempt and resolves within10s without invalid-link analytics',
    async (kind) => {
      const handle = recordFocus()
      const firstFinished = deferred()
      const f = journey({
        notification: async (call) => {
          if (call === 1) {
            await delay(2300)
            firstFinished.release()
          }
        },
      })
      notification(kind)
      let cards = 0
      server.use(
        http.get('*/api/v1/community/posts/post-a', async () => {
          if (++cards === 1) {
            await delay(2300)
            firstFinished.release()
          }
          return HttpResponse.json({ data: post() })
        })
      )
      const started = performance.now()
      try {
        await render(<CommunityScreen />)
        await waitFor(() =>
          expect(kind === 'reply' ? f.state.notificationCalls : cards).toBeGreaterThan(0)
        )
        if (kind === 'reply') await exactReplyFocus(handle)
        else await screen.findByTestId('highlighted-community-card-post-a')
        expect(performance.now() - started).toBeLessThan(10000)
        expect(kind === 'reply' ? f.state.notificationCalls : cards).toBe(2)
        expect(
          mockCapture.mock.calls.filter(([name]) => name === 'deep_link_invalid')
        ).toEqual([])
      } finally {
        await firstFinished.promise
        await Promise.allSettled(f.pending)
      }
    },
    12000
  )

  it('T05 B03 starts the card HTTP deadline after a delayed bearer acquisition inside the10s operation', async () => {
    journey()
    const view = await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    const started = performance.now()
    const ready = new Promise<string>((resolve) =>
      setTimeout(() => resolve('session-token'), 2300)
    )
    const restore = setMobileAccessTokenResolver(() => ready)
    const starts: number[] = []
    server.use(
      http.get('*/api/v1/community/posts/post-a', async () => {
        starts.push(performance.now())
        await delay(100)
        return HttpResponse.json({ data: post() })
      })
    )
    try {
      notification('card')
      await view.rerender(<CommunityScreen />)
      await screen.findByTestId('highlighted-community-card-post-a')
      expect(performance.now() - started).toBeLessThan(10000)
      expect(starts).toHaveLength(1)
      expect(starts[0]! - started).toBeGreaterThanOrEqual(2300)
      expect(
        mockCapture.mock.calls.filter(([name]) => name === 'deep_link_invalid')
      ).toEqual([])
    } finally {
      restore()
      await ready
    }
  }, 12000)

  it.each(['card', 'reply'] as const)(
    'T05 B04 exhausted %s attempts retain unavailable feedback without invalid intent or a sheet',
    async (kind) => {
      const f = journey()
      notification(kind)
      const starts: number[] = []
      const unavailable = () => {
        starts.push(performance.now())
        return errorEnvelope(503, 'Dependency unavailable')
      }
      server.use(
        http.get('*/api/v1/community/posts/post-a', unavailable),
        http.post('*/api/v1/community/targets/resolve', unavailable)
      )
      await render(<CommunityScreen />)
      await waitFor(() => expect(starts.length).toBeGreaterThan(1))
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
      // Observe the terminal UI after the unchanged10s operation expires.
      // The separate request-start assertion keeps every attempt inside that bound.
      const notice = await screen.findByTestId(
        'deep-link-info-banner',
        {},
        { timeout: 11000 }
      )
      expect(notice).toHaveTextContent(
        'Community is temporarily unavailable. Your draft is saved.'
      )
      expect(starts.at(-1)! - starts[0]!).toBeLessThan(10000)
      expect(starts.length).toBeLessThanOrEqual(41)
      expect(
        mockCapture.mock.calls.filter(([name]) => name === 'deep_link_invalid')
      ).toEqual([])
      expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull()
      expect(screen.queryByTestId('highlighted-community-card-post-a')).toBeNull()
      expect(screen.getByTestId('community-post-card-post-b')).toBeVisible()
      await Promise.allSettled(f.pending)
    },
    13000
  )
}
