// Story 4.2 Task 7 step 1 owner: implement web garment tagging modal dialog component in apps/web/src/app/components/garment-tagging-modal.tsx
'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GarmentCategory,
  GarmentMaterial,
  GarmentComfortRange,
  GarmentItemContract,
  GarmentWithTags,
  SuggestGarmentTagsData,
  SuggestGarmentTagsSuggestedData,
  UpdateGarmentTagsInput,
} from '@couture/api-client/contracts/http'
import {
  garmentSubtypeMatchesCategory,
  garmentSubtypesForCategory,
  garmentSubtypeStrings,
  type GarmentSubtype,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { AccessibleModal } from './accessible-modal'
import {
  suggestGarmentTagsFromWeb,
  updateGarmentTagsFromWeb,
  WardrobeRequestError,
} from '../../lib/wardrobe'

export interface GarmentTaggingModalProps {
  isOpen: boolean
  onClose: () => void
  garmentId: string | null
  initialGarment?: Pick<GarmentWithTags, 'id' | 'category' | 'subtype'>
  onTagsConfirmed?: (garment: GarmentItemContract) => void
  invokingElementRef?: React.RefObject<HTMLElement | null>
  suggestTagsFn?: (
    garmentId: string,
    signal?: AbortSignal
  ) => Promise<SuggestGarmentTagsData>
  updateTagsFn?: (
    garmentId: string,
    tags: UpdateGarmentTagsInput,
    signal?: AbortSignal
  ) => Promise<GarmentItemContract>
}

// Labels come from `wardrobe.tagEditor.category|material|comfort` in the locale catalogs.
const CATEGORY_OPTIONS: { value: GarmentCategory; emoji: string }[] = [
  { value: 'top', emoji: '👕' },
  { value: 'bottom', emoji: '👖' },
  { value: 'outerwear', emoji: '🧥' },
  { value: 'dress', emoji: '👗' },
  { value: 'shoes', emoji: '👟' },
  { value: 'accessory', emoji: '🧢' },
]

const MATERIAL_OPTIONS: { value: GarmentMaterial }[] = [
  { value: 'cotton' },
  { value: 'wool' },
  { value: 'linen' },
  { value: 'leather' },
  { value: 'denim' },
  { value: 'fleece' },
  { value: 'synthetic' },
  { value: 'down' },
  { value: 'silk' },
]

const COMFORT_OPTIONS: { value: GarmentComfortRange }[] = [
  { value: 'cold' },
  { value: 'cool' },
  { value: 'mild' },
  { value: 'warm' },
  { value: 'hot' },
]

interface SuggestionStatusProps {
  isLoading: boolean
  loadingLabel: string
  retryLabel: string
  errorMessage: string | null
  onRetry: () => void
}

function SuggestionStatus({
  isLoading,
  loadingLabel,
  retryLabel,
  errorMessage,
  onRetry,
}: SuggestionStatusProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <span className="animate-spin text-lg">⏳</span> {loadingLabel}
      </div>
    )
  }

  if (!errorMessage) return null

  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="text-sm text-danger-ink">
        {errorMessage}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 self-start rounded-lg border border-line-strong bg-page px-4 py-2 text-sm font-semibold text-ink hover:bg-card"
      >
        {retryLabel}
      </button>
    </div>
  )
}

