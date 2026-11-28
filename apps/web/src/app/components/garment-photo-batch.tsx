'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type {
  GarmentItemContract,
  UploadAttemptSession,
} from '@couture/api-client/contracts/http'
import {
  GarmentPhotoBatch,
  garmentPhotoBatchStrings,
  type GarmentPhotoBatchPick,
  type GarmentPhotoBatchState,
} from '@couture/utils'
import { useTranslation } from 'react-i18next'
import { garmentUploadErrorKey } from '../../lib/garment-upload-errors'
import { currentUploadSession, isUploadSessionCurrent } from '../../lib/upload-attempts'
import {
  garmentImageFingerprint,
  prepareGarmentImage,
  type PreparedImage,
  type UploadGarmentImageInput,
} from '../../lib/wardrobe'

const garmentPhotoTypes = ['image/jpeg', 'image/png', 'image/webp']

async function preparePhoto(file: File, signal: AbortSignal) {
  if (!garmentPhotoTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('Invalid photo')
  }
  const original = URL.createObjectURL(file)
  let originalReleased = false
  const releaseOriginal = () => {
    if (originalReleased) return
    URL.revokeObjectURL(original)
    originalReleased = true
  }
  signal.addEventListener('abort', releaseOriginal, { once: true })
  try {
    const image = await prepareGarmentImage(original, '1:1', true, 'compact')
    signal.throwIfAborted()
    return {
      image,
      preview: URL.createObjectURL(image.blob),
      fingerprint: garmentImageFingerprint(image),
    }
  } finally {
    releaseOriginal()
    signal.removeEventListener('abort', releaseOriginal)
  }
}

type Props = {
  children: ReactNode
  resetRef: RefObject<(() => void) | null>
  onClose: () => void
  onGarmentCommitted: (garment: GarmentItemContract) => void
  uploadGarment: (input: UploadGarmentImageInput) => Promise<GarmentItemContract>
}

