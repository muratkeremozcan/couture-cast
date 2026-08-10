// Story 4.4 Task 5 owner: guided wardrobe onboarding flow (permission, capture/tag loop,
// starter-wardrobe skip, silhouette, completion), orchestrating the existing Story 4.1/4.2
// capture and tagging components against the server-authoritative onboarding state machine.
//
// Lives under `app/components/`, not inline in `app/wardrobe/onboarding/page.tsx`: Next.js's
// generated route types require a `page.tsx` file to export nothing but the whitelisted route
// exports (`default`, `metadata`, `generateStaticParams`, ...), and this component accepts an
// optional `garmentPollIntervalsMs` test-only prop that fails that check once `.next/types` has
// actually been generated (`next dev`/`next build`) — confirmed against a real `tsc --noEmit`
// run against generated route types, not assumed. `page.tsx` stays a thin default-only wrapper.
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { I18nextProvider, useTranslation } from 'react-i18next'
import type {
  GarmentItemContract,
  WardrobeOnboardingStateContract,
  WardrobeOnboardingStep,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { SkipToContent } from './skip-to-content'
import { GarmentCaptureModal } from './garment-capture-modal'
import { GarmentTaggingModal } from './garment-tagging-modal'
import { SilhouetteSettingsPanel } from './silhouette-settings-panel'
import {
  resolveCurrentUserId,
  getOnboardingStateFromWeb,
  advanceOnboardingStepFromWeb,
  listGarmentsFromWeb,
  onboardingETag,
  isStaleRevisionError,
} from '../../lib/wardrobe'

/**
 * `garmentPollIntervalsMs` exists only so tests can replace the real
 * 1s/2s/4s/8s cadence with a near-zero one; the route's default export never
 * supplies it, so production always gets the real default.
 */
export function WardrobeOnboardingFlow({
  garmentPollIntervalsMs,
}: {
  garmentPollIntervalsMs?: readonly number[]
} = {}) {
  return (
    <I18nextProvider i18n={getI18n()}>
      <OnboardingFlow garmentPollIntervalsMs={garmentPollIntervalsMs} />
    </I18nextProvider>
  )
}

/** Every captured garment needs tags; a label distinguishes rows before a category exists. */
function describeGarment(
  garment: GarmentItemContract,
  position: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return garment.category
    ? garment.category
    : t('wardrobe.onboarding.garmentFallback', { position })
}

function isTagged(garment: GarmentItemContract): boolean {
  return garment.tagsConfirmedAt !== null
}

/**
 * A `failed` garment can never reach `tagsConfirmedAt`: there is no retry or
 * removal action for it anywhere in this codebase yet (the wardrobe hub
 * itself only ever shows a static "failed" badge for one), so requiring it
 * to be tagged before Continue would be a permanent onboarding dead-end.
 * Excluded from the "all tagged" gate rather than pretending this story can
 * build that recovery flow; tracked as a follow-up, not solved here.
 */
function isTaggable(garment: GarmentItemContract): boolean {
  return garment.status !== 'failed'
}

const GARMENT_POLL_INTERVALS_MS = [1_000, 2_000, 4_000, 8_000] as const

/** Mirrors the wardrobe hub's own `waitForPoll`: an abortable delay between poll attempts. */
function waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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
}

