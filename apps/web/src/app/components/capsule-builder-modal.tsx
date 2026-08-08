'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibleModal } from './accessible-modal'
import type {
  CapsuleOccasion,
  CreateOutfitCapsuleInput,
  GarmentItemContract,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'

export interface CapsuleSaveOptions {
  /** Present only when editing; the current strong entity tag. */
  ifMatch?: string
  /** Stable for the lifetime of this modal so retries cannot duplicate. */
  idempotencyKey: string
}

export interface CapsuleBuilderModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (input: CreateOutfitCapsuleInput, options: CapsuleSaveOptions) => Promise<void>
  ownerUserId: string
  availableGarments: GarmentItemContract[]
  initialCapsule?: OutfitCapsuleContract | null
  invokingElementRef?: React.RefObject<HTMLElement | null>
  /** Invoked when a save fails its precondition so the caller can refetch. */
  onStaleCapsule?: () => void
}

const ALL_OCCASIONS: CapsuleOccasion[] = [
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
]

const MIN_GARMENTS = 2
const MAX_GARMENTS = 10

/**
 * A garment label must distinguish two garments of the same category, otherwise
 * a screen-reader user hears "Move top up" twice with no way to tell them apart.
 */
function describeGarment(
  garment: GarmentItemContract | undefined,
  position: number
): string {
  if (!garment) {
    return `Garment ${position}`
  }
  const category = garment.category ?? 'garment'
  const comfort = garment.comfortRange ? `, ${garment.comfortRange}` : ''
  return `${category}${comfort} (position ${position})`
}

