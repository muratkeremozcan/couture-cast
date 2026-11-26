// Story CC-7.11 D8 owner: the Looks tab. It opens on saved looks, then a Capsules row and a Plan
// row. Segments, filters, Ideas and the capsules redirect are CC-7.12's.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import type { SavedLookContract } from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import {
  listSavedLooksPageFromWeb,
  subscribeSavedLooksChanged,
} from '../../lib/saved-looks'
import {
  currentWebSessionOwner,
  currentWebSessionScope,
  useHydrating,
  useWebSessionOwner,
} from '../../lib/use-web-session'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { useRetryOnVerifiedSession } from '../../lib/session-retry'
import { ClosetSavedLooksRow } from '../wardrobe/saved-looks-row'
import { AppPage, APP_MAIN_NARROW_CLASS } from './app-page'
import { AppTopBar } from './app-top-bar'
import { NavRow } from './nav-row'
import { ScreenGate } from './screen-gate'
import { StickyBottomNav } from './sticky-bottom-nav'

const PAGE_SIZE = 50

/** Story CC-7.7 D5: what a return to Looks shows first, for this member only (memory only). */
const LOOKS_SNAPSHOT_PART = 'saved-looks'
type LooksSnapshot = { looks: SavedLookContract[]; total: number }

type SavedLooksState = {
  looks: SavedLookContract[]
  total: number
  error: string | null
  loading: boolean
  /** The first read for this member answered (or failed); the gate waits for it only. */
  settled: boolean
}

const NO_LOOKS: SavedLooksState = {
  looks: [],
  total: 0,
  error: null,
  loading: false,
  settled: false,
}

/**
 * The first `wanted` saved looks (at least one page), page by page, so a refresh keeps every
 * page the member had loaded.
 */
async function readSavedLooks(
  owner: string,
  wanted: number,
  signal: AbortSignal
): Promise<LooksSnapshot> {
  const looks: SavedLookContract[] = []
  let total = 0
  do {
    const page = await listSavedLooksPageFromWeb({
      owner,
      limit: PAGE_SIZE,
      offset: looks.length,
      signal,
    })
    total = page.total
    const seen = new Set(looks.map((look) => look.id))
    const fresh = page.data.filter((look) => !seen.has(look.id))
    looks.push(...fresh)
    if (fresh.length === 0) break
  } while (looks.length < Math.min(wanted, total))
  return { looks, total }
}

/**
 * The member's saved looks, read once per mount and again after a change. A page read for a
 * session scope the tab no longer holds is dropped and read again (as on Closet, Codex review
 * P2-1). Without a member nothing is read.
 */