// eslint-disable-next-line complexity
export function GarmentTaggingModal({
  isOpen,
  onClose,
  garmentId,
  initialGarment,
  onTagsConfirmed,
  invokingElementRef,
  suggestTagsFn = suggestGarmentTagsFromWeb,
  updateTagsFn = updateGarmentTagsFromWeb,
}: GarmentTaggingModalProps) {
  // The modal mounts under the wardrobe page's provider and under onboarding; the shared instance
  // keeps it on the same language without requiring either.
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const [chosenCategory, setChosenCategory] = useState<GarmentCategory | null>(null)
  // Undefined leaves the stored subtype alone. A member's explicit None is null.
  const [chosenSubtype, setChosenSubtype] = useState<GarmentSubtype | null>()
  const [selectedMaterial, setSelectedMaterial] = useState<GarmentMaterial | null>(null)
  const [selectedComfort, setSelectedComfort] = useState<GarmentComfortRange | null>(null)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isAnalysisPending, setIsAnalysisPending] = useState(false)
  const [suggestions, setSuggestions] = useState<SuggestGarmentTagsSuggestedData | null>(
    null
  )
  // The API answered `mode: 'manual'`: no model ran, so the member chooses every tag.
  const [isManualMode, setIsManualMode] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const categoryGroupRef = useRef<HTMLDivElement | null>(null)
  const categoryOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const subtypeOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const materialOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const comfortOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const saveAbortRef = useRef<AbortController | null>(null)
  const saveRequestIdRef = useRef(0)
  const touchedFieldsRef = useRef({
    material: false,
    comfort: false,
  })

  useEffect(() => {
    touchedFieldsRef.current = {
      material: false,
      comfort: false,
    }
    setChosenCategory(null)
    setChosenSubtype(undefined)
    setSelectedMaterial(null)
    setSelectedComfort(null)
    setSuggestions(null)
    setIsManualMode(false)
    setSuggestionError(null)
    setSaveError(null)
    setIsAnalysisPending(false)
  }, [isOpen, garmentId])

  useEffect(() => {
    if (!isOpen || !garmentId) return

    const controller = new AbortController()
    let isMounted = true
    setIsLoadingSuggestions(true)
    setSuggestionError(null)
    setSaveError(null)
    setIsAnalysisPending(false)

    suggestTagsFn(garmentId, controller.signal)
      .then((data) => {
        if (!isMounted) return
        if (data.mode === 'manual') {
          setIsManualMode(true)
          return
        }
        setSuggestions(data)
        if (data.suggestions.material.isConfident && !touchedFieldsRef.current.material) {
          setSelectedMaterial(data.suggestions.material.value)
        }
        if (
          data.suggestions.comfortRange.isConfident &&
          !touchedFieldsRef.current.comfort
        ) {
          setSelectedComfort(data.suggestions.comfortRange.value)
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return
        // 503 or 409 means manual mode or pending; open with manual choices available
        const message =
          err instanceof Error
            ? err.message
            : i18n.t('wardrobe.tagEditor.errors.suggestionUnavailable')
        const code = err instanceof WardrobeRequestError ? err.code : undefined
        if (code === 'GARMENT_ANALYSIS_PENDING') {
          setIsAnalysisPending(true)
          setSuggestionError(i18n.t('wardrobe.tagEditor.errors.analysisPending'))
        } else if (code === 'TAGGING_INFERENCE_UNAVAILABLE') {
          setSuggestionError(i18n.t('wardrobe.tagEditor.errors.inferenceUnavailable'))
        } else {
          setSuggestionError(
            message || i18n.t('wardrobe.tagEditor.errors.suggestionsFailed')
          )
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingSuggestions(false)
        }
      })

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [isOpen, garmentId, loadAttempt, suggestTagsFn, i18n])

  useEffect(() => {
    if (isOpen) return
    saveRequestIdRef.current += 1
    saveAbortRef.current?.abort()
    saveAbortRef.current = null
    // Bumping the request id makes `handleSave`'s `finally` skip its own
    // `setIsSaving(false)`, so the abandoned request would otherwise leave this
    // permanently mounted dialog stuck on a disabled "Saving..." button for
    // every garment the user opens afterwards.
    setIsSaving(false)
  }, [isOpen])

  const moveSelection = <T extends string>(
    event: React.KeyboardEvent<HTMLButtonElement>,
    options: readonly T[],
    currentValue: T | null,
    refs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>,
    select: (value: T) => void
  ) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const currentIndex = Math.max(0, options.indexOf(currentValue ?? options[0]!))
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (currentIndex + 1) % options.length
            : (currentIndex - 1 + options.length) % options.length
    const nextValue = options[nextIndex]!
    select(nextValue)
    refs.current[nextValue]?.focus()
  }

  const selectCategory = (value: GarmentCategory) => {
    setChosenCategory(value)
    setChosenSubtype((subtype) =>
      subtype == null || garmentSubtypeMatchesCategory(value, subtype)
        ? subtype
        : undefined
    )
  }

  const selectMaterial = (value: GarmentMaterial | null) => {
    touchedFieldsRef.current.material = true
    setSelectedMaterial(value)
  }

  const selectComfort = (value: GarmentComfortRange) => {
    touchedFieldsRef.current.comfort = true
    setSelectedComfort(value)
  }

  const storedGarment = initialGarment?.id === garmentId ? initialGarment : undefined
  const storedCategory = storedGarment?.category ?? null
  const storedSubtype = storedGarment?.subtype
  const hasStoredSubtype = garmentSubtypeMatchesCategory(storedCategory, storedSubtype)
  const suggestedCategory = suggestions?.suggestions.category
  const selectedCategory =
    chosenCategory ??
    (hasStoredSubtype ? storedCategory : null) ??
    (suggestedCategory?.isConfident ? suggestedCategory.value : null)
  const selectedSubtype =
    chosenSubtype === undefined && hasStoredSubtype && selectedCategory === storedCategory
      ? storedSubtype
      : (chosenSubtype ?? null)

  const handleSave = async () => {
    if (!garmentId || !selectedCategory || !selectedComfort) {
      setSaveError(t('wardrobe.tagEditor.errors.selectionRequired'))
      if (!selectedCategory && categoryGroupRef.current) {
        categoryGroupRef.current.focus()
      }
      return
    }

    setIsSaving(true)
    setSaveError(null)
    const controller = new AbortController()
    saveAbortRef.current?.abort()
    saveAbortRef.current = controller
    const requestId = ++saveRequestIdRef.current

    try {
      const updated = await updateTagsFn(
        garmentId,
        {
          category: selectedCategory,
          ...(chosenSubtype !== undefined && { subtype: chosenSubtype }),
          material: selectedMaterial,
          comfortRange: selectedComfort,
        },
        controller.signal
      )
      if (saveRequestIdRef.current !== requestId || controller.signal.aborted) return
      onTagsConfirmed?.(updated)
      onClose()
    } catch (err: unknown) {
      if (!controller.signal.aborted && saveRequestIdRef.current === requestId) {
        setSaveError(
          err instanceof Error ? err.message : t('wardrobe.tagEditor.errors.saveFailed')
        )
      }
    } finally {
      if (saveRequestIdRef.current === requestId) setIsSaving(false)
      if (saveAbortRef.current === controller) saveAbortRef.current = null
    }
  }

  const subtypes = garmentSubtypesForCategory(selectedCategory)
  const subtypeOptions = ['none', ...subtypes] as const
  const subtypeStrings = garmentSubtypeStrings(i18n.language)
  const selectSubtype = (value: (typeof subtypeOptions)[number]) => {
    setChosenCategory(selectedCategory)
    setChosenSubtype(value === 'none' ? null : value)
  }
  const isSaveDisabled =
    !selectedCategory || !selectedComfort || isSaving || isAnalysisPending

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="garment-tagging-title"
      title={t('wardrobe.tagEditor.title')}
      descriptionId="garment-tagging-desc"
      description={
        // Suggestion wording only once suggestions are in hand. Manual mode says the member
        // chooses; until the answer names the mode (and when it failed) the copy is neutral.
        suggestions
          ? t('wardrobe.tagEditor.suggestedDescription')
          : isManualMode
            ? t('wardrobe.tagging.manual_desc')
            : t('wardrobe.tagging.pending_desc')
      }
      invokingElementRef={invokingElementRef}
      initialFocusRef={categoryGroupRef as React.RefObject<HTMLElement | null>}
      ariaLiveMessage={
        isLoadingSuggestions
          ? t('wardrobe.tagging.loading')
          : isSaving
            ? t('wardrobe.tagEditor.savingAnnouncement')
            : null
      }
      errorMessage={saveError}
    >
      <div className="mt-4 flex flex-col gap-6">
        <SuggestionStatus
          isLoading={isLoadingSuggestions}
          loadingLabel={t('wardrobe.tagging.loading')}
          retryLabel={t('wardrobe.tagEditor.retrySuggestions')}
          errorMessage={suggestionError}
          onRetry={() => setLoadAttempt((current) => current + 1)}
        />

        {!isAnalysisPending && (
          <>
            {/* Category Group */}
            <fieldset
              ref={categoryGroupRef as unknown as React.RefObject<HTMLFieldSetElement>}
              tabIndex={-1}
              className="flex flex-col gap-2 border-0 p-0 m-0"
            >
              <legend
                id="garment-category-legend"
                className="text-sm font-semibold text-ink"
              >
                {t('wardrobe.tagEditor.categoryLegend')}{' '}
                <span className="text-danger-ink">*</span>
                {suggestions && (
                  <span className="ml-2 text-xs font-normal text-success-ink">
                    {t(
                      suggestions.suggestions.category.isConfident
                        ? 'wardrobe.tagEditor.suggestedConfident'
                        : 'wardrobe.tagEditor.suggestedReview',
                      {
                        value: t(
                          `wardrobe.tagEditor.category.${suggestions.suggestions.category.value}`
                        ),
                      }
                    )}
                  </span>
                )}
              </legend>
              <div
                role="radiogroup"
                aria-labelledby="garment-category-legend"
                className="grid grid-cols-3 gap-2"
              >
                {CATEGORY_OPTIONS.map((opt) => {
                  const isSelected = selectedCategory === opt.value
                  return (
                    <button
                      key={opt.value}
                      ref={(element) => {
                        categoryOptionRefs.current[opt.value] = element
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={isSaving}
                      tabIndex={
                        isSelected || (!selectedCategory && opt.value === 'top') ? 0 : -1
                      }
                      onClick={() => selectCategory(opt.value)}
                      onKeyDown={(event) =>
                        moveSelection(
                          event,
                          CATEGORY_OPTIONS.map((option) => option.value),
                          selectedCategory,
                          categoryOptionRefs,
                          selectCategory
                        )
                      }
                      className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg border p-2 text-sm font-medium transition ${
                        isSelected
                          ? 'border-inverse bg-inverse text-on-inverse'
                          : 'border-line-strong bg-page text-ink-soft hover:bg-card'
                      }`}
                    >
                      <span aria-hidden="true">{opt.emoji}</span>
                      <span>{t(`wardrobe.tagEditor.category.${opt.value}`)}</span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {subtypes.length > 0 && (
              <fieldset
                data-testid="garment-tagging-subtype-picker"
                className="m-0 border-0 p-0"
              >
                <legend
                  id="garment-subtype-legend"
                  className="text-sm font-semibold text-ink"
                >
                  {subtypeStrings.label}
                </legend>
                <div
                  role="radiogroup"
                  aria-labelledby="garment-subtype-legend"
                  className="mt-2 flex flex-wrap gap-2"
                >
                  {subtypeOptions.map((value) => {
                    const selected = (selectedSubtype ?? 'none') === value
                    return (
                      <button
                        key={value}
                        ref={(element) => {
                          subtypeOptionRefs.current[value] = element
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        data-testid={`garment-tagging-subtype-${value}`}
                        disabled={isSaving}
                        onClick={() => selectSubtype(value)}
                        onKeyDown={(event) =>
                          moveSelection(
                            event,
                            subtypeOptions,
                            selectedSubtype ?? 'none',
                            subtypeOptionRefs,
                            selectSubtype
                          )
                        }
                        className={`min-h-11 min-w-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-60 ${selected ? 'border-inverse bg-inverse text-on-inverse' : 'border-line-strong bg-page text-ink'}`}
                      >
                        {value === 'none'
                          ? subtypeStrings.none
                          : subtypeStrings.values[value]}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {/* Material Group */}
            <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
              <legend
                id="garment-material-legend"
                className="text-sm font-semibold text-ink"
              >
                {t('wardrobe.tagEditor.materialLegend')}{' '}
                <span className="text-xs font-normal text-ink-muted">
                  {t('wardrobe.tagEditor.optional')}
                </span>
                {suggestions && (
                  <span className="ml-2 text-xs font-normal text-success-ink">
                    {t(
                      suggestions.suggestions.material.isConfident
                        ? 'wardrobe.tagEditor.suggestedConfident'
                        : 'wardrobe.tagEditor.suggestedReview',
                      {
                        value: suggestions.suggestions.material.value
                          ? t(
                              `wardrobe.tagEditor.material.${suggestions.suggestions.material.value}`
                            )
                          : t('wardrobe.tagEditor.materialClear'),
                      }
                    )}
                  </span>
                )}
              </legend>
              <div
                role="radiogroup"
                aria-labelledby="garment-material-legend"
                className="flex flex-wrap gap-2"
              >
                <button
                  ref={(element) => {
                    materialOptionRefs.current.clear = element
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selectedMaterial === null}
                  disabled={isSaving}
                  tabIndex={selectedMaterial === null ? 0 : -1}
                  onClick={() => selectMaterial(null)}
                  onKeyDown={(event) => {
                    const values = [
                      'clear',
                      ...MATERIAL_OPTIONS.map((option) => option.value),
                    ]
                    moveSelection(
                      event,
                      values,
                      selectedMaterial ?? 'clear',
                      materialOptionRefs,
                      (value) =>
                        selectMaterial(
                          value === 'clear' ? null : (value as GarmentMaterial)
                        )
                    )
                  }}
                  className={`min-h-11 min-w-11 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    selectedMaterial === null
                      ? 'border-inverse bg-inverse text-on-inverse'
                      : 'border-line-strong bg-page text-ink-soft hover:bg-card'
                  }`}
                >
                  {t('wardrobe.tagEditor.materialClear')}
                </button>
                {MATERIAL_OPTIONS.map((opt) => {
                  const isSelected = selectedMaterial === opt.value
                  return (
                    <button
                      key={opt.value}
                      ref={(element) => {
                        materialOptionRefs.current[opt.value] = element
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={isSaving}
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => selectMaterial(opt.value)}
                      onKeyDown={(event) => {
                        const values = [
                          'clear',
                          ...MATERIAL_OPTIONS.map((option) => option.value),
                        ]
                        moveSelection(
                          event,
                          values,
                          selectedMaterial ?? 'clear',
                          materialOptionRefs,
                          (value) =>
                            selectMaterial(
                              value === 'clear' ? null : (value as GarmentMaterial)
                            )
                        )
                      }}
                      className={`min-h-11 min-w-11 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                        isSelected
                          ? 'border-inverse bg-inverse text-on-inverse'
                          : 'border-line-strong bg-page text-ink-soft hover:bg-card'
                      }`}
                    >
                      {t(`wardrobe.tagEditor.material.${opt.value}`)}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {/* Comfort Range Group */}
            <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
              <legend
                id="garment-comfort-legend"
                className="text-sm font-semibold text-ink"
              >
                {t('wardrobe.tagEditor.comfortLegend')}{' '}
                <span className="text-danger-ink">*</span>
                {suggestions && (
                  <span className="ml-2 text-xs font-normal text-success-ink">
                    {t(
                      suggestions.suggestions.comfortRange.isConfident
                        ? 'wardrobe.tagEditor.suggestedConfident'
                        : 'wardrobe.tagEditor.suggestedReview',
                      {
                        value: t(
                          `wardrobe.tagEditor.comfort.${suggestions.suggestions.comfortRange.value}.name`
                        ),
                      }
                    )}
                  </span>
                )}
              </legend>
              <div
                role="radiogroup"
                aria-labelledby="garment-comfort-legend"
                className="flex flex-col gap-2"
              >
                {COMFORT_OPTIONS.map((opt) => {
                  const isSelected = selectedComfort === opt.value
                  return (
                    <button
                      key={opt.value}
                      ref={(element) => {
                        comfortOptionRefs.current[opt.value] = element
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={isSaving}
                      tabIndex={
                        isSelected || (!selectedComfort && opt.value === 'cold') ? 0 : -1
                      }
                      onClick={() => selectComfort(opt.value)}
                      onKeyDown={(event) =>
                        moveSelection(
                          event,
                          COMFORT_OPTIONS.map((option) => option.value),
                          selectedComfort,
                          comfortOptionRefs,
                          selectComfort
                        )
                      }
                      className={`flex min-h-11 w-full flex-col items-start justify-center rounded-lg border p-3 text-left transition ${
                        isSelected
                          ? 'border-inverse bg-inverse text-on-inverse'
                          : 'border-line-strong bg-page text-ink hover:bg-card'
                      }`}
                    >
                      <span className="text-sm font-semibold">
                        {t(`wardrobe.tagEditor.comfort.${opt.value}.label`)}
                      </span>
                      <span
                        className={`text-xs ${isSelected ? 'text-on-inverse' : 'text-ink-muted'}`}
                      >
                        {t(`wardrobe.tagEditor.comfort.${opt.value}.desc`)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 min-w-11 rounded-lg border border-line-strong bg-page px-4 py-2 text-sm font-medium text-ink hover:bg-card"
              >
                {t('wardrobe.tagEditor.cancel')}
              </button>
              <button
                type="button"
                disabled={isSaveDisabled}
                onClick={() => {
                  void handleSave()
                }}
                className={`min-h-11 min-w-11 rounded-lg px-6 py-2 text-sm font-semibold transition ${
                  isSaveDisabled
                    ? 'cursor-not-allowed bg-card-muted text-ink-muted'
                    : 'bg-inverse text-on-inverse hover:bg-inverse/90'
                }`}
              >
                {isSaving ? t('wardrobe.tagEditor.saving') : t('wardrobe.tagEditor.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </AccessibleModal>
  )
}
