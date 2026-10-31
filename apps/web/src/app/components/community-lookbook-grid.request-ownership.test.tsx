// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import * as communityClient from '../../lib/community'
import {
  CommunitySyncState,
  CommunityReactionState,
  CommunityCommentsState,
} from '@couture/api-client'
import { http, HttpResponse } from 'msw'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  cursorFor,
  installImagePrepMocks,
  choosePhoto,
  allocateBody,
  publishBody,
  imageFixtureHandler,
  ALLOCATE_PATH,
  PUBLISH_PATH,
  SUGGESTED_ALT_TEXT,
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
  const originalScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  )
  afterEach(() => {
    if (originalScroll)
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })
  function prepareRealtimeJourney() {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const syncs: CommunitySyncState[] = []
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
      this: CommunitySyncState
    ) {
      syncs.push(this)
    })
    const state = {
      failed: false,
      revision: 0,
      hidden: false,
      removedComment: false,
      resync: false,
    }
    const install = useMswHandlers
    install(
      http.get(FEED_PATH, () =>
        HttpResponse.json({
          data: feed({
            items: [post(), { ...post(), id: 'post-2' }],
            nextCursor: cursorFor(),
          }),
        })
      ),
      http.get('/api/v1/community/events', () => {
        if (state.failed)
          return errorBody(503, 'Dependency unavailable', 'Service Unavailable')
        const resync = state.resync
        state.resync = false
        return HttpResponse.json({
          data: {
            events: resync
              ? [{ version: 1, kind: 'resync', resyncRequired: true }]
              : state.revision
                ? [
                    {
                      version: 1,
                      kind: 'reactions.changed',
                      postId: 'post-2',
                      communityRevision: String(state.revision),
                    },
                  ]
                : [],
            nextCursor: 'journey-cursor',
            hasMore: false,
            resyncRequired: resync,
          },
        })
      }),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as {
          targets: { key: string; postId: string }[]
        }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) =>
              state.hidden && target.postId === 'post-1'
                ? { key: target.key, status: 'unavailable' }
                : {
                    key: target.key,
                    status: 'available',
                    communityRevision: String(state.revision),
                    post: { ...post(), id: target.postId },
                    comment: null,
                    parent: null,
                    pageCursor: null,
                    parentPageCursor: null,
                    threadPosition: null,
                  }
            ),
          },
        })
      }),
      http.get('/api/v1/community/posts/post-1/comments', () =>
        state.hidden
          ? errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
          : HttpResponse.json({
              data: {
                items: state.removedComment
                  ? []
                  : [
                      {
                        id: 'visible-root',
                        postId: 'post-1',
                        parentId: null,
                        body: 'Visible before resync.',
                        author: 'Explorer',
                        isOwn: false,
                        unavailable: false,
                        publicationSequence: 1,
                        publishedAt: '2026-10-19T11:00:00Z',
                        replyCount: 0,
                      },
                    ],
                nextCursor: null,
                snapshot: state.removedComment ? 2 : 1,
                hasNewer: false,
              },
            })
      ),
      http.get('/api/v1/community/posts/post-1/comment-submissions', () =>
        HttpResponse.json({ data: { items: [], nextCursor: null } })
      )
    )
    return { state, sync: () => syncs[0]! }
  }
  it.each(['current', 'post-1', 'post-2', 'removed-child'] as const)(
    'T07 C02 held unavailable target preserves negative visibility and intent for %s',
    async (opened) => {
      prepareRealtimeJourney()
      const held = deferred(),
        user = userEvent.setup()
      const pending: Promise<unknown>[] = []
      const actual = communityClient.communitySyncFromWeb
      vi.spyOn(communityClient, 'communitySyncFromWeb').mockImplementation(() => {
        const client = actual()
        return {
          ...client,
          resolve: (...args) => {
            const flight = client.resolve(...args)
            if (args[0].targets[0]?.key === 'notification') {
              pending.push(flight)
              void flight.catch(() => undefined)
            }
            return flight
          },
        }
      })
      let targetCalls = 0
      window.history.replaceState(
        null,
        '',
        '/community?source=notification&type=community&cardId=post-1&commentId=removed-reply'
      )
      useMswHandlers(
        http.get('/api/v1/community/posts/:postId', ({ params }) =>
          HttpResponse.json({ data: { ...post(), id: params.postId } })
        ),
        http.get('/api/v1/community/posts/post-2/comments', () =>
          HttpResponse.json({
            data: { items: [], nextCursor: null, snapshot: 0, hasNewer: false },
          })
        ),
        http.get('/api/v1/community/posts/post-2/comment-submissions', () =>
          HttpResponse.json({ data: { items: [] } })
        ),
        http.post('/api/v1/community/targets/resolve', async ({ request }) => {
          const body = (await request.json()) as {
            targets: { key: string; postId: string }[]
          }
          if (body.targets[0]?.key === 'notification') {
            targetCalls++
            await held.promise
          }
          return HttpResponse.json({
            data: {
              targets: body.targets.map((target) =>
                target.key === 'notification' && opened !== 'removed-child'
                  ? { key: target.key, status: 'unavailable' }
                  : {
                      key: target.key,
                      status: 'available',
                      communityRevision: '0',
                      post: { ...post(), id: target.postId },
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
      try {
        await act(() => {
          renderGrid({ highlightedCardId: 'post-1' })
          return Promise.resolve()
        })
        await screen.findByTestId('lookbook-card-post-1')
        // The deep-link target can render before the feed page that holds the other card.
        await screen.findByTestId('lookbook-card-post-2')
        await waitFor(() => expect(targetCalls).toBe(1))
        if (opened === 'post-1' || opened === 'post-2') {
          await act(() => {
            screen.getByTestId(`lookbook-open-${opened}`).click()
            return Promise.resolve()
          })
          await screen.findByTestId('community-detail')
          const composer = screen.getByLabelText('Add a comment')
          if (opened === 'post-1') {
            // This input unmounts on authoritative eviction. Commit the controlled
            // value directly so user-event's pending blur/change bookkeeping cannot
            // introduce a nested synchronous act during modal focus restoration.
            await act(() => {
              composer.focus()
              fireEvent.change(composer, { target: { value: 'Unrelated owned draft' } })
              return Promise.resolve()
            })
            expect(composer).toHaveFocus()
          } else {
            await act(async () => {
              await user.type(composer, 'Unrelated owned draft')
            })
          }
          expect(screen.getByLabelText('Add a comment')).toHaveValue(
            'Unrelated owned draft'
          )
        }
        expect(pending.length).toBeGreaterThan(0)
        await act(async () => {
          held.release()
          await Promise.allSettled(pending)
        })
        const invalid = 'This link is invalid, expired, or no longer available.'
        if (opened === 'removed-child') {
          expect(screen.getByTestId('lookbook-card-post-1')).toBeInTheDocument()
          expect(screen.queryByText(invalid)).toBeNull()
          expect(screen.queryByTestId('comment-removed-reply')).toBeNull()
        } else {
          if (opened === 'current') await screen.findByText(invalid)
          else expect.soft(screen.queryByText(invalid)).toBeNull()
          await waitFor(() =>
            expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
          )
          expect(screen.getByTestId('lookbook-card-post-2')).toBeInTheDocument()
          if (opened === 'post-2') {
            expect(screen.getByTestId('community-detail')).toBeVisible()
            expect(screen.getByLabelText('Add a comment')).toHaveValue(
              'Unrelated owned draft'
            )
          } else expect(screen.queryByTestId('community-detail')).toBeNull()
        }
      } finally {
        held.release()
        await Promise.allSettled(pending)
        window.history.replaceState(null, '', '/')
      }
    }
  )

  it('A06 reconciles three healthy750ms thread HTTP requests with fresh request budgets', async () => {
    const journey = prepareRealtimeJourney(),
      user = userEvent.setup()
    let slow = false
    const requests: string[] = []
    useMswHandlers(
      http.get('/api/v1/community/posts/post-1/comments', async ({ request }) => {
        const second = new URL(request.url).searchParams.has('cursor')
        if (slow) {
          requests.push(second ? 'second-root-page' : 'first-root-page')
          await new Promise((resolve) => setTimeout(resolve, 750))
        }
        return HttpResponse.json({
          data: {
            items: [
              {
                id: second ? 'root-two' : 'root-one',
                postId: 'post-1',
                parentId: null,
                body: second
                  ? 'Second root page.'
                  : slow
                    ? 'Fresh first root.'
                    : 'First root page.',
                author: 'Explorer',
                isOwn: false,
                unavailable: false,
                publicationSequence: second ? 2 : 1,
                publishedAt: '2026-10-19T11:00:00Z',
                replyCount: 0,
              },
            ],
            nextCursor: second ? null : 'thread-next',
            snapshot: 2,
            hasNewer: false,
          },
        })
      }),
      http.get('/api/v1/community/posts/post-1/comment-submissions', async () => {
        if (slow) {
          requests.push('private-status')
          await new Promise((resolve) => setTimeout(resolve, 750))
        }
        return HttpResponse.json({ data: { items: [], nextCursor: null } })
      })
    )
    renderGrid()
    await screen.findByTestId('lookbook-card-post-1')
    await act(async () => {
      await journey.sync().catchUp()
    })
    await user.click(screen.getByTestId('comments-button-post-1'))
    await screen.findByText('First root page.')
    await user.click(screen.getByRole('button', { name: 'More comments' }))
    await screen.findByText('Second root page.')
    await user.type(
      screen.getByLabelText('Add a comment'),
      'Retained during bounded refresh'
    )
    slow = true
    journey.state.revision++
    const start = performance.now()
    await act(async () => {
      await journey.sync().catchUp()
    })
    expect(performance.now() - start).toBeGreaterThanOrEqual(2250)
    expect(performance.now() - start).toBeLessThan(10000)
    expect(requests).toEqual(['first-root-page', 'second-root-page', 'private-status'])
    expect(screen.getByText('Fresh first root.')).toBeInTheDocument()
    expect(screen.getByLabelText('Add a comment')).toHaveValue(
      'Retained during bounded refresh'
    )
  })

  it('A08 failed buffered insertion recovers on a quiet connection and keeps the buffer', async () => {
    const journey = prepareRealtimeJourney(),
      user = userEvent.setup()
    let published = false,
      failInsert = true
    useMswHandlers(
      http.get(FEED_PATH, () =>
        HttpResponse.json({
          data: feed({
            items: [post(), ...(published ? [{ ...post(), id: 'post-2' }] : [])],
          }),
        })
      ),
      http.get('/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events: published
              ? [
                  {
                    version: 1,
                    kind: 'post.published',
                    postId: 'post-2',
                    communityRevision: '1',
                  },
                ]
              : [],
            nextCursor: 'buffer',
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as {
          targets: { key: string; postId: string }[]
        }
        if (targets.length === 1 && targets[0]!.postId === 'post-2' && failInsert) {
          failInsert = false
          return errorBody(503, 'Unavailable', 'Service Unavailable')
        }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) => ({
              key: target.key,
              status: 'available',
              communityRevision: '1',
              post: { ...post(), id: target.postId },
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
    renderGrid()
    await screen.findByTestId('lookbook-card-post-1')
    await act(async () => {
      await journey.sync().catchUp()
    })
    published = true
    await act(async () => {
      await journey.sync().catchUp()
    })
    await user.click(await screen.findByRole('button', { name: 'Show 1 new looks' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Show 1 new looks' })).toBeNull()
    )
    const recovered = await screen.findByRole(
      'button',
      { name: 'Show 1 new looks' },
      { timeout: 10000 }
    )
    await user.click(recovered)
    await screen.findByTestId('lookbook-card-post-2')
  }, 15000)

  it('T06 B04 retries a delayed reply-target attempt and focuses the exact reply within10s', async () => {
    prepareRealtimeJourney()
    const parent = {
      id: 'retry-parent',
      postId: 'post-1',
      parentId: null,
      body: 'Retry parent context',
      author: 'Explorer',
      isOwn: false,
      unavailable: false,
      publicationSequence: 1,
      publishedAt: '2026-10-19T11:00:00Z',
      replyCount: 1,
    }
    const reply = {
      ...parent,
      id: 'retry-reply',
      parentId: parent.id,
      body: 'Exact retry notification reply',
      publicationSequence: 2,
      replyCount: 0,
    }
    const requests: unknown[] = []
    let attempts = 0
    let firstFinished!: () => void
    const settled = new Promise<void>((resolve) => {
      firstFinished = resolve
    })
    window.history.replaceState(
      null,
      '',
      '/community?source=notification&type=community&cardId=post-1&commentId=retry-reply&parentId=retry-parent'
    )
    useMswHandlers(
      http.get(POST_PATH, () => HttpResponse.json({ data: post() })),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const body = (await request.json()) as {
          targets: { key: string; postId: string }[]
        }
        requests.push(body)
        if (body.targets[0]?.key === 'notification' && ++attempts === 1) {
          await new Promise((resolve) => setTimeout(resolve, 2300))
          firstFinished()
        }
        return HttpResponse.json({
          data: {
            targets: body.targets.map((target) => ({
              key: target.key,
              status: 'available',
              communityRevision: '1',
              post: post(),
              comment: reply,
              parent,
              pageCursor: null,
              parentPageCursor: null,
              threadPosition: 1,
            })),
          },
        })
      }),
      http.get('/api/v1/community/posts/post-1/comments', () =>
        HttpResponse.json({
          data: { items: [parent], nextCursor: null, snapshot: 2, hasNewer: false },
        })
      ),
      http.get('/api/v1/community/posts/post-1/comments/retry-parent/replies', () =>
        HttpResponse.json({
          data: { items: [reply], nextCursor: null, snapshot: 2, hasNewer: false },
        })
      )
    )
    const started = performance.now()
    try {
      renderGrid({ highlightedCardId: 'post-1' })
      const target = await screen.findByTestId(
        'comment-retry-reply',
        {},
        { timeout: 10000 }
      )
      await waitFor(() => expect(document.activeElement).toBe(target))
      expect(performance.now() - started).toBeLessThan(10000)
      expect(attempts).toBe(2)
      expect(requests.slice(0, 2)).toEqual([
        {
          targets: [
            {
              key: 'notification',
              postId: 'post-1',
              commentId: reply.id,
              parentId: parent.id,
            },
          ],
        },
        {
          targets: [
            {
              key: 'notification',
              postId: 'post-1',
              commentId: reply.id,
              parentId: parent.id,
            },
          ],
        },
      ])
      expect(
        screen.queryByText('This link is invalid, expired, or no longer available.')
      ).toBeNull()
    } finally {
      await settled
      window.history.replaceState(null, '', '/')
    }
  }, 12000)

  it('T06 B04 exhausted reply attempts retain unavailable feedback and leave the dialog closed', async () => {
    prepareRealtimeJourney()
    const starts: number[] = []
    window.history.replaceState(
      null,
      '',
      '/community?source=notification&type=community&cardId=post-1&commentId=retry-reply&parentId=retry-parent'
    )
    useMswHandlers(
      http.get(POST_PATH, () => HttpResponse.json({ data: post() })),
      http.post('/api/v1/community/targets/resolve', () => {
        starts.push(performance.now())
        return errorBody(503, 'Dependency unavailable', 'Service Unavailable')
      })
    )
    try {
      renderGrid({ highlightedCardId: 'post-1' })
      await waitFor(() => expect(starts.length).toBeGreaterThan(1))
      expect(
        screen.queryByText('Community is temporarily unavailable. Your draft is saved.')
      ).toBeNull()
      // UI observation includes timer delivery after the unchanged10s operation.
      await screen.findByText(
        'Community is temporarily unavailable. Your draft is saved.',
        {},
        { timeout: 11000 }
      )
      expect(starts.at(-1)! - starts[0]!).toBeLessThan(10000)
      expect(starts.length).toBeLessThanOrEqual(41)
      expect(
        screen.queryByText('This link is invalid, expired, or no longer available.')
      ).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByTestId('lookbook-card-post-1')).toBeVisible()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  }, 13000)

  it.each(['visible', 'withdrawn', 'closed'] as const)(
    'A10/A11 notification resolution re-owns unrelated invalidation and fences target=%s',
    async (disposition) => {
      const withdrawn = disposition === 'withdrawn'
      const closed = disposition === 'closed'
      const requests: ReturnType<
        ReturnType<typeof communityClient.communitySyncFromWeb>['resolve']
      >[] = []
      const actualClient = communityClient.communitySyncFromWeb
      vi.spyOn(communityClient, 'communitySyncFromWeb').mockImplementation(() => {
        const client = actualClient()
        return {
          ...client,
          resolve: (...args) => {
            const promise = client.resolve(...args)
            if (args[0].targets[0]?.key === 'notification') requests.push(promise)
            return promise
          },
        }
      })
      const journey = prepareRealtimeJourney(),
        held = deferred()
      let calls = 0
      window.history.replaceState(
        null,
        '',
        '/community?source=notification&type=community&cardId=post-1&commentId=visible-root'
      )
      useMswHandlers(
        http.get(POST_PATH, () => HttpResponse.json({ data: post() })),
        http.post('/api/v1/community/targets/resolve', async ({ request }) => {
          const { targets } = (await request.json()) as {
            targets: { key: string; postId: string }[]
          }
          if (targets[0]?.key === 'notification') {
            if (++calls === 1) await held.promise
          }
          return HttpResponse.json({
            data: {
              targets: targets.map((target) =>
                target.key !== 'notification' && withdrawn && target.postId === 'post-1'
                  ? { key: target.key, status: 'unavailable' }
                  : {
                      key: target.key,
                      status: 'available',
                      communityRevision: '1',
                      post: { ...post(), id: target.postId },
                      comment: {
                        id: 'visible-root',
                        postId: 'post-1',
                        parentId: null,
                        body: 'Visible before resync.',
                        author: 'Explorer',
                        isOwn: false,
                        unavailable: false,
                        publicationSequence: 1,
                        publishedAt: '2026-10-19T11:00:00Z',
                        replyCount: 0,
                      },
                      parent: null,
                      pageCursor: null,
                      parentPageCursor: null,
                      threadPosition: 1,
                    }
              ),
            },
          })
        })
      )
      try {
        renderGrid({ highlightedCardId: 'post-1' })
        await waitFor(() => expect(calls).toBe(1))
        await act(async () => {
          await journey.sync().catchUp()
        })
        journey.state.revision++
        await act(async () => {
          await journey.sync().catchUp()
        })
        if (closed) {
          const user = userEvent.setup()
          await user.click(screen.getByTestId('lookbook-open-post-1'))
          await screen.findByTestId('community-detail')
          await user.click(detailHeaderClose())
          await act(async () => {
            held.release()
            await requests[0]
            await requests.at(-1)
          })
          expect(screen.queryByTestId('community-detail')).toBeNull()
          expect(calls).toBe(1)
        } else if (withdrawn) {
          held.release()
          await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2))
          expect(screen.queryByTestId('community-detail')).toBeNull()
        } else {
          held.release()
          await screen.findByTestId('community-detail')
          expect(calls).toBeGreaterThanOrEqual(2)
          await screen.findByText('Visible before resync.')
        }
      } finally {
        held.release()
        window.history.replaceState(null, '', '/')
      }
    }
  )

  it.each(['publish', 'photo'] as const)(
    'A04 retains owned%s through unavailable foreground recovery',
    async (kind) => {
      const journey = prepareRealtimeJourney(),
        held = deferred(),
        user = userEvent.setup()
      const restorePhoto = installImagePrepMocks()
      let allocations = 0,
        publishes = 0
      useMswHandlers(
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, async () => {
          allocations++
          if (kind === 'photo') await held.promise
          return allocateBody()
        }),
        http.post(PUBLISH_PATH, async () => {
          publishes++
          await held.promise
          return publishBody()
        })
      )
      try {
        renderGrid()
        await screen.findByTestId('lookbook-card-post-1')
        await act(async () => {
          await journey.sync().catchUp()
        })
        await user.click(screen.getByTestId('create-post-button'))
        await choosePhoto(user)
        await waitFor(() => expect(allocations).toBe(1))
        if (kind === 'publish') {
          await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
          await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
          await user.click(screen.getByTestId('post-publish-submit'))
          await waitFor(() => expect(publishes).toBe(1))
        }
        journey.state.failed = true
        await act(async () => {
          journey.sync().foreground()
          await journey.sync().catchUp()
        })
        expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
        journey.state.failed = false
        await act(async () => {
          await journey.sync().catchUp()
        })
        held.release()
        if (kind === 'photo') {
          await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
          expect(screen.getByTestId('post-image-preview')).toBeInTheDocument()
        } else {
          await waitFor(() =>
            expect(screen.queryByTestId('post-publish-submit')).toBeNull()
          )
          expect(screen.getByTestId('community-action-notice')).toHaveTextContent(
            'Your look was submitted for review.'
          )
        }
        expect(allocations).toBe(1)
        expect(publishes).toBe(kind === 'publish' ? 1 : 0)
      } finally {
        held.release()
        restorePhoto()
        vi.unstubAllGlobals()
      }
    }
  )

  it('A04 dependency recovery preserves an already-owned report through foreground recycle', async () => {
    const journey = prepareRealtimeJourney(),
      held = deferred()
    let calls = 0
    useMswHandlers(
      http.post('/api/v1/community/posts/post-1/report', async () => {
        calls++
        await held.promise
        return HttpResponse.json({ tracked: true })
      })
    )
    const user = userEvent.setup()
    renderGrid()
    await screen.findByTestId('lookbook-card-post-1')
    await act(async () => {
      await journey.sync().catchUp()
    })
    await user.click(screen.getByTestId('report-button-post-1'))
    await user.click(await screen.findByTestId('report-submit-button'))
    await waitFor(() => expect(calls).toBe(1))
    try {
      journey.state.failed = true
      await act(async () => {
        journey.sync().foreground()
        await journey.sync().catchUp()
      })
      expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
      journey.state.failed = false
      await act(async () => {
        await journey.sync().catchUp()
      })
      held.release()
      await waitFor(() =>
        expect(screen.getByTestId('report-button-post-1')).toHaveTextContent('Reported')
      )
      expect(calls).toBe(1)
    } finally {
      held.release()
    }
  })
  it('A05 invalidation retires a held pagination spinner and permits a subsequent load', async () => {
    const journey = prepareRealtimeJourney(),
      held = deferred()
    let pages = 0
    useMswHandlers(
      http.get(FEED_PATH, async ({ request }) => {
        if (new URL(request.url).searchParams.has('cursor')) {
          if (++pages === 1) await held.promise
          return HttpResponse.json({
            data: feed({ items: [{ ...post(), id: 'page-two' }], nextCursor: null }),
          })
        }
        return HttpResponse.json({
          data: feed({ items: [post()], nextCursor: cursorFor() }),
        })
      })
    )
    const user = userEvent.setup()
    renderGrid()
    await screen.findByTestId('lookbook-card-post-1')
    await act(async () => {
      await journey.sync().catchUp()
    })
    await user.click(screen.getByTestId('load-more-button'))
    await waitFor(() => expect(pages).toBe(1))
    try {
      journey.state.revision++
      await act(async () => {
        await journey.sync().catchUp()
      })
      expect(screen.getByTestId('load-more-button')).toBeEnabled()
      await user.click(screen.getByTestId('load-more-button'))
      await screen.findByTestId('lookbook-card-page-two')
      expect(pages).toBe(2)
    } finally {
      held.release()
    }
  })
  it('A07 target eviction retires the open ref before same-pass thread reconciliation', async () => {
    const journey = prepareRealtimeJourney(),
      user = userEvent.setup()
    const refresh = vi.spyOn(CommunityCommentsState.prototype, 'refresh')
    renderGrid()
    await screen.findByTestId('lookbook-card-post-1')
    await act(async () => {
      await journey.sync().catchUp()
    })
    await user.click(screen.getByTestId('comments-button-post-1'))
    await screen.findByText('Visible before resync.')
    refresh.mockClear()
    journey.state.hidden = true
    journey.state.revision++
    await act(async () => {
      await journey.sync().catchUp()
    })
    expect(refresh).not.toHaveBeenCalledWith('post-1', expect.anything())
    expect(screen.queryByTestId('community-detail')).toBeNull()
    expect(screen.getByTestId('lookbook-card-post-2')).toBeInTheDocument()
  })
  it('A14 actual grid anonymous resync removes thread content and retains draft and composer focus', async () => {
    const journey = prepareRealtimeJourney(),
      user = userEvent.setup()
    renderGrid()
    await screen.findByTestId('lookbook-card-post-1')
    await act(async () => {
      await journey.sync().catchUp()
    })
    await user.click(screen.getByTestId('comments-button-post-1'))
    await screen.findByText('Visible before resync.')
    await user.type(screen.getByLabelText('Add a comment'), 'Keep this draft')
    expect(screen.getByLabelText('Add a comment')).toHaveFocus()
    journey.state.removedComment = true
    journey.state.resync = true
    await act(async () => {
      await journey.sync().catchUp()
    })
    // The thread reread follows the resync, so the removal lands after catchUp resolves.
    await waitFor(() => expect(screen.queryByText('Visible before resync.')).toBeNull())
    expect(screen.getByLabelText('Add a comment')).toHaveValue('Keep this draft')
    expect(screen.getByLabelText('Add a comment')).toHaveFocus()
    journey.state.failed = true
    await act(async () => {
      journey.sync().foreground()
      await journey.sync().catchUp()
    })
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull()
    )
    journey.state.failed = false
    await act(async () => {
      await journey.sync().catchUp()
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Add a comment')).toHaveValue('Keep this draft')
    )
    expect(screen.getByLabelText('Add a comment')).toHaveFocus()
  })

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
    // The deep link can render the card before the feed answers, and the feed's own
    // announcement would then replace "Reaction saved.", so let the feed settle first.
    await waitFor(() =>
      expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
        'aria-busy',
        'false'
      )
    )
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
