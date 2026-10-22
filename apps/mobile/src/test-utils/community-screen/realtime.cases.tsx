import { press } from '@/src/test-utils/press'
/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.5: actual screen, coordinator and generated HTTP wrappers. Socket trigger is controlled.
import { CommunitySyncState } from '@couture/api-client'
import type { CommunityReactionSummary } from '@couture/api-client/contracts/http'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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
    unavailable: async () => {
      failed = true
      await recover()
      failed = false
    },
  })
}

export function registerCommunityRealtimeCases() {
  it('A05 doorbell invalidation releases held pagination ownership and allows another load', async () => {
    const recover = recoveryCoordinator()
    let pages = 0
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    serveFeed(async (url) => {
      if (url.searchParams.has('cursor')) {
        if (++pages === 1) await held
        return feedJson({ items: [item({ id: 'page-two' })], nextCursor: null })
      }
      return feedJson({ items: [item()], nextCursor: cursor('temperate_dry') })
    })
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')
    await act(recover)
    if (pages === 0) press(await screen.findByTestId('community-feed-load-more'))
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
    expect(screen.queryByTestId('community-card-post-b')).toBeNull()
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
