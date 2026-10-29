import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CommunityCommentsState,
  commentSessionIdentity,
} from '../src/community-comments-state'
import {
  createCommunityCommentInputSchema,
  communityCommentBodySchema,
  communityCommentsCursorSchema,
  type CommunityCommentsPage,
  type CommunityCommentSubmission,
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

// Accepted contract: a body holds at most 280 UTF-16 units, and each emoji below is 2 units.
const MAX_BODY_UTF16 = 280
const EMOJI = '😀'
const atLimitBody = EMOJI.repeat(MAX_BODY_UTF16 / EMOJI.length)
const overLimitBody = `${atLimitBody}${EMOJI}`

describe('comment contracts', () => {
  it.each([
    '',
    '\u200b\u2060',
    '\u061c',
    '\u034f',
    '\u115f',
    '\u1160',
    '\u17b4',
    '\u180b',
    '\u2800',
    '\u3164',
    '\ufe0f',
    '\uffa0',
    '\ufff0',
    '\u{e0100}',
    'a\nb',
    '\nHello',
    '\ud800',
    'a\u2028b',
    'a\u2029b',
    overLimitBody,
  ])('refuses invalid single-line visible text %j', (body) =>
    expect(communityCommentBodySchema.safeParse(body).success).toBe(false)
  )
  it('validates the parent scope of root and reply snapshot cursors', () => {
    const root = { kind: 'roots', postId: 'post', parentId: null, snapshot: 2, after: 1 }
    expect(communityCommentsCursorSchema.safeParse(root).success).toBe(true)
    expect(
      communityCommentsCursorSchema.safeParse({ ...root, parentId: 'root' }).success
    ).toBe(false)
    expect(
      communityCommentsCursorSchema.safeParse({ ...root, kind: 'replies' }).success
    ).toBe(false)
    expect(
      communityCommentsCursorSchema.safeParse({
        ...root,
        kind: 'replies',
        parentId: 'root',
      }).success
    ).toBe(true)
  })
  it('normalizes NFC, trims and counts UTF-16 units', () => {
    expect(communityCommentBodySchema.parse(' e\u0301 ')).toBe('é')
    expect(communityCommentBodySchema.parse(atLimitBody)).toHaveLength(MAX_BODY_UTF16)
    expect(
      createCommunityCommentInputSchema.parse({
        mutationId: '00000000-0000-4000-8000-000000000001',
        body: 'Hello',
        locale: 'en-US',
      }).parentId
    ).toBeNull()
    expect(
      communityCommentsCursorSchema.safeParse({
        kind: 'roots',
        postId: 'p',
        parentId: null,
        snapshot: 1,
        after: 2,
      }).success
    ).toBe(false)
  })
})

describe('screen-owned comments state', () => {
  it('notifies subscribers and isolates account changes, erasure and visibility', () => {
    const { state } = setup(),
      listener = vi.fn()
    const unsubscribe = state.subscribe(listener)
    state.setSession('one')
    state.draft('post', { body: 'draft' })
    state.setSession('one')
    expect(state.current('post').draft.body).toBe('draft')
    state.setSession('two')
    expect(state.current('post').draft.body).toBe('')
    state.draft('post', { body: 'private' })
    state.evict('post')
    expect(state.current('post').draft.body).toBe('')
    state.draft('post', { body: 'private' })
    state.reset()
    expect(state.current('post').draft.body).toBe('')
    const version = state.getVersion()
    unsubscribe()
    state.reset()
    expect(listener).toHaveBeenCalledTimes(version)
  })
  it('merges oldest-first pages once within a snapshot and replaces fresh snapshots', async () => {
    const { state, transport } = setup()
    transport.roots
      .mockResolvedValueOnce(page([item('b', 2)], 'next'))
      .mockResolvedValueOnce(page([item('a', 1), item('b', 2)]))
    await state.load('post')
    await state.load('post', null, true)
    expect(state.current('post').roots?.items.map((row) => row.id)).toEqual(['a', 'b'])
    await state.load('post', null, true)
    expect(transport.roots).toHaveBeenCalledTimes(2)
    transport.roots.mockResolvedValueOnce(page([item('c', 3)], null, 6))
    await state.load('post')
    expect(state.current('post').roots?.snapshot).toBe(6)
  })
  it('loads and merges reply pages, and clears/fences cached replies on refresh', async () => {
    const { state, transport } = setup()
    transport.replies
      .mockResolvedValueOnce(page([item('a', 1)], 'next'))
      .mockResolvedValueOnce(page([item('b', 2)]))
    await state.load('post', 'root')
    await state.load('post', 'root', true)
    expect(state.current('post').replies.get('root')?.items).toHaveLength(2)
    const late = deferred<CommunityCommentsPage>()
    transport.replies.mockReturnValueOnce(late.promise)
    const old = state.load('post', 'root')
    await state.load('post')
    late.resolve(page([item('stale')]))
    await old
    expect(state.current('post').replies.size).toBe(0)
  })
  it('fences first reply expansions on refresh while preserving private and other-post reads', async () => {
    const { state, transport } = setup()
    const reply = deferred<CommunityCommentsPage>(),
      other = deferred<CommunityCommentsPage>(),
      statuses = deferred<SubmissionsPage>()
    transport.replies.mockReturnValueOnce(reply.promise)
    transport.roots.mockReturnValueOnce(other.promise)
    transport.submissions.mockReturnValueOnce(statuses.promise)
    const oldReply = state.load('post', 'root'),
      otherRead = state.load('other'),
      privateRead = state.statuses('post')
    await state.load('post')
    reply.resolve(page([item('stale')]))
    other.resolve(page([item('other')]))
    statuses.resolve(ownPage())
    await Promise.all([oldReply, otherRead, privateRead])
    expect(state.current('post').replies.size).toBe(0)
    expect(state.current('other').roots?.items[0]?.id).toBe('other')
    expect(state.current('post').submissions[0]?.id).toBe('own')
  })
  it('keeps a reply page expanded while a refresh is still reading the roots', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    transport.roots.mockReturnValueOnce(roots.promise)
    const refreshing = state.refresh('post')
    transport.replies.mockResolvedValueOnce(page([item('reply', 2)]))
    await state.load('post', 'root')
    roots.resolve(page([{ ...item('root'), replyCount: 1 }]))
    await refreshing
    expect(
      state
        .current('post')
        .replies.get('root')
        ?.items.map((reply) => reply.id)
    ).toEqual(['reply'])
  })
  it('drops a reply page expanded during a refresh when its parent is gone from the new roots', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    transport.roots.mockReturnValueOnce(roots.promise)
    const refreshing = state.refresh('post')
    transport.replies.mockResolvedValueOnce(page([item('reply', 2)]))
    await state.load('post', 'root')
    roots.resolve(page([item('other', 3)]))
    await refreshing
    expect(state.current('post').replies.has('root')).toBe(false)
  })
  it('keeps a page loaded onto an expanded parent while a refresh re-reads that parent', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    transport.replies.mockResolvedValueOnce(page([item('first', 2)], 'next'))
    await state.load('post', 'root')
    transport.roots.mockReturnValueOnce(roots.promise)
    const refreshing = state.refresh('post')
    transport.replies
      .mockResolvedValueOnce(page([item('second', 3)]))
      .mockResolvedValueOnce(page([item('first', 2)], 'next'))
    await state.load('post', 'root', true)
    roots.resolve(page([{ ...item('root'), replyCount: 2 }]))
    await refreshing
    const replies = state.current('post').replies.get('root')
    expect(replies?.items.map((reply) => reply.id)).toEqual(['first', 'second'])
    expect(replies?.nextCursor).toBeNull()
  })
  it('does not announce a reply page a member expanded while a refresh was reading', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    await state.load('post')
    transport.roots.mockReturnValueOnce(roots.promise)
    const refreshing = state.refresh('post')
    transport.replies.mockResolvedValueOnce(page([item('reply', 2)]))
    await state.load('post', 'root')
    roots.resolve(page([{ ...item('root'), replyCount: 1 }]))
    await refreshing
    expect(state.current('post').replies.get('root')?.items).toHaveLength(1)
    expect(state.current('post').announcement).toBeNull()
  })
  it('does not announce replies a member loaded onto a page while a refresh re-read it', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    await state.load('post')
    transport.replies.mockResolvedValueOnce(page([item('first', 2)], 'next'))
    await state.load('post', 'root')
    transport.roots.mockReturnValueOnce(roots.promise)
    const refreshing = state.refresh('post')
    transport.replies
      .mockResolvedValueOnce(page([item('second', 3)]))
      .mockResolvedValueOnce(page([item('first', 2)], 'next'))
    await state.load('post', 'root', true)
    roots.resolve(page([{ ...item('root'), replyCount: 2 }]))
    await refreshing
    expect(state.current('post').replies.get('root')?.items).toHaveLength(2)
    expect(state.current('post').announcement).toBeNull()
  })
  it('still announces a reply that arrived while a refresh kept a member-loaded page', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    await state.load('post')
    transport.replies.mockResolvedValueOnce(page([item('first', 2)], 'next'))
    await state.load('post', 'root')
    transport.roots.mockReturnValueOnce(roots.promise)
    const refreshing = state.refresh('post')
    transport.replies
      .mockResolvedValueOnce(page([item('second', 3)]))
      .mockResolvedValueOnce(page([item('first', 2), item('arrived', 4)], 'next'))
    await state.load('post', 'root', true)
    roots.resolve(page([{ ...item('root'), replyCount: 3 }]))
    await refreshing
    expect(state.current('post').announcement?.key).toBe('community.realtime.newComments')
  })
  it('does not bring back a reply the server removed from the re-read range', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    transport.replies.mockResolvedValueOnce(page([item('r1', 1), item('r2', 2)], 'c1'))
    await state.load('post', 'root')
    transport.roots.mockReturnValueOnce(roots.promise)
    const refreshing = state.refresh('post')
    transport.replies
      .mockResolvedValueOnce(page([item('D', 4), item('r5', 5)], 'c2'))
      .mockResolvedValueOnce(page([item('r1', 1), item('r5', 5)], 'c1'))
    await state.load('post', 'root', true)
    roots.resolve(page([{ ...item('root'), replyCount: 2 }]))
    await refreshing
    const replies = state.current('post').replies.get('root')
    expect(replies?.items.map((reply) => reply.id)).toEqual(['r1', 'r5'])
    expect(replies?.nextCursor).toBe('c2')
  })
  it('keeps a reply deleted elsewhere gone when a member loads more during the refresh', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    transport.replies.mockResolvedValueOnce(page([item('r1', 1), item('r2', 2)], 'c1'))
    await state.load('post', 'root')
    transport.roots.mockReturnValueOnce(roots.promise)
    const refreshing = state.refresh('post')
    transport.replies
      .mockResolvedValueOnce(page([item('D', 4)], 'c2'))
      .mockResolvedValueOnce(page([item('r1', 1)], 'c1'))
    await state.load('post', 'root', true)
    roots.resolve(page([{ ...item('root'), replyCount: 2 }]))
    await refreshing
    expect(
      state
        .current('post')
        .replies.get('root')
        ?.items.map((reply) => reply.id)
    ).toEqual(['r1', 'D'])
  })
  it('drops a re-read reply page whose parent is gone from the new roots', async () => {
    const { state, transport } = setup()
    transport.replies.mockResolvedValueOnce(page([item('reply', 2)]))
    await state.load('post', 'root')
    transport.roots.mockResolvedValueOnce(page([item('other', 3)]))
    transport.replies.mockResolvedValueOnce(page([item('reply', 2)]))
    await state.refresh('post')
    expect(state.current('post').replies.has('root')).toBe(false)
  })
  describe('root pages a member loads while a refresh is reading', () => {
    const ids = (state: ReturnType<typeof setup>['state']) =>
      state.current('post').roots?.items.map((root) => root.id)
    // The refresh reads the first page (held), a member's load more carries a cursor.
    function holdRefresh(transport: ReturnType<typeof setup>['transport']) {
      const reread = deferred<CommunityCommentsPage>()
      transport.roots.mockImplementation((_post: string, cursor?: string) =>
        cursor ? Promise.resolve(laterRoots()) : reread.promise
      )
      return reread
    }
    let laterRoots: () => CommunityCommentsPage
    it('keeps the next root page, its cursor and what is under it', async () => {
      const { state, transport } = setup()
      transport.roots.mockResolvedValueOnce(
        page([item('root1', 1), item('root2', 2)], 'rc1')
      )
      await state.load('post')
      laterRoots = () => page([{ ...item('root3', 4), replyCount: 1 }], 'rc2')
      const reread = holdRefresh(transport)
      const refreshing = state.refresh('post')
      await state.load('post', null, true)
      transport.replies.mockResolvedValueOnce(page([item('reply', 5)]))
      await state.load('post', 'root3')
      reread.resolve(page([item('root1', 1), item('root2', 2)], 'rc1'))
      await refreshing
      expect(ids(state)).toEqual(['root1', 'root2', 'root3'])
      expect(state.current('post').roots?.nextCursor).toBe('rc2')
      expect(state.current('post').replies.has('root3')).toBe(true)
    })
    it('does not bring back a root the server removed from the re-read range', async () => {
      const { state, transport } = setup()
      transport.roots.mockResolvedValueOnce(page([item('r1', 1), item('r2', 2)], 'rc1'))
      await state.load('post')
      laterRoots = () => page([item('D', 4), item('r5', 5)], 'rc2')
      const reread = holdRefresh(transport)
      const refreshing = state.refresh('post')
      await state.load('post', null, true)
      reread.resolve(page([item('r1', 1), item('r5', 5)], 'rc1'))
      await refreshing
      expect(ids(state)).toEqual(['r1', 'r5'])
      expect(state.current('post').roots?.nextCursor).toBe('rc2')
    })
    it('does not announce the roots a member loaded meanwhile', async () => {
      const { state, transport } = setup()
      transport.roots.mockResolvedValueOnce(page([item('root1', 1)], 'rc1'))
      await state.load('post')
      laterRoots = () => page([item('root2', 3)], 'rc2')
      const reread = holdRefresh(transport)
      const refreshing = state.refresh('post')
      await state.load('post', null, true)
      reread.resolve(page([item('root1', 1)], 'rc1'))
      await refreshing
      expect(ids(state)).toEqual(['root1', 'root2'])
      expect(state.current('post').announcement).toBeNull()
    })
  })
  it('lets a refresh replace the reply pages it re-read', async () => {
    const { state, transport } = setup(),
      roots = deferred<CommunityCommentsPage>()
    transport.replies.mockResolvedValueOnce(page([item('old', 2)]))
    await state.load('post', 'root')
    transport.roots.mockReturnValueOnce(roots.promise)
    transport.replies.mockResolvedValueOnce(page([item('old', 2), item('new', 3)]))
    const refreshing = state.refresh('post')
    roots.resolve(page([{ ...item('root'), replyCount: 2 }]))
    await refreshing
    expect(
      state
        .current('post')
        .replies.get('root')
        ?.items.map((reply) => reply.id)
    ).toEqual(['old', 'new'])
  })
  it('ignores older success and errors after newer requests and visibility loss', async () => {
    const { state, transport } = setup(),
      first = deferred<CommunityCommentsPage>()
    transport.roots.mockReturnValueOnce(first.promise)
    const old = state.load('post')
    await state.load('post')
    first.reject('not_found')
    await old
    expect(state.current('post').roots?.items).toHaveLength(1)
    const late = deferred<CommunityCommentsPage>()
    transport.roots.mockReturnValueOnce(late.promise)
    const stale = state.load('post')
    state.evict('post')
    late.resolve(page())
    await stale
    expect(state.current('post').roots).toBeNull()
  })
  it('serializes private polling, retains expanded pages and reconciles published IDs', async () => {
    const { state, transport } = setup()
    transport.submissions
      .mockResolvedValueOnce(ownPage([own('a')], 'next'))
      .mockResolvedValueOnce(ownPage([own('b')]))
    await state.statuses('post')
    await state.statuses('post', true)
    transport.submissions
      .mockResolvedValueOnce(ownPage([own('a')], 'next'))
      .mockResolvedValueOnce(ownPage([own('b')]))
    await state.statuses('post')
    expect(state.current('post').submissions.map((row) => row.id)).toEqual(['a', 'b'])
    await state.statuses('post', true)
    expect(transport.submissions).toHaveBeenCalledTimes(4)
    transport.roots.mockResolvedValueOnce(page([item('a')]))
    await state.load('post')
    expect(state.current('post').submissions.map((row) => row.id)).toEqual(['b'])
  })
  it('deduplicates overlapping polling and queues load-more behind it', async () => {
    const { state, transport } = setup(),
      delayed = deferred<SubmissionsPage>()
    transport.submissions
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(ownPage([own('b')]))
    const first = state.statuses('post'),
      duplicate = state.statuses('post'),
      append = state.statuses('post', true)
    delayed.resolve(ownPage([own('a')], 'next'))
    await Promise.all([first, duplicate, append])
    expect(transport.submissions).toHaveBeenCalledTimes(2)
    expect(state.current('post').submissions).toHaveLength(2)
  })
  it('fences private responses and private failures after erasure', async () => {
    const { state, transport } = setup(),
      delayed = deferred<SubmissionsPage>()
    transport.submissions.mockReturnValueOnce(delayed.promise)
    const old = state.statuses('post')
    state.reset()
    delayed.resolve(ownPage())
    await old
    expect(state.current('post').submissions).toEqual([])
    transport.submissions.mockRejectedValueOnce('unknown')
    await state.statuses('post')
    expect(state.current('post').error).toBe('community.comments.failed')
  })
  it('validates before sending and retains UUID/body through uncertain retries and edits', async () => {
    const { state, transport, id } = setup()
    await state.submit('post', 'en-US')
    expect(transport.create).not.toHaveBeenCalled()
    state.draft('post', { body: 'First draft', parentId: 'root' })
    transport.create.mockRejectedValueOnce('unknown')
    await state.submit('post', 'en-US')
    const request: unknown = transport.create.mock.calls[0]?.[1]
    state.draft('post', { body: 'Edited draft' })
    await state.submit('post', 'fr-FR')
    expect(transport.create.mock.calls[1]?.[1]).toEqual(request)
    expect(state.current('post').draft.body).toBe('Edited draft')
    expect(state.current('post').unresolved).toBeNull()
    expect(id).toHaveBeenCalledTimes(2)
    await state.submit('post', 'en-US')
    expect(state.current('post').draft.body).toBe('')
  })
  it('serializes create and fences a successful late submission on account switch', async () => {
    const { state, transport } = setup(),
      delayed = deferred<CommunityCommentSubmission>()
    transport.create.mockReturnValueOnce(delayed.promise)
    state.draft('post', { body: 'hello' })
    const pending = state.submit('post', 'en-US')
    await state.submit('post', 'en-US')
    state.setSession('other')
    delayed.resolve(own())
    await pending
    expect(transport.create).toHaveBeenCalledTimes(1)
    expect(state.current('post').submissions).toEqual([])
  })
  it('applies tombstones to roots/replies/owner statuses and fences delayed reads', async () => {
    const { state, transport } = setup()
    await state.load('post')
    await state.load('post', 'root')
    transport.submissions.mockResolvedValueOnce(ownPage([own('root')]))
    await state.statuses('post')
    const late = deferred<CommunityCommentsPage>()
    transport.roots.mockReturnValueOnce(late.promise)
    const old = state.load('post', null, false)
    await state.delete('post', 'root')
    late.resolve(page())
    await old
    expect(state.current('post').roots?.items[0]).toMatchObject({
      body: null,
      author: null,
      unavailable: true,
    })
    expect(state.current('post').announcement?.key).toBe('community.comments.deleted')
  })
  it('deletes an expanded reply and preserves other private and public entries', async () => {
    const { state, transport } = setup()
    transport.roots.mockResolvedValueOnce(page([item('root'), item('other')]))
    await state.load('post')
    transport.replies.mockResolvedValueOnce(
      page([
        { ...item('reply'), parentId: 'root' },
        { ...item('other-reply'), parentId: 'root' },
      ])
    )
    await state.load('post', 'root')
    transport.submissions.mockResolvedValueOnce(ownPage([own('reply'), own('private')]))
    await state.statuses('post')
    await state.delete('post', 'reply')
    expect(state.current('post').replies.get('root')?.items[0]?.unavailable).toBe(true)
    expect(state.current('post').replies.get('root')?.items[1]?.body).toBe(
      'Beautiful layers.'
    )
    expect(state.current('post').roots?.items[1]?.body).toBe('Beautiful layers.')
    expect(state.current('post').submissions[0]?.id).toBe('private')
  })
  it('retains the newer reply target after a successful immutable retry', async () => {
    const { state, transport } = setup()
    state.draft('post', { body: 'Hello', parentId: 'root' })
    transport.create.mockRejectedValueOnce('unknown')
    await state.submit('post', 'en-US')
    state.draft('post', { parentId: 'another-root' })
    await state.submit('post', 'en-US')
    expect(state.current('post').draft.parentId).toBe('another-root')
  })
  it('keeps private tombstones and fences failed mutations after a session change', async () => {
    const { state, transport } = setup()
    transport.submissions.mockResolvedValueOnce(ownPage())
    await state.statuses('post')
    await state.delete('post', 'own')
    expect(state.current('post').submissions[0]?.status).toBe('author_deleted')
    const deleted = deferred<CommunityCommentSubmission>(),
      reported = deferred<unknown>(),
      submitted = deferred<CommunityCommentSubmission>()
    transport.delete.mockReturnValueOnce(deleted.promise)
    transport.report.mockReturnValueOnce(reported.promise)
    transport.create.mockReturnValueOnce(submitted.promise)
    state.draft('post', { body: 'Hello' })
    const pending = [
      state.delete('post', 'own'),
      state.report('post', 'root', 'spam'),
      state.submit('post', 'en-US'),
    ]
    state.reset()
    deleted.reject('not_found')
    reported.reject('not_found')
    submitted.reject('not_found')
    await Promise.all(pending)
    expect(state.current('post').error).toBeNull()
    const late = deferred<unknown>()
    transport.report.mockReturnValueOnce(late.promise)
    const reporting = state.report('post', 'root', 'spam')
    state.reset()
    late.resolve({})
    await reporting
    expect(state.current('post').announcement).toBeNull()
  })
  it('fences private request failures when a newer account owns the screen', async () => {
    const { state, transport } = setup()
    const late = deferred<SubmissionsPage>()
    transport.submissions.mockReturnValueOnce(late.promise)
    const pending = state.statuses('post')
    state.reset()
    late.reject('not_found')
    await pending
    expect(state.current('post').error).toBeNull()
    await state.load('post', 'root', true)
    expect(transport.replies).not.toHaveBeenCalled()
  })
  it('informs its screen owner when an unavailable thread is evicted', async () => {
    const { transport, id } = setup()
    const close = vi.fn()
    const state = new CommunityCommentsState(transport, id, () => 'not_found', close)
    transport.roots.mockRejectedValueOnce(new Error('hidden'))
    await state.load('post')
    expect(close).toHaveBeenCalledWith('post')
  })
  it('keeps confirmations authoritative across failed/late deletes and reports', async () => {
    const { state, transport } = setup()
    transport.delete.mockRejectedValueOnce('unknown')
    await state.delete('post', 'root')
    expect(state.current('post').error).toBe('community.comments.failed')
    await state.report('post', 'root', 'spam')
    expect(state.current('post').announcement?.key).toBe('community.comments.reported')
    transport.report.mockRejectedValueOnce('unknown')
    await state.report('post', 'root', 'spam')
    expect(state.current('post').error).toBe('community.comments.failed')
    const delayed = deferred<CommunityCommentSubmission>()
    transport.delete.mockReturnValueOnce(delayed.promise)
    const pending = state.delete('post', 'root')
    state.reset()
    delayed.resolve(own())
    await pending
    expect(state.current('post').announcement).toBeNull()
  })
  it('derives stable local account scope while opaque tokens stay isolated', () => {
    expect(commentSessionIdentity(null)).toBeNull()
    expect(commentSessionIdentity('opaque')).toBe('opaque')
    expect(
      commentSessionIdentity(`x.${btoa(JSON.stringify({ sub: 'account' }))}.y`)
    ).toBe('account')
    expect(commentSessionIdentity('x.invalid.y')).toBe('x.invalid.y')
    expect(commentSessionIdentity(`x.${btoa('{}')}.y`)).toContain('x.')
  })
})

