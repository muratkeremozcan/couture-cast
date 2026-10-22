import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunityRequestSuperseded } from '../src/community-sync-state'
import type { CommunitySyncClient } from '../src/community-sync-client'
import {
  deferred,
  item,
  own,
  page,
  setup,
  type SubmissionsPage,
} from './community-comments-state-fixtures'

const location = {
  commentId: 'reply',
  parentId: 'root',
  pageCursor: 'reply-page',
  parentPageCursor: 'root-page',
}
const available = (
  parent: string | null,
  cursor: string | null
): Awaited<ReturnType<CommunitySyncClient['resolve']>> => ({
  targets: [
    {
      key: 'post',
      status: 'available',
      communityRevision: '2',
      post: {
        id: 'post',
        status: 'published',
        caption: null,
        altText: 'Fixture',
        climateBand: 'cold_dry',
        challengeId: null,
        createdAt: '2026-10-20T00:00:00Z',
        publishedAt: '2026-10-20T00:00:00Z',
        author: { displayName: 'Fixture', isSelf: false },
        imageAccess: {
          url: 'https://fixture.invalid/image',
          expiresAt: '2026-10-22T00:00:00Z',
        },
        reactions: {
          counts: { applause: 0, love: 0, inspiration: 0 },
          total: 0,
          viewerReaction: null,
          revision: 0,
          generation: 1,
        },
      },
      comment: item('reply'),
      parent: parent ? item(parent) : null,
      pageCursor: cursor,
      parentPageCursor: cursor,
      threadPosition: 1,
    },
  ],
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('comments recovery cancellation and focused page ownership', () => {
  it('keeps another thread cursor and pending reads when one thread is retired', async () => {
    const { state, transport } = setup()
    await state.loadLocation('other', null, 'other-page')
    await state.loadLocation('post', null, 'post-page')
    state.retireFocus('post')
    await state.loadLocation('post', 'root', null)
    state.evict('post')
    await state.refresh('other')
    expect(transport.roots).toHaveBeenLastCalledWith('other', 'other-page')
  })
  it('healthy realtime cancels pending status timers and can start without scheduling any', async () => {
    vi.useFakeTimers()
    const { state, transport } = setup()
    state.current('post').submissions = [own()]
    const stop = state.watchSubmissions('post')
    expect(vi.getTimerCount()).toBe(1)
    state.setRealtimeHealthy(true)
    expect(vi.getTimerCount()).toBe(0)
    const secondStop = state.watchSubmissions('post')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(transport.submissions).not.toHaveBeenCalled()
    stop()
    secondStop()
  })
  it('reconstructs page bounds for hydrated threads and stops when the authoritative snapshot shrinks', async () => {
    const { state, transport } = setup()
    state.current('post').roots = page([item('root')], 'second')
    transport.roots.mockResolvedValueOnce(page([item('next', 2)], null))
    await state.load('post', null, true)
    expect(state.current('post').roots?.items.map((row) => row.id)).toEqual([
      'root',
      'next',
    ])
    state.current('post').replies.set('root', page([item('reply')]))
    await state.refresh('post')
    expect(transport.replies).toHaveBeenCalledWith('post', 'root', undefined)
    expect(state.current('post').roots?.items).toEqual([item()])
  })
  it('aborted refresh cannot start a snapshot read and a retired refresh cannot publish held results', async () => {
    const { state, transport } = setup()
    await expect(state.refresh('post', AbortSignal.abort())).rejects.toBeInstanceOf(
      CommunityRequestSuperseded
    )
    expect(transport.roots).not.toHaveBeenCalled()
    const held = deferred<ReturnType<typeof page>>()
    transport.roots.mockReturnValueOnce(held.promise)
    const refreshing = state.refresh('post')
    await Promise.resolve()
    state.reset()
    held.resolve(page())
    await expect(refreshing).rejects.toBeInstanceOf(CommunityRequestSuperseded)
    expect(state.current('post').roots).toBeNull()
  })
  it('withdrawal status can fence public reads without retiring the shared private flight', async () => {
    const { state, transport } = setup()
    await state.load('other')
    await state.load('post')
    transport.submissions.mockResolvedValueOnce({
      items: [{ ...own('root'), status: 'erased', body: null }],
      nextCursor: null,
    })
    await state.statuses('post')
    expect(state.current('post').roots?.items[0]).toMatchObject({
      id: 'root',
      body: null,
      author: null,
      unavailable: true,
    })
    expect(state.current('other').roots?.items[0]?.unavailable).toBe(false)
    await state.load('post')
    expect(state.current('post').loading).toBe(false)
  })
  it.each([{ targets: [] }, { targets: [{ key: 'post', status: 'unavailable' }] }])(
    'evicts a focused thread when authoritative location is absent',
    async ({ targets }) => {
      const { state, transport } = setup()
      await state.loadTarget('post', location)
      transport.locate = vi.fn().mockResolvedValue({ targets })
      await expect(state.refresh('post')).rejects.toBeInstanceOf(
        CommunityRequestSuperseded
      )
      expect(state.current('post').roots).toBeNull()
      expect(state.current('post').replies.size).toBe(0)
    }
  )
  it.each([null, 'new-cursor'])(
    'keeps focused root and reply snapshots aligned with current location %s',
    async (cursor) => {
      const { state, transport } = setup()
      await state.loadTarget('post', location)
      transport.locate = vi.fn().mockResolvedValue(available('root', cursor))
      const signal = new AbortController().signal
      await state.refresh('post', signal)
      expect(transport.roots).toHaveBeenLastCalledWith(
        'post',
        cursor ?? undefined,
        signal
      )
      expect(transport.replies).toHaveBeenLastCalledWith(
        'post',
        'root',
        cursor ?? undefined,
        signal
      )
      expect(transport.submissions).toHaveBeenLastCalledWith('post', undefined, signal)
      expect(state.current('post').replies.has('root')).toBe(true)
    }
  )
  it('falls back to a root snapshot when the focused root has no page cursor', async () => {
    const { state, transport } = setup()
    await state.loadTarget('post', { ...location, parentId: null })
    transport.locate = vi.fn().mockResolvedValue(available(null, null))
    await state.refresh('post')
    expect(transport.roots).toHaveBeenLastCalledWith('post', undefined)
  })
  it('propagates cancellation after a private page settles without accepting its contents', async () => {
    const { state, transport } = setup()
    const held = deferred<SubmissionsPage>()
    transport.submissions.mockReturnValueOnce(held.promise)
    const controller = new AbortController()
    const result = expect(
      state.statuses('post', false, true, controller.signal)
    ).rejects.toBeInstanceOf(CommunityRequestSuperseded)
    controller.abort()
    held.resolve({ items: [own()], nextCursor: null })
    await result
    expect(state.current('post').submissions).toEqual([])
  })
  it('a required joining caller observes failure while optional joining callers settle safely', async () => {
    const { state, transport } = setup()
    const held = deferred<SubmissionsPage>()
    transport.submissions.mockReturnValueOnce(held.promise)
    const optional = state.statuses('post')
    const required = expect(state.statuses('post', true, true)).rejects.toBe('offline')
    const optionalAppend = state.statuses('post', true)
    held.reject('offline')
    await Promise.all([optional, required, optionalAppend])
    expect(transport.submissions).toHaveBeenCalledTimes(1)
    expect(state.current('post').error).toBe('community.comments.failed')
  })
  it('retired private failures cannot replace a new account draft or error', async () => {
    const { state, transport } = setup()
    state.setSession('first')
    const held = deferred<SubmissionsPage>()
    transport.submissions.mockReturnValueOnce(held.promise)
    const result = state.statuses('post', false, true)
    state.setSession('second')
    state.draft('post', { body: 'Second owner draft' })
    held.reject('not_found')
    await result
    expect(state.current('post').draft.body).toBe('Second owner draft')
    expect(state.current('post').error).toBeNull()
  })
  it('does not commit a failed or successful retired target page', async () => {
    for (const reject of [false, true]) {
      const { state, transport } = setup()
      const held = deferred<ReturnType<typeof page>>()
      transport.roots.mockReturnValueOnce(held.promise)
      const result = state.loadLocation('post', null, null)
      state.evict('post')
      if (reject) held.reject('not_found')
      else held.resolve(page())
      await result
      expect(state.current('post').roots).toBeNull()
      expect(state.current('post').error).toBeNull()
    }
  })
  it('retires expanded pages and their cursors when the post is evicted', async () => {
    const { state, transport } = setup()
    await state.loadTarget('post', location)
    await state.refresh('post')
    state.evict('post')
    await state.load('post', 'root')
    expect(transport.replies).toHaveBeenLastCalledWith('post', 'root', undefined)
  })
  it('does not remove private status ownership when clearing a reply expansion', async () => {
    const { state, transport } = setup()
    const held = deferred<SubmissionsPage>()
    transport.submissions.mockReturnValueOnce(held.promise)
    const statuses = state.statuses('post')
    const expanded = deferred<ReturnType<typeof page>>()
    transport.replies.mockReturnValueOnce(expanded.promise)
    const reply = state.load('post', 'root')
    await state.load('post')
    expanded.resolve(page([item('late-reply')]))
    held.resolve({ items: [own()], nextCursor: null })
    await Promise.all([statuses, reply])
    expect(state.current('post').replies.size).toBe(0)
    expect(state.current('post').submissions).toEqual([own()])
  })
})