export function CapsuleBuilderModal({
  isOpen,
  onClose,
  onSave,
  availableGarments,
  initialCapsule,
  invokingElementRef,
  onStaleCapsule,
}: CapsuleBuilderModalProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedOccasions, setSelectedOccasions] = useState<CapsuleOccasion[]>([
    'casual',
  ])
  const [selectedGarmentIds, setSelectedGarmentIds] = useState<string[]>([])
  const [isFavorite, setIsFavorite] = useState(false)
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const pendingFocusRef = useRef<string | null>(null)

  const capsuleId = initialCapsule?.id ?? null
  const unavailableCount = initialCapsule?.unavailableGarmentCount ?? 0

  /**
   * Reset only when the modal opens or the edited capsule changes.
   *
   * Keying this effect on `availableGarments` meant every background refetch
   * produced a new array identity and silently wiped whatever the user had
   * typed, mid-edit.
   */
  useEffect(() => {
    if (!isOpen) {
      return
    }

    if (initialCapsule) {
      setName(initialCapsule.name)
      setDescription(initialCapsule.description ?? '')
      setSelectedOccasions(initialCapsule.occasions)
      /**
       * Only currently available garments are seeded. The API excludes purged
       * garments from `garments`, so re-submitting them is impossible; the user
       * repairs the capsule by picking replacements for the missing count.
       */
      setSelectedGarmentIds(initialCapsule.garments.map((garment) => garment.id))
      setIsFavorite(initialCapsule.isFavorite)
    } else {
      setName('')
      setDescription('')
      setSelectedOccasions(['casual'])
      setSelectedGarmentIds([])
      setIsFavorite(false)
    }

    setErrorMessage(null)
    setLiveAnnouncement(null)
    setIsStale(false)
    setIsSubmitting(false)
    /** One key per open form, reused across every retry of this submission. */
    setIdempotencyKey(crypto.randomUUID())
  }, [isOpen, capsuleId, initialCapsule])

  /**
   * Restore focus after a reorder. The moved row's control may now be disabled
   * at a boundary, in which case focusing it is a no-op that drops the user on
   * `<body>`; the opposite control is the nearest meaningful target.
   */
  useEffect(() => {
    const target = pendingFocusRef.current
    if (!target) {
      return
    }
    pendingFocusRef.current = null

    const element = document.querySelector<HTMLButtonElement>(`[data-testid="${target}"]`)
    if (element && !element.disabled) {
      element.focus()
      return
    }
    const fallbackId = target.startsWith('move-up-')
      ? target.replace('move-up-', 'move-down-')
      : target.replace('move-down-', 'move-up-')
    document.querySelector<HTMLButtonElement>(`[data-testid="${fallbackId}"]`)?.focus()
  }, [selectedGarmentIds])

  const garmentsById = useMemo(
    () => new Map(availableGarments.map((garment) => [garment.id, garment])),
    [availableGarments]
  )

  const toggleGarment = (id: string) => {
    setErrorMessage(null)
    if (selectedGarmentIds.includes(id)) {
      setSelectedGarmentIds(selectedGarmentIds.filter((selected) => selected !== id))
      return
    }
    if (selectedGarmentIds.length >= MAX_GARMENTS) {
      setErrorMessage(t('wardrobe.capsules.errors.garmentCount'))
      return
    }
    setSelectedGarmentIds([...selectedGarmentIds, id])
  }

  const toggleOccasion = (occasion: CapsuleOccasion) => {
    setErrorMessage(null)
    if (selectedOccasions.includes(occasion)) {
      if (selectedOccasions.length <= 1) {
        setErrorMessage(t('wardrobe.capsules.errors.occasionRequired'))
        return
      }
      setSelectedOccasions(selectedOccasions.filter((value) => value !== occasion))
      return
    }
    setSelectedOccasions([...selectedOccasions, occasion])
  }

  const moveGarment = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= selectedGarmentIds.length) {
      return
    }

    const updated = [...selectedGarmentIds]
    const movedId = updated[index]!
    updated[index] = updated[targetIndex]!
    updated[targetIndex] = movedId
    setSelectedGarmentIds(updated)

    const label = describeGarment(garmentsById.get(movedId), targetIndex + 1)
    setLiveAnnouncement(
      t('wardrobe.capsules.garmentMoved', {
        garment: label,
        position: targetIndex + 1,
        count: updated.length,
      })
    )
    pendingFocusRef.current = `move-${direction}-button-${movedId}`
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!name.trim()) {
      setErrorMessage(t('wardrobe.capsules.errors.nameRequired'))
      return
    }
    if (
      selectedGarmentIds.length < MIN_GARMENTS ||
      selectedGarmentIds.length > MAX_GARMENTS
    ) {
      setErrorMessage(t('wardrobe.capsules.errors.garmentCount'))
      return
    }
    if (selectedOccasions.length === 0) {
      setErrorMessage(t('wardrobe.capsules.errors.occasionRequired'))
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      await onSave(
        {
          name: name.trim(),
          /**
           * An emptied description sends `null`, not `undefined`. Sending
           * `undefined` drops the field from the PATCH body, which the server
           * reads as "leave unchanged" and makes the description unclearable.
           */
          description: description.trim() === '' ? null : description.trim(),
          occasions: selectedOccasions,
          garmentIds: selectedGarmentIds,
          isFavorite,
        },
        {
          ifMatch: initialCapsule
            ? `"capsule:${initialCapsule.id}:${initialCapsule.revision}"`
            : undefined,
          idempotencyKey,
        }
      )
      onClose()
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : t('wardrobe.capsules.errors.save')
      const stale =
        message.includes('CAPSULE_REVISION_MISMATCH') ||
        message.toLowerCase().includes('changed')

      setIsStale(stale)
      setErrorMessage(stale ? t('wardrobe.capsules.errors.stale') : message)
      setIsSubmitting(false)
    }
  }

  const selectionCountLabel = `${selectedGarmentIds.length} of ${MAX_GARMENTS} selected`

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="capsule-modal-title"
      title={initialCapsule ? t('wardrobe.capsules.edit') : t('wardrobe.capsules.create')}
      descriptionId="capsule-modal-description"
      description="Build a cohesive outfit capsule from your wardrobe."
      invokingElementRef={invokingElementRef}
      initialFocusRef={nameInputRef}
      ariaLiveMessage={liveAnnouncement}
      errorMessage={errorMessage}
    >
      <form
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
        className="mt-4 space-y-5"
        data-testid="capsule-builder-form"
      >
        {unavailableCount > 0 && (
          <div
            className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            data-testid="capsule-repair-banner"
          >
            <strong className="block font-semibold">
              {t('wardrobe.capsules.repairTitle')}
            </strong>
            {unavailableCount === 1
              ? '1 garment is no longer available and has been removed. Choose a replacement before saving.'
              : `${unavailableCount} garments are no longer available and have been removed. Choose replacements before saving.`}
          </div>
        )}

        {isStale && (
          <button
            type="button"
            onClick={() => onStaleCapsule?.()}
            className="w-full rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-200"
            data-testid="capsule-reload-button"
          >
            Reload the latest version
          </button>
        )}

        <div>
          <label
            htmlFor="capsule-name-input"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t('wardrobe.capsules.nameLabel')}
          </label>
          <input
            ref={nameInputRef}
            id="capsule-name-input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            required
            className="mt-1 block w-full rounded-md border border-zinc-300 p-2 text-sm text-zinc-900 focus:border-black focus:ring-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            placeholder={t('wardrobe.capsules.namePlaceholder')}
            data-testid="capsule-name-input"
          />
        </div>

        <div>
          <label
            htmlFor="capsule-desc-input"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t('wardrobe.capsules.descriptionLabel')}
          </label>
          <textarea
            id="capsule-desc-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={280}
            rows={2}
            className="mt-1 block w-full rounded-md border border-zinc-300 p-2 text-sm text-zinc-900 focus:border-black focus:ring-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            placeholder={t('wardrobe.capsules.descriptionPlaceholder')}
            data-testid="capsule-desc-input"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('wardrobe.capsules.occasionsLabel')}
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ALL_OCCASIONS.map((occasion) => (
              <label
                key={occasion}
                /**
                 * The real checkbox stays visually hidden but focusable, and
                 * `focus-within` renders the ring on the styled chip so keyboard
                 * focus is visible. Target size meets the 44px minimum.
                 */
                className={`flex min-h-[44px] cursor-pointer items-center space-x-2 rounded-lg border px-3 py-2 text-xs font-medium focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-black dark:focus-within:ring-zinc-100 ${
                  selectedOccasions.includes(occasion)
                    ? 'border-black bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedOccasions.includes(occasion)}
                  onChange={() => toggleOccasion(occasion)}
                  className="sr-only"
                  data-testid={`occasion-checkbox-${occasion}`}
                />
                <span>{t(`wardrobe.capsules.occasions.${occasion}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('wardrobe.capsules.garmentsLabel')}
          </legend>
          <p
            className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
            data-testid="capsule-selection-count"
          >
            {selectionCountLabel}. Select {MIN_GARMENTS} to {MAX_GARMENTS}.
          </p>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
            {availableGarments.map((garment) => (
              <label
                key={garment.id}
                className="flex min-h-[44px] items-center justify-between p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={selectedGarmentIds.includes(garment.id)}
                    onChange={() => toggleGarment(garment.id)}
                    className="h-5 w-5 rounded border-zinc-300 text-black focus:ring-2 focus:ring-black focus:ring-offset-2"
                    data-testid={`garment-select-checkbox-${garment.id}`}
                  />
                  <span className="text-sm capitalize text-zinc-900 dark:text-zinc-100">
                    {garment.category ?? 'Garment'} ({garment.comfortRange ?? 'mild'})
                  </span>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {selectedGarmentIds.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('wardrobe.capsules.garmentsLabel')}
            </h3>
            <ul className="mt-2 space-y-2" data-testid="capsule-garment-ordering-list">
              {selectedGarmentIds.map((garmentId, index) => {
                const label = describeGarment(garmentsById.get(garmentId), index + 1)
                return (
                  <li
                    key={garmentId}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
                    data-testid={`ordered-garment-item-${garmentId}`}
                  >
                    <span className="font-medium capitalize">
                      {index + 1}. {garmentsById.get(garmentId)?.category ?? 'Garment'}
                    </span>
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => moveGarment(index, 'up')}
                        disabled={index === 0}
                        aria-label={t('wardrobe.capsules.moveGarmentUp', {
                          garment: label,
                        })}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-zinc-300 px-2 py-1 text-xs focus:ring-2 focus:ring-black focus:ring-offset-1 disabled:opacity-30 dark:border-zinc-700"
                        data-testid={`move-up-button-${garmentId}`}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveGarment(index, 'down')}
                        disabled={index === selectedGarmentIds.length - 1}
                        aria-label={t('wardrobe.capsules.moveGarmentDown', {
                          garment: label,
                        })}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-zinc-300 px-2 py-1 text-xs focus:ring-2 focus:ring-black focus:ring-offset-1 disabled:opacity-30 dark:border-zinc-700"
                        data-testid={`move-down-button-${garmentId}`}
                      >
                        ▼
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="flex min-h-[44px] items-center space-x-2">
          <input
            id="capsule-favorite-checkbox"
            type="checkbox"
            checked={isFavorite}
            onChange={(event) => setIsFavorite(event.target.checked)}
            className="h-5 w-5 rounded border-zinc-300 text-black focus:ring-2 focus:ring-black focus:ring-offset-2"
            data-testid="capsule-favorite-checkbox"
          />
          <label
            htmlFor="capsule-favorite-checkbox"
            className="text-sm text-zinc-700 dark:text-zinc-300"
          >
            {t('wardrobe.capsules.favoriteLabel')}
          </label>
        </div>

        <div className="flex items-center justify-end space-x-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            data-testid="save-capsule-button"
          >
            {isSubmitting
              ? `${t('wardrobe.capsules.save')}…`
              : t('wardrobe.capsules.save')}
          </button>
        </div>
      </form>
    </AccessibleModal>
  )
}
