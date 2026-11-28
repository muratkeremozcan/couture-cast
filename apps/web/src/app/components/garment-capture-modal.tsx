// Story 4.1 Task 8 step 1 owner: implement web garment capture modal component with camera, cropping, background cleanup preview, and ARIA live regions
'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { flatLayStrings, getGuestPreviewStrings } from '@couture/utils'
import {
  createFlatLayClient,
  FlatLayCapture,
  type FlatLayCaptureState,
} from '@couture/api-client'
import type {
  GarmentItemContract,
  UploadAttemptSession,
} from '@couture/api-client/contracts/http'
import {
  prepareGarmentImage,
  uploadGarmentImageFromWeb,
  type PreparedImage,
  type UploadGarmentImageInput,
} from '../../lib/wardrobe'
import {
  garmentUploadErrorKey,
  type GarmentUploadErrorKey,
} from '../../lib/garment-upload-errors'
import {
  currentUploadSession,
  isUploadSessionCurrent,
  resolveUploadBearer,
  useUploadSessionChange,
} from '../../lib/upload-attempts'
import { AccessibleModal } from './accessible-modal'
import { WebGarmentPhotoBatch } from './garment-photo-batch'
import { FlatLayPicker, FlatLayReviewGrid } from './flat-lay-capture'
import { resolveWebApiBaseUrl } from '../../lib/api-client'
import { readStorage, WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'

const flatLayClient = createFlatLayClient(resolveWebApiBaseUrl, (session) =>
  resolveUploadBearer(
    session,
    () => readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null
  )
)

type PickedImage = { dataUrl: string; session: UploadAttemptSession }
type CropRatio = '1:1' | '4:3'

type PreparedCrop = {
  source: PickedImage
  aspectRatio: CropRatio
  useBgCleanup: boolean
  image: PreparedImage
  url: string
}

function usePreparedCrop(
  isOpen: boolean,
  source: PickedImage | null,
  aspectRatio: CropRatio,
  useBgCleanup: boolean,
  onError: (key: CaptureErrorKey) => void
) {
  const [crop, setCrop] = useState<PreparedCrop | null>(null)
  useEffect(() => {
    setCrop(null)
    if (!isOpen || !source) return
    let active = true
    let url: string | undefined
    void prepareGarmentImage(source.dataUrl, aspectRatio, useBgCleanup, 'compact')
      .then((image) => {
        if (!active || !isUploadSessionCurrent(source.session)) return
        url = URL.createObjectURL(image.blob)
        setCrop({ source, aspectRatio, useBgCleanup, image, url })
      })
      .catch((error: unknown) => {
        if (active) onError(garmentUploadErrorKey(error))
      })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [isOpen, source, aspectRatio, useBgCleanup, onError])
  if (
    !crop ||
    crop.source !== source ||
    crop.aspectRatio !== aspectRatio ||
    crop.useBgCleanup !== useBgCleanup
  )
    return null
  return crop
}

export interface GarmentCaptureModalProps {
  confirmDiscard?: boolean
  isOpen: boolean
  onClose: () => void
  onGarmentCommitted?: (garment: GarmentItemContract) => void
  onBatchGarmentCommitted?: (garment: GarmentItemContract) => void
  uploadGarment?: (input: UploadGarmentImageInput) => Promise<GarmentItemContract>
  invokingElementRef?: React.RefObject<HTMLElement | null>
}

export type CaptureStep = 'source' | 'camera' | 'crop' | 'uploading' | 'complete'

/** Every `wardrobe.capture.errors` key the modal can show; the member never reads raw error text. */
type CaptureErrorKey =
  | GarmentUploadErrorKey
  | 'cameraUnavailable'
  | 'cameraDenied'
  | 'unsupportedType'
  | 'fileTooLarge'
  | 'noImage'

/** The catalog key of each upload phase `uploadGarmentImageFromWeb` reports. */
const UPLOAD_STATUS_KEYS: Record<string, string> = {
  preparing: 'wardrobe.capture.status.preparing',
  requesting_upload: 'wardrobe.capture.status.requestingUpload',
  uploading: 'wardrobe.capture.status.uploading',
  verifying: 'wardrobe.capture.status.verifying',
  processing: 'wardrobe.capture.status.processing',
}

function SourceStep({
  onStartCamera,
  onFilePickerOpen,
  onFileSelect,
  flatLayPicker,
}: {
  onStartCamera: () => void
  onFilePickerOpen: () => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  flatLayPicker?: React.ReactNode
}) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="text-sm text-ink-soft">{t('wardrobe.capture.intro')}</p>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => {
            onStartCamera()
          }}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-line-strong p-6 font-semibold text-ink transition hover:border-ink hover:bg-card"
        >
          <span aria-hidden="true" className="text-2xl">
            📷
          </span>
          <span className="mt-2">{t('wardrobe.capture.takePhoto')}</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-line-strong p-6 font-semibold text-ink transition hover:border-ink hover:bg-card"
        >
          <span aria-hidden="true" className="text-2xl">
            📁
          </span>
          <span className="mt-2">{t('wardrobe.capture.chooseFile')}</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          aria-label={t('wardrobe.capture.fileLabel')}
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onClick={onFilePickerOpen}
          onChange={onFileSelect}
        />
      </div>
      {flatLayPicker}
    </div>
  )
}