function useSavedLooksList(owner: string | null) {
  const { attempt: sessionAttempt, missed } = useRetryOnVerifiedSession()
  const [attempt, setAttempt] = useState(0)
  const hydrating = useHydrating()
  const [state, setState] = useState<SavedLooksState>(() => {
    const snapshot =
      hydrating || !owner
        ? undefined
        : screenSnapshot.recall<LooksSnapshot>(
            currentWebSessionScope(),
            'looks',
            LOOKS_SNAPSHOT_PART
          )
    return snapshot ? { ...NO_LOOKS, ...snapshot, settled: true } : NO_LOOKS
  })
  const [loadingMore, setLoadingMore] = useState(false)
  const epochRef = useRef(0)
  /** How many looks the screen shows; a refresh reads at least as many back (review #12). */
  const shownRef = useRef(state.looks.length)
  shownRef.current = state.looks.length
  const loadMoreRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const epoch = ++epochRef.current
    loadMoreRef.current?.abort()
    setLoadingMore(false)
    if (!owner) {
      setState({ ...NO_LOOKS, settled: true })
      return
    }
    const controller = new AbortController()
    const scope = currentWebSessionScope()
    const current = () =>
      !controller.signal.aborted &&
      epochRef.current === epoch &&
      currentWebSessionOwner() === owner
    setState((previous) => ({ ...previous, loading: true }))
    void readSavedLooks(owner, Math.max(PAGE_SIZE, shownRef.current), controller.signal)
      .then((read) => {
        if (!current()) return
        if (scope !== currentWebSessionScope()) {
          setAttempt((count) => count + 1)
          return
        }
        setState({ ...read, error: null, loading: false, settled: true })
        screenSnapshot.remember(scope, 'looks', LOOKS_SNAPSHOT_PART, read)
      })
      .catch((error: unknown) => {
        if (!current()) return
        setState((previous) => ({
          ...previous,
          error:
            error instanceof Error ? error.message : 'Unable to load your saved looks.',
          loading: false,
          settled: true,
        }))
        missed()
      })
    return () => controller.abort()
  }, [owner, attempt, sessionAttempt, missed])

  useEffect(() => {
    if (!owner) return
    return subscribeSavedLooksChanged((changedOwner) => {
      if (changedOwner === owner) setAttempt((count) => count + 1)
    })
  }, [owner])

  // The screen is keyed by member, so an unmount also covers a change of member.
  useEffect(() => () => loadMoreRef.current?.abort(), [])

  const loadMore = useCallback(() => {
    if (!owner || state.loading || loadingMore || state.looks.length >= state.total)
      return
    setLoadingMore(true)
    const epoch = epochRef.current
    const scope = currentWebSessionScope()
    const controller = new AbortController()
    loadMoreRef.current = controller
    void listSavedLooksPageFromWeb({
      owner,
      limit: PAGE_SIZE,
      offset: state.looks.length,
      signal: controller.signal,
    })
      .then((page) => {
        if (
          controller.signal.aborted ||
          epochRef.current !== epoch ||
          currentWebSessionOwner() !== owner ||
          scope !== currentWebSessionScope()
        )
          return
        setState((previous) => {
          const seen = new Set(previous.looks.map((look) => look.id))
          const looks = [
            ...previous.looks,
            ...page.data.filter((look) => !seen.has(look.id)),
          ]
          // Review #12: every loaded page, so a return restores the list its scroll was in.
          screenSnapshot.remember(scope, 'looks', LOOKS_SNAPSHOT_PART, {
            looks,
            total: page.total,
          } satisfies LooksSnapshot)
          return { ...previous, looks, total: page.total }
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted && epochRef.current === epoch)
          setLoadingMore(false)
      })
  }, [owner, state.loading, state.looks.length, state.total, loadingMore])

  return {
    ...state,
    loadingMore,
    loadMore,
    reload: () => setAttempt((count) => count + 1),
  }
}

function LooksBody({ owner }: { owner: string | null }) {
  const { t } = useTranslation()
  const saved = useSavedLooksList(owner)
  const hasLooks = owner !== null && saved.looks.length > 0

  return (
    <ScreenGate screen="looks" ready={saved.settled}>
      {hasLooks || saved.error ? (
        <div data-testid="looks-first-content">
          <ClosetSavedLooksRow
            owner={owner}
            savedLooks={saved.looks}
            totalCount={saved.total}
            hasMore={saved.looks.length < saved.total}
            isLoadingMore={saved.loadingMore}
            onLoadMore={saved.loadMore}
            isLoading={saved.loading}
            loadError={saved.error}
            // The Looks tab reads no closet, so a saved look reopens in its detail layer; Closet
            // keeps reopening a Style this piece look in the editor until CC-7.12.
            garments={[]}
            onRetry={saved.reload}
            onChanged={saved.reload}
            onReopenStylePiece={() => undefined}
            initiallyExpanded
          />
        </div>
      ) : (
        <p data-testid="looks-first-content" className="text-base text-ink-muted">
          {t('looks.empty')}
        </p>
      )}
      <nav aria-label={t('nav.looks')} className="mt-6">
        <NavRow
          href="/wardrobe/capsules"
          label={t('looks.capsules')}
          testId="looks-capsules-row"
        />
        <NavRow href="/looks/plan" label={t('looks.plan')} testId="looks-plan-row" />
      </nav>
    </ScreenGate>
  )
}

export function LooksScreen() {
  const owner = useWebSessionOwner()
  return (
    <I18nextProvider i18n={getI18n()}>
      <AppPage>
        <AppTopBar titleKey="nav.looks" />
        <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
          <LooksBody key={owner} owner={owner} />
        </main>
        <StickyBottomNav />
      </AppPage>
    </I18nextProvider>
  )
}
