// Story CC-7.11 D8 owner: the member's saved looks, read page by page. The Closet's saved looks row
// and the Looks tab both list them, so the read lives here once (moved out of the wardrobe hub).
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SavedLookContract } from '@couture/api-client/contracts/http'
import { mobileIdentityEpoch } from '@/src/lib/mobile-auth'
import {
  listSavedLooksPageFromMobile,
  subscribeMobileSavedLooksChanged,
} from '@/src/lib/saved-looks'

/** One page of saved looks per read. */
const SAVED_LOOKS_PAGE = 50

export interface SavedLooksState {
  savedLooks: SavedLookContract[]
  total: number
  /** A first page or a reload is in flight. */
  loading: boolean
  loadingMore: boolean
  error: string | null
  /** True once the first page settled (success, empty or error) for this owner. */
  settled: boolean
  hasMore: boolean
  /** Reads the first page again in place; the list stays on screen until it answers. */
  reload: () => void
  loadMore: () => void
}

/**
 * The saved looks of `owner` under identity `epoch`. A change any screen reports for the same
 * owner reloads the list. A read that settles after a sign-out, an account switch or a newer
 * reload is dropped, so one member never sees another's looks.
 */
export function useSavedLooks({
  owner,
  epoch,
}: {
  owner: string | null
  epoch: number
}): SavedLooksState {
  const { t } = useTranslation()
  const [savedLooks, setSavedLooks] = useState<SavedLookContract[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const loadEpochRef = useRef(0)

  useEffect(() => {
    const loadEpoch = ++loadEpochRef.current
    setLoadingMore(false)
    if (!owner) {
      setSavedLooks([])
      setTotal(0)
      setError(null)
      setLoading(false)
      setSettled(true)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void listSavedLooksPageFromMobile({
      limit: SAVED_LOOKS_PAGE,
      offset: 0,
      signal: controller.signal,
    })
      .then((page) => {
        if (
          controller.signal.aborted ||
          loadEpochRef.current !== loadEpoch ||
          epoch !== mobileIdentityEpoch()
        ) {
          return
        }
        setSavedLooks(page.data)
        setTotal(page.total)
        setError(null)
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || loadEpochRef.current !== loadEpoch) return
        setError(
          failure instanceof Error
            ? failure.message
            : t('wardrobe.hub.saved_looks_failed')
        )
      })
      .finally(() => {
        if (!controller.signal.aborted && loadEpochRef.current === loadEpoch) {
          setLoading(false)
          setSettled(true)
        }
      })
    return () => controller.abort()
  }, [epoch, owner, attempt, t])

  useEffect(() => {
    if (!owner) return
    return subscribeMobileSavedLooksChanged((changedOwner) => {
      if (changedOwner === owner) setAttempt((value) => value + 1)
    })
  }, [owner])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  const loadMore = useCallback(() => {
    if (!owner || loading || loadingMore || savedLooks.length >= total) return
    setLoadingMore(true)
    const offset = savedLooks.length
    const startEpoch = epoch
    const startLoadEpoch = loadEpochRef.current
    void listSavedLooksPageFromMobile({ limit: SAVED_LOOKS_PAGE, offset })
      .then((page) => {
        if (
          loadEpochRef.current !== startLoadEpoch ||
          startEpoch !== mobileIdentityEpoch()
        ) {
          return
        }
        setSavedLooks((current) => {
          const seen = new Set(current.map((item) => item.id))
          return [...current, ...page.data.filter((item) => !seen.has(item.id))]
        })
        setTotal(page.total)
      })
      .catch(() => undefined)
      .finally(() => {
        if (loadEpochRef.current === startLoadEpoch) setLoadingMore(false)
      })
  }, [epoch, owner, savedLooks.length, loading, loadingMore, total])

  return {
    savedLooks,
    total,
    loading,
    loadingMore,
    error,
    settled,
    hasMore: savedLooks.length < total,
    reload,
    loadMore,
  }
}