function CaptureSource({
  flatLay,
  state,
  onClose,
  resetBatchRef,
  onFlatLayPickerOpen,
  onBatchPickerOpen,
  onBatchGarmentCommitted,
  uploadGarment,
  source,
}: {
  flatLay: FlatLayCapture
  state: FlatLayCaptureState
  onClose: () => void
  resetBatchRef: React.RefObject<(() => void) | null>
  onFlatLayPickerOpen: () => void
  onBatchPickerOpen: () => void
  onBatchGarmentCommitted: GarmentCaptureModalProps['onBatchGarmentCommitted']
  uploadGarment: NonNullable<GarmentCaptureModalProps['uploadGarment']>
  source: React.ComponentProps<typeof SourceStep>
}) {
  if (state.phase !== 'source') {
    return <FlatLayReviewGrid state={state} capture={flatLay} onClose={onClose} />
  }
  if (!onBatchGarmentCommitted) return <SourceStep {...source} />
  return (
    <WebGarmentPhotoBatch
      resetRef={resetBatchRef}
      onClose={onClose}
      onInitialPickerOpen={onBatchPickerOpen}
      onGarmentCommitted={onBatchGarmentCommitted}
      uploadGarment={uploadGarment}
    >
      <SourceStep
        {...source}
        flatLayPicker={<FlatLayPicker capture={flatLay} onOpen={onFlatLayPickerOpen} />}
      />
    </WebGarmentPhotoBatch>
  )
}

function captureErrorMessage(
  t: TFunction,
  copy: ReturnType<typeof flatLayStrings>,
  flatLayError: FlatLayCaptureState['error'],
  error: CaptureErrorKey | null
) {
  if (flatLayError === 'signedOut' || flatLayError === 'consentRequired') {
    return t(`wardrobe.capture.errors.${flatLayError}`)
  }
  if (flatLayError) return copy[flatLayError]
  return error ? t(`wardrobe.capture.errors.${error}`) : null
}

function CameraStep({
  videoRef,
  onCancel,
  onCapture,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  onCancel: () => void
  onCapture: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 flex flex-col items-center gap-4">
      {/* Tester report 2026-11-17: a phone camera streams a portrait frame, and a 16:9 box with
          object-cover showed a third of it while Snap Photo kept all of it. The preview takes the
          frame's own shape, capped to the screen, so it shows exactly what the photo holds. */}
      <div className="flex w-full justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="block max-h-[55dvh] w-auto max-w-full rounded-lg object-contain"
        />
      </div>
      <div className="flex gap-4">
        <button
          onClick={onCancel}
          className="rounded-lg border border-line-strong bg-page px-4 py-2 text-sm font-semibold text-ink hover:bg-card"
        >
          {t('wardrobe.capture.cancel')}
        </button>
        <button
          onClick={onCapture}
          className="rounded-lg bg-inverse px-6 py-2 text-sm font-semibold text-on-inverse hover:bg-inverse/90"
        >
          {t('wardrobe.capture.snapPhoto')}
        </button>
      </div>
    </div>
  )
}

