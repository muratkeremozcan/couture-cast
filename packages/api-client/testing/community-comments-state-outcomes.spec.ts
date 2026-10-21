// Story 6.4 owner: create outcome classification, read failure keys, stale-response fences,
// private suppression and snapshot pagination for the screen-owned comments state.
import { describe, expect, it, vi } from 'vitest'
import { CommunityCommentsState } from '../src/community-comments-state'
import { CommunityRequestSuperseded } from '../src/community-sync-state'
import type { CommunitySyncClient } from '../src/community-sync-client'
import type {
  CommunityCommentsPage,
  CommunityCommentSubmission,
} from '../src/contracts/http/community'
import {
  deferred,
  item,
  own,
  ownPage,
  page,
  setup,
  type SubmissionsPage,
} from './community-comments-state-fixtures'

describe('screen-owned comments state', () => {
  it.each([
    ['initial roots', null, false],
    ['refreshed roots at the last page', null, true],
    ['first reply expansion', 'root', false],
    ['refreshed replies at the last page', 'root', true],
  ] as const)(
    'preserves a deferred %s read when no-cursor append is requested',
    async (_label, parentId, cached) => {
      const { state, transport } = setup()
      const read = parentId ? transport.replies : transport.roots
      if (cached) await state.load('post', parentId)
      const refresh = deferred<CommunityCommentsPage>()
      read.mockReturnValueOnce(refresh.promise)
      const refreshing = state.load('post', parentId)
      expect(state.current('post').loading).toBe(true)

      // The public client accepts calls from any consumer, including stale pager callbacks.
      await state.load('post', parentId, true)
      expect(state.current('post').loading).toBe(true)
      const accepted = page([{ ...item('fresh', 6), parentId }], null, 6)
      refresh.resolve(accepted)
      await refreshing

      const result = parentId
        ? state.current('post').replies.get(parentId)
        : state.current('post').roots
      expect(result).toEqual(accepted)
      expect(state.current('post')).toMatchObject({ loading: false, error: null })
      expect(read).toHaveBeenCalledTimes(cached ? 2 : 1)
    }
  )

  // not_found evicts only this post; signed_out resets every cached thread.
  it.each([
    ['not_found', null, 'other draft'],
    ['signed_out', null, ''],
    ['disabled', 'community.error.disabled', 'other draft'],
    ['rate_limited', 'community.comments.rateLimited', 'other draft'],
    ['age_gate', 'community.error.ageGate', 'other draft'],
    ['unknown', 'community.comments.failed', 'other draft'],
  ] as const)(
    'handles public read failure %s with error %s',
    async (reason, error, otherDraft) => {
      const { state, transport } = setup()
      state.draft('other', { body: 'other draft' })
      transport.roots.mockRejectedValueOnce(reason)
      await state.load('post')
      expect(state.current('post')).toMatchObject({ roots: null, loading: false, error })
      expect(state.current('post').announcement?.key ?? null).toBe(error)
      expect(state.current('other').draft.body).toBe(otherDraft)
    }
  )
})

