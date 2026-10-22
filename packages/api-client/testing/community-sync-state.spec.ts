import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CommunitySyncState,
  CommunityRequestSuperseded,
  type CommunitySyncCallbacks,
} from '../src/community-sync-state'
import type { CommunitySyncClient } from '../src/community-sync-client'
import { abortError } from '../src/request-deadline'
import { connectCommunityTransport } from '../src/realtime/community-transport'

vi.mock('../src/realtime/community-transport', () => ({
  connectCommunityTransport: vi.fn(() => vi.fn()),
}))

type Page = Awaited<ReturnType<CommunitySyncClient['events']>>
const page = (cursor: string, extra: Partial<Page> = {}): Page => ({
  events: [],
  nextCursor: cursor,
  hasMore: false,
  resyncRequired: false,
  ...extra,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function setup() {
  const client = {
    events: vi.fn<CommunitySyncClient['events']>().mockResolvedValue(page('head')),
    resolve: vi.fn<CommunitySyncClient['resolve']>().mockResolvedValue({ targets: [] }),
  }
  const callbacks: CommunitySyncCallbacks = {
    rendered: vi.fn(() => ['post']),
    rebuild: vi.fn(() => Promise.resolve()),
    changed: vi.fn(() => Promise.resolve()),
    apply: vi.fn(),
    availability: vi.fn(),
  }
  const state = new CommunitySyncState(client, 'all', callbacks)
  return { client, callbacks, state }
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Story 6.5 reconciliation ownership', () => {
  it('silently rebuilds a healthy removal marker with a valid cursor while composition stays owned', async () => {
    const { client, callbacks, state } = setup()
    state.start('https://fixtures.invalid', () => Promise.resolve('fixture'))
    vi.mocked(connectCommunityTransport).mock.calls[0]![0].state('connected')
    await state.catchUp()
    const rebuilt = deferred<void>()
    callbacks.rebuild = vi.fn(() => rebuilt.promise)
    vi.mocked(callbacks.availability).mockClear()
    client.events.mockResolvedValueOnce(
      page('removed', {
        resyncRequired: true,
        events: [{ version: 1, kind: 'resync', resyncRequired: true }],
      })
    )
    try {
      await state.catchUp()
      await vi.waitFor(() => expect(callbacks.rebuild).toHaveBeenCalledTimes(1))
      expect(callbacks.availability).not.toHaveBeenCalled()
      rebuilt.resolve(undefined)
      await state.catchUp()
      expect(callbacks.availability).toHaveBeenLastCalledWith('connected', true)
    } finally {
      rebuilt.resolve(undefined)
      state.stop()
    }
  })
  it('paginates target batches and ignores late results after stop', async () => {
    const { client, callbacks, state } = setup()
    callbacks.rendered = () => Array.from({ length: 51 }, (_, i) => `post-${i}`)
    const held = deferred<Awaited<ReturnType<CommunitySyncClient['resolve']>>>()
    client.resolve.mockResolvedValueOnce({ targets: [] }).mockImplementationOnce(() => {
      state.stop()
      return held.promise
    })
    const flight = state.catchUp()
    await vi.waitFor(() => expect(client.resolve).toHaveBeenCalledTimes(2))
    expect(client.resolve.mock.calls.map(([input]) => input.targets.length)).toEqual([
      50, 1,
    ])
    held.resolve({ targets: [{ key: 'post-50', status: 'unavailable' }] })
    await flight
    expect(callbacks.apply).not.toHaveBeenCalled()
  })
  it('consumes duplicate events once and drains a nonbootstrap page with hasMore', async () => {
    const { client, callbacks, state } = setup()
    await state.catchUp()
    const event = {
      version: 1,
      kind: 'post.published',
      postId: 'post',
      communityRevision: '1',
    } as const
    client.events
      .mockResolvedValueOnce(page('one', { events: [event, event], hasMore: true }))
      .mockResolvedValue(page('two'))
    await state.catchUp()
    expect(client.events).toHaveBeenLastCalledWith('all', 'one', expect.any(AbortSignal))
    expect(callbacks.changed).toHaveBeenCalledExactlyOnceWith(
      [event, event],
      expect.any(AbortSignal)
    )
    state.stop()
  })
  it('refuses an older projection even when newer invalidation still needs consuming', async () => {
    const { client, callbacks, state } = setup()
    const current = {
      key: 'post',
      status: 'available',
      communityRevision: '9',
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
      comment: null,
      parent: null,
      pageCursor: null,
      parentPageCursor: null,
      threadPosition: null,
    } satisfies Awaited<ReturnType<CommunitySyncClient['resolve']>>['targets'][number]
    client.resolve.mockResolvedValue({ targets: [current] })
    await state.catchUp()
    client.resolve.mockResolvedValue({
      targets: [{ ...current, communityRevision: '8' }],
    })
    client.events.mockResolvedValue(
      page('new-event', {
        events: [
          {
            version: 1,
            kind: 'reactions.changed',
            postId: 'post',
            communityRevision: '10',
          },
        ],
      })
    )
    await state.catchUp()
    expect(callbacks.apply).toHaveBeenCalledExactlyOnceWith(current)
    expect(callbacks.changed).toHaveBeenCalledTimes(1)
    state.stop()
  })
  it.each([
    undefined,
    null,
    'offline',
    { response: null },
    { response: {} },
    { response: { status: 401 } },
  ])(
    'classifies dependency failure without publishing an unverified view: %j',
    async (error) => {
      const { client, callbacks, state } = setup()
      client.events.mockRejectedValue(error)
      await state.catchUp()
      expect(callbacks.apply).not.toHaveBeenCalled()
      expect(callbacks.availability).toHaveBeenLastCalledWith(
        ...(typeof error === 'object' &&
        error?.response &&
        'status' in error.response &&
        error.response.status === 401
          ? ['denied']
          : ['unavailable', false])
      )
      state.stop()
    }
  )
  it('retires transport callbacks and foreground/recovery after denial', async () => {
    const { client, callbacks, state } = setup()
    state.start('https://fixtures.invalid', () => Promise.resolve('fixture'))
    await state.catchUp()
    const transport = vi.mocked(connectCommunityTransport).mock.calls[0]![0]
    transport.state('denied')
    const calls = client.events.mock.calls.length
    const availability = vi.mocked(callbacks.availability).mock.calls.length
    transport.state('connected')
    transport.changed()
    state.foreground()
    state.recover()
    await state.catchUp()
    expect(client.events).toHaveBeenCalledTimes(calls)
    expect(callbacks.availability).toHaveBeenCalledTimes(availability)
  })
  it('uses a fresh validation on foreground and bounded recovery even with a quiet socket', async () => {
    vi.useFakeTimers()
    const { client, callbacks, state } = setup()
    await state.catchUp()
    const initial = client.resolve.mock.calls.length
    state.foreground()
    await state.catchUp()
    expect(client.resolve.mock.calls.length).toBeGreaterThan(initial)
    state.recover()
    expect(callbacks.availability).toHaveBeenLastCalledWith('unavailable', false)
    await vi.advanceTimersByTimeAsync(8000)
    expect(callbacks.availability).toHaveBeenLastCalledWith('connected', false)
    state.stop()
  })
  it.each(['event', 'rebuild', 'changed', 'reconcile'] as const)(
    'does not publish completion after session retirement during %s',
    async (phase) => {
      const { client, callbacks, state } = setup()
      if (phase === 'event')
        client.events.mockImplementation(() => {
          state.stop()
          return Promise.resolve(page('retired'))
        })
      if (phase === 'rebuild')
        callbacks.rebuild = () => {
          state.stop()
          return Promise.resolve()
        }
      if (phase === 'changed') {
        client.events.mockResolvedValue(
          page('retired', {
            events: [
              {
                version: 1,
                kind: 'comment.status',
                postId: 'post',
                commentId: 'reply',
                privateRevision: '1',
              },
            ],
          })
        )
        callbacks.changed = () => {
          state.stop()
          return Promise.resolve()
        }
      }
      if (phase === 'reconcile')
        callbacks.reconcile = () => {
          state.stop()
          return Promise.resolve()
        }
      await state.catchUp()
      expect(callbacks.availability).not.toHaveBeenCalledWith(
        'connected',
        expect.anything()
      )
    }
  )
  it('retries superseded reconciliation and does not consume duplicate public revisions', async () => {
    const { client, callbacks, state } = setup()
    callbacks.reconcile = vi
      .fn()
      .mockRejectedValueOnce(new CommunityRequestSuperseded())
      .mockResolvedValue(undefined)
    const change = {
      version: 1,
      kind: 'reactions.changed',
      postId: 'post',
      communityRevision: '4',
    } as const
    const privateChange = {
      version: 1,
      kind: 'comment.status',
      postId: 'post',
      commentId: 'reply',
      privateRevision: '1',
    } as const
    client.events.mockResolvedValue(page('head', { events: [change, privateChange] }))
    await state.catchUp()
    await state.catchUp()
    const calls = vi.mocked(callbacks.changed).mock.calls
    expect(calls[0]?.[0]).toEqual([change, privateChange])
    expect(calls.at(-1)?.[0]).toEqual([privateChange])
    state.stop()
  })
  it('aborts a held HTTP request at two seconds and retires its late result', async () => {
    vi.useFakeTimers()
    const { client, callbacks, state } = setup()
    const held = deferred<Page>()
    client.events.mockReturnValue(held.promise)
    const flight = state.catchUp()
    await vi.advanceTimersByTimeAsync(2000)
    await flight
    expect(client.events.mock.calls[0]?.[2]?.aborted).toBe(true)
    expect(callbacks.availability).toHaveBeenLastCalledWith('unavailable', false)
    held.resolve(page('late'))
    await vi.advanceTimersByTimeAsync(0)
    expect(callbacks.rebuild).not.toHaveBeenCalled()
    state.stop()
  })
  it('bounds repeated cursorless409 recovery and hides unverifiable content until a fresh snapshot succeeds', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { client, callbacks, state } = setup()
    const held = deferred<Page>()
    let requests = 0
    client.events.mockImplementation(() =>
      ++requests <= 4
        ? Promise.reject(
            Object.assign(new Error('Resynchronization required'), {
              response: { status: 409 },
            })
          )
        : held.promise
    )
    try {
      await state.catchUp()
      await vi.advanceTimersByTimeAsync(0)
      expect(callbacks.availability).toHaveBeenLastCalledWith('unavailable', false)
      expect(client.events).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(7499)
      expect(client.events).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(client.events).toHaveBeenCalledTimes(2)
      expect(callbacks.rebuild).not.toHaveBeenCalled()
      client.events.mockResolvedValue(page('fresh-head'))
      await vi.advanceTimersByTimeAsync(7500)
      expect(callbacks.rebuild).toHaveBeenCalledTimes(1)
      expect(callbacks.availability).toHaveBeenLastCalledWith('connected', false)
      expect(client.events.mock.calls.at(-1)?.[1]).toBe('fresh-head')
    } finally {
      state.stop()
      held.resolve(page('retired'))
    }
  })
  it('a stale replay cursor hides old content then immediately rebuilds from fresh heads', async () => {
    const { client, callbacks, state } = setup()
    try {
      await state.catchUp()
      const head = deferred<Page>()
      client.events
        .mockRejectedValueOnce({ response: { status: 409 } })
        .mockReturnValueOnce(head.promise)
        .mockResolvedValue(page('fresh-head'))
      await state.catchUp()
      expect(callbacks.availability).toHaveBeenLastCalledWith('unavailable', false)
      expect(client.events).toHaveBeenLastCalledWith(
        'all',
        undefined,
        expect.any(AbortSignal)
      )
      expect(callbacks.rebuild).toHaveBeenCalledTimes(1)
      head.resolve(page('fresh-head'))
      await state.catchUp()
      expect(callbacks.rebuild).toHaveBeenCalledTimes(2)
      expect(callbacks.availability).toHaveBeenLastCalledWith('connected', false)
      expect(client.events).toHaveBeenLastCalledWith(
        'all',
        'fresh-head',
        expect.any(AbortSignal)
      )
    } finally {
      state.stop()
    }
  })
  it('a cursorless resync marker also yields to bounded fallback and stop retires its retry', async () => {
    vi.useFakeTimers()
    const { client, callbacks, state } = setup()
    client.events.mockResolvedValue(page('invalid-head', { resyncRequired: true }))
    await state.catchUp()
    await vi.advanceTimersByTimeAsync(0)
    expect(callbacks.availability).toHaveBeenLastCalledWith('unavailable', false)
    expect(client.events).toHaveBeenCalledTimes(1)
    expect(callbacks.rebuild).not.toHaveBeenCalled()
    state.stop()
    await vi.advanceTimersByTimeAsync(16000)
    expect(client.events).toHaveBeenCalledTimes(1)
  })
  it('R09 retains the first fallback deadline through repeated unavailable notifications', async () => {
    vi.useFakeTimers()
    const { client, state } = setup()
    state.start('https://fixtures.invalid', () => Promise.resolve('fixture'))
    const transport = vi.mocked(connectCommunityTransport).mock.calls[0]![0]
    await state.catchUp()
    const baseline = client.events.mock.calls.length
    for (let i = 0; i < 8; i++) {
      transport.state('unavailable')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(client.events.mock.calls.length).toBeGreaterThan(baseline)
    state.stop()
  })
  it('A06 fallback starts remain at most8s apart while healthy HTTP reconciliation takes time', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { client, state } = setup()
    state.start('https://fixtures.invalid', () => Promise.resolve('fixture'))
    await state.catchUp()
    const starts: number[] = []
    client.events.mockImplementation(async () => {
      starts.push(Date.now())
      await new Promise((resolve) => setTimeout(resolve, 750))
      return page('head')
    })
    await vi.advanceTimersByTimeAsync(25000)
    expect(starts.length).toBeGreaterThanOrEqual(3)
    expect(starts.slice(1).every((time, index) => time - starts[index]! <= 8000)).toBe(
      true
    )
    state.stop()
  })

  it('A01 replays captured heads after the first outage view and validates immediately', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { client, callbacks, state } = setup()
    state.start('https://fixtures.invalid', () => Promise.resolve('fixture'))
    const transport = vi.mocked(connectCommunityTransport).mock.calls[0]![0]
    transport.state('connected')
    await state.catchUp()
    const baseline = client.resolve.mock.calls.length
    transport.state('recovering')
    // Optional appending commits after capture but during the authoritative view.
    client.resolve.mockImplementationOnce(() => {
      client.events.mockResolvedValue(
        page('new-head', {
          events: [
            {
              version: 1,
              kind: 'reactions.changed',
              postId: 'post',
              communityRevision: '8',
            },
          ],
        })
      )
      return Promise.resolve({ targets: [] })
    })
    await vi.advanceTimersByTimeAsync(8000)
    expect(client.resolve.mock.calls.length).toBeGreaterThan(baseline)
    expect(callbacks.changed).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'reactions.changed', communityRevision: '8' }),
      ]),
      expect.any(AbortSignal)
    )
    state.stop()
  })

  it('A06 gives a healthy three-request reconciliation its own bounded operation', async () => {
    vi.useFakeTimers()
    const { callbacks, state } = setup()
    const completed: number[] = []
    callbacks.reconcile = async (signal) => {
      for (let page = 0; page < 3; page++) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 750)
          signal!.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(abortError('Aborted'))
            },
            { once: true }
          )
        })
        completed.push(page)
      }
    }
    const flight = state.catchUp()
    await vi.advanceTimersByTimeAsync(2300)
    await flight
    expect(completed).toEqual([0, 1, 2])
    expect(callbacks.availability).toHaveBeenLastCalledWith('connected', false)
    state.stop()
  })

  it('R07 a current post projection cannot consume an unappended comment invalidation', async () => {
    const { client, callbacks, state } = setup()
    client.resolve.mockResolvedValue({
      targets: [
        {
          key: 'post',
          status: 'available',
          communityRevision: '7',
          post: {
            id: 'post',
            status: 'published',
            caption: null,
            altText: 'fixture',
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
          comment: null,
          parent: null,
          pageCursor: null,
          parentPageCursor: null,
          threadPosition: null,
        },
      ],
    })
    await state.catchUp()
    client.events.mockResolvedValue(
      page('comment-seven', {
        events: [
          {
            version: 1,
            kind: 'comment.published',
            postId: 'post',
            commentId: 'root',
            communityRevision: '7',
          },
        ],
      })
    )
    await state.catchUp()
    expect(callbacks.changed).toHaveBeenCalledTimes(1)
    state.stop()
  })

  it('6.5-UNIT-005: captures heads before views, then replays with one concurrent flight', async () => {
    const { client, callbacks, state } = setup()
    const head = deferred<Page>()
    client.events.mockReturnValueOnce(head.promise)
    const first = state.catchUp()
    expect(state.catchUp()).toBe(first)
    expect(callbacks.rebuild).not.toHaveBeenCalled()
    head.resolve(page('captured'))
    await first
    expect(client.events.mock.calls).toEqual([
      ['all', undefined, expect.any(AbortSignal)],
      ['all', 'captured', expect.any(AbortSignal)],
    ])
    expect(callbacks.rebuild).toHaveBeenCalledTimes(1)
    expect(client.resolve).toHaveBeenCalledWith(
      {
        targets: [{ key: 'post', postId: 'post' }],
      },
      expect.any(AbortSignal)
    )
    state.stop()
  })

  it('6.5-UNIT-006: failed replacement retains cursor and retries the unapplied revision', async () => {
    const { client, callbacks, state } = setup()
    await state.catchUp()
    const event = {
      version: 1 as const,
      kind: 'reactions.changed' as const,
      postId: 'post',
      communityRevision: '4',
    }
    client.events.mockResolvedValue(page('after-four', { events: [event] }))
    vi.mocked(callbacks.changed).mockRejectedValueOnce(
      new Error('dependency unavailable')
    )
    await state.catchUp()
    expect(callbacks.availability).toHaveBeenLastCalledWith('unavailable', false)
    await state.catchUp()
    expect(callbacks.changed).toHaveBeenCalledTimes(2)
    expect(client.events.mock.calls.slice(-2)).toEqual([
      ['all', 'head', expect.any(AbortSignal)],
      ['all', 'head', expect.any(AbortSignal)],
    ])
    await state.catchUp()
    expect(callbacks.changed).toHaveBeenCalledTimes(2)
    state.stop()
  })

  it('6.5-UNIT-006: stopping during an authoritative fetch discards its result and cursor', async () => {
    const { client, callbacks, state } = setup()
    const held = deferred<Awaited<ReturnType<CommunitySyncClient['resolve']>>>()
    client.resolve.mockReturnValueOnce(held.promise)
    const flight = state.catchUp()
    await vi.waitFor(() => expect(client.resolve).toHaveBeenCalledTimes(1))
    state.stop()
    held.resolve({ targets: [{ key: 'post', status: 'unavailable' }] })
    await flight
    expect(callbacks.apply).not.toHaveBeenCalled()
    expect(callbacks.availability).not.toHaveBeenCalled()
    expect(client.events).toHaveBeenCalledTimes(1)
  })

  it('6.5-UNIT-005: healthy sockets have no periodic REST; fallback restores bounded target checks', async () => {
    vi.useFakeTimers()
    const { client, state } = setup()
    state.start('https://fixtures.invalid', () =>
      Promise.resolve('synthetic-test-bearer')
    )
    const transport = vi.mocked(connectCommunityTransport).mock.calls[0]![0]
    transport.state('connected')
    await state.catchUp()
    const healthyCalls = client.events.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(client.events).toHaveBeenCalledTimes(healthyCalls)
    transport.changed()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.events).toHaveBeenCalledTimes(healthyCalls + 1)
    transport.state('unavailable')
    const fallbackCalls = client.events.mock.calls.length
    await vi.advanceTimersByTimeAsync(8000)
    expect(client.events.mock.calls.length).toBeGreaterThan(fallbackCalls)
    expect(client.resolve.mock.calls.length).toBeGreaterThan(1)
    state.stop()
  })

  it('6.5-UNIT-006: unavailable retains ownership and denial tears it down', async () => {
    const { client, callbacks, state } = setup()
    await state.catchUp()
    client.events.mockRejectedValueOnce({ response: { status: 503 } })
    await state.catchUp()
    client.events.mockResolvedValue(page('after-retry'))
    await state.catchUp()
    expect(client.events).toHaveBeenLastCalledWith('all', 'head', expect.any(AbortSignal))
    client.events.mockRejectedValueOnce({ response: { status: 403 } })
    await state.catchUp()
    expect(callbacks.availability).toHaveBeenLastCalledWith('denied')
    const calls = client.events.mock.calls.length
    await state.catchUp()
    expect(client.events).toHaveBeenCalledTimes(calls)
  })
})