function CropStep({
  preparedCrop,
  aspectRatio,
  setAspectRatio,
  useBgCleanup,
  setUseBgCleanup,
  onReset,
  onConfirm,
  confirmRef,
  retakeRef,
  preparationError,
  cleanupFallback,
}: {
  preparedCrop: PreparedCrop | null
  aspectRatio: '1:1' | '4:3'
  setAspectRatio: (ar: '1:1' | '4:3') => void
  useBgCleanup: boolean
  setUseBgCleanup: (val: boolean) => void
  onReset: () => void
  onConfirm: () => void
  confirmRef: React.Ref<HTMLButtonElement>
  retakeRef: React.Ref<HTMLButtonElement>
  preparationError: boolean
  cleanupFallback: string
}) {
  const { t } = useTranslation()
  const imagePreview = preparedCrop?.url
  const preparing = !preparedCrop && !preparationError
  const keptOriginal =
    useBgCleanup && preparedCrop && !preparedCrop.image.backgroundRemoved
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink-soft">
          {t('wardrobe.capture.aspectRatio')}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setAspectRatio('1:1')}
            className={`rounded-md px-3 py-1 text-xs font-bold ${
              aspectRatio === '1:1'
                ? 'bg-inverse text-on-inverse'
                : 'bg-card-muted text-ink-soft'
            }`}
          >
            {t('wardrobe.capture.aspectSquare')}
          </button>
          <button
            onClick={() => setAspectRatio('4:3')}
            className={`rounded-md px-3 py-1 text-xs font-bold ${
              aspectRatio === '4:3'
                ? 'bg-inverse text-on-inverse'
                : 'bg-card-muted text-ink-soft'
            }`}
          >
            {t('wardrobe.capture.aspectPortrait')}
          </button>
        </div>
      </div>

      <div
        className={`relative mx-auto overflow-hidden rounded-lg bg-card-muted ${
          aspectRatio === '1:1' ? 'aspect-square w-64' : 'aspect-[3/4] w-64'
        }`}
      >
        {imagePreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreview}
            alt={t('wardrobe.capture.previewAlt')}
            className="h-full w-full object-contain"
          />
        ) : preparing ? (
          <p role="status" className="p-4 text-center text-sm">
            {t('wardrobe.capture.status.preparing')}
          </p>
        ) : null}
      </div>
      {keptOriginal && (
        <p role="status" className="text-sm text-ink-soft">
          {cleanupFallback}
        </p>
      )}

      <div className="flex items-center justify-between rounded-lg bg-card p-3">
        <div>
          <span className="block text-sm font-semibold text-ink">
            {t('wardrobe.capture.cleanupLabel')}
          </span>
          <span className="text-xs text-ink-muted">
            {t('wardrobe.capture.cleanupHint')}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-label={t('wardrobe.capture.cleanupLabel')}
          aria-checked={useBgCleanup}
          onClick={() => setUseBgCleanup(!useBgCleanup)}
          // The global 44 px touch target sized the 24 px track itself into a disc; the button
          // keeps the touch target and draws the track inside it.
          className="inline-flex shrink-0 items-center justify-center"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
              useBgCleanup ? 'bg-inverse' : 'bg-line-strong'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-page transition ${
                useBgCleanup ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </span>
        </button>
      </div>

      {/* Phones stack the two actions full width in DOM order, so keyboard focus moves top to
          bottom; side by side they wrapped to two lines each on a 412 px screen. */}
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-between">
        <button
          ref={retakeRef}
          onClick={onReset}
          className="whitespace-nowrap rounded-lg border border-line-strong bg-page px-4 py-2 text-sm font-medium text-ink hover:bg-card"
        >
          {t('wardrobe.capture.retake')}
        </button>
        <button
          ref={confirmRef}
          disabled={!imagePreview}
          onClick={() => {
            onConfirm()
          }}
          className="whitespace-nowrap rounded-lg bg-inverse px-5 py-2 text-sm font-semibold text-on-inverse hover:bg-inverse/90 disabled:opacity-60"
        >
          {t('wardrobe.capture.useImage')}
        </button>
      </div>
    </div>
  )
}

