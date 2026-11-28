// Story 4.1 & 4.2 owner: implement web wardrobe hub page with capture and smart tagging
// Story 4.1 Task 8 step 2 owner: implement web wardrobe hub page in `apps/web/src/app/wardrobe/page.tsx`
// Story 4.4 Task 5 owner: "Set up your closet" onboarding entry card and the
// silhouette settings surface reachable outside onboarding (decision 3).
// Story CC-7.9 D6, D7, D9: the shared top bar and page surface; the three header actions sit on
// the body's first row, the closet is a section holding one level of garment cards, and every
// member-facing string comes from the catalogs.
'use client'

import Link from 'next/link'
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useSyncExternalStore,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { I18nextProvider, useTranslation } from 'react-i18next'
import {
  wardrobeOnboardingStepEnum,
  type GarmentItemContract,
  type GarmentWithTags,
  type WardrobeOnboardingStep,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { GarmentCaptureModal } from '../components/garment-capture-modal'
import { GarmentTaggingModal } from '../components/garment-tagging-modal'
import { AppPage, APP_MAIN_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { NavRow } from '../components/nav-row'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import {
  listGarmentsFromWeb,
  getOnboardingStateFromWeb,
  resolveCurrentUserId,
} from '../../lib/wardrobe'
import { readStorage, WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import { hasAppHistoryBelow } from '../../lib/app-history'
import { LANDING_SESSION_ATTRIBUTE } from '../../lib/landing-session'
import { hasStoredWebSession } from '../../lib/web-session'
import { useRetryOnVerifiedSession } from '../../lib/session-retry'
import {
  currentWebSessionBearer,
  currentWebSessionOwner,
  currentWebSessionScope,
  useHydrating,
  useWebSessionOwner,
} from '../../lib/use-web-session'
import {
  formatGarmentAlt,
  formatGarmentTagLabels,
  getGuestPreviewStrings,
  filterCloset,
  resetUnavailableClosetSubtype,
  type ClosetGarmentFilter,
  nextStylePiecePhotoExpiry,
  scheduleStylePiecePhotoExpiry,
  type StylePieceSelection,
} from '@couture/utils'
import { StylePiecePanel } from './style-piece-panel'
import { ClosetMoreMenu } from './closet-more-menu'
import { GarmentDetail, garmentPhotoAlt, type ClosetGarment } from './garment-detail'
import { useGarmentDeletion, type GarmentDeleteMode } from './garment-deletion'
import { SaveFeedbackProvider, useStatusBar } from '../components/save-feedback'
import { ScreenGate } from '../components/screen-gate'
import { screenSnapshot } from '../../lib/screen-snapshot'

/** D2: the open garment detail lives in the URL, so a reload reopens it. */
const GARMENT_DETAIL_PARAM = 'garment'

/** The history entry key that marks an entry this page pushed for an open detail. */
const GARMENT_DETAIL_HISTORY_KEY = 'garmentDetail'

function readHistoryState(): Record<string, unknown> {
  const state: unknown = window.history.state
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
}

/**
 * Reports the `garment` search param. It reads `useSearchParams`, which Next keeps in sync with
 * native History API calls and with browser Back and Forward, so it renders inside its own
 * Suspense boundary and the closet itself still prerenders.
 */
function GarmentDetailParamSync({
  onChange,
}: {
  onChange: (garmentId: string | null) => void
}) {
  const garmentId = useSearchParams()?.get(GARMENT_DETAIL_PARAM) || null
  useEffect(() => onChange(garmentId), [garmentId, onChange])
  return null
}

/** The internal load-error sentinels; the screen shows their catalog text. */
const WARDROBE_LOAD_FAILED = 'Unable to load your wardrobe.'
const WARDROBE_REFRESH_FAILED = 'Unable to refresh your wardrobe.'

const STATUS_ACTION_CLASS =
  'flex min-h-touch min-w-touch max-w-full items-center self-start rounded-md text-left'

const GARMENT_STATUS_BADGES = {
  awaiting_tags: {
    tone: 'bg-notice-surface text-notice-ink',
    path: 'M20 13l-7 7L4 11V4h7zM8 8h.01',
  },
  failed: {
    tone: 'bg-danger-surface text-danger-ink',
    path: 'M12 3 2 20h20zM12 9v4m0 3h.01',
  },
  processing: {
    tone: 'bg-card-muted text-ink-soft',
    path: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  },
} as const

type ActionableStatus = keyof typeof GARMENT_STATUS_BADGES

function GarmentStatusBadge({ status }: { status: ActionableStatus }) {
  const { t } = useTranslation()
  const { tone, path } = GARMENT_STATUS_BADGES[status]
  return (
    <span
      data-testid={`garment-status-${status}`}
      className={`inline-flex w-fit max-w-full items-center gap-1 rounded-md border border-current px-1 py-0.5 text-xs font-semibold ${tone}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {t(`wardrobe.hub.status.${status}`)}
      </span>
    </span>
  )
}

/** The visible card label: localized category and material, or "Untagged garment". */
function garmentCardLabel(locale: string, garment: ClosetGarment): string {
  if (!garment.category) return formatGarmentAlt(locale, { category: null })
  const labels = formatGarmentTagLabels(locale, garment)
  return [labels.category, labels.material].filter(Boolean).join(' · ')
}

export default function WardrobePage() {
  const owner = useWebSessionOwner()
  const visitor = useClosetVisitor(owner)
  return (
    <I18nextProvider i18n={getI18n()}>
      <ClosetStatusBar>
        <WardrobeHubView key={owner} owner={owner} visitor={visitor} />
      </ClosetStatusBar>
    </I18nextProvider>
  )
}

function subscribeLandingSession(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [LANDING_SESSION_ATTRIBUTE],
  })
  return () => observer.disconnect()
}

const readLandingAttribute = () =>
  document.documentElement.getAttribute(LANDING_SESSION_ATTRIBUTE)

/**
 * Whether this page has seen any sign of a session: the landing attribute naming a member or a
 * stored session still to verify, stored credentials, or a member holding the Closet. It reads
 * the browser only, so the server render (and the hydration render) says no.
 */
function sawSessionEvidence(owner: string | null, landing: string | null): boolean {
  if (owner !== null || landing === 'member' || landing === 'pending') return true
  return typeof window !== 'undefined' && hasStoredWebSession()
}

/**
 * Story CC-7.9 add-on B: a visitor who never signed in. The pre-paint landing attribute says no
 * session (`none`), and this page saw no evidence of one since it mounted. Such a visitor has no
 * session that expired and no account that failed to load, so the Closet shows none of those
 * errors; it offers sign-in instead. Evidence (review P2-2) is a `member` or `pending` landing
 * attribute, stored credentials or a member holding the Closet. A returning member whose stored
 * session is refused or expires before verification names them, and a member whose session ends
 * while the Closet is open, keep "Your session expired". The evidence lives here, above the
 * owner-keyed view, so a remount for a new owner keeps it; it holds a flag and no member data.
 */
function useClosetVisitor(owner: string | null): boolean {
  const landing = useSyncExternalStore(
    subscribeLandingSession,
    readLandingAttribute,
    () => null
  )
  const [hadSession, setHadSession] = useState(() =>
    sawSessionEvidence(
      owner,
      typeof document === 'undefined' ? null : readLandingAttribute()
    )
  )
  useEffect(() => {
    if (sawSessionEvidence(owner, landing)) setHadSession(true)
  }, [owner, landing])
  return owner === null && landing === 'none' && !hadSession
}

/**
 * The root layout provides the CC-7.1 status bar; a Closet rendered without it (an isolated
 * mount) brings its own, so the delete's Deleted, Undo and Retry notices always show.
 */
function ClosetStatusBar({ children }: { children: React.ReactNode }) {
  const { hasProvider } = useStatusBar()
  if (hasProvider) return <>{children}</>
  return (
    <SaveFeedbackProvider inline renderOfflineLine={false}>
      {children}
    </SaveFeedbackProvider>
  )
}

function WardrobeLoadError({
  visitor,
  loadError,
  hasGarments,
  isLoading,
  strings,
  onRetry,
}: {
  /** A visitor who never signed in has no closet read that failed (add-on B). */
  visitor: boolean
  loadError: string | null
  hasGarments: boolean
  isLoading: boolean
  strings: ReturnType<typeof getGuestPreviewStrings>
  onRetry: () => void
}) {
  const { t } = useTranslation()
  if (visitor || !loadError) return null
  return (
    <div
      role="alert"
      className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger-line bg-danger-surface p-3 text-sm text-danger-ink"
    >
      <div>
        {hasGarments && <p>{strings.firstUse.staleWardrobe}</p>}
        <p>
          {loadError === WARDROBE_LOAD_FAILED
            ? strings.firstUse.wardrobeFailed
            : loadError === WARDROBE_REFRESH_FAILED
              ? t('wardrobe.hub.refreshFailed')
              : loadError}
        </p>
      </div>
      <button
        type="button"
        className="min-h-11 px-2 font-semibold underline"
        data-testid="wardrobe-list-retry"
        disabled={isLoading}
        onClick={onRetry}
      >
        {strings.chrome.retry}
      </button>
    </div>
  )
}

function GarmentCardPhoto({
  garment,
  locale,
}: {
  garment: ClosetGarment
  locale: string
}) {
  if (!garment.imageAccess) {
    return (
      <div
        role="img"
        aria-label={garmentPhotoAlt(locale, garment)}
        className="flex aspect-[4/3] w-full items-center justify-center text-3xl"
      >
        <span aria-hidden="true">👗</span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={garment.imageAccess.url}
      alt={garmentPhotoAlt(locale, garment)}
      className="aspect-[4/3] w-full object-cover"
    />
  )
}

function WardrobeEmptyState({
  visitor,
  isLoading,
  hasLoaded,
  loadError,
  openCapture,
}: {
  /** A visitor who never signed in sees the sign-in offer in its place (add-on B). */
  visitor: boolean
  isLoading: boolean
  hasLoaded: boolean
  loadError: string | null
  openCapture: (opener: HTMLElement) => void
}) {
  const { t } = useTranslation()
  if (visitor) return <ClosetVisitorOffer />
  // Only the first read says it is loading: a refresh (a return to the Closet, a retry after
  // tags) keeps the empty state in place until its answer replaces it (CC-7.7 D5).
  if (isLoading && !hasLoaded)
    return (
      <p role="status" className="mt-8 text-center text-sm text-ink-muted">
        {t('wardrobe.hub.loading')}
      </p>
    )
  if (!hasLoaded || loadError) return null
  return (
    // CC-7.10: the empty-closet anchor the screen budget measures Closet chrome to.
    <div
      data-testid="closet-empty-state"
      className="mt-8 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-line py-12 text-center"
    >
      <div aria-hidden="true" className="text-3xl">
        🧥
      </div>
      <h3 className="mt-3 text-base font-semibold text-ink">
        {t('wardrobe.hub.emptyTitle')}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">
        {t('wardrobe.hub.emptyBody')}
      </p>
      {/* D3: + Add Garment in the first row is the screen's one gold action, so this is neutral. */}
      <button
        onClick={(event) => openCapture(event.currentTarget)}
        className="mt-4 min-h-11 rounded-lg border border-line-strong bg-page px-4 py-2 text-sm font-semibold text-ink"
      >
        {t('wardrobe.hub.emptyAction')}
      </button>
    </div>
  )
}

/**
 * Story CC-7.11 D4: the Closet's one primary, in the top bar's trailing slot. It shows the short
 * "+ Add" so the title keeps its room in long locales; its accessible name stays the full label.
 */
const ADD_GARMENT_CLASS =
  'flex min-h-touch min-w-touch items-center justify-center rounded-lg bg-primary px-2 py-1 text-sm font-semibold text-on-primary [overflow-wrap:anywhere]'

/**
 * The Closet's one primary action. Adding a garment is a member action, so for a visitor who
 * never signed in it leads to sign-in (add-on B).
 */
function AddGarmentAction({
  visitor,
  buttonRef,
  onOpen,
}: {
  visitor: boolean
  buttonRef: React.RefObject<HTMLButtonElement | null>
  onOpen: (opener: HTMLElement) => void
}) {
  const { t } = useTranslation()
  if (visitor)
    return (
      <Link
        href="/signin"
        data-testid="garment-capture-open"
        data-gold="primary"
        aria-label={t('wardrobe.hub.addGarment')}
        className={ADD_GARMENT_CLASS}
      >
        {`+ ${t('wardrobe.menu.add')}`}
      </Link>
    )
  return (
    <button
      ref={buttonRef}
      data-testid="garment-capture-open"
      data-gold="primary"
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={t('wardrobe.hub.addGarment')}
      className={ADD_GARMENT_CLASS}
    >
      {`+ ${t('wardrobe.menu.add')}`}
    </button>
  )
}

/**
 * Add-on B: the visitor's Closet. It sits where the empty closet would, the last block of the
 * closet section, so it moves nothing when the signed-out page learns there is no member.
 */
function ClosetVisitorOffer() {
  const { t } = useTranslation()
  return (
    <div
      data-testid="wardrobe-visitor-offer"
      className="mt-8 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-line py-12 text-center"
    >
      <div aria-hidden="true" className="text-3xl">
        🧥
      </div>
      <p className="mt-3 max-w-sm text-sm text-ink-muted">
        {t('wardrobe.hub.emptyBody')}
      </p>
      <Link
        href="/signin"
        data-testid="wardrobe-sign-in"
        className="mt-4 flex min-h-11 items-center rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink"
      >
        {t('community.notifications.signin')}
      </Link>
    </div>
  )
}

function readLiveWebBearer(): string | null {
  return (
    currentWebSessionBearer() ??
    readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ??
    null
  )
}

function withoutPendingDeletes(
  garments: ClosetGarment[],
  pendingIds: ReadonlySet<string>
): ClosetGarment[] {
  if (pendingIds.size === 0) return garments
  return garments.filter((garment) => !pendingIds.has(garment.id))
}

function findReadyGarment(
  garments: readonly ClosetGarment[],
  garmentId: string | null
): ClosetGarment | null {
  if (!garmentId) return null
  return (
    garments.find((garment) => garment.id === garmentId && garment.status === 'ready') ??
    null
  )
}

/**
 * D2: `/wardrobe?garment=<id>` opens the detail in place. Opening pushes a history entry, so
 * the browser Back button and the detail's back control both return to the grid at the
 * scroll position the member left, with focus on the card they opened.
 */
function useGarmentDetailRoute(
  garmentOpenRefs: React.RefObject<Map<string, HTMLButtonElement>>
) {
  const [detailGarmentId, setDetailGarmentId] = useState<string | null>(null)
  const gridScrollRef = useRef(0)
  const lastDetailIdRef = useRef<string | null>(null)
  // Story CC-7.6 D7: after a delete the opened card is gone, so focus goes elsewhere.
  const focusAfterCloseRef = useRef<(() => HTMLElement | null) | null>(null)

  const paramSync = (
    <Suspense fallback={null}>
      <GarmentDetailParamSync onChange={setDetailGarmentId} />
    </Suspense>
  )

  // Back returns to the grid where the member left it, with focus on the card they opened.
  useLayoutEffect(() => {
    const previous = lastDetailIdRef.current
    lastDetailIdRef.current = detailGarmentId
    if (detailGarmentId) {
      if (!previous) window.scrollTo(0, 0)
      return
    }
    if (!previous) return
    window.scrollTo(0, gridScrollRef.current)
    const focusAfterClose = focusAfterCloseRef.current
    focusAfterCloseRef.current = null
    const target = focusAfterClose
      ? focusAfterClose()
      : garmentOpenRefs.current.get(previous)
    target?.focus({ preventScroll: true })
  }, [detailGarmentId, garmentOpenRefs])

  const openGarmentDetail = (garmentId: string) => {
    gridScrollRef.current = window.scrollY
    const url = new URL(window.location.href)
    url.searchParams.set(GARMENT_DETAIL_PARAM, garmentId)
    // The entry records that this page pushed it, so the detail's back control can step back
    // to the grid entry even after browser Back and Forward. Only app-owned state is passed:
    // Next adds its own router state to a native History API call and syncs the URL.
    window.history.pushState({ [GARMENT_DETAIL_HISTORY_KEY]: garmentId }, '', url)
    setDetailGarmentId(garmentId)
  }

  /**
   * `focusTarget` (CC-7.6 D7) closes the grid at once and moves focus to what it returns; the
   * delete passes it because the card the member opened is no longer in the grid.
   */
  const closeGarmentDetail = (focusTarget?: () => HTMLElement | null) => {
    if (focusTarget) {
      focusAfterCloseRef.current = focusTarget
    }
    if (hasAppHistoryBelow() && readHistoryState()[GARMENT_DETAIL_HISTORY_KEY]) {
      // Back lands on the grid entry; the search param sync closes the detail, so browser Back
      // and this control agree. A delete closes at once so the detail never shows the piece
      // as missing while the history step lands.
      window.history.back()
      if (focusTarget) setDetailGarmentId(null)
      return
    }
    // A direct link or reload starts the document at the detail. Replace it with the grid.
    const url = new URL(window.location.href)
    url.searchParams.delete(GARMENT_DETAIL_PARAM)
    window.history.replaceState(null, '', url)
    setDetailGarmentId(null)
  }

  return { detailGarmentId, openGarmentDetail, closeGarmentDetail, paramSync }
}

/**
 * Story CC-7.7 D5: the Closet a member last saw, for a return in the same session. Memory only
 * (lib/screen-snapshot.ts); every read runs again on the return and replaces it in place.
 */
type ClosetSnapshot = {
  garments: ClosetGarment[]
  onboardingStep: WardrobeOnboardingStep | null
  onboardingStatusError: boolean
  userId: string | null
  userIdError: boolean
}

const CLOSET_SNAPSHOT_PART = 'closet'

const EMPTY_CLOSET: ClosetSnapshot = {
  garments: [],
  onboardingStep: null,
  onboardingStatusError: false,
  userId: null,
  userIdError: false,
}

/**
 * Where a Closet mount starts: this member's snapshot on a return, else nothing loaded. `scope`
 * is the session scope at mount (Codex review P2-1), what a fixture bearer switch is told by.
 */
function useClosetStart(owner: string | null): {
  restored: boolean
  start: ClosetSnapshot
  scope: string | null
} {
  const hydrating = useHydrating()
  const [start] = useState(() => {
    const scope = owner ? currentWebSessionScope() : null
    const snapshot =
      hydrating || !owner
        ? undefined
        : screenSnapshot.recall<ClosetSnapshot>(scope, 'closet', CLOSET_SNAPSHOT_PART)
    return { restored: snapshot !== undefined, start: snapshot ?? EMPTY_CLOSET, scope }
  })
  return start
}

/**
 * Story CC-7.7 D3: the Closet body appears once the closet has answered for the member (CC-7.12
 * D8: saved looks left the Closet for Looks). Story CC-7.11 (TEA d): the setup progress only names the More menu's Closet setup
 * item, which updates in place in the top bar, and the account and setup notices sit below the
 * closet, so neither read holds the grid back and nothing is inserted above it afterwards.
 */
function closetGateReady(reads: {
  owner: string | null
  hasLoaded: boolean
  loadError: string | null
}): boolean {
  return reads.owner !== null && (reads.hasLoaded || reads.loadError !== null)
}

/**
 * The account and setup-progress notices. They answer after the gate opens (Story CC-7.11, TEA
 * d), so they sit below the closet, where nothing moves for them (CC-7.7 D3 amendment, prod
 * baseline Closet 0.1157).
 */
function ClosetAccountNotices({
  visitor,
  userIdError,
  onboardingStatusError,
  onRetryOnboarding,
}: {
  /** A visitor who never signed in has no account or setup to fail (add-on B). */
  visitor: boolean
  userIdError: boolean
  onboardingStatusError: boolean
  onRetryOnboarding: () => void
}) {
  const { t } = useTranslation()
  if (visitor) return null
  return (
    <div className="mt-6">
      {userIdError && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-danger-line bg-danger-surface p-3 text-sm text-danger-ink"
        >
          {t('wardrobe.hub.accountFailed')}
        </p>
      )}

      {onboardingStatusError && (
        <div
          role="alert"
          className="mb-6 flex min-h-11 items-center justify-between rounded-xl border border-danger-line bg-danger-surface px-6 py-4 text-sm text-danger-ink"
        >
          <span>{t('wardrobe.hub.setupFailed')}</span>
          <button
            type="button"
            onClick={onRetryOnboarding}
            className="min-h-11 font-semibold underline"
          >
            {t('feedback.retry')}
          </button>
        </div>
      )}
    </div>
  )
}

function WardrobeHubView({ owner, visitor }: { owner: string | null; visitor: boolean }) {
  const { t, i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const { restored, start, scope: startScope } = useClosetStart(owner)
  /** The session scope of the closet read whose garments are on screen (Codex review P2-1). */
  const shownScopeRef = useRef<string | null>(startScope)
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)
  const [garments, setGarments] = useState<ClosetGarment[]>(start.garments)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [hasLoaded, setHasLoaded] = useState(restored)
  const listController = useRef<AbortController | null>(null)
  const inventoryVersion = useRef(0)
  const loadAfterTags = useRef(false)
  const [garmentError, setGarmentError] = useState<string | null>(null)
  const [confirmedGarment, setConfirmedGarment] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState<WardrobeOnboardingStep | null>(
    start.onboardingStep
  )
  /**
   * CodeRabbit r2 #10: one sequence for the automatic onboarding read and Retry. Each read takes
   * the next number when it starts, and only the latest one may set the onboarding state, so an
   * older answer (or failure) never overwrites a newer one.
   */
  const onboardingRequestRef = useRef(0)
  const [onboardingStatusError, setOnboardingStatusError] = useState(
    start.onboardingStatusError
  )
  const [userId, setUserId] = useState<string | null>(start.userId)
  const [userIdError, setUserIdError] = useState(start.userIdError)
  const [styleSelection, setStyleSelection] = useState<StylePieceSelection | null>(null)
  const styleInvoker = useRef<HTMLButtonElement | null>(null)
  const [, updatePhotoClock] = useState(0)
  const photoExpiry = nextStylePiecePhotoExpiry(garments, Date.now())
  useEffect(
    () =>
      scheduleStylePiecePhotoExpiry(photoExpiry, () =>
        updatePhotoClock((clock) => clock + 1)
      ),
    [photoExpiry]
  )
  const loadInventory = useCallback(
    async (signal: AbortSignal) => {
      // Give a superseded request one fresh read, including any missing garments.
      let scopeChanged = false
      for (let attempt = 0; attempt < 2; attempt++) {
        const version = inventoryVersion.current
        const scope = currentWebSessionScope()
        const items = await listGarmentsFromWeb(signal)
        if (signal.aborted || currentWebSessionOwner() !== owner) return null
        // Codex review P2-1: e2e fixture bearers share one owner, so a closet read with the
        // last fixture bearer is dropped and read again with the bearer the tab holds now. An
        // unchanged scope counts, a null one included: a closet read with no member (the
        // signed-out hub) has no other member's rows to land.
        scopeChanged = scope !== currentWebSessionScope()
        if (scopeChanged) continue
        // A completed refresh or local update may be newer than this snapshot.
        if (version !== inventoryVersion.current) continue
        shownScopeRef.current = scope
        inventoryVersion.current++
        setGarments(items)
        setLoadError(null)
        setHasLoaded(true)
        return items
      }
      // The session moved again under the fresh read: the load error and its Retry show, never
      // a blank closet behind a gate that waits for nothing.
      if (scopeChanged)
        throw new Error(
          loadAfterTags.current ? WARDROBE_REFRESH_FAILED : WARDROBE_LOAD_FAILED
        )
      return null
    },
    [owner]
  )

  const garmentOpenRefs = useRef(new Map<string, HTMLButtonElement>())
  const { detailGarmentId, openGarmentDetail, closeGarmentDetail, paramSync } =
    useGarmentDetailRoute(garmentOpenRefs)

  const handleDetailTagsSaved = (updated: GarmentWithTags, startedVersion?: number) => {
    // A closet read that landed while the save was in flight is newer than this answer for
    // every other field, so keep it and read again instead of applying a stale row.
    if (startedVersion !== undefined && startedVersion !== inventoryVersion.current) {
      setLoadAttempt((attempt) => attempt + 1)
      return
    }
    inventoryVersion.current++
    setGarments((current) =>
      current.map((item) =>
        item.id === updated.id
          ? // A photo the API could not sign this time keeps the one already shown, which
            // still renews on expiry or on a load error.
            { ...updated, imageAccess: updated.imageAccess ?? item.imageAccess }
          : item
      )
    )
  }

  const closetHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const { pendingIds: pendingDeleteIds, requestDelete } = useGarmentDeletion({
    owner,
    readBearer: readLiveWebBearer,
    onCommitted: (garmentId) => {
      inventoryVersion.current++
      setGarments((current) => current.filter((item) => item.id !== garmentId))
    },
  })
  // A piece inside its Undo window, or being sent, is hidden from the grid and the detail.
  const visibleGarments = withoutPendingDeletes(garments, pendingDeleteIds)
  const [closetFilter, setClosetFilter] = useState<ClosetGarmentFilter>({
    category: 'all',
    subtype: 'all',
  })
  // The accepted inventory retains pieces during an in-flight read or delete Undo window.
  useEffect(() => {
    if (hasLoaded) {
      setClosetFilter((filter) => resetUnavailableClosetSubtype(filter, garments))
    }
  }, [garments, hasLoaded])
  const { filterChips, filteredGarments } = filterCloset(
    visibleGarments,
    closetFilter,
    i18n.language,
    t('wardrobe.hub.categoryAll')
  )

  /**
   * D7: the detail closes to the grid at its saved scroll position, and focus moves to the next
   * card, else the previous one, else the grid heading.
   */
  const handleDetailDelete = (garmentId: string, mode: GarmentDeleteMode) => {
    const order = visibleGarments.map((garment) => garment.id)
    const index = order.indexOf(garmentId)
    const neighbours =
      index < 0 ? [] : [...order.slice(index + 1), ...order.slice(0, index).reverse()]
    requestDelete(garmentId, mode)
    closeGarmentDetail(() => {
      // The next or previous card's detail opener; a card still processing has none (its
      // only button checks the upload), so it is skipped.
      for (const id of neighbours) {
        const opener = garmentOpenRefs.current.get(id)
        if (opener?.isConnected) return opener
      }
      return closetHeadingRef.current
    })
  }

  const detailGarment = findReadyGarment(visibleGarments, detailGarmentId)

  const addGarmentButtonRef = useRef<HTMLButtonElement | null>(null)
  const captureInvokerRef = useRef<HTMLElement | null>(null)
  const taggingInvokerRef = useRef<HTMLElement | null>(null)
  const taggingButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingTaggingGarmentIdRef = useRef<string | null>(null)
  const isCaptureOpenRef = useRef(false)
  const pollingControllerRef = useRef<AbortController | null>(null)
  const batchPollingControllerRef = useRef<AbortController | null>(null)
  const batchPendingIds = useRef(new Set<string>())
  const directEntryConsumed = useRef(false)
  /**
   * The account, setup progress and closet reads below run once at mount. One that ran before
   * this tab held a verified bearer (a new tab, a mount while verification still runs) reads
   * again when the verified identity is published, instead of leaving "Your session expired".
   */
  const { attempt: sessionAttempt, missed: missedSession } = useRetryOnVerifiedSession()
  /** Reads the account and setup progress again after an answer for a scope that left. */
  const [accountReadAttempt, setAccountReadAttempt] = useState(0)

  useEffect(() => {
    isCaptureOpenRef.current = isCaptureModalOpen
  }, [isCaptureModalOpen])

  /**
   * The user id is not optional: the Silhouette button below stays disabled
   * until it resolves, so a failure has to be surfaced or the button is
   * disabled forever with no explanation. The onboarding entry card used to
   * treat its own fetch as best-effort and swallow a failure silently, but an
   * incomplete user who hits a transient network blip would then lose their
   * only visible route back into a required setup flow with no way to know
   * it happened; it gets the same visible-error-with-retry treatment.
   */
  useEffect(() => {
    const controller = new AbortController()
    // Codex review P2-1, like the closet read: an answer read for a session scope the tab no
    // longer holds (a fixture bearer switch) is dropped and read again for the one it holds now.
    const scope = currentWebSessionScope()
    const sameScope = () => {
      if (scope === currentWebSessionScope()) return true
      setAccountReadAttempt((attempt) => attempt + 1)
      return false
    }
    setUserIdError(false)
    void resolveCurrentUserId()
      .then((id) => {
        if (!controller.signal.aborted && sameScope()) {
          setUserId(id)
        }
      })
      .catch(() => {
        if (controller.signal.aborted || !sameScope()) return
        setUserIdError(true)
        missedSession()
      })
    const onboardingRequest = ++onboardingRequestRef.current
    const latestOnboarding = () => onboardingRequest === onboardingRequestRef.current
    void getOnboardingStateFromWeb(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted && latestOnboarding() && sameScope()) {
          setOnboardingStep(state.currentStep)
          setOnboardingStatusError(false)
        }
      })
      .catch(() => {
        if (controller.signal.aborted || !latestOnboarding() || !sameScope()) return
        setOnboardingStatusError(true)
        missedSession()
      })
    return () => controller.abort()
  }, [sessionAttempt, missedSession, accountReadAttempt])

  const retryOnboardingStatus = () => {
    const scope = currentWebSessionScope()
    const request = ++onboardingRequestRef.current
    const latest = () => request === onboardingRequestRef.current
    setOnboardingStatusError(false)
    void getOnboardingStateFromWeb()
      .then((state) => {
        if (!latest()) return
        if (scope === currentWebSessionScope()) setOnboardingStep(state.currentStep)
        else setAccountReadAttempt((attempt) => attempt + 1)
      })
      .catch(() => {
        if (!latest()) return
        if (scope === currentWebSessionScope()) setOnboardingStatusError(true)
        else setAccountReadAttempt((attempt) => attempt + 1)
      })
  }

  useEffect(() => {
    pollingControllerRef.current?.abort()
    const controller = new AbortController()
    listController.current = controller
    setIsLoading(true)
    void loadInventory(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : loadAfterTags.current
                ? WARDROBE_REFRESH_FAILED
                : WARDROBE_LOAD_FAILED
          )
          missedSession()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false)
          loadAfterTags.current = false
        }
      })
    return () => controller.abort()
  }, [sessionAttempt, missedSession, loadAttempt, loadInventory])

  useEffect(
    () => () => {
      pollingControllerRef.current?.abort()
      batchPollingControllerRef.current?.abort()
    },
    []
  )

  const openCapture = (invoker: HTMLElement) => {
    captureInvokerRef.current = invoker
    setIsCaptureModalOpen(true)
  }

  const openTagging = (garmentId: string, invoker?: HTMLElement | null) => {
    taggingInvokerRef.current =
      invoker ??
      taggingButtonRefs.current.get(garmentId) ??
      (captureInvokerRef.current?.isConnected ? captureInvokerRef.current : null) ??
      addGarmentButtonRef.current
    setTaggingGarmentId(garmentId)
  }

  const waitForPoll = (delayMs: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const abort = () => {
        window.clearTimeout(timer)
        reject(new DOMException('Polling aborted', 'AbortError'))
      }
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, delayMs)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })

  const settleBatchRows = (persisted: GarmentItemContract[] | null) => {
    for (const garment of persisted ?? []) {
      if (garment.status !== 'processing') batchPendingIds.current.delete(garment.id)
    }
    return batchPendingIds.current.size === 0
  }

  const pollCommittedGarment = (garmentId: string, batch = false) => {
    const poll = batch ? batchPollingControllerRef : pollingControllerRef
    poll.current?.abort()
    listController.current?.abort()
    setIsLoading(false)
    const controller = new AbortController()
    poll.current = controller
    setGarmentError(null)

    void (async () => {
      try {
        const startedAt = Date.now()
        const offsets = batch
          ? [0, 1_000, 2_000, 4_000, 8_000]
          : [1_000, 2_000, 4_000, 8_000]
        for (const offsetMs of offsets) {
          await waitForPoll(
            Math.max(0, startedAt + offsetMs - Date.now()),
            controller.signal
          )
          const persisted = await loadInventory(controller.signal)
          if (controller.signal.aborted || currentWebSessionOwner() !== owner) return
          if (batch) {
            if (settleBatchRows(persisted)) return
            continue
          }
          const current = persisted?.find((garment) => garment.id === garmentId)
          if (!current || current.status === 'processing') continue
          if (current.status === 'ready') setConfirmedGarment(true)
          if (current.status === 'awaiting_tags') {
            if (isCaptureOpenRef.current) {
              pendingTaggingGarmentIdRef.current = current.id
            } else {
              openTagging(current.id)
            }
          }
          return
        }
        setGarmentError(t('wardrobe.hub.taggingSlow'))
      } catch (error) {
        if (!controller.signal.aborted) {
          setGarmentError(
            error instanceof Error ? error.message : t('wardrobe.hub.statusRefreshFailed')
          )
        }
      }
    })()
  }

  useEffect(() => {
    if (!owner || !hasLoaded || isLoading || loadError || directEntryConsumed.current)
      return
    if (new URLSearchParams(window.location.search).get('entry') !== 'add') return
    directEntryConsumed.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete('entry')
    window.history.replaceState(null, '', url)
    const awaitingTags = garments.find((garment) => garment.status === 'awaiting_tags')
    if (awaitingTags) {
      openTagging(awaitingTags.id)
      return
    }
    // The processing row can be resumed without starting another upload.
    const isProcessing = garments.some((garment) => garment.status === 'processing')
    if (!isProcessing && addGarmentButtonRef.current)
      openCapture(addGarmentButtonRef.current)
  }, [garments, hasLoaded, isLoading, loadError, owner])

  const showCommittedGarment = (garment: GarmentItemContract) => {
    inventoryVersion.current++
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
  }

  const handleBatchGarmentCommitted = (garment: GarmentItemContract) => {
    showCommittedGarment(garment)
    batchPendingIds.current.add(garment.id)
    pollCommittedGarment(garment.id, true)
  }

  const handleGarmentCommitted = (garment: GarmentItemContract) => {
    showCommittedGarment(garment)
    if (garment.status === 'ready') setConfirmedGarment(true)
    if (garment.status === 'awaiting_tags') {
      pendingTaggingGarmentIdRef.current = garment.id
    } else if (garment.status === 'processing') {
      pollCommittedGarment(garment.id)
    }
  }

  const closeCapture = () => {
    setIsCaptureModalOpen(false)
    const pendingGarmentId = pendingTaggingGarmentIdRef.current
    pendingTaggingGarmentIdRef.current = null
    if (pendingGarmentId) {
      window.requestAnimationFrame(() => openTagging(pendingGarmentId))
    }
  }

  const handleTagsConfirmed = (updatedGarment: GarmentItemContract) => {
    const recordedButton = taggingButtonRefs.current.get(updatedGarment.id)
    if (
      !taggingInvokerRef.current?.isConnected ||
      taggingInvokerRef.current === recordedButton
    ) {
      taggingInvokerRef.current = addGarmentButtonRef.current
    }
    inventoryVersion.current++
    setGarments((current) =>
      current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
    )
    setTaggingGarmentId(null)
    setConfirmedGarment(true)
    loadAfterTags.current = true
    setLoadAttempt((attempt) => attempt + 1)
  }

  const closetReady = closetGateReady({
    owner,
    hasLoaded,
    loadError,
  })

  // Story CC-7.7 D5: what a return to the Closet shows first, for this member only.
  useEffect(() => {
    if (!owner || !hasLoaded) return
    // Under the scope its closet read started in; the store drops it once that scope left.
    screenSnapshot.remember(shownScopeRef.current, 'closet', CLOSET_SNAPSHOT_PART, {
      garments,
      onboardingStep,
      onboardingStatusError,
      userId,
      userIdError,
    } satisfies ClosetSnapshot)
  }, [
    garments,
    hasLoaded,
    onboardingStep,
    onboardingStatusError,
    owner,
    userId,
    userIdError,
  ])

  const noticeProps = {
    visitor,
    userIdError,
    onboardingStatusError,
    onRetryOnboarding: retryOnboardingStatus,
  }

  // D7: an open detail is a sub-screen: the top bar names the garment and its back closes it.
  const detailTitle = detailGarment
    ? garmentPhotoAlt(i18n.language, detailGarment)
    : t('wardrobe.hub.detailTitle')

  return (
    <>
      <AppPage>
        {paramSync}
        {detailGarmentId ? (
          <AppTopBar title={detailTitle} onBack={() => closeGarmentDetail()} />
        ) : (
          // Story CC-7.11 D4, D5: Closet opens on its grid. Add, the one primary, and the neutral
          // More menu sit in the top bar, outside the gate, so they never move when the closet
          // appears; Capsules moved to Looks, Silhouette and setup to More and Profile > Style.
          <AppTopBar
            titleKey="nav.closet"
            wrapTitle
            trailing={
              <div className="flex min-w-0 items-center justify-end gap-2">
                <AddGarmentAction
                  visitor={visitor}
                  buttonRef={addGarmentButtonRef}
                  onOpen={openCapture}
                />
                <ClosetMoreMenu setupDone={onboardingStep === 'complete'} />
              </div>
            }
          />
        )}

        <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
          <ScreenGate screen="closet" ready={closetReady}>
            {detailGarmentId && (
              <GarmentDetail
                garment={detailGarment}
                owner={owner}
                hasLoaded={hasLoaded}
                loadFailed={Boolean(loadError)}
                loading={isLoading}
                onDelete={handleDetailDelete}
                onTagSaveStart={() => inventoryVersion.current}
                onTagsSaved={handleDetailTagsSaved}
                onRefresh={() => setLoadAttempt((attempt) => attempt + 1)}
                onStylePiece={(selection, button) => {
                  styleInvoker.current = button
                  setStyleSelection(selection)
                }}
              />
            )}
            {/* D2: the grid stays mounted under the detail, so Back keeps its scroll and state. */}
            <div hidden={Boolean(detailGarmentId)} data-testid="wardrobe-closet-view">
              {/* D7: the closet is a section on the page; its garment cards are the one card level. */}
              <section aria-labelledby="wardrobe-closet-heading">
                {/* CC-7.11 D4: the visible heading and explainer left the space above the grid;
                    the heading stays for screen readers and as the focus target after a
                    delete. */}
                <h2
                  id="wardrobe-closet-heading"
                  ref={closetHeadingRef}
                  tabIndex={-1}
                  data-testid="wardrobe-closet-heading"
                  className="sr-only"
                >
                  {t('wardrobe.hub.closetTitle')}
                </h2>

                <WardrobeLoadError
                  visitor={visitor}
                  loadError={loadError}
                  hasGarments={visibleGarments.length > 0}
                  isLoading={isLoading}
                  strings={strings}
                  onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
                />
                {garmentError && (
                  <p role="alert" className="mt-4 text-sm text-ink">
                    {garmentError}
                  </p>
                )}
                {confirmedGarment && (
                  <Link
                    href="/"
                    className="inline-flex min-h-11 items-center text-sm text-ink underline"
                  >
                    {strings.firstUse.backToOutfit}
                  </Link>
                )}

                {visibleGarments.length > 0 && (
                  <div
                    role="group"
                    aria-label={t('wardrobe.hub.categoryFilters')}
                    data-testid="closet-category-filters"
                    className="mb-2 flex w-full gap-2 overflow-x-auto py-1"
                  >
                    {filterChips.map(({ id, kind, selected, label, filter }) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={selected}
                        data-testid={id}
                        className={`min-h-touch min-w-touch max-w-full shrink-0 border border-line-strong px-2 py-1 text-sm font-medium [overflow-wrap:anywhere] ${kind === 'category' ? 'rounded-full' : 'rounded-lg'} ${kind === 'subtype' && filter.subtype === 'all' ? 'ms-2' : ''} ${selected ? 'bg-inverse text-on-inverse' : 'bg-page text-ink'}`}
                        onClick={() => setClosetFilter(filter)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {filteredGarments.length === 0 ? (
                  <WardrobeEmptyState
                    visitor={visitor}
                    isLoading={isLoading}
                    hasLoaded={hasLoaded}
                    loadError={loadError}
                    openCapture={openCapture}
                  />
                ) : (
                  // CC-7.10: the grid top the screen budget measures Closet chrome to.
                  <div
                    data-testid="closet-garment-grid"
                    // Story CC-7.11 D4, P4: square photos and one compact row each for the name
                    // and the actions, so two rows of tagged tiles sit above the 608 px fold at
                    // 390 x 664.
                    className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
                  >
                    {filteredGarments.map((garment) => (
                      <div
                        key={garment.id}
                        data-testid={`garment-card-${garment.id}`}
                        data-surface="card"
                        className="relative flex flex-col justify-between overflow-hidden rounded-lg border border-line bg-card"
                      >
                        <GarmentCardPhoto garment={garment} locale={i18n.language} />
                        {/* A ready card opens its detail. The button covers the card, so the photo
                          keeps its own alt text outside it, and the actions below sit above it.
                          The global focus rule draws its ring (D3). */}
                        {garment.status === 'ready' && (
                          <button
                            type="button"
                            ref={(element) => {
                              if (element)
                                garmentOpenRefs.current.set(garment.id, element)
                              else garmentOpenRefs.current.delete(garment.id)
                            }}
                            data-testid={`garment-open-${garment.id}`}
                            aria-label={garmentPhotoAlt(i18n.language, garment)}
                            onClick={() => openGarmentDetail(garment.id)}
                            className="absolute inset-0 z-0 rounded-lg"
                          />
                        )}
                        <div className="pointer-events-none relative z-10 flex flex-col gap-1 p-2 [&_button]:pointer-events-auto">
                          {/* The name has the row to itself so the category reads whole at
                              390 px; the status chip leads the actions row below it. */}
                          <span
                            data-testid="garment-card-label"
                            className="min-w-0 text-sm font-medium text-ink-soft [overflow-wrap:anywhere]"
                          >
                            {garmentCardLabel(i18n.language, garment)}
                          </span>
                          {garment.status === 'awaiting_tags' && (
                            <button
                              type="button"
                              ref={(element) => {
                                if (element)
                                  taggingButtonRefs.current.set(garment.id, element)
                                else taggingButtonRefs.current.delete(garment.id)
                              }}
                              onClick={(event) =>
                                openTagging(garment.id, event.currentTarget)
                              }
                              className={STATUS_ACTION_CLASS}
                            >
                              <GarmentStatusBadge status="awaiting_tags" />
                            </button>
                          )}
                          {garment.status === 'failed' && (
                            <button
                              type="button"
                              className={STATUS_ACTION_CLASS}
                              aria-label={`${t('wardrobe.hub.status.failed')}. ${strings.firstUse.replaceGarment}`}
                              title={strings.firstUse.replaceGarment}
                              onClick={(event) => openCapture(event.currentTarget)}
                            >
                              <GarmentStatusBadge status="failed" />
                            </button>
                          )}
                          {garment.status === 'processing' && (
                            <button
                              type="button"
                              className={STATUS_ACTION_CLASS}
                              aria-label={`${t('wardrobe.hub.status.processing')}. ${strings.firstUse.checkGarment}`}
                              title={strings.firstUse.checkGarment}
                              onClick={() => pollCommittedGarment(garment.id)}
                            >
                              <GarmentStatusBadge status="processing" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {hasLoaded && onboardingStep && onboardingStep !== 'complete' && (
                  <div className="mt-4" data-testid="closet-setup-progress">
                    <NavRow
                      href="/wardrobe/onboarding"
                      label={t('wardrobe.menu.setup')}
                      value={t('wardrobe.hub.setupProgress', {
                        completed:
                          wardrobeOnboardingStepEnum.options.indexOf(onboardingStep),
                        total: wardrobeOnboardingStepEnum.options.length - 1,
                      })}
                      testId="closet-setup-progress-link"
                      last
                    />
                  </div>
                )}
              </section>
              <ClosetAccountNotices {...noticeProps} />
            </div>
          </ScreenGate>
        </main>

        <StickyBottomNav />
      </AppPage>

      <GarmentCaptureModal
        confirmDiscard
        isOpen={isCaptureModalOpen}
        onClose={closeCapture}
        onGarmentCommitted={handleGarmentCommitted}
        onBatchGarmentCommitted={handleBatchGarmentCommitted}
        invokingElementRef={captureInvokerRef}
      />

      <GarmentTaggingModal
        isOpen={Boolean(taggingGarmentId)}
        onClose={() => setTaggingGarmentId(null)}
        garmentId={taggingGarmentId}
        initialGarment={garments.find((garment) => garment.id === taggingGarmentId)}
        onTagsConfirmed={handleTagsConfirmed}
        invokingElementRef={taggingInvokerRef}
      />

      {owner && styleSelection && (
        <StylePiecePanel
          selection={styleSelection}
          inWardrobe={garments.some(({ id }) => id === styleSelection.id)}
          loadInventory={loadInventory}
          owner={owner}
          locale={i18n.language}
          invoker={styleInvoker}
          fallbackFocusSelector="[data-testid='app-top-bar-back']"
          onClose={() => {
            setStyleSelection(null)
          }}
        />
      )}
    </>
  )
}
