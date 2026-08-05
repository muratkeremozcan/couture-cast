// Story 4.2 Task 7 step 1 owner: implement web garment tagging modal dialog component in apps/web/src/app/components/garment-tagging-modal.tsx
'use client'

import React, { useState, useEffect, useRef } from 'react'
import type {
  GarmentCategory,
  GarmentMaterial,
  GarmentComfortRange,
  GarmentItemContract,
  SuggestGarmentTagsData,
} from '@couture/api-client/contracts/http'
import { AccessibleModal } from './accessible-modal'
import { suggestGarmentTagsFromWeb, updateGarmentTagsFromWeb } from '../../lib/wardrobe'

export interface GarmentTaggingModalProps {
  isOpen: boolean
  onClose: () => void
  garmentId: string | null
  onTagsConfirmed?: (garment: GarmentItemContract) => void
  invokingElementRef?: React.RefObject<HTMLElement | null>
  suggestTagsFn?: (
    garmentId: string,
    signal?: AbortSignal
  ) => Promise<SuggestGarmentTagsData>
  updateTagsFn?: (
    garmentId: string,
    tags: {
      category: GarmentCategory
      material?: GarmentMaterial | null
      comfortRange: GarmentComfortRange
    }
  ) => Promise<GarmentItemContract>
}

const CATEGORY_OPTIONS: { value: GarmentCategory; label: string; emoji: string }[] = [
  { value: 'top', label: 'Top', emoji: '👕' },
  { value: 'bottom', label: 'Bottom', emoji: '👖' },
  { value: 'outerwear', label: 'Outerwear', emoji: '🧥' },
  { value: 'dress', label: 'Dress', emoji: '👗' },
  { value: 'shoes', label: 'Shoes', emoji: '👟' },
  { value: 'accessory', label: 'Accessory', emoji: '🧢' },
]

const MATERIAL_OPTIONS: { value: GarmentMaterial; label: string }[] = [
  { value: 'cotton', label: 'Cotton' },
  { value: 'wool', label: 'Wool' },
  { value: 'linen', label: 'Linen' },
  { value: 'leather', label: 'Leather' },
  { value: 'denim', label: 'Denim' },
  { value: 'fleece', label: 'Fleece' },
  { value: 'synthetic', label: 'Synthetic' },
  { value: 'down', label: 'Down' },
  { value: 'silk', label: 'Silk' },
]

const COMFORT_OPTIONS: { value: GarmentComfortRange; label: string; desc: string }[] = [
  { value: 'cold', label: 'Cold (< 10°C / 50°F)', desc: 'Heavy warmth & layering' },
  {
    value: 'cool',
    label: 'Cool (10-16°C / 50-60°F)',
    desc: 'Outerwear or light sweater',
  },
  { value: 'mild', label: 'Mild (16-22°C / 60-72°F)', desc: 'Comfortable light layer' },
  {
    value: 'warm',
    label: 'Warm (22-28°C / 72-82°F)',
    desc: 'Standard summer top/bottom',
  },
  { value: 'hot', label: 'Hot (> 28°C / 82°F)', desc: 'Breathable, hot weather' },
]

interface SuggestionStatusProps {
  isLoading: boolean
  errorMessage: string | null
  onRetry: () => void
}

function SuggestionStatus({ isLoading, errorMessage, onRetry }: SuggestionStatusProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="animate-spin text-lg">⏳</span> Loading smart suggestions...
      </div>
    )
  }

  if (!errorMessage) return null

  return (
    <button
      type="button"
      onClick={onRetry}
      className="min-h-[44px] self-start rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      Retry smart suggestions
    </button>
  )
}