function UploadingStep({
  uploadState,
  uploadProgress,
}: {
  uploadState: string
  uploadProgress: number
}) {
  const { t } = useTranslation()
  const statusKey = UPLOAD_STATUS_KEYS[uploadState]
  return (
    <div className="mt-8 flex flex-col items-center gap-4 py-6">
      <div className="h-3 w-full overflow-hidden rounded-full bg-card-muted">
        <div
          className="h-full bg-inverse transition-all duration-200"
          style={{ width: `${uploadProgress}%` }}
        />
      </div>
      <p className="text-sm font-semibold text-ink">
        {statusKey ? t(statusKey, { progress: uploadProgress }) : null}
      </p>
    </div>
  )
}

function CompleteStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mt-6 flex flex-col items-center gap-4 text-center py-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-2xl text-success-ink">
        ✓
      </div>
      <h3 className="text-lg font-bold text-ink">
        {t('wardrobe.capture.completeTitle')}
      </h3>
      <p className="text-sm text-ink-soft">{t('wardrobe.capture.completeBody')}</p>
      <button
        onClick={onDone}
        className="mt-2 min-h-11 rounded-lg bg-inverse px-6 py-2 text-sm font-semibold text-on-inverse hover:bg-inverse/90"
      >
        {t('wardrobe.capture.done')}
      </button>
    </div>
  )
}