describe('create intent classification (B1)', () => {
  const intent = {
    mutationId: '00000000-0000-4000-8000-000000000001',
    body: 'Beautiful layers.',
    parentId: 'root',
    locale: 'en-US',
  }

  it.each<[string, unknown, string]>([
    ['HTTP 400', { httpStatus: 400 }, 'community.comments.failed'],
    ['HTTP 403', { httpStatus: 403 }, 'community.comments.failed'],
    ['HTTP 409', { httpStatus: 409 }, 'community.comments.failed'],
    ['HTTP 429', { httpStatus: 429 }, 'community.comments.failed'],
    ['age_gate', 'age_gate', 'community.error.ageGate'],
    ['disabled', 'disabled', 'community.error.disabled'],
    ['rate_limited', 'rate_limited', 'community.comments.rateLimited'],
    ['reason_changed', 'reason_changed', 'community.comments.failed'],
    ['self_report', 'self_report', 'community.comments.failed'],
  ])(
    'releases the intent after a definite %s rejection and keeps the draft',
    async (_label, rejection, error) => {
      const { state, transport, id } = setup()
      state.draft('post', { body: 'Beautiful layers.', parentId: 'root' })
      transport.create.mockRejectedValueOnce(rejection)
      await state.submit('post', 'en-US')
      expect(transport.create).toHaveBeenCalledWith('post', intent)
      expect(state.current('post')).toMatchObject({
        unresolved: null,
        pending: false,
        error,
        draft: { body: 'Beautiful layers.', parentId: 'root' },
      })
      id.mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      await state.submit('post', 'en-US')
      expect(transport.create).toHaveBeenLastCalledWith('post', {
        ...intent,
        mutationId: '00000000-0000-4000-8000-000000000002',
      })
    }
  )

  it.each<[string, unknown]>([
    ['HTTP 500', { httpStatus: 500 }],
    ['HTTP 503', { httpStatus: 503 }],
    ['a deadline timeout', new DOMException('Request deadline reached', 'TimeoutError')],
    ['an aborted request', new DOMException('The operation was aborted.', 'AbortError')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])(
    'retains the exact intent after %s and retries the identical request',
    async (_label, rejection) => {
      const { state, transport, id } = setup()
      state.draft('post', { body: 'Beautiful layers.', parentId: 'root' })
      transport.create.mockRejectedValueOnce(rejection)
      await state.submit('post', 'en-US')
      expect(state.current('post').unresolved).toEqual(intent)
      expect(state.current('post')).toMatchObject({
        pending: false,
        error: 'community.comments.failed',
      })
      state.draft('post', { body: 'Edited while offline', parentId: null })
      await state.submit('post', 'fr-FR')
      expect(transport.create.mock.calls).toEqual([
        ['post', intent],
        ['post', intent],
      ])
      expect(id).toHaveBeenCalledTimes(1)
      expect(state.current('post')).toMatchObject({
        unresolved: null,
        error: null,
        draft: { body: 'Edited while offline', parentId: null },
      })
    }
  )
})

describe('stale-response fences with non-evicting failures', () => {
  it('ignores a superseded public read that fails after a newer read succeeded', async () => {
    const { state, transport } = setup(),
      first = deferred<CommunityCommentsPage>()
    transport.roots.mockReturnValueOnce(first.promise)
    const old = state.load('post')
    await state.load('post')
    const version = state.getVersion()
    first.reject('unknown')
    await old
    expect(state.current('post')).toMatchObject({
      roots: page(),
      loading: false,
      pending: false,
      error: null,
      announcement: null,
    })
    expect(state.getVersion()).toBe(version)
  })

  it('ignores a reply expansion failure fenced by a root refresh', async () => {
    const { state, transport } = setup(),
      reply = deferred<CommunityCommentsPage>()
    transport.replies.mockReturnValueOnce(reply.promise)
    const expanding = state.load('post', 'root')
    await state.load('post')
    reply.reject('unknown')
    await expanding
    expect(state.current('post')).toMatchObject({
      roots: page(),
      loading: false,
      error: null,
      announcement: null,
    })
    expect(state.current('post').replies.size).toBe(0)
  })

  it.each(['unknown', 'not_found', 'signed_out'])(
    'ignores %s from mutations and polls started before an account switch',
    async (reason) => {
      const { transport, id } = setup()
      const close = vi.fn()
      const state = new CommunityCommentsState(
        transport,
        id,
        (error) => (typeof error === 'string' ? error : 'unknown'),
        close
      )
      state.setSession('first-account')
      const deleted = deferred<CommunityCommentSubmission>(),
        reported = deferred<unknown>(),
        created = deferred<CommunityCommentSubmission>(),
        polled = deferred<SubmissionsPage>()
      transport.delete.mockReturnValueOnce(deleted.promise)
      transport.report.mockReturnValueOnce(reported.promise)
      transport.create.mockReturnValueOnce(created.promise)
      transport.submissions.mockReturnValueOnce(polled.promise)
      state.draft('post', { body: 'Beautiful layers.' })
      const pending = [
        state.delete('post', 'root'),
        state.report('post', 'root', 'spam'),
        state.submit('post', 'en-US'),
        state.statuses('post'),
      ]
      state.setSession('second-account')
      state.draft('post', { body: 'Second account draft' })
      const version = state.getVersion()
      deleted.reject(reason)
      reported.reject(reason)
      created.reject(reason)
      polled.reject(reason)
      await Promise.all(pending)
      expect(state.current('post')).toMatchObject({
        draft: { body: 'Second account draft', parentId: null },
        unresolved: null,
        pending: false,
        error: null,
        announcement: null,
      })
      expect(close).not.toHaveBeenCalled()
      expect(state.getVersion()).toBe(version)
    }
  )
})

describe('private status suppression of cached public comments', () => {
  it.each<[string, 'author_deleted' | 'erased' | 'consent_suspended', string | null]>([
    ['root', 'author_deleted', null],
    ['root', 'erased', null],
    ['root', 'consent_suspended', null],
    ['reply', 'author_deleted', 'root'],
    ['reply', 'erased', 'root'],
    ['reply', 'consent_suspended', 'root'],
  ])(
    'removes a cached %s body and alias after a private %s status',
    async (target, status, parentId) => {
      const { state, transport } = setup(),
        stale = deferred<CommunityCommentsPage>()
      transport.roots.mockResolvedValueOnce(page([item('root'), item('other', 2)]))
      await state.load('post')
      transport.replies.mockResolvedValueOnce(
        page([
          { ...item('reply'), parentId: 'root' },
          { ...item('sibling', 2), parentId: 'root' },
        ])
      )
      await state.load('post', 'root')
      const view = () =>
        parentId
          ? state.current('post').replies.get(parentId)
          : state.current('post').roots
      const cached = view()
      ;(parentId ? transport.replies : transport.roots).mockReturnValueOnce(stale.promise)
      const reading = state.load('post', parentId)
      transport.submissions.mockResolvedValueOnce(
        ownPage([
          { ...own(target), parentId, status, body: null, publicationSequence: 1 },
        ])
      )
      await state.statuses('post')
      stale.resolve(cached ?? page())
      await reading
      expect(view()?.items).toEqual([
        { ...cached?.items[0], body: null, author: null, unavailable: true },
        cached?.items[1],
      ])
      expect(state.current('post').roots?.items[1]?.body).toBe('Beautiful layers.')
      expect(state.current('post').submissions).toEqual([])
    }
  )
})

describe('pagination across snapshots', () => {
  it.each<[string, string | null]>([
    ['roots', null],
    ['replies', 'root'],
  ])(
    'replaces %s when an append returns a changed snapshot',
    async (_label, parentId) => {
      const { state, transport } = setup()
      const read = parentId ? transport.replies : transport.roots
      read
        .mockResolvedValueOnce(page([item('a', 1), item('b', 2)], 'next', 5))
        .mockResolvedValueOnce(page([item('c', 3)], null, 6))
      await state.load('post', parentId)
      await state.load('post', parentId, true)
      const view = parentId
        ? state.current('post').replies.get(parentId)
        : state.current('post').roots
      expect(view).toEqual(page([item('c', 3)], null, 6))
      expect(read.mock.calls[1]?.at(-1)).toBe('next')
    }
  )

  it('discards an in-flight append when a refresh replaces the snapshot', async () => {
    const { state, transport } = setup(),
      append = deferred<CommunityCommentsPage>()
    transport.roots
      .mockResolvedValueOnce(page([item('a', 1)], 'next', 5))
      .mockReturnValueOnce(append.promise)
      .mockResolvedValueOnce(page([item('fresh', 4)], null, 6))
    await state.load('post')
    const appending = state.load('post', null, true)
    await state.load('post')
    append.resolve(page([item('b', 2)], null, 5))
    await appending
    expect(state.current('post')).toMatchObject({
      roots: page([item('fresh', 4)], null, 6),
      loading: false,
      error: null,
    })
    expect(transport.roots.mock.calls).toEqual([
      ['post', undefined],
      ['post', 'next'],
      ['post', undefined],
    ])
  })
})

describe('R07 authoritative thread recovery', () => {
  function focusedReplyTarget() {
    return {
      key: 'post',
      status: 'available' as const,
      communityRevision: '2',
      post: {
        id: 'post',
        status: 'published' as const,
        caption: null,
        altText: 'Neutral fixture',
        climateBand: 'cold_dry' as const,
        challengeId: null,
        createdAt: '2026-01-01T00:00:00Z',
        publishedAt: '2026-01-01T00:00:00Z',
        author: { displayName: 'Fixture', isSelf: false },
        imageAccess: {
          url: 'https://fixture.invalid/image',
          expiresAt: '2026-12-01T00:00:00Z',
        },
        reactions: {
          counts: { applause: 0, love: 0, inspiration: 0 },
          total: 0,
          viewerReaction: null,
          revision: 0,
          generation: 0,
        },
      },
      comment: { ...item('reply-22', 45), parentId: 'root-23' },
      parent: { ...item('root-23', 23), replyCount: 22 },
      pageCursor: 'reply-target-page',
      parentPageCursor: 'parent-target-page',
      threadPosition: 45,
    }
  }
  it('keeps the focused off-page reply when refresh starts before its target page commits', async () => {
    const { state, transport } = setup()
    const targetRoots = deferred<CommunityCommentsPage>()
    const located = deferred<Awaited<ReturnType<CommunitySyncClient['resolve']>>>()
    const locateStarted = deferred<void>()
    const target = focusedReplyTarget()
    const locate = vi
      .fn<CommunitySyncClient['resolve']>()
      .mockImplementationOnce(() => {
        locateStarted.resolve()
        return located.promise
      })
      .mockResolvedValue({ targets: [target] })
    transport.locate = locate
    transport.roots
      .mockReturnValueOnce(targetRoots.promise)
      .mockResolvedValue(page([target.parent]))
    transport.replies.mockResolvedValue(page([target.comment]))
    const loading = state.loadTarget('post', {
      commentId: target.comment.id,
      parentId: target.parent.id,
      pageCursor: target.pageCursor,
      parentPageCursor: target.parentPageCursor,
    })
    state.draft('post', { body: 'Retained draft' })
    const refreshing = state.refresh('post')
    await locateStarted.promise
    expect(state.current('post').replies.size).toBe(0)
    targetRoots.resolve(page([target.parent]))
    await loading
    expect(state.current('post').replies.get('root-23')?.items).toEqual([target.comment])
    located.resolve({ targets: [target] })
    await refreshing
    expect(state.current('post').replies.get('root-23')?.items).toEqual([target.comment])
    expect(transport.replies).toHaveBeenLastCalledWith(
      'post',
      'root-23',
      'reply-target-page'
    )
    await state.refresh('post')
    expect(state.current('post').replies.get('root-23')?.items).toEqual([target.comment])
    expect(state.current('post').draft.body).toBe('Retained draft')
    expect(locate).toHaveBeenCalledTimes(2)
  })
  it.each([
    'explicit navigation',
    'close',
    'new target',
    'eviction',
    'account switch',
  ] as const)('fences the captured focus refresh after %s', async (action) => {
    const { state, transport } = setup()
    const target = focusedReplyTarget()
    transport.roots.mockResolvedValue(page([target.parent]))
    transport.replies.mockResolvedValue(page([target.comment]))
    await state.loadTarget('post', {
      commentId: target.comment.id,
      parentId: target.parent.id,
      pageCursor: target.pageCursor,
      parentPageCursor: target.parentPageCursor,
    })
    const located = deferred<Awaited<ReturnType<CommunitySyncClient['resolve']>>>()
    transport.locate = vi
      .fn<CommunitySyncClient['resolve']>()
      .mockReturnValue(located.promise)
    const refreshing = state.refresh('post')
    const rejected = expect(refreshing).rejects.toBeInstanceOf(CommunityRequestSuperseded)
    if (action === 'explicit navigation') await state.load('post')
    else if (action === 'close') state.retireFocus('post')
    else if (action === 'eviction') state.evict('post')
    else if (action === 'account switch') state.setSession('second')
    else
      await state.loadTarget('post', {
        commentId: 'other-root',
        parentId: null,
        pageCursor: 'other-target-page',
        parentPageCursor: null,
      })
    state.draft('post', { body: 'Current owner draft' })
    const rootsCalls = transport.roots.mock.calls.length
    located.resolve({ targets: [{ key: 'post', status: 'unavailable' }] })
    await rejected
    expect(state.current('post').draft.body).toBe('Current owner draft')
    expect(transport.roots).toHaveBeenCalledTimes(rootsCalls)
    if (action === 'eviction' || action === 'account switch')
      expect(state.current('post').replies.size).toBe(0)
  })
  it('resolves the current off-page snapshot before refreshing and fences a late account result', async () => {
    const { state, transport } = setup()
    state.setSession('first')
    transport.roots.mockResolvedValue(page([item('older-target', 25)]))
    const located: Awaited<ReturnType<CommunitySyncClient['resolve']>> = {
      targets: [
        {
          key: 'post',
          status: 'available',
          communityRevision: '2',
          post: {
            id: 'post',
            status: 'published',
            caption: null,
            altText: 'Neutral fixture',
            climateBand: 'cold_dry',
            challengeId: null,
            createdAt: '2026-01-01T00:00:00Z',
            publishedAt: '2026-01-01T00:00:00Z',
            author: { displayName: 'Fixture', isSelf: false },
            imageAccess: {
              url: 'https://fixture.invalid/image',
              expiresAt: '2026-12-01T00:00:00Z',
            },
            reactions: {
              counts: { applause: 0, love: 0, inspiration: 0 },
              total: 0,
              viewerReaction: null,
              revision: 0,
              generation: 0,
            },
          },
          comment: item('older-target', 25),
          parent: null,
          pageCursor: 'new-snapshot-page',
          parentPageCursor: null,
          threadPosition: 25,
        },
      ],
    }
    const locate = vi.fn<CommunitySyncClient['resolve']>().mockResolvedValue(located)
    transport.locate = locate
    await state.loadTarget('post', {
      commentId: 'older-target',
      parentId: null,
      pageCursor: 'old-snapshot-page',
      parentPageCursor: null,
    })
    state.draft('post', { body: 'Retained off-page draft' })
    await state.refresh('post')
    expect(locate).toHaveBeenCalledWith(
      { targets: [{ key: 'post', postId: 'post', commentId: 'older-target' }] },
      undefined
    )
    expect(transport.roots).toHaveBeenLastCalledWith('post', 'new-snapshot-page')
    expect(state.current('post').draft.body).toBe('Retained off-page draft')
    // Explicit navigation retires the deep-link page; passive refresh keeps its intent.
    await state.load('post')
    await state.refresh('post')
    expect(locate).toHaveBeenCalledTimes(1)
    expect(transport.roots).toHaveBeenLastCalledWith('post', undefined)
    await state.loadTarget('post', {
      commentId: 'older-target',
      parentId: null,
      pageCursor: 'new-snapshot-page',
      parentPageCursor: null,
    })
    const held = deferred<Awaited<ReturnType<CommunitySyncClient['resolve']>>>()
    locate.mockReturnValueOnce(held.promise)
    const refreshing = state.refresh('post')
    state.setSession('second')
    state.draft('post', { body: 'Second account draft' })
    held.resolve({ targets: [{ key: 'post', status: 'unavailable' }] })
    await expect(refreshing).rejects.toBeInstanceOf(CommunityRequestSuperseded)
    expect(state.current('post').draft.body).toBe('Second account draft')
    expect(transport.roots).toHaveBeenCalledTimes(5)
  })

  it('propagates a required refresh failure and retains the draft for retry', async () => {
    const { state, transport } = setup()
    await state.load('post')
    state.draft('post', { body: 'Retained draft' })
    transport.roots.mockRejectedValueOnce(new Error('offline'))
    await expect(state.refresh('post')).rejects.toThrow('offline')
    expect(state.current('post').draft.body).toBe('Retained draft')
  })
  it('preserves the off-page target cursor during refresh and announces only added comments', async () => {
    const { state, transport } = setup()
    transport.roots.mockResolvedValue(page([item('older-target', 25)]))
    await state.loadTarget('post', {
      parentId: null,
      pageCursor: 'off-page',
      parentPageCursor: null,
    })
    await state.refresh('post')
    expect(transport.roots).toHaveBeenLastCalledWith('post', 'off-page')
    expect(state.consumeAnnouncement('post')).toBeNull()
    transport.roots.mockResolvedValue(page([item('older-target', 25), item('new', 26)]))
    await state.refresh('post')
    expect(state.consumeAnnouncement('post')?.key).toBe('community.realtime.newComments')
  })
  it('target loading preserves a concurrent private status read and handles page failure', async () => {
    const { state, transport } = setup()
    const held = deferred<SubmissionsPage>()
    transport.submissions.mockReturnValueOnce(held.promise)
    const statuses = state.statuses('post')
    await state.loadTarget('post', {
      parentId: null,
      pageCursor: 'target',
      parentPageCursor: null,
    })
    held.resolve(ownPage())
    await statuses
    expect(state.current('post').submissions).toEqual([own()])
    transport.roots.mockRejectedValueOnce('unknown')
    await expect(
      state.loadTarget('post', {
        parentId: null,
        pageCursor: 'target',
        parentPageCursor: null,
      })
    ).resolves.toBeUndefined()
    expect(state.current('post').error).toBe('community.comments.failed')
  })
})