export function GarmentTaggingModal({
  isOpen,
  onClose,
  garmentId,
  onTagsConfirmed,
  invokingElementRef,
  suggestTagsFn = suggestGarmentTagsFromWeb,
  updateTagsFn = updateGarmentTagsFromWeb,
}: GarmentTaggingModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<GarmentCategory | null>(null)
  const [selectedMaterial, setSelectedMaterial] = useState<GarmentMaterial | null>(null)
  const [selectedComfort, setSelectedComfort] = useState<GarmentComfortRange | null>(null)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestGarmentTagsData | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const categoryGroupRef = useRef<HTMLDivElement | null>(null)
  const categoryOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const materialOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const comfortOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (!isOpen || !garmentId) {
      setSelectedCategory(null)
      setSelectedMaterial(null)
      setSelectedComfort(null)
      setSuggestions(null)
      setErrorMessage(null)
      return
    }

    const controller = new AbortController()
    let isMounted = true
    setIsLoadingSuggestions(true)
    setErrorMessage(null)

    suggestTagsFn(garmentId, controller.signal)
      .then((data) => {
        if (!isMounted) return
        setSuggestions(data)
        if (data.suggestions.category.isConfident) {
          setSelectedCategory(data.suggestions.category.value)
        }
        if (data.suggestions.material.isConfident) {
          setSelectedMaterial(data.suggestions.material.value)
        }
        if (data.suggestions.comfortRange.isConfident) {
          setSelectedComfort(data.suggestions.comfortRange.value)
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return
        // 503 or 409 means manual mode or pending; open with manual choices available
        const message = err instanceof Error ? err.message : 'Suggestion unavailable'
        if (message.includes('GARMENT_ANALYSIS_PENDING')) {
          setErrorMessage(
            'Garment analysis is still pending. You can select tags manually.'
          )
        } else if (message.includes('TAGGING_INFERENCE_UNAVAILABLE')) {
          setErrorMessage(
            'Smart suggestion inference is unavailable. Please select tags manually.'
          )
        } else {
          setErrorMessage(message || 'Unable to load smart suggestions.')
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
  }, [isOpen, garmentId, loadAttempt, suggestTagsFn])

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

  const handleSave = async () => {
    if (!garmentId || !selectedCategory || !selectedComfort) {
      setErrorMessage('Please select a category and comfort range before saving.')
      if (!selectedCategory && categoryGroupRef.current) {
        categoryGroupRef.current.focus()
      }
      return
    }

    setIsSaving(true)
    setErrorMessage(null)

    try {
      const updated = await updateTagsFn(garmentId, {
        category: selectedCategory,
        material: selectedMaterial,
        comfortRange: selectedComfort,
      })
      onTagsConfirmed?.(updated)
      onClose()
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to save tags. Please try again.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const isSaveDisabled = !selectedCategory || !selectedComfort || isSaving

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="garment-tagging-title"
      title="Organize Garment Tags"
      descriptionId="garment-tagging-desc"
      description="Review or customize AI suggestions to personalize your daily outfit recommendations."
      invokingElementRef={invokingElementRef}
      initialFocusRef={categoryGroupRef as React.RefObject<HTMLElement | null>}
      errorMessage={errorMessage}
    >
      <div className="mt-4 flex flex-col gap-6">
        <SuggestionStatus
          isLoading={isLoadingSuggestions}
          errorMessage={errorMessage}
          onRetry={() => setLoadAttempt((current) => current + 1)}
        />

        {/* Category Group */}
        <fieldset
          ref={categoryGroupRef as unknown as React.RefObject<HTMLFieldSetElement>}
          tabIndex={-1}
          className="flex flex-col gap-2 border-0 p-0 m-0"
        >
          <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Garment Category <span className="text-red-500">*</span>
            {suggestions && (
              <span className="ml-2 text-xs font-normal text-emerald-700 dark:text-emerald-400">
                ({suggestions.suggestions.category.isConfident ? 'AI' : 'Low confidence'}
                {' suggested: '}
                {suggestions.suggestions.category.value})
              </span>
            )}
          </legend>
          <div role="radiogroup" className="grid grid-cols-3 gap-2">
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
                  tabIndex={
                    isSelected || (!selectedCategory && opt.value === 'top') ? 0 : -1
                  }
                  onClick={() => setSelectedCategory(opt.value)}
                  onKeyDown={(event) =>
                    moveSelection(
                      event,
                      CATEGORY_OPTIONS.map((option) => option.value),
                      selectedCategory,
                      categoryOptionRefs,
                      setSelectedCategory
                    )
                  }
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg border p-2 text-sm font-medium transition ${
                    isSelected
                      ? 'border-gold-500 bg-gold-500/10 text-zinc-900 ring-2 ring-gold-500 dark:text-zinc-50'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  <span aria-hidden="true">{opt.emoji}</span>
                  <span>{opt.label}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        {/* Material Group */}
        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
          <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Fabric Material{' '}
            <span className="text-xs font-normal text-zinc-500">(Optional)</span>
            {suggestions && (
              <span className="ml-2 text-xs font-normal text-emerald-700 dark:text-emerald-400">
                ({suggestions.suggestions.material.isConfident ? 'AI' : 'Low confidence'}
                {' suggested: '}
                {suggestions.suggestions.material.value})
              </span>
            )}
          </legend>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            <button
              ref={(element) => {
                materialOptionRefs.current.clear = element
              }}
              type="button"
              role="radio"
              aria-checked={selectedMaterial === null}
              tabIndex={selectedMaterial === null ? 0 : -1}
              onClick={() => setSelectedMaterial(null)}
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
                    setSelectedMaterial(
                      value === 'clear' ? null : (value as GarmentMaterial)
                    )
                )
              }}
              className={`min-h-[44px] min-w-[44px] rounded-lg border px-3 py-2 text-xs font-medium transition ${
                selectedMaterial === null
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400'
              }`}
            >
              Not sure / Clear
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
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => setSelectedMaterial(opt.value)}
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
                        setSelectedMaterial(
                          value === 'clear' ? null : (value as GarmentMaterial)
                        )
                    )
                  }}
                  className={`min-h-[44px] min-w-[44px] rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    isSelected
                      ? 'border-gold-500 bg-gold-500/10 text-zinc-900 ring-2 ring-gold-500 dark:text-zinc-50'
                      : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        {/* Comfort Range Group */}
        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
          <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Target Comfort Range <span className="text-red-500">*</span>
            {suggestions && (
              <span className="ml-2 text-xs font-normal text-emerald-700 dark:text-emerald-400">
                (
                {suggestions.suggestions.comfortRange.isConfident
                  ? 'AI'
                  : 'Low confidence'}
                {' suggested: '}
                {suggestions.suggestions.comfortRange.value})
              </span>
            )}
          </legend>
          <div role="radiogroup" className="flex flex-col gap-2">
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
                  tabIndex={
                    isSelected || (!selectedComfort && opt.value === 'cold') ? 0 : -1
                  }
                  onClick={() => setSelectedComfort(opt.value)}
                  onKeyDown={(event) =>
                    moveSelection(
                      event,
                      COMFORT_OPTIONS.map((option) => option.value),
                      selectedComfort,
                      comfortOptionRefs,
                      setSelectedComfort
                    )
                  }
                  className={`flex min-h-[44px] w-full flex-col items-start justify-center rounded-lg border p-3 text-left transition ${
                    isSelected
                      ? 'border-gold-500 bg-gold-500/10 ring-2 ring-gold-500'
                      : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {opt.label}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {opt.desc}
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
            className="min-h-[44px] min-w-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaveDisabled}
            onClick={() => {
              void handleSave()
            }}
            className={`min-h-[44px] min-w-[44px] rounded-lg px-6 py-2 text-sm font-semibold text-white transition ${
              isSaveDisabled
                ? 'cursor-not-allowed bg-zinc-300 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-600'
                : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900'
            }`}
          >
            {isSaving ? 'Saving...' : 'Confirm & Save Tags'}
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
