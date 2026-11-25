// Story CC-7.7 D1, D3 and D5 owner: one gate per signed-in tab body.
//
// A member on a phone used to watch each tab jump while it loaded: the signed-out sample outfit
// swapped for theirs on Home, the setup banner popped in above the Closet grid, the Spotlight
// skeleton collapsed on Community. The gate keeps the tab's shell (header and bottom nav, both
// outside it) still and shows one neutral placeholder where the body will be, while the body
// stays mounted underneath so its reads start at once. When the reads it waits for settle (with
// data, empty or an error), the body appears as one unit and the placeholder leaves.
//
// The server cannot know the session, so the placeholder and the body are both in the HTML and
// globals.css picks one from <html data-session> before first paint (lib/landing-session.ts):
// under `pending` and `member` the placeholder shows until this gate sets `data-ready`; under
// `none` the signed-out page renders as before and no placeholder ever shows.
//
// A return to a tab this member already saw in the session (lib/screen-snapshot.ts) opens the
// gate at once, restores the tab's scroll before paint and lets the sections refresh in place.
//
// A gate also opens once `SCREEN_GATE_DEADLINE_MS` passed (Codex review P2-2): one read that
// never answers must not hide the sections that did, or their errors and Retry.
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { LANDING_SESSION_ATTRIBUTE } from '../../lib/landing-session'
import { screenSnapshot, type ScreenName } from '../../lib/screen-snapshot'
import {
  currentWebSessionOwner,
  currentWebSessionScope,
  isLiveScope,
  NO_MEMBER_SCOPE,
  useHydrating,
  useWebSession,
  useWebSessionScope,
} from '../../lib/use-web-session'

/** A gate opens after this long even when a read never answered (Codex review P2-2). */
export const SCREEN_GATE_DEADLINE_MS = 10_000

type ScreenGateContextValue = {
  screen: ScreenName
  /** The session scope the gate is waiting for; a read reports again when it changes. */
  ownerKey: string
  report: (read: string, settled: boolean) => void
  /** The body is shown: a one-time focus intent may run now (Codex review P2-8). */
  open: boolean
}

const ScreenGateContext = createContext<ScreenGateContextValue | null>(null)

/**
 * A section's read, reported to the gate around it. `settled` turns true once the read answered
 * (with data, empty or an error) for the current member. Outside a gate it does nothing, so the
 * same section renders anywhere; a gate that does not list `read` ignores it.
 */
export function useScreenGateRead(read: string, settled: boolean): void {
  const gate = useContext(ScreenGateContext)
  const report = gate?.report
  const ownerKey = gate?.ownerKey
  useLayoutEffect(() => {
    report?.(read, settled)
  }, [report, ownerKey, read, settled])
}

/** `useScreenGateRead` as an element, for a branch that settles a read by rendering. */
export function ScreenGateReport({ read, settled }: { read: string; settled: boolean }) {
  useScreenGateRead(read, settled)
  return null
}

/** The tab a section renders in, for its snapshot; null outside a gate. */
export function useScreenGateScreen(): ScreenName | null {
  return useContext(ScreenGateContext)?.screen ?? null
}

/**
 * Whether the body around a section is shown; always true outside a gate. A one-time intent
 * (a deep-link focus, a guided autofocus) waits for it, because focus on a hidden element is
 * lost and the intent would be spent on nothing (Codex review P2-8).
 */
export function useScreenGateOpen(): boolean {
  return useContext(ScreenGateContext)?.open ?? true
}

/**
 * Story CC-7.7 D5 (Codex review P1-2): one section's last settled data on its tab, for a return
 * in the same session. `restored` is what this mount starts from: undefined on hydration, a
 * first visit, outside a gate, or for another member. A read calls `beginRead` as it starts,
 * which captures the session scope its answer belongs to; `remember` stores the data under that
 * scope (undefined forgets it), and the store drops it if the scope is no longer live.
 */
