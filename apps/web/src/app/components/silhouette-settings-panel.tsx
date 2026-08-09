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
  /** Overridable for tests; the default mirrors the wardrobe hub's processing poll cadence. */
  pollIntervalsMs?: readonly number[]
}

const DEFAULT_POLL_INTERVALS_MS = [1_000, 2_000, 4_000, 8_000] as const
const SLIDER_SAVE_DEBOUNCE_MS = 400

const FAILURE_REASON_KEY: Record<SilhouettePhotoFailureReason, string> = {
  contrast: 'wardrobe.silhouette.errors.contrast',
  privacy_violation: 'wardrobe.silhouette.errors.privacyViolation',
  timeout: 'wardrobe.silhouette.errors.timeout',
  storage_error: 'wardrobe.silhouette.errors.storageError',
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        resolve(event.target.result)
        return
      }
      reject(new Error('The selected photo could not be read.'))
    }
    reader.onerror = () => reject(new Error('The selected photo could not be read.'))
    reader.readAsDataURL(file)
  })
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
        aria-label="My Form photo file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFileSelected}
      />

      {!isMyFormActive && !isUploading && !isPolling && !displayError && (
        <button
          type="button"
          onClick={onUploadButtonClick}
          className="min-h-[44px] rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t('wardrobe.silhouette.myFormUpload')}
        </button>
      )}

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
              alt="My Form"
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
  pollIntervalsMs = DEFAULT_POLL_INTERVALS_MS,
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

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const confirmCheckboxRef = useRef<HTMLInputElement | null>(null)
  const sliderSaveTimerRef = useRef<number | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const mutationAbortRef = useRef<AbortController | null>(null)
  const revisionRef = useRef(0)

  const applyProfile = useCallback(
    (next: SilhouetteProfileContract) => {
      setProfile(next)
      revisionRef.current = next.revision
      setHeightSlider(next.heightSlider ?? 50)
      setBuildSlider(next.buildSlider ?? 50)
      onProfileChange?.(next)
    },
    [onProfileChange]
  )

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setLoadError(null)
    getProfile(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        applyProfile(loaded)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
    // Only ever loads once per mount; `getProfile` is a stable DI default in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (sliderSaveTimerRef.current !== null)
        window.clearTimeout(sliderSaveTimerRef.current)
      pollAbortRef.current?.abort()
      mutationAbortRef.current?.abort()
    }
  }, [])

  const persistSliders = useCallback(
    (nextHeight: number, nextBuild: number) => {
      setSliderError(null)
      const controller = new AbortController()
      mutationAbortRef.current = controller
      saveSliders(
        { heightSlider: nextHeight, buildSlider: nextBuild },
        silhouetteETag(userId, revisionRef.current),
        controller.signal
      )
        .then((saved) => applyProfile(saved))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setSliderError(error instanceof Error ? error.message : String(error))
        })
    },
    [applyProfile, saveSliders, userId]
  )

  const scheduleSliderSave = useCallback(
    (nextHeight: number, nextBuild: number) => {
      if (sliderSaveTimerRef.current !== null)
        window.clearTimeout(sliderSaveTimerRef.current)
      sliderSaveTimerRef.current = window.setTimeout(() => {
        persistSliders(nextHeight, nextBuild)
      }, SLIDER_SAVE_DEBOUNCE_MS)
    },
    [persistSliders]
  )

  const handleHeightChange = (value: number) => {
    setHeightSlider(value)
    scheduleSliderSave(value, buildSlider)
  }

  const handleBuildChange = (value: number) => {
    setBuildSlider(value)
    scheduleSliderSave(heightSlider, value)
  }

  const pollUntilSettled = useCallback(
    (startRevision: number) => {
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
            if (
              latest.myForm?.status === 'processing' &&
              latest.revision === startRevision
            ) {
              continue
            }
            applyProfile(latest)
            return
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setUploadError(error instanceof Error ? error.message : String(error))
          }
        } finally {
          if (!controller.signal.aborted) setIsPolling(false)
        }
      })()
    },
    [applyProfile, getProfile, pollIntervalsMs]
  )

  const startUpload = useCallback(
    (imagePreview: string, key: string) => {
      setIsUploading(true)
      setUploadError(null)
      uploadMyFormPhoto({ imagePreview, idempotencyKey: key })
        .then((saved) => {
          setIsUploading(false)
          applyProfile(saved)
          if (saved.myForm?.status === 'processing') {
            pollUntilSettled(saved.revision)
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
      const preview = await fileToDataUrl(file)
      /** One key per logical attempt: minted here, reused by every retry below. */
      const key = crypto.randomUUID()
      setUploadPreview(preview)
      setIdempotencyKey(key)
      startUpload(preview, key)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleRetryUpload = () => {
    if (!uploadPreview || !idempotencyKey) return
    startUpload(uploadPreview, idempotencyKey)
  }

  const handleRemoveMyForm = () => {
    setIsRemoving(true)
    setUploadError(null)
    const controller = new AbortController()
    mutationAbortRef.current = controller
    removeMyFormPhoto(silhouetteETag(userId, revisionRef.current), controller.signal)
      .then((saved) => {
        setUploadPreview(null)
        setIdempotencyKey(null)
        applyProfile(saved)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setUploadError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsRemoving(false)
      })
  }

  if (isLoading) {
    return (
      <p role="status" className="text-sm text-zinc-500" data-testid="silhouette-loading">
        Loading your silhouette…
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
  const failureMessage =
    myForm?.status === 'failed' && myForm.failureReason
      ? t(FAILURE_REASON_KEY[myForm.failureReason])
      : null
  /**
   * A retry is offered for both a server-reported `failed` status and a
   * network-level rejection (the upload never reached the server at all).
   * Either way, `uploadPreview`/`idempotencyKey` are still around to reuse.
   */
  const displayError = failureMessage ?? uploadError
  const canRetry = Boolean(displayError && uploadPreview && idempotencyKey)

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
