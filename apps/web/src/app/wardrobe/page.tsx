// Story 4.1 & 4.2 owner: implement web wardrobe hub page with capture and smart tagging
// Story 4.1 Task 8 step 2 owner: implement web wardrobe hub page in `apps/web/src/app/wardrobe/page.tsx`
// Story 4.4 Task 5 owner: "Set up your closet" onboarding entry card and the
// silhouette settings surface reachable outside onboarding (decision 3).
'use client'

import Link from 'next/link'
import React, { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react'
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
  UNVERIFIED_BEARER_OWNER,
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

/** D2: the open garment detail lives in the URL, so a reload reopens it. */
const GARMENT_DETAIL_PARAM = 'garment'

function readGarmentDetailParam(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(GARMENT_DETAIL_PARAM) || null
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
      <WardrobeHubView key={owner} owner={owner} />
    </I18nextProvider>
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
  if (isLoading)
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
  const detailPushedRef = useRef(false)
  const gridScrollRef = useRef(0)
  const lastDetailIdRef = useRef<string | null>(null)

  useEffect(() => {
    setDetailGarmentId(readGarmentDetailParam())
    const onPopState = () => {
      const next = readGarmentDetailParam()
      if (!next) detailPushedRef.current = false
      setDetailGarmentId(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

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
    garmentOpenRefs.current.get(previous)?.focus({ preventScroll: true })
  }, [detailGarmentId, garmentOpenRefs])

  const openGarmentDetail = (garmentId: string) => {
    gridScrollRef.current = window.scrollY
    const url = new URL(window.location.href)
    url.searchParams.set(GARMENT_DETAIL_PARAM, garmentId)
    window.history.pushState(window.history.state, '', url)
    detailPushedRef.current = true
    setDetailGarmentId(garmentId)
  }

  const closeGarmentDetail = () => {
    if (detailPushedRef.current) {
      // The popstate handler above closes the detail, so browser Back and this control agree.
      window.history.back()
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.delete(GARMENT_DETAIL_PARAM)
    window.history.replaceState(window.history.state, '', url)
    setDetailGarmentId(null)
  }

  return { detailGarmentId, openGarmentDetail, closeGarmentDetail }
}

function WardrobeHubView({ owner }: { owner: string | null }) {
  const { t, i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)
  const [garments, setGarments] = useState<ClosetGarment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [hasLoaded, setHasLoaded] = useState(false)
  const listController = useRef<AbortController | null>(null)
  const inventoryVersion = useRef(0)
  const loadAfterTags = useRef(false)
  const [garmentError, setGarmentError] = useState<string | null>(null)
  const [confirmedGarment, setConfirmedGarment] = useState(false)
  const [onboardingStatus, setOnboardingStatus] =
    useState<WardrobeOnboardingStatus | null>(null)
  const [onboardingStatusError, setOnboardingStatusError] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [profileOwnerBinding, setProfileOwnerBinding] = useState<{
    id: string
    bearer: string | null
  } | null>(null)
  const [userIdError, setUserIdError] = useState(false)
  const [isSilhouetteModalOpen, setIsSilhouetteModalOpen] = useState(false)
  const [isSilhouetteBusy, setIsSilhouetteBusy] = useState(false)
  const [styleSelection, setStyleSelection] = useState<StylePieceSelection | null>(null)
  const [initialSavedLook, setInitialSavedLook] = useState<SavedLookContract | null>(null)
  const [savedLooks, setSavedLooks] = useState<SavedLookContract[]>([])
  const [savedLooksTotal, setSavedLooksTotal] = useState(0)
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
      for (let attempt = 0; attempt < 2; attempt++) {
        const version = inventoryVersion.current
        const items = await listGarmentsFromWeb(signal)
        if (signal.aborted || currentWebSessionOwner() !== owner) return null
        // A completed refresh or local update may be newer than this snapshot.
        if (version !== inventoryVersion.current) continue
        inventoryVersion.current++
        setGarments(items)
        setLoadError(null)
        setHasLoaded(true)
        return items
      }
      return null
    },
    [owner]
  )

  const garmentOpenRefs = useRef(new Map<string, HTMLButtonElement>())
  const { detailGarmentId, openGarmentDetail, closeGarmentDetail } =
    useGarmentDetailRoute(garmentOpenRefs)

  const handleDetailTagsSaved = (updated: GarmentWithColor) => {
    inventoryVersion.current++
    setGarments((current) =>
      current.map((item) => (item.id === updated.id ? updated : item))
    )
  }

  const detailGarment = findReadyGarment(garments, detailGarmentId)

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
    setUserIdError(false)
    setProfileOwnerBinding(null)
    void resolveCurrentUserId()
      .then((id) => {
        if (!controller.signal.aborted) {
          setUserId(id)
          const liveBearer = readLiveWebBearer()
          if (id && capturedBearer && liveBearer === capturedBearer) {
            setProfileOwnerBinding({ id, bearer: capturedBearer })
          }
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setUserIdError(true)
        missedSession()
      })
    void getOnboardingStateFromWeb(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted) {
          setOnboardingStatus(state.status)
          setOnboardingStatusError(false)
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setOnboardingStatusError(true)
        missedSession()
      })
    return () => controller.abort()
  }, [sessionAttempt, missedSession])

  const retryOnboardingStatus = () => {
    setOnboardingStatusError(false)
    void getOnboardingStateFromWeb()
      .then((state) => setOnboardingStatus(state.status))
      .catch(() => setOnboardingStatusError(true))
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
      return
    }
    const controller = new AbortController()
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
          currentWebSessionOwner() !== owner
        ) {
          return
        }
        setSavedLooks(page.data)
        setSavedLooksTotal(page.total)
        setSavedLooksError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || savedLooksLoadEpochRef.current !== loadEpoch) {
          return
        }
        setSavedLooksError(
          error instanceof Error ? error.message : 'Unable to load your saved looks.'
        )
        missedSession()
      })
      .finally(() => {
        if (!controller.signal.aborted && savedLooksLoadEpochRef.current === loadEpoch) {
          setSavedLooksLoading(false)
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
    window.history.replaceState(window.history.state, '', url)
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

  return (
    <>
      <div
        data-app-shell
        className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <SkipToContent />

        <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
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
          {detailGarmentId && (
            <GarmentDetail
              garment={detailGarment}
              owner={owner}
              hasLoaded={hasLoaded}
              loadFailed={Boolean(loadError)}
              loading={isLoading}
              onBack={closeGarmentDetail}
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
            {userIdError && (
              <p
                role="alert"
                className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                Unable to load your account, so Silhouette settings are unavailable right
                now. Reload the page to try again.
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
                  onClick={retryOnboardingStatus}
                  className="min-h-[44px] font-semibold underline"
                >
                  Retry
                </button>
              </div>
            )}

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
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Your Digital Closet
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Photograph or upload clothing items to power personalized weather
                guidance.
              </p>

              <WardrobeLoadError
                loadError={loadError}
                hasGarments={garments.length > 0}
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

              {garments.length === 0 ? (
                <WardrobeEmptyState
                  isLoading={isLoading}
                  hasLoaded={hasLoaded}
                  loadError={loadError}
                  openCapture={openCapture}
                />
              ) : (
                <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                  {garments.map((garment) => (
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
                            if (element) garmentOpenRefs.current.set(garment.id, element)
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
          </div>
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