export function useSectionSnapshot<T>(
  part: string,
  owner: string | null
): {
  restored: T | undefined
  /** The member `restored` belongs to, or null when nothing was restored. */
  restoredFor: string | null
  /** Where the section's state starts: `ready` with restored data, else `checking`. */
  startState: 'ready' | 'checking'
  beginRead: () => void
  remember: (value: T | undefined) => void
} {
  const screen = useScreenGateScreen()
  const hydrating = useHydrating()
  const [start] = useState(() => {
    const scope =
      hydrating || !screen || owner === null || currentWebSessionOwner() !== owner
        ? null
        : currentWebSessionScope()
    return {
      scope,
      restored:
        scope && screen ? screenSnapshot.recall<T>(scope, screen, part) : undefined,
    }
  })
  const scopeRef = useRef<string | null>(start.scope)
  const beginRead = useCallback(() => {
    scopeRef.current =
      owner !== null && currentWebSessionOwner() === owner
        ? currentWebSessionScope()
        : null
  }, [owner])
  const remember = useCallback(
    (value: T | undefined) => {
      if (screen) screenSnapshot.remember(scopeRef.current, screen, part, value)
    },
    [part, screen]
  )
  const restored = start.restored !== undefined
  return {
    restored: start.restored,
    restoredFor: restored ? owner : null,
    startState: restored ? 'ready' : 'checking',
    beginRead,
    remember,
  }
}

/**
 * Story CC-7.7 D3 amendment: whether a section's `checking` state paints its signed-out layout,
 * marked `data-landing="guest"`. The server and the hydrating render cannot know the session, so
 * they paint it, and globals.css hides it on a page painted for a stored session; a signed-out
 * page then shows from its first paint what it keeps once the session check ends, and nothing
 * lands late. After hydration only a signed-out page keeps it.
 */
export function useGuestFirstPaint(): boolean {
  const hydrating = useHydrating()
  if (hydrating) return true
  return document.documentElement.getAttribute(LANDING_SESSION_ATTRIBUTE) === 'none'
}

/** The page painted for a stored session (`member` or `pending`), where the placeholder shows. */
function htmlHoldsSession(): boolean {
  const session = document.documentElement.getAttribute(LANDING_SESSION_ATTRIBUTE)
  return session === 'member' || session === 'pending'
}

export interface ScreenGateProps {
  screen: ScreenName
  /**
   * The gate's reads, by name: the body appears once every one has reported settled through
   * `useScreenGateRead`. Ignored when `ready` is given.
   */
  reads?: readonly string[]
  /** The gate's readiness, for a page that holds its reads itself. */
  ready?: boolean
  /** Sizing and surface of the placeholder block on this tab. */
  placeholderClassName?: string
  children: ReactNode
}

/**
 * D5: before the first paint of a client-side mount, the window goes to this tab's last scroll
 * offset, or to the top on a first visit (the bottom nav links keep the window where it was).
 * Hydration leaves scrolling to the browser. While the tab is open for a member, its offset is
 * kept for the next return.
 */
function useScreenScroll({
  screen,
  scope,
  open,
  fromSnapshot,
  hydrating,
}: {
  screen: ScreenName
  scope: string | null
  open: boolean
  fromSnapshot: boolean
  hydrating: boolean
}) {
  const hydratedAtMount = useRef(hydrating)
  const scopeAtMount = useRef(scope)
  useLayoutEffect(() => {
    if (hydratedAtMount.current) return
    const offset = fromSnapshot
      ? (screenSnapshot.recallScroll(scopeAtMount.current, screen) ?? 0)
      : 0
    window.scrollTo(0, offset)
  }, [fromSnapshot, screen])

  // A layout effect, so the listener leaves in the commit that removes the tab, before the next
  // tab's own scroll restore can be recorded here.
  useLayoutEffect(() => {
    if (!open || scope === null) return
    let frame = 0
    const record = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        // The store drops an offset whose scope is no longer live.
        screenSnapshot.rememberScroll(scope, screen, window.scrollY)
      })
    }
    window.addEventListener('scroll', record, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', record)
    }
  }, [open, scope, screen])
}

/**
 * Codex review P2-2: whether the gate is open, which its reads decide (`openFromReads`) or
 * `SCREEN_GATE_DEADLINE_MS` after the gate started waiting for `ownerKey`. Hydration starts no
 * timer; another member waits afresh.
 */