function OnboardingFlow({
  garmentPollIntervalsMs = GARMENT_POLL_INTERVALS_MS,
}: {
  garmentPollIntervalsMs?: readonly number[]
}) {
  const { t } = useTranslation()
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [onboardingState, setOnboardingState] =
    useState<WardrobeOnboardingStateContract | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null)

  const [permissionDenied, setPermissionDenied] = useState(false)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)

  const [advanceError, setAdvanceError] = useState<string | null>(null)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [isSilhouetteBusy, setIsSilhouetteBusy] = useState(false)

  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)
  /** A garment still `processing` after every scheduled poll attempt; offered as a manual recheck. */
  const [timedOutGarmentIds, setTimedOutGarmentIds] = useState<Set<string>>(
    () => new Set()
  )

  const revisionRef = useRef(0)
  const addAnotherButtonRef = useRef<HTMLButtonElement | null>(null)
  const taggingButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const taggingInvokerRef = useRef<HTMLElement | null>(null)
  const pendingTaggingGarmentIdRef = useRef<string | null>(null)
  const advanceControllerRef = useRef<AbortController | null>(null)
  const isCaptureOpenRef = useRef(false)
  /**
   * One controller per garment id, not a single shared ref: capturing a
   * second `processing` garment while the first is still polling must not
   * abort the first garment's poll. A shared ref previously did exactly
   * that, silently swallowing the abort in the loop's `catch` block and
   * leaving the first garment's checklist row stuck on "Processing" with no
   * recheck action until a reload.
   */
  const garmentPollControllersRef = useRef(new Map<string, AbortController>())
  /**
   * Stable per-garment checklist position, assigned the first time a garment
   * id is seen (resume load or a fresh capture) and never reassigned.
   * Prevents an already-shown "Garment N" label from silently renumbering
   * (and, for a screen-reader user, silently starting to refer to a
   * different item) when another garment is captured or the array is
   * reordered for newest-first display.
   */
  const garmentPositionsRef = useRef(new Map<string, number>())
  const nextGarmentPositionRef = useRef(1)

  const assignGarmentPositions = useCallback((items: readonly GarmentItemContract[]) => {
    for (const item of items) {
      if (!garmentPositionsRef.current.has(item.id)) {
        garmentPositionsRef.current.set(item.id, nextGarmentPositionRef.current)
        nextGarmentPositionRef.current += 1
      }
    }
  }, [])

  useEffect(() => {
    isCaptureOpenRef.current = isCaptureModalOpen
  }, [isCaptureModalOpen])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [uid, loaded] = await Promise.all([
          resolveCurrentUserId(),
          getOnboardingStateFromWeb(),
        ])
        if (cancelled) return
        setUserId(uid)
        if (loaded.status === 'completed') {
          router.replace('/wardrobe')
          return
        }
        revisionRef.current = loaded.revision
        setOnboardingState(loaded)
        if (loaded.status === 'in_progress') {
          setLiveAnnouncement(t('wardrobe.onboarding.resumed'))
        }
        if (loaded.currentStep === 'capture' || loaded.currentStep === 'tagging') {
          const persisted = await listGarmentsFromWeb()
          if (!cancelled) {
            assignGarmentPositions(persisted)
            setGarments(persisted)
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : t('wardrobe.onboarding.errors.loadFailed')
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Runs once on mount; `t`/`router`/`assignGarmentPositions` are stable in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const garmentPollControllers = garmentPollControllersRef.current
    return () => {
      advanceControllerRef.current?.abort()
      for (const controller of garmentPollControllers.values()) {
        controller.abort()
      }
    }
  }, [])

  const advanceStep = useCallback(
    async (targetStep: WardrobeOnboardingStep, usedStarterWardrobe?: boolean) => {
      if (!userId) return null
      setIsAdvancing(true)
      setAdvanceError(null)
      const controller = new AbortController()
      advanceControllerRef.current = controller
      try {
        const next = await advanceOnboardingStepFromWeb(
          usedStarterWardrobe === undefined
            ? { targetStep }
            : { targetStep, usedStarterWardrobe },
          onboardingETag(userId, revisionRef.current),
          controller.signal
        )
        if (controller.signal.aborted) return null
        revisionRef.current = next.revision
        setOnboardingState(next)
        return next
      } catch (error) {
        if (controller.signal.aborted) return null
        setAdvanceError(
          isStaleRevisionError(error)
            ? t('wardrobe.onboarding.errors.stale')
            : error instanceof Error
              ? error.message
              : t('wardrobe.onboarding.errors.saveFailed')
        )
        return null
      } finally {
        if (!controller.signal.aborted) setIsAdvancing(false)
      }
    },
    [userId, t]
  )

  const handleAllowPermission = async () => {
    setIsRequestingPermission(true)
    setPermissionDenied(false)
    setLiveAnnouncement(t('wardrobe.onboarding.announcements.permissionRequesting'))
    let denied = false
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        denied = true
        setPermissionDenied(true)
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        stream.getTracks().forEach((track) => track.stop())
      }
    } catch {
      denied = true
      setPermissionDenied(true)
    } finally {
      setIsRequestingPermission(false)
    }
    const next = await advanceStep('capture')
    if (next) {
      setLiveAnnouncement(
        t(
          denied
            ? 'wardrobe.onboarding.announcements.permissionDenied'
            : 'wardrobe.onboarding.announcements.permissionGranted'
        )
      )
    }
  }

  const openCapture = () => setIsCaptureModalOpen(true)

  /**
   * Resolves the actual invoking element (a specific checklist row, when
   * that's what was clicked) so focus returns there on close, matching the
   * contract this page's own focus-restoration test verifies for the
   * "Add another garment" path. Falls back to that button when no specific
   * row invoked this (e.g. the capture-modal auto-chain).
   */
  const openTagging = (garmentId: string) => {
    taggingInvokerRef.current =
      taggingButtonRefs.current.get(garmentId) ?? addAnotherButtonRef.current
    setTaggingGarmentId(garmentId)
  }

  /**
   * Mirrors the wardrobe hub's own `pollCommittedGarment`: a just-committed
   * garment can still be `processing` (smart-tagging inference running), and
   * without this the checklist row would show a live status once and then
   * go stale until a reload. Exhausting every scheduled attempt without the
   * garment leaving `processing` falls back to the same manual recheck the
   * hub offers rather than leaving the row silently stuck forever.
   */
  const pollCommittedGarment = (garmentId: string) => {
    // Abort only this garment's own prior poll (a stale retry of the same
    // garment), never another garment's still-running poll.
    garmentPollControllersRef.current.get(garmentId)?.abort()
    const controller = new AbortController()
    garmentPollControllersRef.current.set(garmentId, controller)

    void (async () => {
      try {
        const startedAt = Date.now()
        for (const offsetMs of garmentPollIntervalsMs) {
          await waitForPoll(
            Math.max(0, startedAt + offsetMs - Date.now()),
            controller.signal
          )
          const persisted = await listGarmentsFromWeb(controller.signal)
          if (controller.signal.aborted) return
          assignGarmentPositions(persisted)
          setGarments(persisted)
          const current = persisted.find((garment) => garment.id === garmentId)
          if (!current || current.status === 'processing') continue
          setTimedOutGarmentIds((ids) => {
            const next = new Set(ids)
            next.delete(garmentId)
            return next
          })
          if (current.status === 'awaiting_tags') {
            if (isCaptureOpenRef.current) {
              pendingTaggingGarmentIdRef.current = current.id
            } else {
              openTagging(current.id)
            }
          }
          return
        }
        if (!controller.signal.aborted) {
          setTimedOutGarmentIds((ids) => new Set(ids).add(garmentId))
        }
      } catch {
        // Aborted (a newer poll superseded this one) or a transient refresh
        // failure; either way the row just keeps showing "Processing" until
        // the next successful refresh, matching the hub's own handling.
      } finally {
        // Only clear this garment's own entry, and only if it's still the
        // current one (a superseding call for the same garment already
        // replaced it in the map, in which case leave that newer entry alone).
        if (garmentPollControllersRef.current.get(garmentId) === controller) {
          garmentPollControllersRef.current.delete(garmentId)
        }
      }
    })()
  }

  const handleGarmentCommitted = (garment: GarmentItemContract) => {
    assignGarmentPositions([garment])
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
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
    setGarments((current) =>
      current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
    )
    setTaggingGarmentId(null)
    const position = garmentPositionsRef.current.get(updatedGarment.id) ?? 0
    setLiveAnnouncement(
      t('wardrobe.onboarding.announcements.garmentTagged', {
        garment: describeGarment(updatedGarment, position, t),
      })
    )
  }

  const handleUseStarterWardrobe = async () => {
    const next = await advanceStep('silhouette', true)
    if (next) setLiveAnnouncement(t('wardrobe.onboarding.announcements.silhouette'))
  }

  const handleContinueFromCapture = async () => {
    const next = await advanceStep('tagging')
    if (next) setLiveAnnouncement(t('wardrobe.onboarding.announcements.tagging'))
  }

  const handleContinueFromTagging = async () => {
    const next = await advanceStep('silhouette')
    if (next) setLiveAnnouncement(t('wardrobe.onboarding.announcements.silhouette'))
  }

  const handleFinishOnboarding = () => {
    // The completion screen's own `role="status"` message is itself an
    // implicit live region (ARIA `status` implies `aria-live="polite"`), so
    // no separate announcement is needed for reaching it.
    void advanceStep('complete')
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p role="status" className="text-sm text-zinc-500">
          {t('wardrobe.onboarding.loading')}
        </p>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {loadError}
        </p>
      </main>
    )
  }

  if (!onboardingState || !userId) {
    return null
  }

  const currentStep = onboardingState.currentStep
  // At least one garment must exist to advance, but a garment that failed
  // processing (see `isTaggable`) is excluded from the "every one is tagged"
  // check itself, so it can never be the thing standing between a user and
  // Continue.
  const allTagged = garments.length > 0 && garments.filter(isTaggable).every(isTagged)

  return (
    <>
      <div
        data-app-shell
        className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <SkipToContent />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-2xl px-6 py-10 outline-none"
        >
          <p
            aria-live="polite"
            className="sr-only"
            data-testid="onboarding-status-region"
          >
            {liveAnnouncement ?? ''}
          </p>

          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t('wardrobe.onboarding.title')}
          </h1>

          {advanceError && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            >
              {advanceError}
            </p>
          )}

          <OnboardingStepContent
            t={t}
            currentStep={currentStep}
            permissionDenied={permissionDenied}
            isRequestingPermission={isRequestingPermission}
            onAllowPermission={() => {
              void handleAllowPermission()
            }}
            garments={garments}
            garmentPositions={garmentPositionsRef.current}
            timedOutGarmentIds={timedOutGarmentIds}
            allTagged={allTagged}
            isAdvancing={isAdvancing}
            isSilhouetteBusy={isSilhouetteBusy}
            addAnotherButtonRef={addAnotherButtonRef}
            taggingButtonRefs={taggingButtonRefs}
            onAddAnother={openCapture}
            onOpenTagging={openTagging}
            onUseStarterWardrobe={() => {
              void handleUseStarterWardrobe()
            }}
            onContinueFromCapture={() => {
              void handleContinueFromCapture()
            }}
            onContinueFromTagging={() => {
              void handleContinueFromTagging()
            }}
            onFinishOnboarding={handleFinishOnboarding}
            onSilhouetteBusyChange={setIsSilhouetteBusy}
            onGoToWardrobe={() => router.push('/wardrobe')}
            userId={userId}
          />
        </main>
      </div>

      <GarmentCaptureModal
        isOpen={isCaptureModalOpen}
        onClose={closeCapture}
        onGarmentCommitted={handleGarmentCommitted}
        invokingElementRef={addAnotherButtonRef}
      />

      <GarmentTaggingModal
        isOpen={Boolean(taggingGarmentId)}
        onClose={() => setTaggingGarmentId(null)}
        garmentId={taggingGarmentId}
        onTagsConfirmed={handleTagsConfirmed}
        invokingElementRef={taggingInvokerRef}
      />
    </>
  )
}