describe('Story 6.4 peer-review concurrency regressions', () => {
  it('applies two independent successful deletes without dropping an in-flight create or report', async () => {
    const { state, transport } = setup()
    transport.roots.mockResolvedValue(page([item('a'), item('b', 2)]))
    await state.load('post')
    const a = deferred<CommunityCommentSubmission>(),
      b = deferred<CommunityCommentSubmission>(),
      created = deferred<CommunityCommentSubmission>(),
      reported = deferred<unknown>()
    transport.delete.mockImplementation((_post, id) =>
      id === 'a' ? a.promise : b.promise
    )
    transport.create.mockReturnValue(created.promise)
    transport.report.mockReturnValue(reported.promise)
    state.draft('post', { body: 'Beautiful layers.' })
    const jobs = [
      state.delete('post', 'a'),
      state.delete('post', 'b'),
      state.submit('post', 'en-US'),
      state.report('post', 'a', 'spam'),
    ]
    a.resolve({ ...own('a'), status: 'author_deleted', body: null })
    await jobs[0]
    b.resolve({ ...own('b'), status: 'author_deleted', body: null })
    await jobs[1]
    created.resolve(own('new'))
    await jobs[2]
    reported.resolve({})
    await jobs[3]
    expect(state.current('post').roots?.items.map((row) => row.id)).toEqual(['a', 'b'])
    expect(state.current('post').roots?.items.every((row) => row.unavailable)).toBe(true)
    expect(state.current('post').submissions.map((row) => row.id)).toEqual(['new'])
    expect(state.current('post').pending).toBe(false)
    expect(state.current('post').announcement?.key).toBe('community.comments.reported')
  })
  it('keeps an initial public read alive when create succeeds before it', async () => {
    const { state, transport } = setup(),
      reading = deferred<CommunityCommentsPage>()
    transport.roots.mockReturnValueOnce(reading.promise)
    const load = state.load('post')
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    expect(state.current('post').loading).toBe(true)
    reading.resolve(page())
    await load
    expect(state.current('post').roots?.items).toEqual([item()])
  })
  it('rejects a private poll captured before a confirmed create', async () => {
    const { state, transport } = setup(),
      old = deferred<SubmissionsPage>()
    transport.submissions.mockReturnValueOnce(old.promise)
    const poll = state.statuses('post')
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    old.resolve(ownPage([]))
    await poll
    expect(state.current('post').submissions).toEqual([own()])
  })
  it('applies private suppression and fences an older public read', async () => {
    const { state, transport } = setup(),
      old = deferred<CommunityCommentsPage>()
    await state.load('post')
    transport.roots.mockReturnValueOnce(old.promise)
    const reading = state.load('post')
    transport.submissions.mockResolvedValue(
      ownPage([
        {
          ...own('root'),
          status: 'consent_suspended',
          body: null,
          publicationSequence: 1,
        },
      ])
    )
    await state.statuses('post')
    old.resolve(page())
    await reading
    expect(state.current('post').roots?.items[0]).toMatchObject({
      body: null,
      author: null,
      unavailable: true,
    })
    expect(state.current('post').submissions).toEqual([])
  })
  it('deduplicates a replayed published receipt against its public item', async () => {
    const { state, transport } = setup()
    await state.load('post')
    transport.create.mockResolvedValue({
      ...own('root'),
      status: 'published',
      publicationSequence: 1,
    })
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    expect(state.current('post').submissions).toEqual([])
  })
  it('retains uncertain intent and releases confirmed rejected intent', async () => {
    const { state, transport, id } = setup()
    state.draft('post', { body: 'Beautiful layers.', parentId: 'root' })
    transport.create.mockRejectedValueOnce(new Error('timeout'))
    await state.submit('post', 'en-US')
    const intent = state.current('post').unresolved
    transport.create.mockRejectedValueOnce({ httpStatus: 400 })
    await state.submit('post', 'en-US')
    expect(transport.create.mock.calls[1]?.[1]).toEqual(intent)
    expect(state.current('post').unresolved).toBeNull()
    id.mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    state.draft('post', { body: 'Corrected root', parentId: null })
    await state.submit('post', 'en-US')
    expect(transport.create.mock.calls[2]?.[1]).toMatchObject({
      body: 'Corrected root',
      parentId: null,
      mutationId: '00000000-0000-4000-8000-000000000002',
    })
  })
  it('returns explicit report acceptance and clears a recovered failure', async () => {
    const { state, transport } = setup()
    transport.report.mockRejectedValueOnce(new Error('offline'))
    expect(await state.report('post', 'root', 'harassment')).toBe(false)
    expect(state.current('post').error).toBe('community.comments.failed')
    expect(await state.report('post', 'root', 'harassment')).toBe(true)
    expect(state.current('post').error).toBeNull()
  })
})

