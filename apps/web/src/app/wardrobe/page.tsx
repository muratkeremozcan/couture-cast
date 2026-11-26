// Story 4.1 & 4.2 owner: implement web wardrobe hub page with capture and smart tagging
// Story 4.1 Task 8 step 2 owner: implement web wardrobe hub page in `apps/web/src/app/wardrobe/page.tsx`
// Story 4.4 Task 5 owner: "Set up your closet" onboarding entry card and the
// silhouette settings surface reachable outside onboarding (decision 3).
'use client'

import Link from 'next/link'
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
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
import { SkipToContent } from '../components/skip-to-content'
import { AccessibleModal } from '../components/accessible-modal'
import { GarmentCaptureModal } from '../components/garment-capture-modal'
import { GarmentTaggingModal } from '../components/garment-tagging-modal'
import { SilhouetteSettingsPanel } from '../components/silhouette-settings-panel'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import {
  listGarmentsFromWeb,
  getOnboardingStateFromWeb,
  resolveCurrentUserId,
} from '../../lib/wardrobe'
import { readStorage, WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
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

/** The visible card label: localized category and material, or "Untagged garment". */
function garmentCardLabel(locale: string, garment: ClosetGarment): string {
  if (!garment.category) return formatGarmentAlt(locale, { category: null })
  const labels = formatGarmentTagLabels(locale, garment)
  return [labels.category, labels.material].filter(Boolean).join(' · ')
}

export default function WardrobePage() {
  const owner = useWebSessionOwner()
  return (
    <I18nextProvider i18n={getI18n()}>
      <ClosetStatusBar>
        <WardrobeHubView key={owner} owner={owner} />
      </ClosetStatusBar>
    </I18nextProvider>
  )
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
  loadError,
  hasGarments,
  isLoading,
  strings,
  onRetry,
}: {
  loadError: string | null
  hasGarments: boolean
  isLoading: boolean
  strings: ReturnType<typeof getGuestPreviewStrings>
  onRetry: () => void
}) {
  if (!loadError) return null
  return (
    <div
      role="alert"
      className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800"
    >
      <div>
        {hasGarments && <p>{strings.firstUse.staleWardrobe}</p>}
        <p>
          {loadError === 'Unable to load your wardrobe.'
            ? strings.firstUse.wardrobeFailed
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
  isLoading,
  hasLoaded,
  loadError,
  openCapture,
}: {
  isLoading: boolean
  hasLoaded: boolean
  loadError: string | null
  openCapture: (opener: HTMLElement) => void
}) {
  // Only the first read says it is loading: a refresh (a return to the Closet, a retry after
  // tags) keeps the empty state in place until its answer replaces it (CC-7.7 D5).
  if (isLoading && !hasLoaded)
    return (
      <p role="status" className="mt-8 text-center text-sm text-zinc-500">
        Loading your wardrobe...
      </p>
    )
  if (!hasLoaded || loadError) return null
  return (
    <div className="mt-8 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
      <div className="text-4xl">🧥</div>
      <h3 className="mt-3 text-base font-semibold text-zinc-800 dark:text-zinc-200">
        No garments added yet
      </h3>
      <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Snap a photo of your favorite jacket, top, or dress to get started.
      </p>
      <button
        onClick={(event) => openCapture(event.currentTarget)}
        className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Snap or Import Garment
      </button>
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
  hasMember,
  userIdError,
  onboardingStatusError,
  onRetryOnboarding,
}: {
  /** Where this copy sits: above the closet for a member, below it otherwise. */
  placement: 'above' | 'below'
  hasMember: boolean
  userIdError: boolean
  onboardingStatusError: boolean
  onRetryOnboarding: () => void
}) {
  if ((placement === 'above') !== hasMember) return null
  return (
    <div className={placement === 'below' ? 'mt-6' : undefined}>
      {userIdError && (
        <p role="alert" className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          Unable to load your account, so Silhouette settings are unavailable right now.
          Reload the page to try again.
        </p>
      )}

      {onboardingStatusError && (
        <div
          role="alert"
          className="mb-6 flex min-h-[44px] items-center justify-between rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-800"
        >
          <span>Unable to check your closet setup progress.</span>
          <button
            type="button"
            onClick={onRetryOnboarding}
            className="min-h-[44px] font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

function WardrobeHubView({ owner }: { owner: string | null }) {
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
          loadAfterTags.current
            ? 'Unable to refresh your wardrobe.'
            : 'Unable to load your wardrobe.'
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
                ? 'Unable to refresh your wardrobe.'
                : 'Unable to load your wardrobe.'
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
        setGarmentError(
          'Smart tagging is taking longer than expected. The garment will remain visible while processing continues.'
        )
      } catch (error) {
        if (!controller.signal.aborted) {
          setGarmentError(
            error instanceof Error ? error.message : 'Unable to refresh garment status.'
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
    hasMember: owner !== null,
    userIdError,
    onboardingStatusError,
    onRetryOnboarding: retryOnboardingStatus,
  }

  return (
    <>
      <div
        data-app-shell
        className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <SkipToContent />
        {paramSync}

        <header
          data-testid="app-header"
          className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {/* Owner report 2026-11-16, iPhone 16 Safari: on one row the actions squeezed the
              title, wrapped Outfit capsules and pushed + Add Garment off the screen. Below the
              sm breakpoint the title takes its own row and the actions wrap beneath it. */}
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link
                href="/"
                className="hidden min-h-11 items-center text-sm underline md:inline-flex"
              >
                {t('nav.home')}
              </Link>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                Wardrobe Hub
              </h1>
            </div>
            {/* TEA P4: on phones the two secondary actions share the first row in equal halves and
                + Add Garment, the primary, takes the full second row. */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
              {/* The capsules route had no entry point anywhere in the app. */}
              <Link
                href="/wardrobe/capsules"
                className="flex min-h-[44px] items-center justify-center rounded-lg border text-center border-zinc-300 px-2 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:ring-2 focus:ring-black focus:ring-offset-2 sm:px-4 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                data-testid="wardrobe-capsules-link"
              >
                Outfit capsules
              </Link>
              <button
                ref={silhouetteButtonRef}
                type="button"
                onClick={() => setIsSilhouetteModalOpen(true)}
                disabled={!userId}
                title={
                  userIdError
                    ? 'Unable to load your account. Reload the page to try again.'
                    : undefined
                }
                className="flex min-h-[44px] items-center justify-center rounded-lg border text-center border-zinc-300 px-2 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t('wardrobe.silhouette.title')}
              </button>
              <button
                ref={addGarmentButtonRef}
                data-testid="garment-capture-open"
                onClick={(event) => openCapture(event.currentTarget)}
                className="col-span-2 min-h-[44px] whitespace-nowrap rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
              >
                + Add Garment
              </button>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-5xl px-6 py-8 pb-24 outline-none md:pb-8"
        >
          <ScreenGate screen="closet" ready={closetReady}>
            {detailGarmentId && (
              <GarmentDetail
                garment={detailGarment}
                owner={owner}
                hasLoaded={hasLoaded}
                loadFailed={Boolean(loadError)}
                loading={isLoading}
                onBack={() => closeGarmentDetail()}
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
                  className="mb-6 flex min-h-[44px] items-center justify-between rounded-xl border border-gold-500/40 bg-gold-500/10 px-6 py-4 text-sm font-semibold text-zinc-900 transition hover:bg-gold-500/20 focus:ring-2 focus:ring-black focus:ring-offset-2 dark:text-zinc-100"
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

              <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2
                  ref={closetHeadingRef}
                  tabIndex={-1}
                  data-testid="wardrobe-closet-heading"
                  className="text-lg font-semibold text-zinc-900 outline-none dark:text-zinc-100"
                >
                  Your Digital Closet
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Photograph or upload clothing items to power personalized weather
                  guidance.
                </p>

                <WardrobeLoadError
                  loadError={loadError}
                  hasGarments={visibleGarments.length > 0}
                  isLoading={isLoading}
                  strings={strings}
                  onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
                />
                {garmentError && (
                  <p role="alert" className="mt-4 text-sm">
                    {garmentError}
                  </p>
                )}
                {confirmedGarment && (
                  <Link
                    href="/"
                    className="inline-flex min-h-11 items-center text-sm underline"
                  >
                    {strings.firstUse.backToOutfit}
                  </Link>
                )}

                {visibleGarments.length === 0 ? (
                  <WardrobeEmptyState
                    isLoading={isLoading}
                    hasLoaded={hasLoaded}
                    loadError={loadError}
                    openCapture={openCapture}
                  />
                ) : (
                  <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {visibleGarments.map((garment) => (
                      <div
                        key={garment.id}
                        data-testid={`garment-card-${garment.id}`}
                        className="relative flex flex-col justify-between overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
                      >
                        <GarmentCardPhoto garment={garment} locale={i18n.language} />
                        <span
                          data-testid="garment-card-label"
                          className="block truncate px-3 pt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200"
                        >
                          {garmentCardLabel(i18n.language, garment)}
                        </span>
                        {/* A ready card opens its detail. The button covers the card, so the photo
                          keeps its own alt text outside it, and the actions below sit above it. */}
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
                            className="absolute inset-0 z-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
                          />
                        )}
                        <div className="pointer-events-none relative z-10 flex flex-col gap-2 p-3 [&_button]:pointer-events-auto">
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              data-testid={`garment-status-${garment.status}`}
                              className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                            >
                              {garment.status.replace('_', ' ')}
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
                                className="min-h-[44px] min-w-[44px] rounded bg-gold-500/20 px-2 py-1 text-xs font-semibold text-gold-700 hover:bg-gold-500/30 dark:text-gold-300"
                              >
                                Needs tags
                              </button>
                            )}
                            {garment.status === 'failed' && (
                              <button
                                type="button"
                                className="min-h-11 px-2 text-left text-xs font-semibold underline"
                                onClick={(event) => openCapture(event.currentTarget)}
                              >
                                {strings.firstUse.replaceGarment}
                              </button>
                            )}
                            {garment.status === 'processing' && (
                              <button
                                type="button"
                                onClick={() => pollCommittedGarment(garment.id)}
                                className="min-h-11 px-2 text-xs font-semibold underline"
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
              </div>
              <ClosetAccountNotices placement="below" {...noticeProps} />
            </div>
          </ScreenGate>
        </main>

        <StickyBottomNav />
      </div>

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
          ariaLiveMessage={isSilhouetteBusy ? 'Saving changes. Please wait.' : null}
        >
          <SilhouetteSettingsPanel userId={userId} onBusyChange={setIsSilhouetteBusy} />
        </AccessibleModal>
      )}
    </>
  )
}
