'use client'
// Story 4.3 Task 5 step 1 owner: implement web CapsuleBuilderModal component in apps/web/src/app/components/capsule-builder-modal.tsx

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
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
  t: TFunction,
  garment: GarmentItemContract | undefined,
  position: number
): string {
  if (!garment) {
    return t('wardrobe.capsules.garmentFallback', { position })
  }
  const category = garment.category
    ? t(`wardrobe.capsules.category.${garment.category}`)
    : t('wardrobe.capsules.garmentNoun')
  return garment.comfortRange
    ? t('wardrobe.capsules.garmentLabelWithComfort', {
        category,
        comfort: t(`wardrobe.capsules.comfort.${garment.comfortRange}`),
        position,
      })
    : t('wardrobe.capsules.garmentLabel', { category, position })
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

  /** The visible row label: the category, or the untagged label when the garment has none. */
  const orderedCategoryLabel = (garment: GarmentItemContract | undefined) =>
    garment?.category
      ? t(`wardrobe.capsules.category.${garment.category}`)
      : t('wardrobe.capsules.untagged')

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

    const label = describeGarment(t, garmentsById.get(movedId), targetIndex + 1)
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

  const selectionCountLabel = t('wardrobe.capsules.garmentsSelected', {
    count: selectedGarmentIds.length,
    max: MAX_GARMENTS,
  })

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="capsule-modal-title"
      title={initialCapsule ? t('wardrobe.capsules.edit') : t('wardrobe.capsules.create')}
      descriptionId="capsule-modal-description"
      description={t('wardrobe.capsules.builderDescription')}
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
            className="rounded-lg border border-notice-line bg-notice-surface p-3 text-xs text-notice-ink"
            data-testid="capsule-repair-banner"
          >
            <strong className="block font-semibold">
              {t('wardrobe.capsules.repairTitle')}
            </strong>
            {t('wardrobe.capsules.repairRemoved', { count: unavailableCount })}
          </div>
        )}

        {isStale && (
          <button
            type="button"
            onClick={() => onStaleCapsule?.()}
            className="w-full rounded-lg border border-notice-line bg-page px-3 py-2 text-xs font-medium text-notice-ink hover:bg-notice-surface"
            data-testid="capsule-reload-button"
          >
            {t('wardrobe.capsules.reloadLatest')}
          </button>
        )}

        <div>
          <label
            htmlFor="capsule-name-input"
            className="block text-sm font-medium text-ink-soft"
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
            className="mt-1 block w-full rounded-md border border-line-strong bg-page p-2 text-sm text-ink placeholder:text-ink-muted"
            placeholder={t('wardrobe.capsules.namePlaceholder')}
            data-testid="capsule-name-input"
          />
        </div>

        <div>
          <label
            htmlFor="capsule-desc-input"
            className="block text-sm font-medium text-ink-soft"
          >
            {t('wardrobe.capsules.descriptionLabel')}
          </label>
          <textarea
            id="capsule-desc-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={280}
            rows={2}
            className="mt-1 block w-full rounded-md border border-line-strong bg-page p-2 text-sm text-ink placeholder:text-ink-muted"
            placeholder={t('wardrobe.capsules.descriptionPlaceholder')}
            data-testid="capsule-desc-input"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ink-soft">
            {t('wardrobe.capsules.occasionsLabel')}
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ALL_OCCASIONS.map((occasion) => (
              <label
                key={occasion}
                data-gold="focus"
                /**
                 * The real checkbox stays visually hidden but focusable, and
                 * `focus-within` renders the focus halo on the styled chip so keyboard
                 * focus is visible. Target size meets the 44px minimum.
                 */
                className={`flex min-h-11 cursor-pointer items-center space-x-2 rounded-lg border px-3 py-2 text-xs font-medium focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2 ${
                  selectedOccasions.includes(occasion)
                    ? 'border-inverse bg-inverse text-on-inverse'
                    : 'border-line bg-card text-ink-soft'
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
          <legend className="text-sm font-medium text-ink-soft">
            {t('wardrobe.capsules.garmentsLabel')}
          </legend>
          <p
            className="mt-1 text-xs text-ink-muted"
            data-testid="capsule-selection-count"
          >
            {selectionCountLabel}{' '}
            {t('wardrobe.capsules.garmentsRange', {
              min: MIN_GARMENTS,
              max: MAX_GARMENTS,
            })}
          </p>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line p-2">
            {availableGarments.map((garment) => (
              <label
                key={garment.id}
                className="flex min-h-11 items-center justify-between p-2 hover:bg-card"
              >
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={selectedGarmentIds.includes(garment.id)}
                    onChange={() => toggleGarment(garment.id)}
                    className="h-5 w-5 rounded-md border-line-strong accent-ink"
                    data-testid={`garment-select-checkbox-${garment.id}`}
                  />
                  <span className="text-sm capitalize text-ink">
                    {orderedCategoryLabel(garment)} (
                    {t(`wardrobe.capsules.comfort.${garment.comfortRange ?? 'mild'}`)})
                  </span>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {selectedGarmentIds.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-ink-soft">
              {t('wardrobe.capsules.garmentOrder')}
            </h3>
            <ul className="mt-2 space-y-2" data-testid="capsule-garment-ordering-list">
              {selectedGarmentIds.map((garmentId, index) => {
                const label = describeGarment(t, garmentsById.get(garmentId), index + 1)
                return (
                  <li
                    key={garmentId}
                    className="flex items-center justify-between rounded-lg border border-line p-2 text-sm"
                    data-testid={`ordered-garment-item-${garmentId}`}
                  >
                    <span className="font-medium capitalize">
                      {index + 1}. {orderedCategoryLabel(garmentsById.get(garmentId))}
                    </span>
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => moveGarment(index, 'up')}
                        disabled={index === 0}
                        aria-label={t('wardrobe.capsules.moveGarmentUp', {
                          garment: label,
                        })}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line-strong bg-page px-2 py-1 text-xs text-ink disabled:opacity-30"
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
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line-strong bg-page px-2 py-1 text-xs text-ink disabled:opacity-30"
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

        <div className="flex min-h-11 items-center space-x-2">
          <input
            id="capsule-favorite-checkbox"
            type="checkbox"
            checked={isFavorite}
            onChange={(event) => setIsFavorite(event.target.checked)}
            className="h-5 w-5 rounded-md border-line-strong accent-ink"
            data-testid="capsule-favorite-checkbox"
          />
          <label htmlFor="capsule-favorite-checkbox" className="text-sm text-ink-soft">
            {t('wardrobe.capsules.favoriteLabel')}
          </label>
        </div>

        <div className="flex items-center justify-end space-x-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-page px-4 py-2 text-sm font-medium text-ink hover:bg-card"
          >
            {t('wardrobe.capsules.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-inverse px-4 py-2 text-sm font-medium text-on-inverse hover:bg-inverse/90 disabled:opacity-50"
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