describe('pending-only private polling and once-only announcements', () => {
  it('backs off repeated failures, clears recovery, announces a transition once and stops after screening', async () => {
    vi.useFakeTimers()
    const { state, transport } = setup()
    state.current('post').submissions = [own()]
    transport.submissions.mockRejectedValue(new Error('offline'))
    const stop = state.watchSubmissions('post')
    try {
      await vi.advanceTimersByTimeAsync(3000)
      const first = state.consumeAnnouncement('post')
      expect(first?.key).toBe('community.comments.failed')
      expect(state.consumeAnnouncement('post')).toBeNull()
      await vi.advanceTimersByTimeAsync(5999)
      expect(transport.submissions).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(transport.submissions).toHaveBeenCalledTimes(2)
      expect(state.consumeAnnouncement('post')).toBeNull()
      transport.submissions.mockResolvedValue(
        ownPage([{ ...own(), status: 'published', publicationSequence: 1 }])
      )
      await vi.advanceTimersByTimeAsync(12000)
      expect(state.current('post').error).toBeNull()
      expect(state.consumeAnnouncement('post')?.key).toBe(
        'community.comments.status.published'
      )
      await vi.advanceTimersByTimeAsync(60000)
      expect(transport.submissions).toHaveBeenCalledTimes(3)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })
})

describe('watchSubmissions polls only pending screening work', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  async function withPendingSubmission() {
    const harness = setup()
    harness.transport.submissions.mockResolvedValueOnce(ownPage())
    await harness.state.statuses('post')
    harness.transport.submissions.mockClear()
    return harness
  }

  it.each<[string, CommunityCommentSubmission[]]>([
    ['no private submissions', []],
    [
      'only settled submissions',
      [
        { ...own('a'), status: 'published', publicationSequence: 1 },
        { ...own('b'), status: 'held_for_review' },
      ],
    ],
  ])('does not poll with %s', async (_label, items) => {
    const { state, transport } = setup()
    transport.submissions.mockResolvedValueOnce(ownPage(items))
    await state.statuses('post')
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(transport.submissions).toHaveBeenCalledTimes(1)
    stop()
  })

  it('starts when a confirmed create leaves screening work and stops once it settles', async () => {
    const { state, transport } = setup()
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(transport.submissions).not.toHaveBeenCalled()
    transport.submissions
      .mockResolvedValueOnce(ownPage())
      .mockResolvedValueOnce(
        ownPage([{ ...own(), status: 'published', publicationSequence: 1 }])
      )
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    await vi.advanceTimersByTimeAsync(2999)
    expect(transport.submissions).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.submissions).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(transport.submissions).toHaveBeenCalledTimes(2)
    expect(state.current('post').submissions[0]?.status).toBe('published')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(transport.submissions).toHaveBeenCalledTimes(2)
    stop()
  })

  it('backs off failed polls on a 3s, 6s, 12s, 24s, 30s schedule capped at 30s', async () => {
    const { state, transport } = await withPendingSubmission()
    transport.submissions.mockRejectedValue('unknown')
    const stop = state.watchSubmissions('post')
    for (const [calls, interval] of [
      3000, 6000, 12_000, 24_000, 30_000, 30_000,
    ].entries()) {
      await vi.advanceTimersByTimeAsync(interval - 1)
      expect(transport.submissions).toHaveBeenCalledTimes(calls)
      await vi.advanceTimersByTimeAsync(1)
      expect(transport.submissions).toHaveBeenCalledTimes(calls + 1)
    }
    stop()
  })

  it('announces a failing poll once, then clears the error and restarts at 3s after recovery', async () => {
    const { state, transport } = await withPendingSubmission()
    transport.submissions
      .mockRejectedValueOnce('unknown')
      .mockRejectedValueOnce('unknown')
      .mockRejectedValueOnce('unknown')
      .mockResolvedValue(ownPage())
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(3000)
    const announcement = state.current('post').announcement
    expect(state.current('post').error).toBe('community.comments.failed')
    expect(announcement).toEqual({ key: 'community.comments.failed', id: 1 })
    await vi.advanceTimersByTimeAsync(6000)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(transport.submissions).toHaveBeenCalledTimes(3)
    expect(state.current('post').announcement).toEqual(announcement)
    await vi.advanceTimersByTimeAsync(24_000)
    expect(transport.submissions).toHaveBeenCalledTimes(4)
    expect(state.current('post').error).toBeNull()
    expect(state.current('post').submissions).toEqual([own()])
    await vi.advanceTimersByTimeAsync(2999)
    expect(transport.submissions).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.submissions).toHaveBeenCalledTimes(5)
    stop()
  })

  // After the end event the server answers as it would for that event: the old screening work
  // is still pending for a stop, the next account has none, and an evicted post is gone.
  type Submissions = ReturnType<typeof setup>['transport']['submissions']
  it.each<
    [
      string,
      (state: CommunityCommentsState, stop: () => void) => void,
      (submissions: Submissions) => void,
    ]
  >([
    [
      'its stop handle',
      (_state, stop) => stop(),
      (submissions) => submissions.mockResolvedValue(ownPage()),
    ],
    [
      'an account switch',
      (state) => state.setSession('other-account'),
      (submissions) => submissions.mockResolvedValue(ownPage([])),
    ],
    [
      'a sign-out reset',
      (state) => state.reset(),
      (submissions) => submissions.mockResolvedValue(ownPage([])),
    ],
    [
      'eviction of the post',
      (state) => state.evict('post'),
      (submissions) => submissions.mockRejectedValue('not_found'),
    ],
  ])('sends no further polls after %s', async (_label, end, server) => {
    const { state, transport } = await withPendingSubmission()
    transport.submissions.mockResolvedValueOnce(ownPage())
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(3000)
    expect(transport.submissions).toHaveBeenCalledTimes(1)
    server(transport.submissions)
    end(state, stop)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(transport.submissions).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not reschedule when stopped while a poll is in flight', async () => {
    const { state, transport } = await withPendingSubmission()
    const inFlight = deferred<SubmissionsPage>()
    transport.submissions
      .mockReturnValueOnce(inFlight.promise)
      .mockResolvedValue(ownPage())
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(3000)
    stop()
    inFlight.resolve(ownPage())
    await vi.advanceTimersByTimeAsync(300_000)
    expect(transport.submissions).toHaveBeenCalledTimes(1)
  })

  it('arms the first poll 3s after screening work appears, not from an earlier update', async () => {
    const { state, transport } = setup()
    const stop = state.watchSubmissions('post')
    state.draft('post', { body: 'Beautiful layers.' })
    await vi.advanceTimersByTimeAsync(1000)
    await state.submit('post', 'en-US')
    await vi.advanceTimersByTimeAsync(2999)
    expect(transport.submissions).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.submissions).toHaveBeenCalledTimes(1)
    stop()
  })

  it('skips an armed poll once screening work settled through another refresh', async () => {
    const { state, transport } = await withPendingSubmission()
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(1000)
    transport.submissions.mockResolvedValueOnce(
      ownPage([{ ...own(), status: 'published', publicationSequence: 1 }])
    )
    await state.statuses('post')
    await vi.advanceTimersByTimeAsync(300_000)
    expect(transport.submissions).toHaveBeenCalledTimes(1)
    stop()
  })

  // The web dialog and mobile sheet keep one watch mounted across an account switch.
  it('resumes polling on the same watch for screening work created by the next account', async () => {
    const { state, transport } = setup()
    let account = 'first-account'
    const polledAs: string[] = []
    const secondAccountPolls = [
      ownPage([own('second')]),
      ownPage([{ ...own('second'), status: 'published', publicationSequence: 1 }]),
    ]
    transport.submissions.mockImplementation(() => {
      polledAs.push(account)
      return Promise.resolve(
        account === 'first-account'
          ? ownPage()
          : (secondAccountPolls.shift() ?? ownPage([]))
      )
    })
    state.setSession(account)
    await state.statuses('post')
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(3000)
    expect(polledAs).toEqual(['first-account', 'first-account'])
    account = 'second-account'
    state.setSession(account)
    transport.create.mockResolvedValueOnce(own('second'))
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    expect(state.current('post').submissions).toEqual([own('second')])
    await vi.advanceTimersByTimeAsync(2999)
    expect(polledAs).toEqual(['first-account', 'first-account'])
    await vi.advanceTimersByTimeAsync(1)
    expect(polledAs).toEqual(['first-account', 'first-account', 'second-account'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(polledAs).toEqual([
      'first-account',
      'first-account',
      'second-account',
      'second-account',
    ])
    expect(state.current('post').submissions[0]?.status).toBe('published')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(polledAs).toHaveLength(4)
    stop()
  })

  it('restarts the next account at the 3s base interval after earlier failures', async () => {
    const { state, transport } = setup()
    state.setSession('first-account')
    transport.submissions.mockResolvedValueOnce(ownPage())
    await state.statuses('post')
    transport.submissions
      .mockRejectedValueOnce('unknown')
      .mockRejectedValueOnce('unknown')
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(3000 + 6000 + 1000)
    expect(transport.submissions).toHaveBeenCalledTimes(3)
    state.setSession('second-account')
    transport.submissions.mockResolvedValue(ownPage([own('second')]))
    transport.create.mockResolvedValueOnce(own('second'))
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    await vi.advanceTimersByTimeAsync(2999)
    expect(transport.submissions).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.submissions).toHaveBeenCalledTimes(4)
    stop()
  })

  it('polls the next account while an old poll is still in flight and ignores its completion', async () => {
    const { state, transport } = setup()
    state.setSession('first-account')
    transport.submissions.mockResolvedValueOnce(ownPage())
    await state.statuses('post')
    const old = deferred<SubmissionsPage>(),
      fresh = deferred<SubmissionsPage>()
    transport.submissions
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise)
      .mockResolvedValue(ownPage([own('second')]))
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(3000)
    expect(transport.submissions).toHaveBeenCalledTimes(2)
    state.setSession('second-account')
    transport.create.mockResolvedValueOnce(own('second'))
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    await vi.advanceTimersByTimeAsync(3000)
    expect(transport.submissions).toHaveBeenCalledTimes(3)
    old.resolve(ownPage())
    await vi.advanceTimersByTimeAsync(500)
    fresh.resolve(ownPage([own('second')]))
    await vi.advanceTimersByTimeAsync(2999)
    expect(transport.submissions).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.submissions).toHaveBeenCalledTimes(4)
    stop()
  })

  it('cancels the old account timer so later updates cannot arm a duplicate poll', async () => {
    const { state, transport } = setup()
    state.setSession('first-account')
    transport.submissions.mockResolvedValueOnce(ownPage())
    await state.statuses('post')
    transport.submissions.mockResolvedValueOnce(ownPage())
    const stop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(4000)
    expect(transport.submissions).toHaveBeenCalledTimes(2)
    state.setSession('second-account')
    transport.submissions.mockResolvedValue(ownPage([own('second')]))
    transport.create.mockResolvedValueOnce(own('second'))
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    await vi.advanceTimersByTimeAsync(2500)
    state.draft('post', { body: 'Another thought' })
    await vi.advanceTimersByTimeAsync(500)
    expect(transport.submissions).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(2999)
    expect(transport.submissions).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.submissions).toHaveBeenCalledTimes(4)
    stop()
  })
})

