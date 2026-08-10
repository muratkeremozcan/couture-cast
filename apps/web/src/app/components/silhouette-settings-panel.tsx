// Story 4.4 Task 5 owner: web silhouette sliders + "My Form" photo settings panel,
// reachable both inline as the onboarding silhouette step and standalone (decision 3).
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  SilhouetteProfileContract,
  SilhouettePhotoFailureReason,
} from '@couture/api-client/contracts/http'
import {
  getSilhouetteProfileFromWeb,
  updateSilhouetteSlidersFromWeb,
  uploadMyFormPhotoFromWeb,
  deleteMyFormPhotoFromWeb,
  silhouetteETag,
  isStaleRevisionError,
  generateIdempotencyKey,
  type UploadMyFormPhotoInput,
} from '../../lib/wardrobe'

export interface SilhouetteSettingsPanelProps {
  /** The signed-in user's id; the strong entity tag is `"silhouette:<userId>:<revision>"`. */
  userId: string
  getProfile?: (signal?: AbortSignal) => Promise<SilhouetteProfileContract>
  saveSliders?: (
    input: { heightSlider: number; buildSlider: number },
    ifMatch: string,
    signal?: AbortSignal
  ) => Promise<SilhouetteProfileContract>
  uploadMyFormPhoto?: (
    input: UploadMyFormPhotoInput
  ) => Promise<SilhouetteProfileContract>
  removeMyFormPhoto?: (
    ifMatch: string,
    signal?: AbortSignal
  ) => Promise<SilhouetteProfileContract>
  /** Notified after every successful load or mutation, for parent orchestration. */
  onProfileChange?: (profile: SilhouetteProfileContract) => void
  /**
   * Notified whenever an upload or poll starts/stops, so a parent can guard
   * navigation away (closing this panel mid-upload silently aborts it).
   */
  onBusyChange?: (busy: boolean) => void
  /** Overridable for tests; the default mirrors the wardrobe hub's processing poll cadence. */
  pollIntervalsMs?: readonly number[]
  /** Overridable for tests, so slider auto-save doesn't need a real 400ms wait. */
  sliderSaveDebounceMs?: number
}

const DEFAULT_POLL_INTERVALS_MS = [1_000, 2_000, 4_000, 8_000] as const
const SLIDER_SAVE_DEBOUNCE_MS = 400

const FAILURE_REASON_KEY: Record<SilhouettePhotoFailureReason, string> = {
  contrast: 'wardrobe.silhouette.errors.contrast',
  privacy_violation: 'wardrobe.silhouette.errors.privacyViolation',
  timeout: 'wardrobe.silhouette.errors.timeout',
  storage_error: 'wardrobe.silhouette.errors.storageError',
}

function fileToDataUrl(file: File, fileReadFailedMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        resolve(event.target.result)
        return
      }
      reject(new Error(fileReadFailedMessage))
    }
    reader.onerror = () => reject(new Error(fileReadFailedMessage))
    reader.readAsDataURL(file)
  })
}

/**
 * Decision 4: "two independent 0-100 integer sliders... that reshape the
 * rendered mannequin continuously." A stylized black silhouette, not a photo
 * or a labeled body-type taxonomy: height stretches the whole figure from
 * its feet, build widens the torso and hips independently. Purely a visual
 * echo of the two range inputs' own values, so it is decorative, not a
 * second control surface: a screen-reader user already gets the actual
 * height/build values from the sliders themselves.
 */
function MannequinPreview({
  heightSlider,
  buildSlider,
}: {
  heightSlider: number
  buildSlider: number
}) {
  const heightScale = 0.8 + (heightSlider / 100) * 0.4
  const buildScale = 0.75 + (buildSlider / 100) * 0.5

  return (
    <div className="flex justify-center py-2">
      <svg
        viewBox="0 0 120 220"
        aria-hidden="true"
        className="h-48 w-24 text-zinc-900 dark:text-zinc-100"
        data-testid="silhouette-mannequin"
      >
        <g style={{ transform: `scaleY(${heightScale})`, transformOrigin: '60px 210px' }}>
          <circle cx="60" cy="26" r="18" fill="currentColor" />
          <rect
            x="38"
            y="48"
            width="44"
            height="80"
            rx="16"
            fill="currentColor"
            style={{ transform: `scaleX(${buildScale})`, transformOrigin: '60px 88px' }}
          />
          <rect
            x="38"
            y="128"
            width="44"
            height="82"
            rx="10"
            fill="currentColor"
            style={{ transform: `scaleX(${buildScale})`, transformOrigin: '60px 128px' }}
          />
        </g>
      </svg>
    </div>
  )
}

