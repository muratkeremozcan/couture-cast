// Story 4.1 Task 8 step 1 owner: implement web garment capture modal component with camera, cropping, background cleanup preview, and ARIA live regions
'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getGuestPreviewStrings } from '@couture/utils'
import type {
  GarmentItemContract,
  UploadAttemptSession,
} from '@couture/api-client/contracts/http'
import {
  uploadGarmentImageFromWeb,
  type UploadGarmentImageInput,
} from '../../lib/wardrobe'
import {
  garmentUploadErrorKey,
  type GarmentUploadErrorKey,
} from '../../lib/garment-upload-errors'
import {
  currentUploadSession,
  isUploadSessionCurrent,
  useUploadSessionChange,
} from '../../lib/upload-attempts'
import { AccessibleModal } from './accessible-modal'

export interface GarmentCaptureModalProps {
  confirmDiscard?: boolean
  isOpen: boolean
  onClose: () => void
  onGarmentCommitted?: (garment: GarmentItemContract) => void
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
}: {
  onStartCamera: () => void
  onFilePickerOpen: () => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t('wardrobe.capture.intro')}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => {
            onStartCamera()
          }}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 p-6 font-semibold text-zinc-800 transition hover:border-gold-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <span aria-hidden="true" className="text-2xl">
            📷
          </span>
          <span className="mt-2">{t('wardrobe.capture.takePhoto')}</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 p-6 font-semibold text-zinc-800 transition hover:border-gold-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
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
    </div>
  )
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
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
        >
          {t('wardrobe.capture.cancel')}
        </button>
        <button
          onClick={onCapture}
          className="rounded-lg bg-zinc-900 px-6 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t('wardrobe.capture.snapPhoto')}
        </button>
      </div>
    </div>
  )
}