describe('consumeAnnouncement', () => {
  it('returns each announcement once, never replays it on reopen, and returns each new action', async () => {
    const { state } = setup()
    expect(state.consumeAnnouncement('post')).toBeNull()
    await state.report('post', 'root', 'spam')
    expect(state.consumeAnnouncement('post')).toEqual({
      key: 'community.comments.reported',
      id: 1,
    })
    expect(state.consumeAnnouncement('post')).toBeNull()
    const reopened = vi.fn()
    const unsubscribe = state.subscribe(reopened)
    state.draft('post', { body: 'Beautiful layers.' })
    expect(reopened).toHaveBeenCalledTimes(1)
    expect(state.consumeAnnouncement('post')).toBeNull()
    unsubscribe()
    await state.submit('post', 'en-US')
    expect(state.consumeAnnouncement('post')).toEqual({
      key: 'community.comments.submitted',
      id: 2,
    })
    await state.report('post', 'root', 'spam')
    await state.report('post', 'root', 'spam')
    expect(state.consumeAnnouncement('post')).toEqual({
      key: 'community.comments.reported',
      id: 4,
    })
    expect(state.consumeAnnouncement('post')).toBeNull()
  })
})

describe('public reads during a confirmed create', () => {
  it('keeps both an in-flight public refresh and the confirmed receipt', async () => {
    const { state, transport } = setup(),
      refresh = deferred<CommunityCommentsPage>()
    await state.load('post')
    transport.roots.mockReturnValueOnce(refresh.promise)
    transport.create.mockResolvedValueOnce(own('new'))
    const reading = state.load('post')
    state.draft('post', { body: 'Beautiful layers.' })
    await state.submit('post', 'en-US')
    expect(state.current('post')).toMatchObject({
      loading: true,
      pending: false,
      submissions: [own('new')],
    })
    refresh.resolve(page([item('root'), item('other', 2)]))
    await reading
    expect(state.current('post')).toMatchObject({
      loading: false,
      error: null,
      submissions: [own('new')],
      announcement: { key: 'community.comments.submitted' },
    })
    expect(state.current('post').roots?.items.map((row) => row.id)).toEqual([
      'root',
      'other',
    ])
  })
})