interface MyFormPanelProps {
  t: (key: string) => string
  myForm: SilhouetteProfileContract['myForm']
  isMyFormActive: boolean
  confirmChecked: boolean
  confirmError: string | null
  confirmCheckboxRef: React.RefObject<HTMLInputElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isUploading: boolean
  isPolling: boolean
  isRemoving: boolean
  displayError: string | null
  canRetry: boolean
  onConfirmChange: (checked: boolean) => void
  onUploadButtonClick: () => void
  onFileSelected: (event: React.ChangeEvent<HTMLInputElement>) => void
  onRetryUpload: () => void
  onRemoveMyForm: () => void
}

/**
 * All "My Form" upload-lifecycle UI: guidance, basewear confirmation, the
 * upload trigger, in-flight status, reason-specific errors with retry, and
 * the ready state. Split out of `SilhouetteSettingsPanel` to keep that
 * component's cyclomatic complexity within the project's lint budget.
 */
function MyFormPanel({
  t,
  myForm,
  isMyFormActive,
  confirmChecked,
  confirmError,
  confirmCheckboxRef,
  fileInputRef,
  isUploading,
  isPolling,
  isRemoving,
  displayError,
  canRetry,
  onConfirmChange,
  onUploadButtonClick,
  onFileSelected,
  onRetryUpload,
  onRemoveMyForm,
}: MyFormPanelProps) {
  const isReady = isMyFormActive && myForm?.status === 'ready'

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {t('wardrobe.silhouette.myFormUpload')}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t('wardrobe.silhouette.myFormGuidance')}
      </p>

      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          ref={confirmCheckboxRef}
          type="checkbox"
          checked={confirmChecked}
          onChange={(event) => onConfirmChange(event.target.checked)}
          aria-label={t('wardrobe.silhouette.myFormConfirm')}
          className="h-5 w-5 rounded border-zinc-300 focus:ring-2 focus:ring-black focus:ring-offset-2"
        />
        {t('wardrobe.silhouette.myFormConfirm')}
      </label>

      {confirmError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {confirmError}
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        aria-label={t('wardrobe.silhouette.myFormFileLabel')}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFileSelected}
      />

      {(isUploading || isPolling) && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-300">
          {t('wardrobe.silhouette.processing')}
        </p>
      )}

      {displayError && (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {displayError}
          </p>
          {canRetry && (
            <button
              type="button"
              onClick={onRetryUpload}
              className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t('wardrobe.silhouette.myFormRetry')}
            </button>
          )}
        </div>
      )}

      {/*
        Always offered when not mid-flight, even alongside a visible error:
        a reload wipes the session-local retry state (see `canRetry`), and a
        content-based failure (contrast/privacy) can only ever be fixed by
        choosing a different photo, not by resubmitting the same bytes.
       */}
      {!isMyFormActive && !isUploading && !isPolling && (
        <button
          type="button"
          onClick={onUploadButtonClick}
          className="min-h-[44px] rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t('wardrobe.silhouette.myFormUpload')}
        </button>
      )}

      {isReady && (
        <div className="flex flex-col items-start gap-3">
          <p
            role="status"
            className="text-sm font-semibold text-emerald-700 dark:text-emerald-300"
          >
            {t('wardrobe.silhouette.ready')}
          </p>
          {myForm?.imageAccess && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={myForm.imageAccess.url}
              alt={t('wardrobe.silhouette.myFormImageAlt')}
              className="h-32 w-24 rounded-lg object-cover"
            />
          )}
          <button
            type="button"
            disabled={isRemoving}
            onClick={onRemoveMyForm}
            className="min-h-[44px] rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
          >
            {t('wardrobe.silhouette.myFormRemove')}
          </button>
        </div>
      )}
    </div>
  )
}

