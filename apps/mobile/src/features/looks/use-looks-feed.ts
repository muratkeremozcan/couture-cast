// Story CC-7.12 D3, D4 owner: the native Looks Saved feed. Each filter reads its own lists from
// the server (TEA P2): All pages saved looks and capsules newest first and merges them with the
// shared `mergeLooksFeed`; Today reads home sample looks only; Capsules reads capsules only.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  OutfitCapsuleContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  EMPTY_LOOKS_FEED_SOURCE,
  mergeLooksFeed,
  type LooksFeedSource,
  type LooksFeedView,
  type LooksFilter,
} from '@couture/utils'
import { mobileIdentityEpoch, resolveMobileAccessToken } from '@/src/lib/mobile-auth'
import {
  listSavedLooksPageFromMobile,
  subscribeMobileSavedLooksChanged,
} from '@/src/lib/saved-looks'
import { listCapsulesFromMobile, type WardrobeMobileError } from '@/src/lib/wardrobe'

/** D3: one page of each list per read. */
const LOOKS_FEED_PAGE = 50

type Source<T> = { items: T[]; total: number; loaded: boolean; failed: boolean }

const UNREAD: Source<never> = { items: [], total: 0, loaded: false, failed: false }
const SKIPPED: Source<never> = { ...EMPTY_LOOKS_FEED_SOURCE, items: [], failed: false }

interface FeedState {
  looks: Source<SavedLookContract>
  capsules: Source<OutfitCapsuleContract>
}

export interface LooksFeedState {
  view: LooksFeedView<SavedLookContract, OutfitCapsuleContract>
  /** True once both first reads of this filter settled (success, empty or error). */
  settled: boolean
  /** A first read failed; the merge treats that list as empty. */
  failed: boolean
  /** The member has at least one item in a list this filter reads. */
  hasItems: boolean
  loadingMore: boolean
  loadMore: () => void
  /** Reads the first pages again in place; the tiles stay until the answers land. */
  reload: () => void
}

function appendUnique<T extends { id: string }>(current: T[], next: readonly T[]): T[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...next.filter((item) => !seen.has(item.id))]
}

/**
 * Codex #5: reads pages from offset 0 until at least `want` items (or the whole list) are in, so
 * a refresh brings back every page the member had loaded.
 */
async function readPages<T extends { id: string }>(
  readPage: (offset: number) => Promise<{ items: readonly T[]; total: number }>,
  want: number
): Promise<{ items: T[]; total: number }> {
  let items: T[] = []
  let total = 0
  for (;;) {
    const page = await readPage(items.length)
    total = page.total
    const before = items.length
    items = appendUnique(items, page.items)
    if (items.length === before || items.length >= want || items.length >= total) break
  }
  return { items, total }
}

/** A failed source reads as complete and empty, so the other list still shows (P1). */
function forMerge<T extends { id: string; createdAt: string }>(
  source: Source<T>
): LooksFeedSource<T> {
  return source.failed ? EMPTY_LOOKS_FEED_SOURCE : source
}

/**
 * The feed of `filter` for `owner` under identity `epoch`. A read that settles after a sign-out,
 * an account switch, a filter change or a newer reload is dropped.
 */
