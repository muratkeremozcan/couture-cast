// Story 6.6: the spotlight hook's own request bookkeeping. Responses for
// abandoned requests never paint over newer state, and a single-post refresh
// updates or evicts only its own copy.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CommunityReactionSpotlight,
  CommunityReactionSpotlightItem as CommunitySpotlightItem,
} from '@couture/api-client/contracts/http'
import { CommunityReactionState } from '@couture/api-client'
import { useCommunitySpotlight } from './community-spotlight'

const lib = vi.hoisted(() => ({
  getCommunitySpotlightFromWeb: vi.fn(),
  getCommunityPostFromWeb: vi.fn(),
}))

vi.mock('../../lib/community', () => ({
  ...lib,
  communityFailureReason: (error: unknown) =>
    (error as { reason?: string } | null)?.reason ?? 'unknown',
}))

function item(id: string, rank: number): CommunitySpotlightItem {
  return { id, rank, status: 'published' } as unknown as CommunitySpotlightItem
}

function page(
  items: CommunitySpotlightItem[],
  nextCursor: string | null = null
): CommunityReactionSpotlight {
  return { level: 'city', label: 'Lisbon', items, nextCursor }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(reconcile = (items: readonly CommunitySpotlightItem[]) => [...items]) {
  const announce = vi.fn()
  const hook = renderHook(
    ({ scope }: { scope: string | null }) =>
      useCommunitySpotlight({ scope, beginRead: () => 0, reconcile, announce }),
    { initialProps: { scope: 'member-1' as string | null } }
  )
  return { ...hook, announce }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('6.6 spotlight hook bookkeeping', () => {
  it('6.6-WEB-060 drops a first page that resolves after the session changed', async () => {
    const first = deferred<CommunityReactionSpotlight>()
    lib.getCommunitySpotlightFromWeb
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(page([item('fresh', 1)]))
    const { result, rerender } = setup()
    rerender({ scope: 'member-2' })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await act(async () => {
      first.resolve(page([item('stale', 1)]))
      await first.promise
    })
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['fresh'])
  })

  it('6.6-WEB-061 drops a first-page failure that arrives after a reset', async () => {
    const first = deferred<CommunityReactionSpotlight>()
    lib.getCommunitySpotlightFromWeb.mockReturnValueOnce(first.promise)
    const { result, rerender } = setup()
    rerender({ scope: null })
    await act(async () => {
      first.reject({ reason: 'unknown' })
      await first.promise.catch(() => undefined)
    })
    expect(result.current.state.status).toBe('idle')
  })

  it('6.6-WEB-062 View more does nothing without a cursor and drops results after a reset', async () => {
    lib.getCommunitySpotlightFromWeb.mockResolvedValueOnce(page([item('a', 1)], 'next'))
    const { result } = setup()
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    const more = deferred<CommunityReactionSpotlight>()
    lib.getCommunitySpotlightFromWeb.mockReturnValueOnce(more.promise)
    let loading!: Promise<void>
    act(() => {
      loading = result.current.loadMore()
    })
    // A second View more while one is loading never starts another read.
    await act(() => result.current.loadMore())
    expect(lib.getCommunitySpotlightFromWeb).toHaveBeenCalledTimes(2)
    act(() => result.current.reset())
    await act(async () => {
      more.resolve(page([item('b', 2)]))
      await loading
    })
    expect(result.current.state).toMatchObject({ status: 'idle', items: [] })

    // Idle, with no cursor: View more reads nothing.
    await act(() => result.current.loadMore())
    expect(lib.getCommunitySpotlightFromWeb).toHaveBeenCalledTimes(2)
  })

  it('6.6-WEB-063 drops a View more failure that arrives after a reset', async () => {
    lib.getCommunitySpotlightFromWeb.mockResolvedValueOnce(page([item('a', 1)], 'next'))
    const { result, announce } = setup()
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    const more = deferred<CommunityReactionSpotlight>()
    lib.getCommunitySpotlightFromWeb.mockReturnValueOnce(more.promise)
    let loading!: Promise<void>
    act(() => {
      loading = result.current.loadMore()
    })
    act(() => result.current.reset())
    await act(async () => {
      more.reject({ reason: 'unknown' })
      await loading
    })
    expect(result.current.state.moreFailed).toBe(false)
    expect(announce).not.toHaveBeenCalled()
  })
})

describe('6.6 spotlight single-post refresh', () => {
  async function ready(
    reconcile?: (items: readonly CommunitySpotlightItem[]) => CommunitySpotlightItem[]
  ) {
    lib.getCommunitySpotlightFromWeb.mockResolvedValueOnce(
      page([item('a', 1), item('b', 2)])
    )
    const hook = setup(reconcile)
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    return hook
  }

  it('6.6-WEB-064 reads nothing for a post the spotlight does not show', async () => {
    const { result } = await ready()
    await act(() => result.current.refreshItem('elsewhere'))
    expect(lib.getCommunityPostFromWeb).not.toHaveBeenCalled()
  })

  it('6.6-WEB-065 evicts a post that is gone and keeps it through any other failure', async () => {
    const { result } = await ready()
    lib.getCommunityPostFromWeb.mockRejectedValueOnce({ reason: 'unavailable' })
    await act(() => result.current.refreshItem('a'))
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['a', 'b'])
    lib.getCommunityPostFromWeb.mockRejectedValueOnce({ reason: 'not_found' })
    await act(() => result.current.refreshItem('a'))
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['b'])
  })

  it('6.6-WEB-066 evicts a refreshed post the reaction state no longer renders', async () => {
    let drop = false
    const { result } = await ready((items) => (drop ? [] : [...items]))
    drop = true
    lib.getCommunityPostFromWeb.mockResolvedValueOnce({ id: 'b', status: 'published' })
    await act(() => result.current.refreshItem('b'))
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['a'])
  })

  /**
   * Starts a refresh of 'a' on a held read, resets, and reloads the same page,
   * so a late answer that slipped past the abort would visibly change `a`.
   */
  async function refreshAcrossReset() {
    const hook = await ready()
    const read = deferred<unknown>()
    let signal: AbortSignal | undefined
    lib.getCommunityPostFromWeb.mockImplementationOnce(
      (_id: string, abort: AbortSignal) => {
        signal = abort
        return read.promise
      }
    )
    let refreshing!: Promise<void>
    act(() => {
      refreshing = hook.result.current.refreshItem('a')
    })
    act(() => hook.result.current.reset())
    expect(signal?.aborted).toBe(true)
    lib.getCommunitySpotlightFromWeb.mockResolvedValueOnce(
      page([item('a', 1), item('b', 2)])
    )
    await act(() => hook.result.current.retry())
    expect(hook.result.current.state.status).toBe('ready')
    return { ...hook, read, refreshing: () => refreshing }
  }

  it('6.6-WEB-067 a reset aborts an in-flight refresh, whose late not found never evicts the reloaded post', async () => {
    const { result, read, refreshing } = await refreshAcrossReset()
    await act(async () => {
      read.reject({ reason: 'not_found' })
      await refreshing()
    })
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('6.6-WEB-068 a refresh answered after a reset is ignored, even for a post no longer published', async () => {
    const { result, read, refreshing } = await refreshAcrossReset()
    await act(async () => {
      read.resolve({ id: 'a', status: 'withdrawn' })
      await refreshing()
    })
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('6.6-WEB-084 unmounting aborts an in-flight refresh', async () => {
    const { result, unmount } = await ready()
    const read = deferred<unknown>()
    let signal: AbortSignal | undefined
    lib.getCommunityPostFromWeb.mockImplementationOnce(
      (_id: string, abort: AbortSignal) => {
        signal = abort
        return read.promise
      }
    )
    let refreshing!: Promise<void>
    act(() => {
      refreshing = result.current.refreshItem('a')
    })
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
    read.resolve({ id: 'a', status: 'published' })
    await refreshing
  })
})

describe('6.6 spotlight reads against realtime evictions', () => {
  function grid() {
    const reactionState = new CommunityReactionState({
      onChange: () => undefined,
    } as never)
    const announce = vi.fn()
    const hook = renderHook(() =>
      useCommunitySpotlight({
        scope: 'member-1',
        // The grid's own wiring: the ticket comes from the hook, before the request.
        beginRead: () => reactionState.beginRead(),
        reconcile: (items, ticket) =>
          items.flatMap((post) => {
            const current = reactionState.read(post, ticket)
            return current ? [{ ...current, rank: post.rank }] : []
          }),
        announce,
      })
    )
    return { ...hook, reactionState }
  }

  it('6.6-WEB-069 a first page that was in flight during an eviction never restores the post', async () => {
    const first = deferred<CommunityReactionSpotlight>()
    lib.getCommunitySpotlightFromWeb.mockReturnValueOnce(first.promise)
    const { result, reactionState } = grid()
    reactionState.evict('removed')
    await act(async () => {
      first.resolve(page([item('removed', 1), item('kept', 2)]))
      await first.promise
    })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['kept'])
  })

  it('6.6-WEB-070 a View more page and a single-post refresh in flight during an eviction stay out', async () => {
    lib.getCommunitySpotlightFromWeb.mockResolvedValueOnce(page([item('a', 1)], 'next'))
    const { result, reactionState } = grid()
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    const more = deferred<CommunityReactionSpotlight>()
    lib.getCommunitySpotlightFromWeb.mockReturnValueOnce(more.promise)
    let loading!: Promise<void>
    act(() => {
      loading = result.current.loadMore()
    })
    reactionState.evict('removed')
    await act(async () => {
      more.resolve(page([item('removed', 2)]))
      await loading
    })
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['a'])

    const read = deferred<unknown>()
    lib.getCommunityPostFromWeb.mockReturnValueOnce(read.promise)
    let refreshing!: Promise<void>
    act(() => {
      refreshing = result.current.refreshItem('a')
    })
    reactionState.evict('a')
    await act(async () => {
      read.resolve({ id: 'a', status: 'published' })
      await refreshing
    })
    expect(result.current.state.items).toEqual([])
  })
})