function useGateOpen(
  ownerKey: string,
  hydrating: boolean,
  openFromReads: boolean
): boolean {
  const waiting = !hydrating && !openFromReads
  const [expiredFor, setExpiredFor] = useState<string | null>(null)
  useEffect(() => {
    if (!waiting) return
    const timer = window.setTimeout(
      () => setExpiredFor(ownerKey),
      SCREEN_GATE_DEADLINE_MS
    )
    return () => window.clearTimeout(timer)
  }, [ownerKey, waiting])
  return openFromReads || expiredFor === ownerKey
}

/**
 * Each read's last report, keyed by the member it was reported for, so a report for a member who
 * left never opens the gate for the next one. `ready`, when given, decides instead.
 */
function useGateReads(
  ownerKey: string,
  reads: readonly string[] | undefined,
  ready: boolean | undefined
) {
  const ownerKeyRef = useRef(ownerKey)
  ownerKeyRef.current = ownerKey
  const [settled, setSettled] = useState<Readonly<Record<string, boolean>>>({})
  const report = useCallback((read: string, value: boolean) => {
    const key = `${ownerKeyRef.current}\u0000${read}`
    setSettled((previous) =>
      previous[key] === value ? previous : { ...previous, [key]: value }
    )
  }, [])
  const readsSettled =
    ready ?? (reads ?? []).every((read) => settled[`${ownerKey}\u0000${read}`] === true)
  return { report, readsSettled }
}

export function ScreenGate({
  screen,
  reads,
  ready,
  placeholderClassName = 'min-h-[60vh] w-full rounded-[16px] bg-[var(--screen-placeholder-surface)]',
  children,
}: ScreenGateProps) {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  const hydrating = useHydrating()
  const session = useWebSession()
  const scope = useWebSessionScope()
  const ownerKey = scope ?? NO_MEMBER_SCOPE

  // D5: a tab this member saw settle in this session opens at once. Hydration never does: the
  // snapshot lives in memory, so a document that hydrates has none.
  const [fromSnapshot] = useState(
    () => !hydrating && scope !== null && screenSnapshot.isSettled(scope, screen)
  )

  const { report, readsSettled } = useGateReads(ownerKey, reads, ready)

  // Once open for a member, the gate stays open while that member refreshes: a refresh never
  // brings the placeholder back. Another member starts closed again.
  const [openedFor, setOpenedFor] = useState<string | null>(
    fromSnapshot ? ownerKey : null
  )
  const openFromReads =
    openedFor === ownerKey ||
    readsSettled ||
    // D3: a signed-out session opens every gate at once, and a session check that failed
    // shows each section's own error and retry.
    session.status === 'signed_out' ||
    session.status === 'unavailable'
  const open = useGateOpen(ownerKey, hydrating, openFromReads)

  useLayoutEffect(() => {
    if (!open) return
    if (openedFor !== ownerKey) setOpenedFor(ownerKey)
    // Only reads that settled mark the tab settled: a return after the deadline waits again.
    if (readsSettled && session.status === 'signed_in' && isLiveScope(scope))
      screenSnapshot.markSettled(scope, screen)
  }, [open, readsSettled, openedFor, ownerKey, scope, screen, session.status])

  useScreenScroll({ screen, scope, open, fromSnapshot, hydrating })

  const context = useMemo(
    () => ({ screen, ownerKey, report, open }),
    [screen, ownerKey, report, open]
  )

  // Hydration renders exactly what the server did; globals.css decides from `data-session`.
  // After that the attributes say the same thing, so the page also holds without the styles.
  const holdsSession = !hydrating && htmlHoldsSession()
  const showPlaceholder = !hydrating && !open && holdsSession
  const hideBody = !hydrating && !open && holdsSession

  return (
    <div
      data-testid="screen-gate"
      data-screen={screen}
      data-screen-gate=""
      data-ready={open ? 'true' : undefined}
    >
      <div
        data-testid="screen-placeholder"
        data-screen-placeholder=""
        aria-busy="true"
        hidden={hydrating ? undefined : !showPlaceholder}
        className={placeholderClassName}
      >
        <span className="sr-only">{t('session.loading')}</span>
      </div>
      <ScreenGateContext.Provider value={context}>
        <div data-screen-body="" hidden={hideBody || undefined}>
          {children}
        </div>
      </ScreenGateContext.Provider>
    </div>
  )
}
