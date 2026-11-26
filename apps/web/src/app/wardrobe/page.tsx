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
import type {
  GarmentItemContract,
  GarmentWithColor,
  SavedLookContract,
  WardrobeOnboardingStatus,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { AccessibleModal } from '../components/accessible-modal'
import { GarmentCaptureModal } from '../components/garment-capture-modal'
import { GarmentTaggingModal } from '../components/garment-tagging-modal'
import { SilhouetteSettingsPanel } from '../components/silhouette-settings-panel'
import { AppPage, APP_MAIN_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import {
  listGarmentsFromWeb,
  getOnboardingStateFromWeb,
  resolveCurrentUserId,
} from '../../lib/wardrobe'
import { readStorage, WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import { LANDING_SESSION_ATTRIBUTE } from '../../lib/landing-session'
import { hasStoredWebSession } from '../../lib/web-session'
import { useRetryOnVerifiedSession } from '../../lib/session-retry'
import {
  currentWebSessionBearer,
  currentWebSessionOwner,
  currentWebSessionScope,
  UNVERIFIED_BEARER_OWNER,
  useHydrating,
  useWebSessionOwner,
} from '../../lib/use-web-session'
import {
  formatGarmentAlt,
  formatGarmentTagLabels,
  getGuestPreviewStrings,
  getStylePieceStrings,
  nextStylePiecePhotoExpiry,
  scheduleStylePiecePhotoExpiry,
  type StylePieceSelection,
} from '@couture/utils'
import {
  listSavedLooksPageFromWeb,
  subscribeSavedLooksChanged,
} from '../../lib/saved-looks'
import { StylePieceEntry, StylePiecePanel } from './style-piece-panel'
import { ClosetSavedLooksRow } from './saved-looks-row'
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

/**
 * A garment status chip label. The status list is an open set, so a status the catalogs do not
 * name reads as the localized "In progress" (review P2-11); the raw API code stays out of the
 * visible text and is kept only in the chip's `data-testid` for diagnostics.
 */
function garmentStatusLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: string
): string {
  return t(`wardrobe.hub.status.${status}`, {
    defaultValue: t('wardrobe.hub.status.unknown'),
  })
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
        className="flex aspect-[3/4] w-full items-center justify-center text-3xl"
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
      className="aspect-[3/4] w-full object-cover"
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

/** Why Silhouette is disabled, when the account read failed for a member. */
function silhouetteUnavailableHint(
  t: (key: string) => string,
  accountFailed: boolean
): string | undefined {
  return accountFailed ? t('wardrobe.hub.accountFailedShort') : undefined
}

const ADD_GARMENT_CLASS =
  'col-span-2 flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary'

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
        className={ADD_GARMENT_CLASS}
      >
        {t('wardrobe.hub.addGarment')}
      </Link>
    )
  return (
    <button
      ref={buttonRef}
      data-testid="garment-capture-open"
      data-gold="primary"
      onClick={(event) => onOpen(event.currentTarget)}
      className={ADD_GARMENT_CLASS}
    >
      {t('wardrobe.hub.addGarment')}
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

function resolveEffectiveSavedLooksOwner(
  owner: string | null,
  profileOwner: { id: string; bearer: string | null } | null,
  liveBearer: string | null
): string | null {
  if (owner && owner !== UNVERIFIED_BEARER_OWNER) return owner
  if (profileOwner && profileOwner.bearer && profileOwner.bearer === liveBearer) {
    return profileOwner.id
  }
  return null
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
    if (readHistoryState()[GARMENT_DETAIL_HISTORY_KEY]) {
      // Back lands on the grid entry; the search param sync closes the detail, so browser Back
      // and this control agree. A delete closes at once so the detail never shows the piece
      // as missing while the history step lands.
      window.history.back()
      if (focusTarget) setDetailGarmentId(null)
      return
    }
    // A direct link to the detail has no grid entry behind it: replace this one with the grid.
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
  onboardingStatus: WardrobeOnboardingStatus | null
  onboardingStatusError: boolean
  userId: string | null
  userIdError: boolean
  savedLooks: SavedLookContract[]
  savedLooksTotal: number
}

const CLOSET_SNAPSHOT_PART = 'closet'

const EMPTY_CLOSET: ClosetSnapshot = {
  garments: [],
  onboardingStatus: null,
  onboardingStatusError: false,
  userId: null,
  userIdError: false,
  savedLooks: [],
  savedLooksTotal: 0,
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
 * Story CC-7.7 D3: the Closet body appears once the closet, the setup progress, the account and
 * the saved looks have answered for the member, so the setup banner and any error are in place
 * at reveal and nothing is inserted above the grid afterwards.
 */
function closetGateReady(reads: {
  owner: string | null
  hasLoaded: boolean
  loadError: string | null
  onboardingStatus: WardrobeOnboardingStatus | null
  onboardingStatusError: boolean
  userId: string | null
  userIdError: boolean
  savedLooksSettled: boolean
}): boolean {
  return (
    reads.owner !== null &&
    (reads.hasLoaded || reads.loadError !== null) &&
    (reads.onboardingStatus !== null || reads.onboardingStatusError) &&
    (reads.userId !== null || reads.userIdError) &&
    reads.savedLooksSettled
  )
}

/**
 * The account and setup-progress notices. A member's sit above the closet, where the gate holds
 * them in place before the body appears. Without a member (a signed-out page, whose gate opens at
 * once) they land after the first paint, so the page puts them below the closet, where nothing
 * moves for them (D3 amendment, prod baseline Closet 0.1157).
 */
function ClosetAccountNotices({
  placement,
  visitor,
  hasMember,
  userIdError,
  onboardingStatusError,
  onRetryOnboarding,
}: {
  /** Where this copy sits: above the closet for a member, below it otherwise. */
  placement: 'above' | 'below'
  /** A visitor who never signed in has no account or setup to fail (add-on B). */
  visitor: boolean
  hasMember: boolean
  userIdError: boolean
  onboardingStatusError: boolean
  onRetryOnboarding: () => void
}) {
  const { t } = useTranslation()
  if (visitor || (placement === 'above') !== hasMember) return null
  return (
    <div className={placement === 'below' ? 'mt-6' : undefined}>
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
  const [onboardingStatus, setOnboardingStatus] =
    useState<WardrobeOnboardingStatus | null>(start.onboardingStatus)
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
  const [profileOwnerBinding, setProfileOwnerBinding] = useState<{
    id: string
    bearer: string | null
  } | null>(null)
  const [userIdError, setUserIdError] = useState(start.userIdError)
  const [isSilhouetteModalOpen, setIsSilhouetteModalOpen] = useState(false)
  const [isSilhouetteBusy, setIsSilhouetteBusy] = useState(false)
  const [styleSelection, setStyleSelection] = useState<StylePieceSelection | null>(null)
  const [initialSavedLook, setInitialSavedLook] = useState<SavedLookContract | null>(null)
  const [savedLooks, setSavedLooks] = useState<SavedLookContract[]>(start.savedLooks)
  const [savedLooksTotal, setSavedLooksTotal] = useState(start.savedLooksTotal)
  // Story CC-7.7 D4: the saved looks row sits above the grid, so the Closet gate waits for its
  // first read too; its error would otherwise land above the closet after the body appeared.
  const [savedLooksSettled, setSavedLooksSettled] = useState(restored)
  const [savedLooksLoading, setSavedLooksLoading] = useState(false)
  const [savedLooksLoadingMore, setSavedLooksLoadingMore] = useState(false)
  const [savedLooksError, setSavedLooksError] = useState<string | null>(null)
  const [savedLooksAttempt, setSavedLooksAttempt] = useState(0)
  const styleInvoker = useRef<HTMLButtonElement | null>(null)
  const styleLabels = getStylePieceStrings(i18n.language)
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

  const handleDetailTagsSaved = (updated: GarmentWithColor, startedVersion?: number) => {
    // A saved look's Ready or Needs review status follows its anchor's live tags.
    setSavedLooksAttempt((attempt) => attempt + 1)
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
      // A saved look holding the piece now shows it as missing (CC-7.2).
      setSavedLooksAttempt((attempt) => attempt + 1)
    },
  })
  // A piece inside its Undo window, or being sent, is hidden from the grid and the detail.
  const visibleGarments = withoutPendingDeletes(garments, pendingDeleteIds)

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
  const directEntryConsumed = useRef(false)
  const silhouetteButtonRef = useRef<HTMLButtonElement | null>(null)
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
    const capturedBearer = readLiveWebBearer()
    // Codex review P2-1, like the closet read: an answer read for a session scope the tab no
    // longer holds (a fixture bearer switch) is dropped and read again for the one it holds now.
    const scope = currentWebSessionScope()
    const sameScope = () => {
      if (scope === currentWebSessionScope()) return true
      setAccountReadAttempt((attempt) => attempt + 1)
      return false
    }
    setUserIdError(false)
    setProfileOwnerBinding(null)
    void resolveCurrentUserId()
      .then((id) => {
        if (!controller.signal.aborted && sameScope()) {
          setUserId(id)
          const liveBearer = readLiveWebBearer()
          if (id && capturedBearer && liveBearer === capturedBearer) {
            setProfileOwnerBinding({ id, bearer: capturedBearer })
          }
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
          setOnboardingStatus(state.status)
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
        if (scope === currentWebSessionScope()) setOnboardingStatus(state.status)
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

  useEffect(() => () => pollingControllerRef.current?.abort(), [])

  const savedLooksLoadEpochRef = useRef(0)
  const effectiveSavedLooksOwner = resolveEffectiveSavedLooksOwner(
    owner,
    profileOwnerBinding,
    readLiveWebBearer()
  )

  useEffect(() => {
    const loadEpoch = ++savedLooksLoadEpochRef.current
    setSavedLooksLoadingMore(false)
    if (!owner) {
      setSavedLooks([])
      setSavedLooksTotal(0)
      setSavedLooksError(null)
      setSavedLooksLoading(false)
      setSavedLooksSettled(true)
      return
    }
    const controller = new AbortController()
    // Codex review P2-1: a page read for a session scope the tab no longer holds is dropped and
    // read again, and the row does not count as settled on it.
    const scope = currentWebSessionScope()
    let superseded = false
    const sameScope = () => {
      if (scope === currentWebSessionScope()) return true
      superseded = true
      setSavedLooksAttempt((attempt) => attempt + 1)
      return false
    }
    setSavedLooksLoading(true)
    void listSavedLooksPageFromWeb({
      owner: effectiveSavedLooksOwner,
      limit: 50,
      offset: 0,
      signal: controller.signal,
    })
      .then((page) => {
        if (
          controller.signal.aborted ||
          savedLooksLoadEpochRef.current !== loadEpoch ||
          currentWebSessionOwner() !== owner ||
          !sameScope()
        ) {
          return
        }
        setSavedLooks(page.data)
        setSavedLooksTotal(page.total)
        setSavedLooksError(null)
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          savedLooksLoadEpochRef.current !== loadEpoch ||
          !sameScope()
        ) {
          return
        }
        setSavedLooksError(
          error instanceof Error ? error.message : 'Unable to load your saved looks.'
        )
        missedSession()
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          !superseded &&
          savedLooksLoadEpochRef.current === loadEpoch
        ) {
          setSavedLooksLoading(false)
          setSavedLooksSettled(true)
        }
      })
    return () => controller.abort()
  }, [owner, effectiveSavedLooksOwner, sessionAttempt, missedSession, savedLooksAttempt])

  useEffect(() => {
    if (!owner) return
    return subscribeSavedLooksChanged((changedOwner) => {
      if (changedOwner === owner || changedOwner === effectiveSavedLooksOwner) {
        setSavedLooksAttempt((attempt) => attempt + 1)
      }
    })
  }, [owner, effectiveSavedLooksOwner])

  const loadMoreSavedLooks = useCallback(() => {
    if (
      !owner ||
      savedLooksLoading ||
      savedLooksLoadingMore ||
      savedLooks.length >= savedLooksTotal
    )
      return
    setSavedLooksLoadingMore(true)
    const offset = savedLooks.length
    const startLoadEpoch = savedLooksLoadEpochRef.current
    void listSavedLooksPageFromWeb({ limit: 50, offset })
      .then((page) => {
        if (
          savedLooksLoadEpochRef.current !== startLoadEpoch ||
          currentWebSessionOwner() !== owner
        ) {
          return
        }
        setSavedLooks((current) => {
          const seen = new Set(current.map((item) => item.id))
          return [...current, ...page.data.filter((item) => !seen.has(item.id))]
        })
        setSavedLooksTotal(page.total)
      })
      .catch(() => undefined)
      .finally(() => {
        if (savedLooksLoadEpochRef.current === startLoadEpoch) {
          setSavedLooksLoadingMore(false)
        }
      })
  }, [
    owner,
    savedLooks.length,
    savedLooksLoading,
    savedLooksLoadingMore,
    savedLooksTotal,
  ])

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
      const timer = window.setTimeout(resolve, delayMs)
      signal.addEventListener(
        'abort',
        () => {
          window.clearTimeout(timer)
          reject(new DOMException('Polling aborted', 'AbortError'))
        },
        { once: true }
      )
    })

  const pollCommittedGarment = (garmentId: string) => {
    pollingControllerRef.current?.abort()
    listController.current?.abort()
    setIsLoading(false)
    const controller = new AbortController()
    pollingControllerRef.current = controller
    setGarmentError(null)

    void (async () => {
      try {
        const startedAt = Date.now()
        for (const offsetMs of [1_000, 2_000, 4_000, 8_000]) {
          await waitForPoll(
            Math.max(0, startedAt + offsetMs - Date.now()),
            controller.signal
          )
          const persisted = await loadInventory(controller.signal)
          if (controller.signal.aborted || currentWebSessionOwner() !== owner) return
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

  const handleGarmentCommitted = (garment: GarmentItemContract) => {
    inventoryVersion.current++
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
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
    onboardingStatus,
    onboardingStatusError,
    userId,
    userIdError,
    savedLooksSettled,
  })

  // Story CC-7.7 D5: what a return to the Closet shows first, for this member only.
  useEffect(() => {
    if (!owner || !hasLoaded || !savedLooksSettled) return
    // Under the scope its closet read started in; the store drops it once that scope left.
    screenSnapshot.remember(shownScopeRef.current, 'closet', CLOSET_SNAPSHOT_PART, {
      garments,
      onboardingStatus,
      onboardingStatusError,
      userId,
      userIdError,
      savedLooks,
      savedLooksTotal,
    } satisfies ClosetSnapshot)
  }, [
    garments,
    hasLoaded,
    onboardingStatus,
    onboardingStatusError,
    owner,
    savedLooks,
    savedLooksSettled,
    savedLooksTotal,
    userId,
    userIdError,
  ])

  const noticeProps = {
    visitor,
    hasMember: owner !== null,
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
          <AppTopBar titleKey="nav.wardrobe" />
        )}

        <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
          {/* D6: the three header actions moved here so the top bar stays one 56 px row. They
              render outside the gate, where the header held them, so they never move when the
              closet appears. On phones the two secondary actions share the first row in equal
              halves and + Add Garment, the screen's main action, takes the full second row
              (TEA P4). */}
          <div hidden={Boolean(detailGarmentId)} data-testid="wardrobe-actions">
            <div className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
              {/* The capsules route had no entry point anywhere in the app. */}
              <Link
                href="/wardrobe/capsules"
                className="flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-page px-2 py-2 text-center text-sm font-semibold text-ink sm:px-4"
                data-testid="wardrobe-capsules-link"
              >
                {t('wardrobe.capsules.title')}
              </Link>
              <button
                ref={silhouetteButtonRef}
                type="button"
                onClick={() => setIsSilhouetteModalOpen(true)}
                disabled={!userId}
                title={silhouetteUnavailableHint(t, userIdError && !visitor)}
                className="flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-page px-2 py-2 text-center text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
              >
                {t('wardrobe.silhouette.title')}
              </button>
              <AddGarmentAction
                visitor={visitor}
                buttonRef={addGarmentButtonRef}
                onOpen={openCapture}
              />
            </div>
          </div>

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
              <ClosetAccountNotices placement="above" {...noticeProps} />

              {onboardingStatus && onboardingStatus !== 'completed' && (
                <Link
                  href="/wardrobe/onboarding"
                  className="mb-6 flex min-h-11 items-center justify-between rounded-xl border border-line-strong bg-page px-6 py-4 text-sm font-semibold text-ink"
                >
                  {t('wardrobe.onboarding.title')}
                  <span aria-hidden="true">→</span>
                </Link>
              )}

              <ClosetSavedLooksRow
                owner={owner}
                savedLooks={savedLooks}
                totalCount={savedLooksTotal}
                hasMore={savedLooks.length < savedLooksTotal}
                isLoadingMore={savedLooksLoadingMore}
                onLoadMore={loadMoreSavedLooks}
                isLoading={savedLooksLoading}
                loadError={savedLooksError}
                garments={garments}
                onRetry={() => setSavedLooksAttempt((attempt) => attempt + 1)}
                onChanged={() => setSavedLooksAttempt((attempt) => attempt + 1)}
                onReopenStylePiece={(look, invoker) => {
                  const anchor = garments.find((item) => item.id === look.anchorGarmentId)
                  if (!anchor || !anchor.category || !anchor.comfortRange) return
                  styleInvoker.current = invoker as HTMLButtonElement
                  setInitialSavedLook(look)
                  setStyleSelection({
                    id: anchor.id,
                    category: anchor.category,
                    comfortRange: anchor.comfortRange,
                  })
                }}
              />

              {/* D7: the closet is a section on the page; its garment cards are the one card level. */}
              <section aria-labelledby="wardrobe-closet-heading">
                <h2
                  id="wardrobe-closet-heading"
                  ref={closetHeadingRef}
                  tabIndex={-1}
                  data-testid="wardrobe-closet-heading"
                  className="text-lg font-semibold text-ink outline-none"
                >
                  {t('wardrobe.hub.closetTitle')}
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {t('wardrobe.hub.closetBody')}
                </p>

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

                {visibleGarments.length === 0 ? (
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
                    className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4"
                  >
                    {visibleGarments.map((garment) => (
                      <div
                        key={garment.id}
                        data-testid={`garment-card-${garment.id}`}
                        data-surface="card"
                        className="relative flex flex-col justify-between overflow-hidden rounded-lg border border-line bg-card"
                      >
                        <GarmentCardPhoto garment={garment} locale={i18n.language} />
                        <span
                          data-testid="garment-card-label"
                          className="block truncate px-3 pt-3 text-sm font-medium text-ink-soft"
                        >
                          {garmentCardLabel(i18n.language, garment)}
                        </span>
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
                        <div className="pointer-events-none relative z-10 flex flex-col gap-2 p-3 [&_button]:pointer-events-auto">
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              data-testid={`garment-status-${garment.status}`}
                              className="inline-block rounded-sm bg-card-muted px-2 py-0.5 text-xs font-semibold text-ink-soft"
                            >
                              {garmentStatusLabel(t, garment.status)}
                            </span>
                            {garment.status === 'awaiting_tags' && (
                              <button
                                ref={(element) => {
                                  if (element)
                                    taggingButtonRefs.current.set(garment.id, element)
                                  else taggingButtonRefs.current.delete(garment.id)
                                }}
                                onClick={(event) =>
                                  openTagging(garment.id, event.currentTarget)
                                }
                                className="min-h-11 min-w-11 rounded-md border border-line-strong bg-page px-2 py-1 text-xs font-semibold text-ink"
                              >
                                {t('wardrobe.hub.needsTags')}
                              </button>
                            )}
                            {garment.status === 'failed' && (
                              <button
                                type="button"
                                className="min-h-11 px-2 text-left text-xs font-semibold text-ink underline"
                                onClick={(event) => openCapture(event.currentTarget)}
                              >
                                {strings.firstUse.replaceGarment}
                              </button>
                            )}
                            {garment.status === 'processing' && (
                              <button
                                type="button"
                                onClick={() => pollCommittedGarment(garment.id)}
                                className="min-h-11 px-2 text-xs font-semibold text-ink underline"
                              >
                                {strings.firstUse.checkGarment}
                              </button>
                            )}
                          </div>
                          <StylePieceEntry
                            garment={garment}
                            owner={owner}
                            unavailable={Boolean(loadError)}
                            loading={isLoading}
                            labels={styleLabels}
                            onRefresh={() => setLoadAttempt((attempt) => attempt + 1)}
                            onOpen={(selection, button) => {
                              styleInvoker.current = button
                              setStyleSelection(selection)
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <ClosetAccountNotices placement="below" {...noticeProps} />
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
        invokingElementRef={captureInvokerRef}
      />

      <GarmentTaggingModal
        isOpen={Boolean(taggingGarmentId)}
        onClose={() => setTaggingGarmentId(null)}
        garmentId={taggingGarmentId}
        onTagsConfirmed={handleTagsConfirmed}
        invokingElementRef={taggingInvokerRef}
      />

      {owner && styleSelection && (
        <StylePiecePanel
          selection={styleSelection}
          initialSavedLook={initialSavedLook}
          inWardrobe={garments.some(({ id }) => id === styleSelection.id)}
          loadInventory={loadInventory}
          owner={owner}
          locale={i18n.language}
          invoker={styleInvoker}
          onSavedLooksChanged={() => setSavedLooksAttempt((attempt) => attempt + 1)}
          onClose={() => {
            setStyleSelection(null)
            setInitialSavedLook(null)
          }}
        />
      )}

      {isSilhouetteModalOpen && userId && (
        <AccessibleModal
          isOpen={isSilhouetteModalOpen}
          onClose={() => {
            // Escape and the ✕ button both funnel through this handler; ignore
            // both while a slider save or My Form upload is still in flight so
            // an in-progress edit is never silently discarded by closing.
            if (isSilhouetteBusy) return
            setIsSilhouetteModalOpen(false)
          }}
          titleId="silhouette-settings-title"
          title={t('wardrobe.silhouette.title')}
          invokingElementRef={silhouetteButtonRef}
          ariaLiveMessage={isSilhouetteBusy ? t('wardrobe.hub.silhouetteSaving') : null}
        >
          <SilhouetteSettingsPanel userId={userId} onBusyChange={setIsSilhouetteBusy} />
        </AccessibleModal>
      )}
    </>
  )
}
