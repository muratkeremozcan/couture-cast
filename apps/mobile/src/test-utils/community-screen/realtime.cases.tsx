import { modalRenders } from '@/src/test-utils/edge-to-edge-modal'
import { press } from '@/src/test-utils/press'
/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.5: actual screen, coordinator and generated HTTP wrappers. Socket trigger is controlled.
import { CommunitySyncState } from '@couture/api-client'
import type { CommunityReactionSummary } from '@couture/api-client/contracts/http'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { AppState } from 'react-native'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { server } from '@/src/test-utils/msw/server'
import { feedJson, item, serveFeed, UPLOAD_URL, imagePicker, cursor } from './harness'

function recoveryCoordinator() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  let failed = false
  const summary = {
    counts: { applause: 0, love: 0, inspiration: 0 },
    total: 0,
    viewerReaction: null,
    revision: 0,
    generation: 0,
  }
  serveFeed(() => feedJson({ items: [item({ reactions: summary })] }))
  server.use(
    http.get('*/api/v1/community/events', () =>
      failed
        ? HttpResponse.json(
            { statusCode: 503, error: 'Service Unavailable', message: 'Unavailable' },
            { status: 503 }
          )
        : HttpResponse.json({
            data: {
              events: [],
              nextCursor: 'action-recovery',
              hasMore: false,
              resyncRequired: false,
            },
          })
    ),
    http.post('*/api/v1/community/targets/resolve', () =>
      HttpResponse.json({
        data: {
          targets: [
            {
              key: 'post-a',
              status: 'available',
              communityRevision: '0',
              post: item({ reactions: summary }),
              comment: null,
              parent: null,
              pageCursor: null,
              parentPageCursor: null,
              threadPosition: null,
            },
          ],
        },
      })
    )
  )
  const recover = async () => {
    const sync = syncs[0]!
    sync.foreground()
    await sync.catchUp()
  }
  return Object.assign(recover, {
    sync: () => syncs[0]!,
    unavailable: async () => {
      failed = true
      await recover()
      failed = false
    },
  })
}

/** Holds the next catch-up's event page until released. */
function holdEvents() {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  server.use(
    http.get('*/api/v1/community/events', async () => {
      await held
      return HttpResponse.json({
        data: { events: [], nextCursor: 'held', hasMore: false, resyncRequired: false },
      })
    })
  )
  return release
}

