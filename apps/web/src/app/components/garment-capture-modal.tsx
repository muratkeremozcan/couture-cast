// Story 4.1 Task 8 step 1 owner: implement web garment capture modal component with camera, cropping, background cleanup preview, and ARIA live regions
'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import {
  uploadGarmentImageFromWeb,
  type UploadGarmentImageInput,
} from '../../lib/wardrobe'

export interface GarmentCaptureModalProps {
  isOpen: boolean
  onClose: () => void
  onGarmentCommitted?: (garment: GarmentItemContract) => void
  uploadGarment?: (input: UploadGarmentImageInput) => Promise<GarmentItemContract>
}

export type CaptureStep = 'source' | 'camera' | 'crop' | 'uploading' | 'complete'

function SourceStep({
  onStartCamera,
  onFileSelect,
}: {
  onStartCamera: () => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Photograph or import a garment photo to add to your private CoutureCast wardrobe.
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
          <span className="mt-2">Take Photo</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 p-6 font-semibold text-zinc-800 transition hover:border-gold-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <span aria-hidden="true" className="text-2xl">
            📁
          </span>
          <span className="mt-2">Choose File</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Garment image file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
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
  return (
    <div className="mt-4 flex flex-col items-center gap-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex gap-4">
        <button
          onClick={onCancel}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
        >
          Cancel
        </button>
        <button
          onClick={onCapture}
          className="rounded-lg bg-zinc-900 px-6 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Snap Photo
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
}: {
  imagePreview: string
  aspectRatio: '1:1' | '4:3'
  setAspectRatio: (ar: '1:1' | '4:3') => void
  useBgCleanup: boolean
  setUseBgCleanup: (val: boolean) => void
  onReset: () => void
  onConfirm: () => void
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Aspect Ratio:
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
            1:1 Square
          </button>
          <button
            onClick={() => setAspectRatio('4:3')}
            className={`rounded px-3 py-1 text-xs font-bold ${
              aspectRatio === '4:3'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            4:3 Portrait
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
          alt="Garment preview"
          className={`h-full w-full object-contain ${
            useBgCleanup ? 'brightness-105 contrast-105' : ''
          }`}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
        <div>
          <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Auto Background Cleanup
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Preview matting & transparent backdrop
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Auto Background Cleanup"
          aria-checked={useBgCleanup}
          onClick={() => setUseBgCleanup(!useBgCleanup)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
            useBgCleanup ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
              useBgCleanup ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <button
          onClick={onReset}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
        >
          Retake / Choose Another
        </button>
        <button
          onClick={() => {
            onConfirm()
          }}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Use This Image
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
  return (
    <div className="mt-8 flex flex-col items-center gap-4 py-6">
      <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full bg-emerald-600 transition-all duration-300"
          style={{ width: `${uploadProgress}%` }}
        />
      </div>
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {uploadState === 'preparing' && 'Preparing asset validation...'}
        {uploadState === 'requesting_upload' && 'Allocating upload session...'}
        {uploadState === 'uploading' && `Uploading image bytes (${uploadProgress}%)...`}
        {uploadState === 'verifying' && 'Verifying private storage payload...'}
        {uploadState === 'processing' && 'Garment uploaded! Processing color analysis...'}
      </p>
    </div>
  )
}

function CompleteStep({ onDone }: { onDone: () => void }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-4 text-center py-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
        ✓
      </div>
      <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
        Garment Upload Complete!
      </h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Your clothing item has been securely uploaded to your private wardrobe and is
        queued for personalized outfit matching.
      </p>
      <button
        onClick={onDone}
        className="mt-2 rounded-lg bg-zinc-900 px-6 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Done
      </button>
    </div>
  )
}

export function GarmentCaptureModal({
  isOpen,
  onClose,
  onGarmentCommitted,
  uploadGarment = uploadGarmentImageFromWeb,
}: GarmentCaptureModalProps) {
  const [step, setStep] = useState<CaptureStep>('source')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:3'>('1:1')
  const [useBgCleanup, setUseBgCleanup] = useState<boolean>(true)
  const [uploadState, setUploadState] = useState<string>('')
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const isOpenRef = useRef(isOpen)

  isOpenRef.current = isOpen

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => closeButtonRef.current?.focus())
    return () => {
      trigger?.focus()
    }
  }, [isOpen])

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

  if (!isOpen) {
    return null
  }

  const handleStartCamera = async () => {
    setErrorMessage(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMessage('Camera access is unavailable on this device or context.')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      if (!isOpenRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      setStep('camera')
    } catch {
      setErrorMessage(
        'Camera permission denied or camera unavailable. Please select a photo file.'
      )
    }
  }

  const handleCapturePhoto = () => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth || 640
    canvas.height = videoRef.current.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/png')
      setImagePreview(dataUrl)
      setStep('crop')
    }
    stopCamera()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null)
    const file = e.target.files?.[0]
    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMessage('Unsupported file type. Please upload a JPEG, PNG, or WebP image.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('File size exceeds 10 MiB limit.')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        setImagePreview(event.target.result)
        setStep('crop')
      }
    }
    reader.readAsDataURL(file)
  }

  const handleConfirmAndUpload = async () => {
    if (!imagePreview) {
      setErrorMessage('Choose an image before uploading.')
      return
    }
    setStep('uploading')
    setUploadState('preparing')
    setUploadProgress(10)
    setErrorMessage(null)
    const abortController = new AbortController()
    uploadAbortRef.current = abortController

    try {
      const garment = await uploadGarment({
        imagePreview,
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
        setErrorMessage(
          error instanceof Error ? error.message : 'Upload failed. Please try again.'
        )
        setStep('crop')
      }
    } finally {
      if (uploadAbortRef.current === abortController) {
        uploadAbortRef.current = null
      }
    }
  }

  const handleResetModal = () => {
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
    stopCamera()
    setStep('source')
    setImagePreview(null)
    setErrorMessage(null)
    setUploadProgress(0)
    setUploadState('')
  }

  const handleClose = () => {
    handleResetModal()
    onClose()
  }

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
      return
    }
    if (event.key !== 'Tab') {
      return
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter(
      (element) =>
        element.getAttribute('aria-hidden') !== 'true' &&
        !element.classList.contains('hidden')
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="garment-capture-title"
      onKeyDown={handleDialogKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <h2
            id="garment-capture-title"
            className="text-xl font-bold text-zinc-900 dark:text-zinc-50"
          >
            Garment Capture Flow
          </h2>
          <button
            ref={closeButtonRef}
            onClick={handleClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close capture modal"
          >
            ✕
          </button>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {uploadState ? `Upload status: ${uploadState}` : ''}
        </div>

        {errorMessage && (
          <div
            role="alert"
            aria-live="assertive"
            className="mt-4 rounded-md bg-red-50 p-3 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {errorMessage}
          </div>
        )}

        {step === 'source' && (
          <SourceStep
            onStartCamera={() => {
              void handleStartCamera()
            }}
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

        {step === 'crop' && imagePreview && (
          <CropStep
            imagePreview={imagePreview}
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
      </div>
    </div>
  )
}