function CropStep({
  imagePreview,
  aspectRatio,
  setAspectRatio,
  useBgCleanup,
  setUseBgCleanup,
  onReset,
  onConfirm,
  confirmRef,
}: {
  imagePreview: string
  aspectRatio: '1:1' | '4:3'
  setAspectRatio: (ar: '1:1' | '4:3') => void
  useBgCleanup: boolean
  setUseBgCleanup: (val: boolean) => void
  onReset: () => void
  onConfirm: () => void
  confirmRef: React.Ref<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('wardrobe.capture.aspectRatio')}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setAspectRatio('1:1')}
            className={`rounded px-3 py-1 text-xs font-bold ${
              aspectRatio === '1:1'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {t('wardrobe.capture.aspectSquare')}
          </button>
          <button
            onClick={() => setAspectRatio('4:3')}
            className={`rounded px-3 py-1 text-xs font-bold ${
              aspectRatio === '4:3'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {t('wardrobe.capture.aspectPortrait')}
          </button>
        </div>
      </div>

      <div
        className={`relative mx-auto overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800 ${
          aspectRatio === '1:1' ? 'aspect-square w-64' : 'aspect-[3/4] w-64'
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imagePreview}
          alt={t('wardrobe.capture.previewAlt')}
          className={`h-full w-full object-contain ${
            useBgCleanup ? 'brightness-105 contrast-105' : ''
          }`}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
        <div>
          <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('wardrobe.capture.cleanupLabel')}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
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
              useBgCleanup ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
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
          onClick={onReset}
          className="whitespace-nowrap rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
        >
          {t('wardrobe.capture.retake')}
        </button>
        <button
          ref={confirmRef}
          onClick={() => {
            onConfirm()
          }}
          className="whitespace-nowrap rounded-lg bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
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
      <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full bg-emerald-600 transition-all duration-300"
          style={{ width: `${uploadProgress}%` }}
        />
      </div>
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {statusKey ? t(statusKey, { progress: uploadProgress }) : null}
      </p>
    </div>
  )
}

function CompleteStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mt-6 flex flex-col items-center gap-4 text-center py-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
        ✓
      </div>
      <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
        {t('wardrobe.capture.completeTitle')}
      </h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t('wardrobe.capture.completeBody')}
      </p>
      <button
        onClick={onDone}
        className="mt-2 min-h-[44px] rounded-lg bg-zinc-900 px-6 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
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
  uploadGarment = uploadGarmentImageFromWeb,
  invokingElementRef,
  confirmDiscard = false,
}: GarmentCaptureModalProps) {
  const { t, i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language).firstUse
  const [isDiscarding, setIsDiscarding] = useState(false)
  const keepEditing = useRef<HTMLButtonElement>(null)
  const confirmCrop = useRef<HTMLButtonElement>(null)
  const restoreCropFocus = useRef(false)
  useEffect(() => {
    if (isDiscarding) keepEditing.current?.focus()
    else if (restoreCropFocus.current) {
      restoreCropFocus.current = false
      confirmCrop.current?.focus()
    }
  }, [isDiscarding])
  const [step, setStep] = useState<CaptureStep>('source')
  /** The photo to upload, bound to the session captured when its camera or picker opened. */
  const [imagePreview, setImagePreview] = useState<{
    dataUrl: string
    session: UploadAttemptSession
  } | null>(null)
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:3'>('1:1')
  const [useBgCleanup, setUseBgCleanup] = useState<boolean>(true)
  const [uploadState, setUploadState] = useState<string>('')
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [errorKey, setErrorKey] = useState<CaptureErrorKey | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const isOpenRef = useRef(isOpen)
  /** The session captured when the camera or file picker last opened. */
  const pickerSessionRef = useRef<UploadAttemptSession | null>(null)

  isOpenRef.current = isOpen

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

  useEffect(() => {
    return () => {
      stopCamera()
      uploadAbortRef.current?.abort()
    }
  }, [stopCamera])

  const resetCapture = useCallback(() => {
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
    stopCamera()
    setIsDiscarding(false)
    setStep('source')
    setImagePreview(null)
    setErrorKey(null)
    setUploadProgress(0)
    setUploadState('')
  }, [stopCamera])
  // Round 5 account epoch: the camera, the picked photo and its upload belong to the account
  // signed in when the camera or picker opened; any account change drops them.
  useUploadSessionChange(resetCapture)

  if (!isOpen) {
    return null
  }

  const handleStartCamera = async () => {
    setErrorKey(null)
    const session = currentUploadSession()
    pickerSessionRef.current = session
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorKey('cameraUnavailable')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      if (!isOpenRef.current || !isUploadSessionCurrent(session)) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      setStep('camera')
    } catch {
      setErrorKey('cameraDenied')
    }
  }

  const handleCapturePhoto = () => {
    if (!videoRef.current) return
    const session = pickerSessionRef.current
    if (!session || !isUploadSessionCurrent(session)) {
      resetCapture()
      return
    }
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
    pickerSessionRef.current = currentUploadSession()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorKey(null)
    const file = e.target.files?.[0]
    // A file that arrives without the picker opening (a drop) belongs to the session now.
    const session = pickerSessionRef.current ?? currentUploadSession()
    pickerSessionRef.current = null
    if (!file) return
    // The account changed while the picker was open: the photo was picked for the previous one.
    if (!isUploadSessionCurrent(session)) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorKey('unsupportedType')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorKey('fileTooLarge')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      // A read that finishes after an account change is dropped with the rest of the capture.
      if (!isUploadSessionCurrent(session)) return
      if (typeof event.target?.result === 'string') {
        setImagePreview({ dataUrl: event.target.result, session })
        setStep('crop')
      }
    }
    reader.readAsDataURL(file)
  }

  const handleConfirmAndUpload = async () => {
    if (!imagePreview) {
      setErrorKey('noImage')
      return
    }
    setStep('uploading')
    setUploadState('preparing')
    setUploadProgress(10)
    setErrorKey(null)
    const abortController = new AbortController()
    uploadAbortRef.current = abortController

    try {
      const garment = await uploadGarment({
        imagePreview: imagePreview.dataUrl,
        uploadSession: imagePreview.session,
        aspectRatio,
        useBgCleanup,
        signal: abortController.signal,
        onStateChange: setUploadState,
        onProgress: setUploadProgress,
      })
      onGarmentCommitted?.(garment)
      setStep('complete')
    } catch (error) {
      if (!abortController.signal.aborted && isOpenRef.current) {
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
      title={t('wardrobe.capture.title')}
      invokingElementRef={invokingElementRef}
      closeLabel={t('wardrobe.capture.close')}
      ariaLiveMessage={
        UPLOAD_STATUS_KEYS[uploadState]
          ? t('wardrobe.capture.statusAnnouncement', {
              status: t(UPLOAD_STATUS_KEYS[uploadState], { progress: uploadProgress }),
            })
          : null
      }
      errorMessage={errorKey ? t(`wardrobe.capture.errors.${errorKey}`) : null}
    >
      {step === 'source' && (
        <SourceStep
          onStartCamera={() => {
            void handleStartCamera()
          }}
          onFilePickerOpen={handleFilePickerOpen}
          onFileSelect={handleFileSelect}
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
              className="min-h-11 rounded border px-3"
              onClick={dismissDiscard}
            >
              {strings.keepEditing}
            </button>
            <button
              type="button"
              className="min-h-11 rounded border px-3"
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
          imagePreview={imagePreview.dataUrl}
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
          useBgCleanup={useBgCleanup}
          setUseBgCleanup={setUseBgCleanup}
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