const scopeSummary = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  viewerReaction: null,
  revision: 0,
  generation: 0,
}
/** A cold_dry feed that gains one published look, and a warm_wet feed beside it. */
function twoFilterFeeds() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  const state = { published: false, resolveHeld: undefined as Promise<void> | undefined }
  const look = (id: string) => item({ id, reactions: scopeSummary })
  serveFeed((url) =>
    feedJson({
      items:
        url.searchParams.get('mode') === 'warm_wet'
          ? [look('post-warm')]
          : [look('post-cold'), ...(state.published ? [look('post-cold-new')] : [])],
    })
  )
  server.use(
    http.get('*/api/v1/community/events', () =>
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
    http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
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
async function bufferColdLook(feeds: ReturnType<typeof twoFilterFeeds>) {
  await render(<CommunityScreen />)
  press(await screen.findByTestId('community-filter-chip-cold_dry'))
  await screen.findByTestId('community-post-card-post-cold')
  await act(async () => {
    await feeds.syncs.at(-1)!.catchUp()
  })
  feeds.state.published = true
  await act(async () => {
    await feeds.syncs.at(-1)!.catchUp()
  })
  await screen.findByRole('button', { name: 'Show 1 new looks' })
}

export function registerCommunityRealtimeCases() {
  it('A09 a recovering signal after the verification bound hides content until a catch-up verifies it', async () => {
    const recover = recoveryCoordinator()
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    await act(recover)
    const release = holdEvents()
    const sync = recover.sync()
    let pending!: Promise<void>
    // The last successful authorization is now older than the 8 s bound (D3).
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9000)
    try {
      await act(() => {
        sync.foreground()
        pending = sync.catchUp()
      })
      expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      expect(screen.getByTestId('community-feed-unavailable')).toBeTruthy()
    } finally {
      clock.mockRestore()
      release()
      await act(() => pending)
    }
    await screen.findByTestId('community-post-card-post-a')
  })
  it('A09 a foreground restore keeps content hidden until a catch-up verifies access', async () => {
    const lifecycle: ((state: string) => void)[] = []
    vi.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      lifecycle.push(listener as (state: string) => void)
      return { remove: () => undefined }
    })
    const recover = recoveryCoordinator()
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    await act(recover)
    const release = holdEvents()
    let pending!: Promise<void>
    try {
      await act(() => {
        lifecycle.forEach((listener) => listener('active'))
        pending = recover.sync().catchUp()
      })
      // Verified only a moment ago, but a restore still waits for revalidation.
      expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
    } finally {
      release()
      await act(() => pending)
    }
    await screen.findByTestId('community-post-card-post-a')
  })
  it('A09 a recovering signal within the verification bound keeps the feed while HTTP catch-up serves it', async () => {
    const recover = recoveryCoordinator()
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    await act(recover)
    let releaseEvents!: () => void
    const eventsHeld = new Promise<void>((resolve) => {
      releaseEvents = resolve
    })
    server.use(
      http.get('*/api/v1/community/events', async () => {
        await eventsHeld
        return HttpResponse.json({
          data: { events: [], nextCursor: 'held', hasMore: false, resyncRequired: false },
        })
      })
    )
    // foreground() reports 'recovering' and starts a catch-up that is still in flight.
    const sync = recover.sync()
    let pending!: Promise<void>
    await act(() => {
      sync.foreground()
      pending = sync.catchUp()
    })
    try {
      // Recovering is not unavailable: the cards, the composer entry and the
      // new-post control stay usable while polling serves the feed.
      expect(screen.getByTestId('community-post-card-post-a')).toBeTruthy()
      expect(screen.getByTestId('community-new-post-button')).toBeTruthy()
    } finally {
      releaseEvents()
      await act(() => pending)
    }
    expect(screen.getByTestId('community-post-card-post-a')).toBeTruthy()
  })
  it('A05 doorbell invalidation releases held pagination ownership and allows another load', async () => {
    const recover = recoveryCoordinator()
    let pages = 0
    let firstPages = 0
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    serveFeed(async (url) => {
      if (url.searchParams.has('cursor')) {
        if (++pages === 1) await held
        return feedJson({ items: [item({ id: 'page-two' })], nextCursor: null })
      }
      // The coordinator's first catch-up rebuilds the feed, which legitimately releases
      // any page request already in flight. The initial page therefore offers no cursor:
      // pagination can only start once that bootstrap rebuild has landed, so the one held
      // request below is the one the doorbell must release.
      return feedJson({
        items: [item()],
        nextCursor: ++firstPages >= 2 ? cursor('temperate_dry') : null,
      })
    })
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    await act(recover)
    expect(firstPages).toBe(2)
    // FlatList may reach the end on its own; otherwise the member asks for the next page.
    // A press racing that call is ignored by the screen's pagination ownership.
    await waitFor(() =>
      expect(pages > 0 || screen.queryByTestId('community-feed-load-more')).toBeTruthy()
    )
    if (pages === 0) press(screen.getByTestId('community-feed-load-more'))
    await waitFor(() => expect(pages).toBe(1))
    try {
      server.use(
        http.get('*/api/v1/community/events', () =>
          HttpResponse.json({
            data: {
              events: [
                {
                  version: 1,
                  kind: 'reactions.changed',
                  postId: 'post-a',
                  communityRevision: '1',
                },
              ],
              nextCursor: 'next',
              hasMore: false,
              resyncRequired: false,
            },
          })
        )
      )
      await act(recover)
      await waitFor(() =>
        expect(screen.queryByTestId('community-feed-loading-more')).toBeNull()
      )
      // FlatList may already have exercised onEndReached. Otherwise the member
      // explicitly requests the next page through the restored control.
      const more = screen.queryByTestId('community-feed-load-more')
      if (more) press(more)
      await screen.findByTestId('community-post-card-page-two')
      expect(screen.queryByTestId('community-feed-loading-more')).toBeNull()
      expect(pages).toBe(2)
    } finally {
      release()
    }
  })
  it('R09 foreground recovery preserves an in-flight same-owner report', async () => {
    const recover = recoveryCoordinator()
    let release!: () => void
    let calls = 0
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('*/api/v1/community/posts/post-a/report', async () => {
        calls++
        await held
        return HttpResponse.json({ tracked: true })
      })
    )
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))
    press(await screen.findByTestId('report-reason-spam'))
    fireEvent.change(screen.getByTestId('report-details-input'), {
      target: { value: 'Retained report context' },
    })
    press(screen.getByTestId('submit-report-button'))
    await waitFor(() => expect(calls).toBe(1))
    await act(recover.unavailable)
    await act(recover)
    release()
    await waitFor(() => expect(screen.queryByTestId('community-report-modal')).toBeNull())
    expect(screen.getByTestId('community-card-report-post-a').textContent).toBe(
      'Reported'
    )
    expect(calls).toBe(1)
  })
  it('R09-PRESENTATION: actual foreground revalidation keeps the draft modal host until verified and closes on denial', async () => {
    modalRenders.length = 0
    const lifecycle: ((state: string) => void)[] = []
    vi.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      lifecycle.push(listener as (state: string) => void)
      return { remove: () => undefined }
    })
    const recover = recoveryCoordinator()
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    await act(recover)
    press(screen.getByTestId('community-new-post-button'))
    const host = await screen.findByTestId('community-post-sheet')
    fireEvent.change(screen.getByTestId('community-caption-input'), {
      target: { value: 'Retain my own draft across foreground' },
    })
    const release = holdEvents()
    let pending!: Promise<void>
    try {
      await act(() => {
        lifecycle.forEach((listener) => listener('background'))
        lifecycle.forEach((listener) => listener('active'))
        pending = recover.sync().catchUp()
      })
      expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      expect(
        modalRenders.filter((props) => props.testID === 'community-post-sheet').at(-1)
          ?.visible
      ).toBe(true)
      expect(screen.getByTestId('community-post-sheet')).toBe(host)
      expect(screen.getByTestId<HTMLInputElement>('community-caption-input').value).toBe(
        'Retain my own draft across foreground'
      )
      expect(
        screen.getByTestId('community-pick-image-button').getAttribute('aria-disabled')
      ).toBe('true')
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).toBe('true')
    } finally {
      release()
      await act(() => pending)
    }
    expect(screen.getByTestId('community-post-sheet')).toBe(host)
    expect(screen.getByTestId<HTMLInputElement>('community-caption-input').value).toBe(
      'Retain my own draft across foreground'
    )
    await waitFor(() =>
      expect(
        screen.getByTestId('community-pick-image-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    server.use(
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json(
          { statusCode: 403, code: 'community_access_denied', message: 'Denied' },
          { status: 403 }
        )
      )
    )
    await act(async () => {
      recover.sync().foreground()
      await recover.sync().catchUp()
    })
    await waitFor(() => expect(screen.queryByTestId('community-post-sheet')).toBeNull())
    expect(screen.queryByDisplayValue('Retain my own draft across foreground')).toBeNull()
  })

  it('R09 foreground recovery preserves an in-flight same-owner OS photo picker', async () => {
    const recover = recoveryCoordinator()
    let release!: () => void
    const held = new Promise<{
      canceled: boolean
      assets: { uri: string; width: number; height: number }[]
    }>((resolve) => {
      release = () =>
        resolve({
          canceled: false,
          assets: [{ uri: 'file:///recovered-photo.jpg', width: 1200, height: 1200 }],
        })
    })
    imagePicker.launchImageLibraryAsync.mockReturnValueOnce(held)
    server.use(
      http.post('*/api/v1/community/posts/allocate', () =>
        HttpResponse.json({
          data: {
            postId: 'recovered-picker',
            uploadSessionId: 'picker-session',
            uploadUrl: UPLOAD_URL,
            uploadToken: 'fixture-upload',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            altTextSuggestion: 'Retained photo choice.',
            altTextSuggestionLocale: 'en-US',
          },
        })
      ),
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 }))
    )
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-new-post-button'))
    press(await screen.findByTestId('community-pick-image-button'))
    await waitFor(() =>
      expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1)
    )
    await act(recover.unavailable)
    await act(recover)
    release()
    await screen.findByTestId('community-post-preview-image')
    await waitFor(() =>
      expect(screen.getByTestId<HTMLInputElement>('community-alt-text-input').value).toBe(
        'Retained photo choice.'
      )
    )
    expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1)
  })

  it('R07 anonymous resync removes an open-thread comment and preserves the composer draft', async () => {
    const syncs: CommunitySyncState[] = []
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
      this: CommunitySyncState
    ) {
      syncs.push(this)
      void this.catchUp()
    })
    let visible = true
    let resync = false
    let releaseRebuild!: () => void
    const heldRebuild = new Promise<void>((resolve) => {
      releaseRebuild = resolve
    })
    let rebuilding = false
    const summary = {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      viewerReaction: null,
      revision: 0,
      generation: 0,
    }
    serveFeed(async () => {
      if (!visible) {
        rebuilding = true
        await heldRebuild
      }
      return feedJson({ items: [item({ reactions: summary })] })
    })
    server.use(
      http.get('*/api/v1/community/events', () => {
        const removed = resync
        resync = false
        return HttpResponse.json({
          data: {
            events: removed ? [{ version: 1, kind: 'resync', resyncRequired: true }] : [],
            nextCursor: 'thread-cursor',
            hasMore: false,
            resyncRequired: removed,
          },
        })
      }),
      http.post('*/api/v1/community/targets/resolve', () =>
        HttpResponse.json({
          data: {
            targets: [
              {
                key: 'post-a',
                status: 'available',
                communityRevision: '0',
                post: item({ reactions: summary }),
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
      http.get('*/api/v1/community/posts/post-a/comments', () =>
        HttpResponse.json({
          data: {
            items: visible
              ? [
                  {
                    id: 'visible-root',
                    postId: 'post-a',
                    parentId: null,
                    body: 'Previously visible thread comment.',
                    author: 'Style Explorer Thread',
                    isOwn: false,
                    unavailable: false,
                    publicationSequence: 1,
                    publishedAt: '2026-10-19T11:00:00.000Z',
                    replyCount: 0,
                  },
                ]
              : [],
            nextCursor: null,
            snapshot: visible ? 1 : 2,
            hasNewer: false,
          },
        })
      ),
      http.get('*/api/v1/community/posts/post-a/comment-submissions', () =>
        HttpResponse.json({ data: { items: [], nextCursor: null } })
      )
    )
    await render(<CommunityScreen />)
    await screen.findByRole('button', { name: 'Applaud, 0' })
    await act(async () => {
      await syncs[0]!.catchUp()
    })
    press(await screen.findByTestId('community-card-comments-post-a'))
    await screen.findByText('Previously visible thread comment.')
    const composer = screen.getByTestId<HTMLInputElement>('comment-body')
    composer.focus()
    fireEvent.change(composer, {
      target: { value: 'Keep my unsent thread draft' },
    })
    visible = false
    resync = true
    try {
      await act(async () => {
        await syncs[0]!.catchUp()
      })
      await waitFor(() => expect(rebuilding).toBe(true))
      expect(screen.getByTestId('comment-body')).toBe(composer)
      expect(document.activeElement).toBe(composer)
      expect(screen.getByTestId('community-card-comments-post-a')).toBeTruthy()
    } finally {
      releaseRebuild()
    }
    await act(async () => {
      await syncs[0]!.catchUp()
    })
    await waitFor(() =>
      expect(screen.queryByText('Previously visible thread comment.')).toBeNull()
    )
    expect((await screen.findByTestId<HTMLInputElement>('comment-body')).value).toBe(
      'Keep my unsent thread draft'
    )
    expect(screen.getByTestId('comment-body')).toBe(composer)
    expect(document.activeElement).toBe(composer)
  })

  it('R09 foreground recovery preserves an in-flight same-owner publish', async () => {
    const syncs: CommunitySyncState[] = []
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
      this: CommunitySyncState
    ) {
      syncs.push(this)
    })
    let release!: () => void
    let published = 0
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const summary = {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      viewerReaction: null,
      revision: 0,
      generation: 0,
    }
    server.use(
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events: [],
            nextCursor: 'recovery',
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('*/api/v1/community/targets/resolve', () =>
        HttpResponse.json({
          data: {
            targets: [
              {
                key: 'post-a',
                status: 'available',
                communityRevision: '0',
                post: item({ reactions: summary }),
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
      http.post('*/api/v1/community/posts/allocate', () =>
        HttpResponse.json({
          data: {
            postId: 'recovery-post',
            uploadSessionId: 'recovery-session',
            uploadUrl: UPLOAD_URL,
            uploadToken: 'fixture-upload',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            altTextSuggestion: 'A neutral layered outfit.',
            altTextSuggestionLocale: 'en-US',
          },
        })
      ),
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
      http.post('*/api/v1/community/posts/publish', async () => {
        published++
        await held
        return HttpResponse.json({
          data: item({
            id: 'recovery-post',
            status: 'pending_review',
            publishedAt: null,
            author: { displayName: 'You', isSelf: true },
          }),
        })
      })
    )
    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-new-post-button'))
    press(await screen.findByTestId('community-pick-image-button'))
    await screen.findByTestId('community-post-preview-image')
    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input').value
      ).toBe('A neutral layered outfit.')
    )
    fireEvent.change(screen.getByTestId('community-caption-input'), {
      target: { value: 'Retained composition' },
    })
    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))
    await waitFor(() => expect(published).toBe(1))
    await act(async () => {
      syncs[0]!.foreground()
      await syncs[0]!.catchUp()
    })
    release()
    await waitFor(() => expect(screen.queryByTestId('community-post-sheet')).toBeNull())
    expect((await screen.findByTestId('deep-link-info-banner')).textContent).toContain(
      'Your look was submitted for review.'
    )
    expect(published).toBe(1)
  })
  it('drops new looks buffered under the previous filter when the filter changes', async () => {
    const feeds = twoFilterFeeds()
    await bufferColdLook(feeds)
    press(screen.getByTestId('community-filter-chip-warm_wet'))
    await screen.findByTestId('community-post-card-post-warm')
    expect(screen.queryByRole('button', { name: 'Show 1 new looks' })).toBeNull()
    expect(screen.queryByTestId('community-post-card-post-cold-new')).toBeNull()
  })
  it('never inserts looks from an insertion started before the filter changed', async () => {
    const feeds = twoFilterFeeds()
    await bufferColdLook(feeds)
    let release!: () => void
    feeds.state.resolveHeld = new Promise<void>((resolve) => {
      release = resolve
    })
    press(screen.getByRole('button', { name: 'Show 1 new looks' }))
    press(screen.getByTestId('community-filter-chip-warm_wet'))
    await screen.findByTestId('community-post-card-post-warm')
    release()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(screen.getByTestId('community-post-card-post-warm')).toBeTruthy()
    expect(screen.queryByTestId('community-post-card-post-cold-new')).toBeNull()
  })
  it('R08 withdraws a buffered new look before the member can insert it', async () => {
    let catchUp!: () => Promise<void>
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
      this: CommunitySyncState
    ) {
      catchUp = () => this.catchUp()
      void this.catchUp()
    })
    let phase = 0
    const summary = {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      viewerReaction: null,
      revision: 0,
      generation: 0,
    }
    serveFeed(() =>
      feedJson({
        items: [
          item({ reactions: summary }),
          ...(phase === 1 ? [item({ id: 'post-b', reactions: summary })] : []),
        ],
      })
    )
    server.use(
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events: phase
              ? [
                  {
                    version: 1,
                    kind: phase === 1 ? 'post.published' : 'reactions.changed',
                    postId: 'post-b',
                    communityRevision: String(phase),
                  },
                ]
              : [],
            nextCursor: 'buffer-cursor',
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as {
          targets: { key: string; postId: string }[]
        }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) =>
              phase === 2 && target.postId === 'post-b'
                ? { key: target.key, status: 'unavailable' }
                : {
                    key: target.key,
                    status: 'available',
                    communityRevision: String(phase),
                    post: item({ id: target.postId, reactions: summary }),
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
    await render(<CommunityScreen />)
    await screen.findByRole('button', { name: 'Applaud, 0' })
    await waitFor(() => expect(catchUp).toBeTypeOf('function'))
    await act(async () => {
      await catchUp()
    })
    phase = 1
    await act(async () => {
      await catchUp()
    })
    await screen.findByRole('button', { name: 'Show 1 new looks' })
    phase = 2
    await act(async () => {
      await catchUp()
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Show 1 new looks' })).toBeNull()
    )
    expect(screen.queryByTestId('community-post-card-post-b')).toBeNull()
  })
  it('6.5-MOB-local: passive invalidation replaces a previously rendered reaction aggregate', async () => {
    let catchUp: (() => Promise<void>) | undefined
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
      this: CommunitySyncState
    ) {
      catchUp = () => this.catchUp()
      void this.catchUp()
    })
    let revision = 0
    const summary = (): CommunityReactionSummary => ({
      counts: { applause: revision, love: 0, inspiration: 0 },
      total: revision,
      viewerReaction: null,
      revision,
      generation: 0,
    })
    serveFeed(() => feedJson({ items: [item({ reactions: summary() })] }))
    let eventReads = 0
    server.use(
      http.get('*/api/v1/community/events', () => {
        eventReads++
        return HttpResponse.json({
          data: {
            events: revision
              ? [
                  {
                    version: 1,
                    kind: 'reactions.changed',
                    postId: 'post-a',
                    communityRevision: String(revision),
                  },
                ]
              : [],
            nextCursor: 'owned-local-cursor',
            hasMore: false,
            resyncRequired: false,
          },
        })
      }),
      http.post('*/api/v1/community/targets/resolve', () =>
        HttpResponse.json({
          data: {
            targets: [
              {
                key: 'post-a',
                status: 'available',
                communityRevision: String(revision),
                post: item({ reactions: summary() }),
                comment: null,
                parent: null,
                pageCursor: null,
                parentPageCursor: null,
                threadPosition: null,
              },
            ],
          },
        })
      )
    )
    await render(<CommunityScreen />)
    await screen.findByRole('button', { name: 'Applaud, 0' })
    await waitFor(() => expect(eventReads).toBeGreaterThanOrEqual(2))
    revision = 1
    await act(async () => {
      await catchUp!()
    })
    await screen.findByRole('button', { name: 'Applaud, 1' })
    expect(screen.getByTestId('community-reaction-total-post-a').textContent).toBe(
      '1 reaction'
    )
  })
}