export function SilhouetteSettingsPanel({
  userId,
  getProfile = getSilhouetteProfileFromWeb,
  saveSliders = updateSilhouetteSlidersFromWeb,
  uploadMyFormPhoto = uploadMyFormPhotoFromWeb,
  removeMyFormPhoto = deleteMyFormPhotoFromWeb,
  onProfileChange,
  onBusyChange,
  pollIntervalsMs = DEFAULT_POLL_INTERVALS_MS,
  sliderSaveDebounceMs = SLIDER_SAVE_DEBOUNCE_MS,
}: SilhouetteSettingsPanelProps) {
  const { t } = useTranslation()
  const [profile, setProfile] = useState<SilhouetteProfileContract | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [heightSlider, setHeightSlider] = useState(50)
  const [buildSlider, setBuildSlider] = useState(50)
  const [sliderError, setSliderError] = useState<string | null>(null)

  const [confirmChecked, setConfirmChecked] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  /** True from the moment a slider edit is scheduled until its save request settles. */
  const [isSliderDirty, setIsSliderDirty] = useState(false)
  /** Set when the server rejects a mutation for a revision this client no longer holds. */
  const [isRevisionStale, setIsRevisionStale] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const confirmCheckboxRef = useRef<HTMLInputElement | null>(null)
  const sliderSaveTimerRef = useRef<number | null>(null)
  /** The most recent not-yet-sent slider values, so an unmount mid-debounce can flush them (see #3). */
  const pendingSliderEditRef = useRef<{ height: number; build: number } | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  /**
   * Separate abort controllers per mutation kind: a slider save and a My Form
   * removal are unrelated actions that both happen to write the same profile
   * row, so one starting must never client-abort the other's still-in-flight
   * request. A client-side abort does not prove the server cancelled it, and
   * the two calls racing to abort each other made whichever finished last
   * silently win with no error surfaced for the loser.
   */
  const sliderMutationAbortRef = useRef<AbortController | null>(null)
  const removeMutationAbortRef = useRef<AbortController | null>(null)
  const revisionRef = useRef(0)

  useEffect(() => {
    onBusyChange?.(isUploading || isPolling || isSliderDirty || isRemoving)
  }, [isUploading, isPolling, isSliderDirty, isRemoving, onBusyChange])

  const applyProfile = useCallback(
    (next: SilhouetteProfileContract) => {
      setProfile(next)
      revisionRef.current = next.revision
      setIsRevisionStale(false)
      /**
       * Skip overwriting the sliders while a local edit is still debounced
       * (not yet sent): an unrelated concurrent mutation/poll completing
       * mid-drag must not snap the sliders back to the last-saved value.
       */
      if (sliderSaveTimerRef.current === null) {
        setHeightSlider(next.heightSlider ?? 50)
        setBuildSlider(next.buildSlider ?? 50)
      }
      onProfileChange?.(next)
    },
    [onProfileChange]
  )

  /**
   * Re-fetches the authoritative profile and reconciles `revisionRef` to it,
   * mirroring the capsule builder's `onStaleCapsule` reload precedent
   * (decision 3: converge with another client's committed writes the same
   * way Story 4.3 established) rather than leaving every subsequent retry
   * doomed to repeat the same stale-ETag rejection. User-triggered, not
   * automatic, so a still-unsaved local edit is never silently discarded.
   */
  const reloadProfile = useCallback(() => {
    setSliderError(null)
    setUploadError(null)
    getProfile()
      .then((fresh) => applyProfile(fresh))
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error))
      })
  }, [applyProfile, getProfile])

  const persistSliders = useCallback(
    (nextHeight: number, nextBuild: number) => {
      setSliderError(null)
      sliderMutationAbortRef.current?.abort()
      const controller = new AbortController()
      sliderMutationAbortRef.current = controller
      saveSliders(
        { heightSlider: nextHeight, buildSlider: nextBuild },
        silhouetteETag(userId, revisionRef.current),
        controller.signal
      )
        .then((saved) => {
          if (controller.signal.aborted) return
          applyProfile(saved)
          setIsSliderDirty(false)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setIsSliderDirty(false)
          const stale = isStaleRevisionError(error)
          setIsRevisionStale((current) => current || stale)
          setSliderError(
            stale
              ? t('wardrobe.onboarding.errors.stale')
              : error instanceof Error
                ? error.message
                : String(error)
          )
        })
    },
    [applyProfile, saveSliders, t, userId]
  )

  const scheduleSliderSave = useCallback(
    (nextHeight: number, nextBuild: number) => {
      if (sliderSaveTimerRef.current !== null)
        window.clearTimeout(sliderSaveTimerRef.current)
      pendingSliderEditRef.current = { height: nextHeight, build: nextBuild }
      setIsSliderDirty(true)
      sliderSaveTimerRef.current = window.setTimeout(() => {
        sliderSaveTimerRef.current = null
        pendingSliderEditRef.current = null
        persistSliders(nextHeight, nextBuild)
      }, sliderSaveDebounceMs)
    },
    [persistSliders, sliderSaveDebounceMs]
  )

  const handleHeightChange = (value: number) => {
    setHeightSlider(value)
    scheduleSliderSave(value, buildSlider)
  }

  const handleBuildChange = (value: number) => {
    setBuildSlider(value)
    scheduleSliderSave(heightSlider, value)
  }

  const pollUntilSettled = useCallback(() => {
    pollAbortRef.current?.abort()
    const controller = new AbortController()
    pollAbortRef.current = controller
    setIsPolling(true)

    void (async () => {
      try {
        for (const delayMs of pollIntervalsMs) {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, delayMs)
            controller.signal.addEventListener(
              'abort',
              () => {
                window.clearTimeout(timer)
                reject(new DOMException('Polling aborted', 'AbortError'))
              },
              { once: true }
            )
          })
          const latest = await getProfile(controller.signal)
          if (controller.signal.aborted) return
          /**
           * Status alone decides whether to keep polling. An unrelated
           * concurrent mutation (a slider save) bumps `revision` without
           * ending this upload's processing job; a genuinely different
           * processing job always starts its own `pollUntilSettled` call,
           * which aborts this one first (see the abort at the top of this
           * function), so "still processing" here always means the same
           * job this loop started for.
           */
          if (latest.myForm?.status === 'processing') {
            continue
          }
          applyProfile(latest)
          return
        }
        // Every scheduled poll attempt still reported "processing": surface
        // the same client-visible outcome the server would report for a
        // genuine timeout, with a retry action, instead of going silently
        // blank (a slow-but-alive backend pipeline hits this every time).
        if (!controller.signal.aborted) {
          setUploadError(t('wardrobe.silhouette.errors.timeout'))
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setUploadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!controller.signal.aborted) setIsPolling(false)
      }
    })()
  }, [applyProfile, getProfile, pollIntervalsMs, t])

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setLoadError(null)
    getProfile(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        applyProfile(loaded)
        // Resume polling a photo left "processing" by a prior session
        // (e.g. the page was reloaded mid-processing); otherwise the panel
        // renders nothing at all for this state.
        if (loaded.myForm?.status === 'processing') {
          pollUntilSettled()
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
    // Only ever loads once per mount; `getProfile`/`pollUntilSettled` are
    // effectively stable DI defaults in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort()
      sliderMutationAbortRef.current?.abort()
      removeMutationAbortRef.current?.abort()
      if (sliderSaveTimerRef.current !== null) {
        window.clearTimeout(sliderSaveTimerRef.current)
        if (pendingSliderEditRef.current) {
          // Flush instead of discard: the debounce is a UI nicety, not a
          // reason to lose an edit the user already made — AC2 requires
          // slider values to "persist... immediately".
          persistSliders(
            pendingSliderEditRef.current.height,
            pendingSliderEditRef.current.build
          )
        }
      }
    }
    // Mount-only cleanup; `persistSliders`'s own deps are stable in practice,
    // matching the same tradeoff already accepted for `getProfile` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startUpload = useCallback(
    (imagePreview: string, key: string) => {
      setIsUploading(true)
      setUploadError(null)
      uploadMyFormPhoto({
        imagePreview,
        idempotencyKey: key,
        confirmsBasewearGuidance: true,
      })
        .then((saved) => {
          setIsUploading(false)
          applyProfile(saved)
          if (saved.myForm?.status === 'processing') {
            pollUntilSettled()
          }
        })
        .catch((error: unknown) => {
          setIsUploading(false)
          setUploadError(error instanceof Error ? error.message : String(error))
        })
    },
    [applyProfile, pollUntilSettled, uploadMyFormPhoto]
  )

  const handleConfirmChange = (checked: boolean) => {
    setConfirmChecked(checked)
    if (checked) setConfirmError(null)
  }

  const handleUploadButtonClick = () => {
    setUploadError(null)
    if (!confirmChecked) {
      setConfirmError(t('wardrobe.silhouette.errors.confirmRequired'))
      confirmCheckboxRef.current?.focus()
      return
    }
    setConfirmError(null)
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const preview = await fileToDataUrl(
        file,
        t('wardrobe.silhouette.errors.fileReadFailed')
      )
      /** One key per logical attempt: minted here, reused by every retry below. */
      const key = generateIdempotencyKey()
      setUploadPreview(preview)
      setIdempotencyKey(key)
      startUpload(preview, key)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleRetryUpload = () => {
    if (!uploadPreview || !idempotencyKey) return
    /**
     * Retry bypasses the file picker, so it also bypasses the confirmation
     * gate `handleUploadButtonClick` normally enforces. Re-check it here: a
     * user can uncheck the box after a failed attempt, and the request this
     * sends must reflect that live state rather than blindly reasserting the
     * confirmation the first attempt captured.
     */
    if (!confirmChecked) {
      setConfirmError(t('wardrobe.silhouette.errors.confirmRequired'))
      confirmCheckboxRef.current?.focus()
      return
    }
    setConfirmError(null)
    startUpload(uploadPreview, idempotencyKey)
  }

  const handleRemoveMyForm = () => {
    setIsRemoving(true)
    setUploadError(null)
    removeMutationAbortRef.current?.abort()
    const controller = new AbortController()
    removeMutationAbortRef.current = controller
    removeMyFormPhoto(silhouetteETag(userId, revisionRef.current), controller.signal)
      .then((saved) => {
        if (controller.signal.aborted) return
        setUploadPreview(null)
        setIdempotencyKey(null)
        applyProfile(saved)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const stale = isStaleRevisionError(error)
        setIsRevisionStale((current) => current || stale)
        setUploadError(
          stale
            ? t('wardrobe.onboarding.errors.stale')
            : error instanceof Error
              ? error.message
              : String(error)
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsRemoving(false)
      })
  }

  if (isLoading) {
    return (
      <p role="status" className="text-sm text-zinc-500" data-testid="silhouette-loading">
        {t('wardrobe.silhouette.loading')}
      </p>
    )
  }

  if (loadError) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        {loadError}
      </p>
    )
  }

  const myForm = profile?.myForm ?? null
  const isMyFormActive = profile?.mode === 'my_form'
  const failureReasonKey = myForm?.failureReason
    ? FAILURE_REASON_KEY[myForm.failureReason]
    : undefined
  const failureMessage =
    myForm?.status === 'failed'
      ? failureReasonKey
        ? t(failureReasonKey)
        : // Defensive fallback: the commit response isn't schema-validated at
          // the call site (unlike reads), so an out-of-contract reason from a
          // future/skewed backend still renders something actionable.
          t('wardrobe.silhouette.errors.unknown')
      : null
  /**
   * A retry is offered for both a server-reported `failed` status and a
   * network-level rejection (the upload never reached the server at all).
   * Either way, `uploadPreview`/`idempotencyKey` are still around to reuse.
   *
   * `contrast` and `privacy_violation` are excluded: decision 8 defines them
   * as terminal business outcomes about this specific photo's content, not
   * transient faults, so replaying the identical bytes would only fail the
   * same way again. Only `timeout`/`storage_error` (and a network-level
   * rejection that never reached the server) are safe to replay.
   */
  const isTerminalContentFailure =
    myForm?.failureReason === 'contrast' || myForm?.failureReason === 'privacy_violation'
  const displayError = failureMessage ?? uploadError
  const canRetry = Boolean(
    displayError && uploadPreview && idempotencyKey && !isTerminalContentFailure
  )

  return (
    <div className="flex flex-col gap-6" data-testid="silhouette-settings-panel">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t('wardrobe.silhouette.title')}
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {isMyFormActive
            ? t('wardrobe.silhouette.modeMyForm')
            : t('wardrobe.silhouette.modeDefault')}
        </p>
      </div>

      {sliderError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {sliderError}
        </p>
      )}

      {isRevisionStale && (
        <button
          type="button"
          onClick={reloadProfile}
          className="w-full rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-200"
        >
          Reload the latest version
        </button>
      )}

      <MannequinPreview heightSlider={heightSlider} buildSlider={buildSlider} />

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('wardrobe.silhouette.heightSliderLabel')}
          <input
            type="range"
            min={0}
            max={100}
            value={heightSlider}
            aria-label={t('wardrobe.silhouette.heightSliderLabel')}
            onChange={(event) => handleHeightChange(Number(event.target.value))}
            className="h-11 w-full"
            data-testid="silhouette-height-slider"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('wardrobe.silhouette.buildSliderLabel')}
          <input
            type="range"
            min={0}
            max={100}
            value={buildSlider}
            aria-label={t('wardrobe.silhouette.buildSliderLabel')}
            onChange={(event) => handleBuildChange(Number(event.target.value))}
            className="h-11 w-full"
            data-testid="silhouette-build-slider"
          />
        </label>
      </div>

      <MyFormPanel
        t={t}
        myForm={myForm}
        isMyFormActive={isMyFormActive}
        confirmChecked={confirmChecked}
        confirmError={confirmError}
        confirmCheckboxRef={confirmCheckboxRef}
        fileInputRef={fileInputRef}
        isUploading={isUploading}
        isPolling={isPolling}
        isRemoving={isRemoving}
        displayError={displayError}
        canRetry={canRetry}
        onConfirmChange={handleConfirmChange}
        onUploadButtonClick={handleUploadButtonClick}
        onFileSelected={(event) => {
          void handleFileSelected(event)
        }}
        onRetryUpload={handleRetryUpload}
        onRemoveMyForm={handleRemoveMyForm}
      />
    </div>
  )
}
