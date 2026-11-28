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
  confidentGarmentTag,
  garmentSubtypeMatchesCategory,
  garmentSubtypeStrings,
  garmentTaggingStrings,
  resolveGarmentSubtypeSelection,
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
  initialGarment?: Pick<GarmentWithTags, 'id' | 'category' | 'subtype'> &
    Partial<Pick<GarmentWithTags, 'imageAccess'>>
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
  const [chosenMaterial, setChosenMaterial] = useState<GarmentMaterial | null>()
  const [chosenComfort, setChosenComfort] = useState<GarmentComfortRange>()
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null)
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
  const copy = garmentTaggingStrings(i18n.language)

  useEffect(() => {
    setChosenCategory(null)
    setChosenSubtype(undefined)
    setChosenMaterial(undefined)
    setChosenComfort(undefined)
    setSuggestions(null)
    setIsManualMode(false)
    setSuggestionError(null)
    setSaveError(null)
    setFailedPreviewUrl(null)
    setIsLoadingSuggestions(false)
    setIsAnalysisPending(false)
    saveRequestIdRef.current += 1
    saveAbortRef.current?.abort()
    saveAbortRef.current = null
    setIsSaving(false)
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
          setSuggestions(null)
          setIsManualMode(true)
          return
        }
        setIsManualMode(false)
        setSuggestions(data)
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

  useEffect(() => () => saveAbortRef.current?.abort(), [])

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

  const storedGarment = initialGarment?.id === garmentId ? initialGarment : undefined
  const storedCategory = storedGarment?.category ?? null
  const storedSubtype = garmentSubtypeMatchesCategory(
    storedCategory,
    storedGarment?.subtype
  )
  const scoredTags = suggestions?.suggestions
  const awaitingInitialSuggestions = isLoadingSuggestions && !scoredTags
  const previewUrl = storedGarment?.imageAccess?.url
  const selectedCategory =
    chosenCategory ??
    (storedSubtype ? storedCategory : null) ??
    confidentGarmentTag(scoredTags?.category) ??
    null
  const selectedMaterial =
    chosenMaterial !== undefined
      ? chosenMaterial
      : scoredTags || awaitingInitialSuggestions
        ? confidentGarmentTag(scoredTags?.material)
        : null
  const selectedComfort = chosenComfort ?? confidentGarmentTag(scoredTags?.comfortRange)
  const subtype = resolveGarmentSubtypeSelection(
    selectedCategory,
    chosenSubtype,
    storedGarment,
    scoredTags
  )
  const displayedSubtype =
    awaitingInitialSuggestions && chosenSubtype === undefined && subtype.selected === null
      ? undefined
      : subtype.selected
  const tagsToSave: UpdateGarmentTagsInput | null =
    selectedCategory &&
    selectedComfort &&
    selectedMaterial !== undefined &&
    subtype.selected !== undefined
      ? {
          category: selectedCategory,
          ...(subtype.save !== undefined && { subtype: subtype.save }),
          material: selectedMaterial,
          comfortRange: selectedComfort,
        }
      : null
  const isSaveDisabled =
    !tagsToSave || isSaving || isLoadingSuggestions || isAnalysisPending

  const selectCategory = (value: GarmentCategory) => {
    setChosenCategory(value)
    if (value !== selectedCategory) setChosenSubtype(undefined)
  }

  const handleSave = async () => {
    if (!garmentId || !tagsToSave || isSaveDisabled) return

    setIsSaving(true)
    setSaveError(null)
    const controller = new AbortController()
    saveAbortRef.current?.abort()
    saveAbortRef.current = controller
    const requestId = ++saveRequestIdRef.current

    try {
      const updated = await updateTagsFn(garmentId, tagsToSave, controller.signal)
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

  const subtypeOptions = ['none', ...subtype.options] as const
  const selectedSubtypeOption = displayedSubtype === null ? 'none' : displayedSubtype
  const subtypeStrings = garmentSubtypeStrings(i18n.language)
  const selectSubtype = (value: (typeof subtypeOptions)[number]) => {
    setChosenCategory(selectedCategory)
    setChosenSubtype(value === 'none' ? null : value)
  }
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
        {previewUrl && previewUrl !== failedPreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            onError={() => setFailedPreviewUrl(previewUrl)}
            alt={copy.preview}
            referrerPolicy="no-referrer"
            className="h-32 w-full rounded-lg bg-card-muted object-contain"
          />
        )}
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
                {suggestions && !selectedCategory && (
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {copy.pickOne}
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

            {subtype.options.length > 0 && (
              <fieldset
                data-testid="garment-tagging-subtype-picker"
                className="m-0 border-0 p-0"
              >
                <legend
                  id="garment-subtype-legend"
                  className="text-sm font-semibold text-ink"
                >
                  {subtypeStrings.label}
                  {subtype.selected === undefined && (
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {copy.pickOne}
                    </span>
                  )}
                </legend>
                <div
                  role="radiogroup"
                  aria-labelledby="garment-subtype-legend"
                  className="mt-2 flex flex-wrap gap-2"
                >
                  {subtypeOptions.map((value) => {
                    const selected = selectedSubtypeOption === value
                    return (
                      <button
                        key={value}
                        ref={(element) => {
                          subtypeOptionRefs.current[value] = element
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={
                          selected ||
                          (selectedSubtypeOption === undefined && value === 'none')
                            ? 0
                            : -1
                        }
                        data-testid={`garment-tagging-subtype-${value}`}
                        disabled={isSaving}
                        onClick={() => selectSubtype(value)}
                        onKeyDown={(event) =>
                          moveSelection(
                            event,
                            subtypeOptions,
                            selectedSubtypeOption ?? null,
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
                {!suggestions && (
                  <span className="text-xs font-normal text-ink-muted">
                    {t('wardrobe.tagEditor.optional')}
                  </span>
                )}
                {suggestions && selectedMaterial === undefined && (
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {copy.pickOne}
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
                  tabIndex={selectedMaterial == null ? 0 : -1}
                  onClick={() => setChosenMaterial(null)}
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
                        setChosenMaterial(
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
                      onClick={() => setChosenMaterial(opt.value)}
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
                            setChosenMaterial(
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
                {suggestions && !selectedComfort && (
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {copy.pickOne}
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
                      onClick={() => setChosenComfort(opt.value)}
                      onKeyDown={(event) =>
                        moveSelection(
                          event,
                          COMFORT_OPTIONS.map((option) => option.value),
                          selectedComfort ?? null,
                          comfortOptionRefs,
                          setChosenComfort
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
            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-page py-2">
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
                {isSaving
                  ? t('wardrobe.tagEditor.saving')
                  : suggestions
                    ? copy.looksRight
                    : t('wardrobe.tagEditor.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </AccessibleModal>
  )
}