describe('6.7b spotlight read tokens', () => {
  it('6.7b-WEB-026 hands each page its own read token and never one from a superseded or failed read', async () => {
    let issued = 0
    const reconciled: number[] = []
    const first = deferred<CommunityReactionSpotlight>()
    lib.getCommunitySpotlightFromWeb
      // Read 1: superseded by the session change below.
      .mockReturnValueOnce(first.promise)
      // Read 2: the new member's first page.
      .mockResolvedValueOnce(page([item('a', 1)], 'next'))
      // Read 3: a View more that fails.
      .mockRejectedValueOnce({ reason: 'unknown' })
      // Read 4: the View more retry.
      .mockResolvedValueOnce(page([item('b', 2)]))
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string | null }) =>
        useCommunitySpotlight<{ read: number }>({
          scope,
          beginRead: () => ({ read: ++issued }),
          reconcile: (items, token) => {
            reconciled.push(token.read)
            return [...items]
          },
          announce: vi.fn(),
        }),
      { initialProps: { scope: 'member-1' as string | null } }
    )
    rerender({ scope: 'member-2' })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await act(async () => {
      first.resolve(page([item('stale', 1)]))
      await first.promise
    })
    await act(() => result.current.loadMore())
    expect(result.current.state.moreFailed).toBe(true)
    await act(() => result.current.loadMore())

    expect(issued).toBe(4)
    // Only the reads whose pages landed are reconciled, each under its own token.
    expect(reconciled).toEqual([2, 4])
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})