export function GarmentCaptureModal({
  isOpen,
  onClose,
  onGarmentCommitted,
  onBatchGarmentCommitted,
  uploadGarment = uploadGarmentImageFromWeb,
  invokingElementRef,
  confirmDiscard = false,
}: GarmentCaptureModalProps) {
  const { t, i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language).firstUse
  const flatLayCopy = flatLayStrings(i18n.language)
  const flatLayCallbacks = useRef({ onClose, onBatchGarmentCommitted })
  flatLayCallbacks.current = { onClose, onBatchGarmentCommitted }
  const [flatLayState, setFlatLayState] = useState<FlatLayCaptureState>({
    phase: 'source',
    pieces: [],
  })
  const [flatLay] = useState(
    () =>
      new FlatLayCapture(
        {
          ...flatLayClient,
          isCurrent: isUploadSessionCurrent,
          onCommitted: (garment) =>
            flatLayCallbacks.current.onBatchGarmentCommitted?.(garment),
          onComplete: () => flatLayCallbacks.current.onClose(),
        },
        setFlatLayState
      )
  )
  useEffect(() => () => flatLay.reset(false), [flatLay])
  const [isDiscarding, setIsDiscarding] = useState(false)
  const keepEditing = useRef<HTMLButtonElement>(null)
  const confirmCrop = useRef<HTMLButtonElement>(null)
  const retakeCrop = useRef<HTMLButtonElement>(null)
  const restoreCropFocus = useRef(false)
  useEffect(() => {
    if (isDiscarding) keepEditing.current?.focus()
    else if (restoreCropFocus.current) {
      const target = confirmCrop.current?.disabled
        ? retakeCrop.current
        : confirmCrop.current
      target?.focus()
      if (document.activeElement === target) restoreCropFocus.current = false
    }
  }, [isDiscarding])
  const [step, setStep] = useState<CaptureStep>('source')
  /** The photo to upload, bound to the session captured when its camera or picker opened. */
  const [imagePreview, setImagePreview] = useState<PickedImage | null>(null)
  const [aspectRatio, setAspectRatio] = useState<CropRatio>('1:1')
  const [useBgCleanup, setUseBgCleanup] = useState(true)
  const [uploadState, setUploadState] = useState<string>('')
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [errorKey, setErrorKey] = useState<CaptureErrorKey | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const resetBatchRef = useRef<(() => void) | null>(null)
  const isOpenRef = useRef(isOpen)
  const captureEpoch = useRef(0)
  /** The session captured when the camera or file picker last opened. */
  const pickerSessionRef = useRef<{
    session: UploadAttemptSession
    epoch: number
  } | null>(null)

  isOpenRef.current = isOpen

  const preparedCrop = usePreparedCrop(
    isOpen,
    imagePreview,
    aspectRatio,
    useBgCleanup,
    setErrorKey
  )

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  useEffect(() => {
    if (step === 'camera' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [step])

  const cancelCapture = useCallback(() => {
    captureEpoch.current++
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
    stopCamera()
  }, [stopCamera])
  useEffect(() => cancelCapture, [cancelCapture])

  const resetCapture = useCallback(() => {
    flatLay.reset()
    resetBatchRef.current?.()
    cancelCapture()
    restoreCropFocus.current = false
    setIsDiscarding(false)
    setStep('source')
    setImagePreview(null)
    setErrorKey(null)
    setUploadProgress(0)
    setUploadState('')
  }, [cancelCapture, flatLay])
  // Round 5 account epoch: the camera, the picked photo and its upload belong to the account
  // signed in when the camera or picker opened; any account change drops them.
  useUploadSessionChange(resetCapture)
  useEffect(() => {
    if (!isOpen) resetCapture()
  }, [isOpen, resetCapture])

  if (!isOpen) {
    return null
  }

  const handleStartCamera = async () => {
    flatLay.reset()
    setErrorKey(null)
    const session = currentUploadSession()
    const epoch = ++captureEpoch.current
    pickerSessionRef.current = { session, epoch }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorKey('cameraUnavailable')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      if (captureEpoch.current !== epoch || !isUploadSessionCurrent(session)) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      setStep('camera')
    } catch {
      if (captureEpoch.current === epoch) setErrorKey('cameraDenied')
    }
  }

  const handleCapturePhoto = () => {
    if (!videoRef.current) return
    const capture = pickerSessionRef.current
    if (
      !capture ||
      capture.epoch !== captureEpoch.current ||
      !isUploadSessionCurrent(capture.session)
    ) {
      resetCapture()
      return
    }
    const { session } = capture
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth || 640
    canvas.height = videoRef.current.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
      // JPEG: a camera frame has no transparency, and PNG would carry its sensor grain at
      // several times the size. Preparation re-encodes it for upload anyway.
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      setImagePreview({ dataUrl, session })
      setStep('crop')
    }
    stopCamera()
  }

  const handleFilePickerOpen = () => {
    flatLay.reset()
    pickerSessionRef.current = {
      session: currentUploadSession(),
      epoch: captureEpoch.current,
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorKey(null)
    const file = e.target.files?.[0]
    // A file that arrives without the picker opening (a drop) belongs to the session now.
    const { session, epoch } = pickerSessionRef.current ?? {
      session: currentUploadSession(),
      epoch: captureEpoch.current,
    }
    pickerSessionRef.current = null
    if (!file) return
    // The account changed while the picker was open: the photo was picked for the previous one.
    if (captureEpoch.current !== epoch || !isUploadSessionCurrent(session)) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorKey('unsupportedType')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorKey('fileTooLarge')
      return
    }

    const readEpoch = ++captureEpoch.current
    const reader = new FileReader()
    reader.onload = (event) => {
      if (captureEpoch.current !== readEpoch || !isUploadSessionCurrent(session)) return
      if (typeof event.target?.result === 'string') {
        setImagePreview({ dataUrl: event.target.result, session })
        setStep('crop')
      }
    }
    reader.readAsDataURL(file)
  }

  const handleConfirmAndUpload = async () => {
    if (!imagePreview || !preparedCrop || uploadAbortRef.current) return
    setStep('uploading')
    setUploadState('preparing')
    setUploadProgress(10)
    setErrorKey(null)
    const abortController = new AbortController()
    uploadAbortRef.current = abortController
    const ownsUpload = () =>
      uploadAbortRef.current === abortController && !abortController.signal.aborted

    try {
      const garment = await uploadGarment({
        imagePreview: imagePreview.dataUrl,
        uploadSession: imagePreview.session,
        aspectRatio,
        useBgCleanup,
        prepared: preparedCrop.image,
        signal: abortController.signal,
        onStateChange: (state) => {
          if (ownsUpload()) setUploadState(state)
        },
        onProgress: (progress) => {
          if (ownsUpload()) setUploadProgress(progress)
        },
      })
      if (!ownsUpload()) return
      onGarmentCommitted?.(garment)
      setStep('complete')
    } catch (error) {
      if (ownsUpload() && isOpenRef.current) {
        setErrorKey(garmentUploadErrorKey(error))
        setStep('crop')
      }
    } finally {
      if (uploadAbortRef.current === abortController) {
        uploadAbortRef.current = null
      }
    }
  }

  const handleResetModal = resetCapture

  const handleClose = () => {
    handleResetModal()
    onClose()
  }

  const dismissDiscard = () => {
    restoreCropFocus.current = true
    setIsDiscarding(false)
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={() => {
        if (confirmDiscard && step === 'crop') {
          if (isDiscarding) dismissDiscard()
          else setIsDiscarding(true)
          return
        }
        handleClose()
      }}
      titleId="garment-capture-title"
      title={
        flatLayState.phase === 'source' ? t('wardrobe.capture.title') : flatLayCopy.review
      }
      invokingElementRef={invokingElementRef}
      closeLabel={t('wardrobe.capture.close')}
      ariaLiveMessage={
        UPLOAD_STATUS_KEYS[uploadState]
          ? t('wardrobe.capture.statusAnnouncement', {
              status: t(UPLOAD_STATUS_KEYS[uploadState], { progress: uploadProgress }),
            })
          : null
      }
      errorMessage={captureErrorMessage(t, flatLayCopy, flatLayState.error, errorKey)}
    >
      {step === 'source' && (
        <CaptureSource
          flatLay={flatLay}
          state={flatLayState}
          onClose={handleClose}
          resetBatchRef={resetBatchRef}
          onFlatLayPickerOpen={() => {
            cancelCapture()
            setErrorKey(null)
          }}
          onBatchPickerOpen={() => {
            flatLay.reset()
            cancelCapture()
            setErrorKey(null)
          }}
          onBatchGarmentCommitted={onBatchGarmentCommitted}
          uploadGarment={uploadGarment}
          source={{
            onStartCamera: () => void handleStartCamera(),
            onFilePickerOpen: handleFilePickerOpen,
            onFileSelect: handleFileSelect,
          }}
        />
      )}

      {step === 'camera' && (
        <CameraStep
          videoRef={videoRef}
          onCancel={() => {
            stopCamera()
            setStep('source')
          }}
          onCapture={handleCapturePhoto}
        />
      )}

      {isDiscarding && (
        <div className="space-y-2" aria-live="polite">
          <p>{strings.discardPhoto}</p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={keepEditing}
              type="button"
              className="min-h-11 rounded-md border border-line-strong bg-page px-3 text-ink"
              onClick={dismissDiscard}
            >
              {strings.keepEditing}
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md border border-line-strong bg-page px-3 text-ink"
              onClick={handleClose}
            >
              {strings.discard}
            </button>
          </div>
        </div>
      )}
      {step === 'crop' && imagePreview && !isDiscarding && (
        <CropStep
          confirmRef={confirmCrop}
          retakeRef={retakeCrop}
          preparedCrop={preparedCrop}
          preparationError={Boolean(errorKey)}
          cleanupFallback={strings.cleanupFallback}
          aspectRatio={aspectRatio}
          setAspectRatio={(value) => {
            if (value === aspectRatio) return
            setErrorKey(null)
            setAspectRatio(value)
          }}
          useBgCleanup={useBgCleanup}
          setUseBgCleanup={(value) => {
            setErrorKey(null)
            setUseBgCleanup(value)
          }}
          onReset={handleResetModal}
          onConfirm={() => {
            void handleConfirmAndUpload()
          }}
        />
      )}

      {step === 'uploading' && (
        <UploadingStep uploadState={uploadState} uploadProgress={uploadProgress} />
      )}

      {step === 'complete' && (
        <CompleteStep
          onDone={() => {
            handleClose()
          }}
        />
      )}
    </AccessibleModal>
  )
}