export function useLooksFeed({
  owner,
  epoch,
  filter,
}: {
  owner: string | null
  epoch: number
  filter: LooksFilter
}): LooksFeedState {
  const readsLooks = filter !== 'capsules'
  const readsCapsules = filter !== 'today'
  const initial = (): FeedState => ({
    looks: owner && readsLooks ? UNREAD : SKIPPED,
    capsules: owner && readsCapsules ? UNREAD : SKIPPED,
  })
  const [state, setState] = useState<FeedState>(initial)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const runRef = useRef(0)
  const filterRef = useRef(filter)
  const stateRef = useRef(state)

  // A filter change starts from unread lists, so one filter never shows another's tiles.
  if (filterRef.current !== filter) {
    filterRef.current = filter
    setState(initial())
  }
  stateRef.current = state

  const readLooks = useCallback(
    (offset: number, token: string, signal?: AbortSignal) =>
      listSavedLooksPageFromMobile({
        accessToken: token,
        source: filter === 'today' ? 'home_sample' : undefined,
        includeToday: true,
        sort: 'created_desc',
        limit: LOOKS_FEED_PAGE,
        offset,
        signal,
      }),
    [filter]
  )
  const readCapsules = useCallback(
    (offset: number, token: string, signal?: AbortSignal) =>
      listCapsulesFromMobile(
        token,
        owner ?? '',
        { sort: 'created_desc', limit: LOOKS_FEED_PAGE, offset },
        signal
      ).catch((error: unknown) => {
        // Pending teens can open their saved catalog looks while capsules require approval.
        if (filter === 'all' && (error as WardrobeMobileError | null)?.status === 403) {
          return { items: [], total: 0 }
        }
        throw error
      }),
    [filter, owner]
  )

  useEffect(() => {
    const run = ++runRef.current
    setLoadingMore(false)
    if (!owner) {
      setState({ looks: SKIPPED, capsules: SKIPPED })
      return
    }
    const controller = new AbortController()
    const live = () =>
      !controller.signal.aborted &&
      runRef.current === run &&
      epoch === mobileIdentityEpoch()
    void (async () => {
      const token = (await resolveMobileAccessToken().catch(() => null)) ?? ''
      if (!live()) return
      // A refresh keeps the tiles on screen until it lands, reads back as many items as are
      // loaded, and keeps a loaded list when its refresh fails.
      const previous = stateRef.current
      const want = (source: Source<{ id: string }>) =>
        Math.max(LOOKS_FEED_PAGE, source.loaded ? source.items.length : 0)
      const looks = readsLooks
        ? readPages(
            (offset) =>
              readLooks(offset, token, controller.signal).then((page) => ({
                items: page.data,
                total: page.total,
              })),
            want(previous.looks)
          ).then(
            (read): Source<SavedLookContract> => ({
              ...read,
              loaded: true,
              failed: false,
            }),
            (): Source<SavedLookContract> =>
              previous.looks.loaded ? previous.looks : { ...SKIPPED, failed: true }
          )
        : Promise.resolve<Source<SavedLookContract>>(SKIPPED)
      const capsules = readsCapsules
        ? readPages(
            (offset) => readCapsules(offset, token, controller.signal),
            want(previous.capsules)
          ).then(
            (read): Source<OutfitCapsuleContract> => ({
              ...read,
              loaded: true,
              failed: false,
            }),
            (): Source<OutfitCapsuleContract> =>
              previous.capsules.loaded ? previous.capsules : { ...SKIPPED, failed: true }
          )
        : Promise.resolve<Source<OutfitCapsuleContract>>(SKIPPED)
      const [nextLooks, nextCapsules] = await Promise.all([looks, capsules])
      if (!live()) return
      setState({ looks: nextLooks, capsules: nextCapsules })
    })()
    return () => controller.abort()
  }, [attempt, epoch, owner, readCapsules, readLooks, readsCapsules, readsLooks])

  // A save, remove or undo any screen reports for this owner reads the feed again.
  useEffect(() => {
    if (!owner) return
    return subscribeMobileSavedLooksChanged((changedOwner) => {
      if (changedOwner === owner) setAttempt((value) => value + 1)
    })
  }, [owner])

  const view = useMemo(
    () => mergeLooksFeed(forMerge(state.looks), forMerge(state.capsules)),
    [state]
  )

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  const next = view.next
  const loadMore = useCallback(() => {
    if (!owner || loadingMore || next === null) return
    const run = runRef.current
    const startEpoch = epoch
    const live = () => runRef.current === run && startEpoch === mobileIdentityEpoch()
    setLoadingMore(true)
    void (async () => {
      try {
        const token = (await resolveMobileAccessToken().catch(() => null)) ?? ''
        if (!live()) return
        if (next === 'look') {
          const page = await readLooks(state.looks.items.length, token)
          if (!live()) return
          setState((current) => ({
            ...current,
            looks: {
              ...current.looks,
              items: appendUnique(current.looks.items, page.data),
              total: page.total,
            },
          }))
        } else {
          const page = await readCapsules(state.capsules.items.length, token)
          if (!live()) return
          setState((current) => ({
            ...current,
            capsules: {
              ...current.capsules,
              items: appendUnique(current.capsules.items, page.items),
              total: page.total,
            },
          }))
        }
      } catch {
        // The Load more control stays; the member can press it again.
      } finally {
        if (runRef.current === run) setLoadingMore(false)
      }
    })()
  }, [
    epoch,
    loadingMore,
    next,
    owner,
    readCapsules,
    readLooks,
    state.capsules.items.length,
    state.looks.items.length,
  ])

  const settled =
    !owner ||
    ((state.looks.loaded || state.looks.failed) &&
      (state.capsules.loaded || state.capsules.failed))
  return {
    view,
    settled,
    failed: state.looks.failed || state.capsules.failed,
    hasItems: state.looks.total > 0 || state.capsules.total > 0,
    loadingMore,
    loadMore,
    reload,
  }
}