interface OnboardingStepContentProps {
  t: (key: string, options?: Record<string, unknown>) => string
  currentStep: WardrobeOnboardingStep
  permissionDenied: boolean
  isRequestingPermission: boolean
  onAllowPermission: () => void
  garments: GarmentItemContract[]
  garmentPositions: Map<string, number>
  timedOutGarmentIds: Set<string>
  allTagged: boolean
  isAdvancing: boolean
  isSilhouetteBusy: boolean
  addAnotherButtonRef: React.RefObject<HTMLButtonElement | null>
  taggingButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>
  onAddAnother: () => void
  onOpenTagging: (garmentId: string) => void
  onUseStarterWardrobe: () => void
  onContinueFromCapture: () => void
  onContinueFromTagging: () => void
  onFinishOnboarding: () => void
  onSilhouetteBusyChange: (busy: boolean) => void
  onGoToWardrobe: () => void
  userId: string
}

/**
 * Selects and renders exactly one step's content. Split out of `OnboardingFlow`
 * to keep that component's cyclomatic complexity within the project's lint
 * budget; every `currentStep` branch lives here instead.
 */
function OnboardingStepContent({
  t,
  currentStep,
  permissionDenied,
  isRequestingPermission,
  onAllowPermission,
  garments,
  garmentPositions,
  timedOutGarmentIds,
  allTagged,
  isAdvancing,
  isSilhouetteBusy,
  addAnotherButtonRef,
  taggingButtonRefs,
  onAddAnother,
  onOpenTagging,
  onUseStarterWardrobe,
  onContinueFromCapture,
  onContinueFromTagging,
  onFinishOnboarding,
  onSilhouetteBusyChange,
  onGoToWardrobe,
  userId,
}: OnboardingStepContentProps) {
  const showPermissionDeniedBanner =
    permissionDenied && (currentStep === 'permission' || currentStep === 'capture')

  const stepRegionRef = useRef<HTMLDivElement | null>(null)
  const previousStepRef = useRef<WardrobeOnboardingStep | null>(null)
  useEffect(() => {
    // AC 5 requires moving focus to the new step, not only announcing it:
    // the prior step's focused control (a button that was just clicked) is
    // gone from this region entirely once the server confirms the
    // transition, so focus would otherwise silently fall back to <body>.
    // Skipped on the component's first mount (this component mounts exactly
    // once the async load resolves and `currentStep` gets its first value,
    // so this effect would otherwise steal focus into the region on every
    // page load with no user action -- pulling focus past the
    // `SkipToContent` link before a keyboard user has pressed anything).
    if (previousStepRef.current !== null && previousStepRef.current !== currentStep) {
      stepRegionRef.current?.focus()
    }
    previousStepRef.current = currentStep
  }, [currentStep])

  return (
    <div
      ref={stepRegionRef}
      tabIndex={-1}
      data-testid="onboarding-step-region"
      className="outline-none"
    >
      {/*
        Denial happens on the permission step but the client advances past it
        immediately afterward (permission has no server-persisted screen of
        its own), so the reminder has to survive onto the capture step to
        ever be seen; it clears once the user moves past capture.
       */}
      {showPermissionDeniedBanner && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
          {t('wardrobe.onboarding.permissionDenied')}
        </p>
      )}

      {currentStep === 'permission' && (
        <PermissionStep
          t={t}
          isRequesting={isRequestingPermission || isAdvancing}
          onAllow={onAllowPermission}
        />
      )}

      {(currentStep === 'capture' || currentStep === 'tagging') && (
        <CaptureAndTaggingStep
          t={t}
          garments={garments}
          garmentPositions={garmentPositions}
          timedOutGarmentIds={timedOutGarmentIds}
          allTagged={allTagged}
          isAdvancing={isAdvancing}
          phase={currentStep}
          addAnotherButtonRef={addAnotherButtonRef}
          taggingButtonRefs={taggingButtonRefs}
          onAddAnother={onAddAnother}
          onOpenTagging={onOpenTagging}
          onUseStarterWardrobe={onUseStarterWardrobe}
          onContinue={
            currentStep === 'capture' ? onContinueFromCapture : onContinueFromTagging
          }
        />
      )}

      {currentStep === 'silhouette' && (
        <div className="mt-6 flex flex-col gap-6">
          <SilhouetteSettingsPanel
            userId={userId}
            onBusyChange={onSilhouetteBusyChange}
          />
          <button
            type="button"
            disabled={isAdvancing || isSilhouetteBusy}
            onClick={onFinishOnboarding}
            className="min-h-[44px] self-start rounded-lg bg-zinc-900 px-6 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t('wardrobe.onboarding.continue')}
          </button>
        </div>
      )}

      {currentStep === 'complete' && (
        <div className="mt-6 flex flex-col items-start gap-4">
          <p
            role="status"
            className="text-lg font-semibold text-emerald-700 dark:text-emerald-300"
          >
            {t('wardrobe.onboarding.complete')}
          </p>
          <button
            type="button"
            onClick={onGoToWardrobe}
            className="min-h-[44px] rounded-lg bg-zinc-900 px-6 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t('wardrobe.onboarding.continue')}
          </button>
        </div>
      )}
    </div>
  )
}