export function WebGarmentPhotoBatch({
  children,
  resetRef,
  onClose,
  onGarmentCommitted,
  uploadGarment,
}: Props) {
  const { t, i18n } = useTranslation()
  const strings = garmentPhotoBatchStrings(i18n.language)
  const callbacks = useRef({ uploadGarment, onGarmentCommitted })
  callbacks.current = { uploadGarment, onGarmentCommitted }
  const [state, setState] = useState<GarmentPhotoBatchState>()
  const [batch] = useState(
    () =>
      new GarmentPhotoBatch<
        File,
        PreparedImage,
        UploadAttemptSession,
        GarmentItemContract
      >(
        {
          isCurrent: isUploadSessionCurrent,
          prepare: preparePhoto,
          releaseSource: () => undefined,
          releasePrepared: ({ preview }) => URL.revokeObjectURL(preview),
          upload: (prepared, uploadSession, attemptId, signal) =>
            callbacks.current.uploadGarment({
              prepared,
              uploadSession,
              attemptId,
              signal,
            }),
          classifyBlock: (error) => {
            const key = garmentUploadErrorKey(error)
            if (key === 'consentRequired' || key === 'signedOut') return key
          },
          onCommitted: (result) => callbacks.current.onGarmentCommitted(result),
        },
        setState
      )
  )
  const initialInput = useRef<HTMLInputElement>(null)
  const retryInput = useRef<HTMLInputElement>(null)
  const initialPick = useRef<GarmentPhotoBatchPick | null>(null)
  const retryPick = useRef<GarmentPhotoBatchPick | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const { phase, rows, keptCount, busy, pickerError, blocked } = state ?? batch.state
  useLayoutEffect(() => {
    const reset = (publish: boolean) => {
      initialPick.current = null
      retryPick.current = null
      batch.reset(publish)
    }
    resetRef.current = () => reset(true)
    return () => {
      resetRef.current = null
      reset(false)
    }
  }, [batch, resetRef])
  useEffect(() => {
    if (phase !== 'source') heading.current?.focus()
  }, [phase])
  const cancelPick = useCallback(
    (ref: RefObject<GarmentPhotoBatchPick | null>) => {
      const pick = ref.current
      ref.current = null
      if (pick) batch.cancelPicker(pick)
    },
    [batch]
  )
  useEffect(() => {
    const bindCancel = (
      input: HTMLInputElement | null,
      ref: RefObject<GarmentPhotoBatchPick | null>
    ) => {
      const cancel = () => cancelPick(ref)
      input?.addEventListener('cancel', cancel)
      return () => input?.removeEventListener('cancel', cancel)
    }
    const removeInitial = bindCancel(initialInput.current, initialPick)
    const removeRetry = bindCancel(retryInput.current, retryPick)
    return () => {
      removeInitial()
      removeRetry()
    }
  }, [cancelPick])

  const openPicker = (id?: number) => {
    // A new click means the previous picker closed, even if it missed its cancel event.
    cancelPick(initialPick)
    cancelPick(retryPick)
    if (id === undefined) {
      const pick = batch.open(currentUploadSession())
      if (!pick) return
      initialPick.current = pick
      initialInput.current?.click()
    } else {
      const pick = batch.openRetry(id)
      if (!pick) return
      retryPick.current = pick
      retryInput.current?.click()
    }
  }

  const selectPhotos = (event: ChangeEvent<HTMLInputElement>, retry: boolean) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    const ref = retry ? retryPick : initialPick
    const pick = ref.current
    ref.current = null
    if (pick) void batch.accept(pick, files)
  }

  return (
    <>
      <input
        ref={initialInput}
        type="file"
        accept={garmentPhotoTypes.join(',')}
        multiple
        hidden
        data-testid="garment-batch-input"
        onChange={(event) => selectPhotos(event, false)}
      />
      <input
        ref={retryInput}
        type="file"
        accept={garmentPhotoTypes.join(',')}
        hidden
        data-testid="garment-batch-retry-input"
        onChange={(event) => selectPhotos(event, true)}
      />
      {phase === 'source' ? (
        <>
          {children}
          <button
            type="button"
            data-testid="garment-batch-picker"
            className="mt-4 min-h-11 w-full rounded-lg border-2 border-dashed border-line-strong p-3 font-semibold text-ink hover:border-ink hover:bg-card"
            onClick={() => openPicker()}
          >
            {strings.choose}
          </button>
          {pickerError && (
            <p role="alert" className="mt-2 text-sm text-danger-ink">
              {strings[pickerError]}
            </p>
          )}
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <h3 ref={heading} tabIndex={-1} className="text-base font-semibold text-ink">
            {phase === 'review' ? strings.review : strings.results}
          </h3>
          {blocked && (
            <p
              role="alert"
              data-testid="garment-batch-blocked"
              className="text-sm text-danger-ink"
            >
              {t(`wardrobe.capture.errors.${blocked}`)}
            </p>
          )}
          <ul className="max-h-[55dvh] space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid={`garment-batch-row-${row.id}`}
                className="flex min-h-16 items-center gap-3 rounded-lg border border-line p-2"
              >
                {row.preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.preview}
                    alt={strings.photo(row.id)}
                    className="size-20 shrink-0 rounded-md bg-card-muted object-contain"
                  />
                )}
                <div className="min-w-0 space-y-1">
                  <p
                    id={`garment-batch-photo-${row.id}`}
                    className="text-sm font-semibold"
                  >
                    {strings.photo(row.id)}
                  </p>
                  {row.status === 'ready' ? (
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        data-testid={`garment-batch-keep-${row.id}`}
                        aria-describedby={`garment-batch-photo-${row.id}`}
                        checked={row.keep}
                        onChange={() => batch.toggleKeep(row.id)}
                        className="size-5 accent-ink"
                      />
                      {strings.keep}
                    </label>
                  ) : (
                    <p role="status" className="text-sm text-ink-soft">
                      {row.differentPhoto ? strings.differentPhoto : strings[row.status]}
                    </p>
                  )}
                </div>
                {row.status === 'failed' && !blocked && (
                  <button
                    type="button"
                    data-testid={`garment-batch-retry-${row.id}`}
                    aria-describedby={`garment-batch-photo-${row.id}`}
                    className="ml-auto min-h-11 shrink-0 rounded-lg border border-line-strong px-3 text-sm font-semibold disabled:opacity-60"
                    disabled={busy}
                    onClick={() => openPicker(row.id)}
                  >
                    {strings.retry}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {pickerError && (
            <p role="alert" className="text-sm text-danger-ink">
              {strings[pickerError]}
            </p>
          )}
          {phase === 'review' ? (
            <button
              type="button"
              data-testid="garment-batch-add"
              className="min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse disabled:opacity-60"
              disabled={busy || keptCount === 0}
              onClick={() => void batch.save()}
            >
              {strings.add(keptCount)}
            </button>
          ) : (
            <button
              type="button"
              data-testid="garment-batch-done"
              className="min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse disabled:opacity-60"
              disabled={busy}
              onClick={onClose}
            >
              {t('wardrobe.capture.done')}
            </button>
          )}
        </div>
      )}
    </>
  )
}
