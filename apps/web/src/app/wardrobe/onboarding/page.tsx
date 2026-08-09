// Story 4.4 Task 5 owner: guided wardrobe onboarding flow (permission, capture/tag loop,
// starter-wardrobe skip, silhouette, completion), orchestrating the existing Story 4.1/4.2
// capture and tagging components against the server-authoritative onboarding state machine.
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { I18nextProvider, useTranslation } from 'react-i18next'
import type {
  GarmentItemContract,
  WardrobeOnboardingStateContract,
  WardrobeOnboardingStep,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { SkipToContent } from '../../components/skip-to-content'
import { GarmentCaptureModal } from '../../components/garment-capture-modal'
import { GarmentTaggingModal } from '../../components/garment-tagging-modal'
import { SilhouetteSettingsPanel } from '../../components/silhouette-settings-panel'
import {
  resolveCurrentUserId,
  getOnboardingStateFromWeb,
  advanceOnboardingStepFromWeb,
  listGarmentsFromWeb,
  onboardingETag,
} from '../../../lib/wardrobe'

export default function WardrobeOnboardingPage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      <OnboardingFlow />
    </I18nextProvider>
  )
}

/** Every captured garment needs tags; a label distinguishes rows before a category exists. */
function describeGarment(garment: GarmentItemContract, position: number): string {
  return garment.category ? garment.category : `Garment ${position}`
}

function isTagged(garment: GarmentItemContract): boolean {
  return garment.tagsConfirmedAt !== null
}

function OnboardingFlow() {
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

  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)

  const revisionRef = useRef(0)
  const addAnotherButtonRef = useRef<HTMLButtonElement | null>(null)
  const taggingButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingTaggingGarmentIdRef = useRef<string | null>(null)

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
          if (!cancelled) setGarments(persisted)
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
    // Runs once on mount; `t`/`router` are stable in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const advanceStep = useCallback(
    async (targetStep: WardrobeOnboardingStep, usedStarterWardrobe?: boolean) => {
      if (!userId) return null
      setIsAdvancing(true)
      setAdvanceError(null)
      const controller = new AbortController()
      try {
        const next = await advanceOnboardingStepFromWeb(
          usedStarterWardrobe === undefined
            ? { targetStep }
            : { targetStep, usedStarterWardrobe },
          onboardingETag(userId, revisionRef.current),
          controller.signal
        )
        revisionRef.current = next.revision
        setOnboardingState(next)
        return next
      } catch (error) {
        setAdvanceError(
          error instanceof Error
            ? error.message
            : t('wardrobe.onboarding.errors.saveFailed')
        )
        return null
      } finally {
        setIsAdvancing(false)
      }
    },
    [userId, t]
  )

  const handleAllowPermission = async () => {
    setIsRequestingPermission(true)
    setPermissionDenied(false)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermissionDenied(true)
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        stream.getTracks().forEach((track) => track.stop())
      }
    } catch {
      setPermissionDenied(true)
    } finally {
      setIsRequestingPermission(false)
    }
    await advanceStep('capture')
  }

  const openCapture = () => setIsCaptureModalOpen(true)

  const handleGarmentCommitted = (garment: GarmentItemContract) => {
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
    if (garment.status === 'awaiting_tags') {
      pendingTaggingGarmentIdRef.current = garment.id
    }
  }

  const closeCapture = () => {
    setIsCaptureModalOpen(false)
    const pendingGarmentId = pendingTaggingGarmentIdRef.current
    pendingTaggingGarmentIdRef.current = null
    if (pendingGarmentId) {
      window.requestAnimationFrame(() => setTaggingGarmentId(pendingGarmentId))
    }
  }

  const handleTagsConfirmed = (updatedGarment: GarmentItemContract) => {
    setGarments((current) =>
      current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
    )
    setTaggingGarmentId(null)
  }

  const handleUseStarterWardrobe = () => {
    void advanceStep('silhouette', true)
  }

  const handleContinueFromCapture = () => {
    void advanceStep('tagging')
  }

  const handleContinueFromTagging = () => {
    void advanceStep('silhouette')
  }

  const handleFinishOnboarding = () => {
    void advanceStep('complete')
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p role="status" className="text-sm text-zinc-500">
          Loading…
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
  const allTagged = garments.length > 0 && garments.every(isTagged)

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
            allTagged={allTagged}
            isAdvancing={isAdvancing}
            addAnotherButtonRef={addAnotherButtonRef}
            taggingButtonRefs={taggingButtonRefs}
            onAddAnother={openCapture}
            onOpenTagging={(id) => setTaggingGarmentId(id)}
            onUseStarterWardrobe={handleUseStarterWardrobe}
            onContinueFromCapture={handleContinueFromCapture}
            onContinueFromTagging={handleContinueFromTagging}
            onFinishOnboarding={handleFinishOnboarding}
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
        invokingElementRef={addAnotherButtonRef}
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
  allTagged: boolean
  isAdvancing: boolean
  addAnotherButtonRef: React.RefObject<HTMLButtonElement | null>
  taggingButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>
  onAddAnother: () => void
  onOpenTagging: (garmentId: string) => void
  onUseStarterWardrobe: () => void
  onContinueFromCapture: () => void
  onContinueFromTagging: () => void
  onFinishOnboarding: () => void
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
  allTagged,
  isAdvancing,
  addAnotherButtonRef,
  taggingButtonRefs,
  onAddAnother,
  onOpenTagging,
  onUseStarterWardrobe,
  onContinueFromCapture,
  onContinueFromTagging,
  onFinishOnboarding,
  onGoToWardrobe,
  userId,
}: OnboardingStepContentProps) {
  const showPermissionDeniedBanner =
    permissionDenied && (currentStep === 'permission' || currentStep === 'capture')

  return (
    <>
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
          isRequesting={isRequestingPermission}
          onAllow={onAllowPermission}
        />
      )}

      {(currentStep === 'capture' || currentStep === 'tagging') && (
        <CaptureAndTaggingStep
          t={t}
          garments={garments}
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
          <SilhouetteSettingsPanel userId={userId} />
          <button
            type="button"
            disabled={isAdvancing}
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
    </>
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
        {t('wardrobe.onboarding.permissionTitle')}
      </button>
    </div>
  )
}

interface CaptureAndTaggingStepProps {
  t: (key: string, options?: Record<string, unknown>) => string
  garments: GarmentItemContract[]
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
          {garments.map((garment, index) => {
            const label = describeGarment(garment, index + 1)
            const tagged = isTagged(garment)
            return (
              <li
                key={garment.id}
                className="flex items-center rounded-lg border border-zinc-200 p-1 text-sm dark:border-zinc-800"
              >
                {tagged ? (
                  <span className="px-2 py-2 text-emerald-700 dark:text-emerald-300">
                    {t('wardrobe.onboarding.checklistTagged', { garment: label })}
                  </span>
                ) : (
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
        {phase === 'capture' && (
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