describe('published announcement when the comment is already in the thread', () => {
  it('does not ask to refresh for a comment the same pass already shows publicly', async () => {
    const { state, transport } = setup()
    transport.submissions.mockResolvedValueOnce(ownPage())
    await state.statuses('post')
    state.consumeAnnouncement('post')
    // A live insert made the own comment public before its status read settled.
    state.current('post').roots = page([item('own', 1)])
    transport.submissions.mockResolvedValueOnce(
      ownPage([{ ...own(), status: 'published', publicationSequence: 1 }])
    )
    await state.statuses('post')
    expect(state.consumeAnnouncement('post')?.key ?? null).not.toBe(
      'community.comments.status.published'
    )
    expect(state.current('post').submissions).toEqual([])
  })

  it('keeps the refresh wording when polling settles a comment that is not yet visible', async () => {
    const { state, transport } = setup()
    transport.submissions.mockResolvedValueOnce(ownPage())
    await state.statuses('post')
    state.consumeAnnouncement('post')
    transport.submissions.mockResolvedValueOnce(
      ownPage([{ ...own(), status: 'published', publicationSequence: 1 }])
    )
    await state.statuses('post')
    expect(state.consumeAnnouncement('post')?.key).toBe(
      'community.comments.status.published'
    )
  })
})