interface PermissionStepProps {
  t: (key: string) => string
  isRequesting: boolean
  onAllow: () => void
}

function PermissionStep({ t, isRequesting, onAllow }: PermissionStepProps) {
  return (
    <div className="mt-6 flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {t('wardrobe.onboarding.permissionTitle')}
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t('wardrobe.onboarding.permissionBody')}
      </p>
      <button
        type="button"
        disabled={isRequesting}
        onClick={onAllow}
        className="min-h-[44px] self-start rounded-lg bg-zinc-900 px-6 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {t('wardrobe.onboarding.permissionAction')}
      </button>
    </div>
  )
}

interface CaptureAndTaggingStepProps {
  t: (key: string, options?: Record<string, unknown>) => string
  garments: GarmentItemContract[]
  garmentPositions: Map<string, number>
  timedOutGarmentIds: Set<string>
  allTagged: boolean
  isAdvancing: boolean
  phase: 'capture' | 'tagging'
  addAnotherButtonRef: React.RefObject<HTMLButtonElement | null>
  taggingButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>
  onAddAnother: () => void
  onOpenTagging: (garmentId: string) => void
  onUseStarterWardrobe: () => void
  onContinue: () => void
}

function CaptureAndTaggingStep({
  t,
  garments,
  garmentPositions,
  timedOutGarmentIds,
  allTagged,
  isAdvancing,
  phase,
  addAnotherButtonRef,
  taggingButtonRefs,
  onAddAnother,
  onOpenTagging,
  onUseStarterWardrobe,
  onContinue,
}: CaptureAndTaggingStepProps) {
  const continueDisabled =
    isAdvancing || (phase === 'capture' ? garments.length === 0 : !allTagged)

  return (
    <div className="mt-6 flex flex-col gap-4">
      {garments.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="onboarding-garment-checklist">
          {garments.map((garment) => {
            const label = describeGarment(
              garment,
              garmentPositions.get(garment.id) ?? 0,
              t
            )
            const tagged = isTagged(garment)
            const isRecheckable =
              garment.status === 'awaiting_tags' || timedOutGarmentIds.has(garment.id)
            const isFailed = garment.status === 'failed'
            /**
             * Neither state has a tagging action to offer yet: a still-processing
             * garment isn't `awaiting_tags` until smart-tagging inference
             * finishes (live-polled by `pollCommittedGarment`), and a failed one
             * never will be. Rendering a "needs tags" button for either would
             * let a user open tagging for a garment with no image ready to tag.
             */
            return (
              <li
                key={garment.id}
                className="flex items-center rounded-lg border border-zinc-200 p-1 text-sm dark:border-zinc-800"
              >
                {tagged ? (
                  <span className="px-2 py-2 text-emerald-700 dark:text-emerald-300">
                    {t('wardrobe.onboarding.checklistTagged', { garment: label })}
                  </span>
                ) : isFailed ? (
                  <span
                    data-testid={`garment-status-${garment.id}`}
                    className="px-2 py-2 text-red-700 dark:text-red-300"
                  >
                    {t('wardrobe.onboarding.checklistFailed', { garment: label })}
                  </span>
                ) : isRecheckable ? (
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) taggingButtonRefs.current.set(garment.id, element)
                      else taggingButtonRefs.current.delete(garment.id)
                    }}
                    onClick={() => onOpenTagging(garment.id)}
                    className="min-h-[44px] w-full rounded px-2 py-1 text-left font-semibold text-gold-700 hover:bg-gold-500/10 dark:text-gold-300"
                  >
                    {t('wardrobe.onboarding.checklistPending', { garment: label })}
                  </button>
                ) : (
                  <span
                    data-testid={`garment-status-${garment.id}`}
                    className="px-2 py-2 text-zinc-500 dark:text-zinc-400"
                  >
                    {t('wardrobe.onboarding.checklistProcessing', { garment: label })}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          ref={addAnotherButtonRef}
          type="button"
          onClick={onAddAnother}
          className="min-h-[44px] rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t('wardrobe.onboarding.addAnother')}
        </button>
        {/*
          Only offered before any garment is captured: AC 1 defines "capture real
          garments" and "skip with the starter wardrobe" as mutually exclusive
          paths, so a captured-but-not-yet-tagged garment must not be skippable
          via this action once it exists.
         */}
        {phase === 'capture' && garments.length === 0 && (
          <button
            type="button"
            onClick={onUseStarterWardrobe}
            disabled={isAdvancing}
            className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
          >
            {t('wardrobe.onboarding.useStarterWardrobe')}
          </button>
        )}
        <button
          type="button"
          disabled={continueDisabled}
          onClick={onContinue}
          className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          {t('wardrobe.onboarding.continue')}
        </button>
      </div>
    </div>
  )
}
