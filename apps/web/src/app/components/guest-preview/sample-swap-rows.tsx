'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  SAMPLE_SWAP_INITIAL_LIMIT,
  sampleSwapDisplay,
  type GuestPreviewStrings,
  type SampleGarment,
  type SampleSwapOptions,
} from '@couture/utils'

export type SampleSwapOptionFocus = { tabIndex: number; onFocus: () => void }

const arrowOffset = new Map([
  ['ArrowUp', -1],
  ['ArrowLeft', -1],
  ['ArrowDown', 1],
  ['ArrowRight', 1],
])

export function SampleSwapRows({
  options,
  label,
  strings,
  testId,
  showMoreTestId,
  noAlternativeTestId,
  renderOption,
}: {
  options: SampleSwapOptions
  label: string
  strings: GuestPreviewStrings
  testId?: string
  showMoreTestId: string
  noAlternativeTestId?: string
  renderOption: (
    garment: SampleGarment,
    index: number,
    current: boolean,
    focus: SampleSwapOptionFocus
  ) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const rows = useRef<HTMLDivElement>(null)
  const { current, tiers, hasAlternatives, hasMore } = sampleSwapDisplay(
    options.current,
    options.candidates,
    options.range,
    expanded
  )
  const showTierHeadings = tiers.length > 1
  const radios = () => rows.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const offset = arrowOffset.get(event.key)
    if (!offset || event.altKey || event.ctrlKey || event.metaKey) return
    const options = radios()
    if (!options?.length) return
    event.preventDefault()
    const next = (focusedIndex + offset + options.length) % options.length
    options[next]?.focus()
  }
  const option = (garment: SampleGarment, index: number, selected: boolean) =>
    renderOption(garment, index, selected, {
      tabIndex: focusedIndex === index ? 0 : -1,
      onFocus: () => setFocusedIndex(index),
    })

  return (
    <div data-testid={testId} className="space-y-3">
      <div
        ref={rows}
        role="radiogroup"
        aria-label={label}
        className="space-y-3"
        onKeyDown={moveFocus}
      >
        {current && option(current, 0, true)}
        {tiers.map(({ fit, groups }) => {
          const tierLabel = strings.outfit.weatherFit[fit]
          return (
            <div
              key={fit}
              role={showTierHeadings ? 'group' : undefined}
              aria-label={showTierHeadings ? tierLabel : undefined}
              className="space-y-3"
            >
              {showTierHeadings && (
                <p className="text-sm font-semibold text-ink" aria-hidden="true">
                  {tierLabel}
                </p>
              )}
              {groups.map(({ type, garments, firstIndex }) => {
                const heading = strings.values.garmentType[type]
                return (
                  <div key={type} role="group" aria-label={heading} className="space-y-2">
                    <p
                      className="text-sm font-semibold text-ink-muted"
                      aria-hidden="true"
                    >
                      {heading}
                    </p>
                    {garments.map((garment, index) =>
                      option(garment, firstIndex + index, false)
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {!hasAlternatives && (
        <p data-testid={noAlternativeTestId} className="text-sm text-ink-muted">
          {strings.outfit.noSuitableAlternative}
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          data-testid={showMoreTestId}
          className="min-h-11 rounded-lg border border-line-strong px-4 text-sm font-semibold hover:border-ink"
          onClick={() => {
            setExpanded(true)
            requestAnimationFrame(() => {
              radios()?.[SAMPLE_SWAP_INITIAL_LIMIT]?.focus()
            })
          }}
        >
          {strings.outfit.showMore}
        </button>
      )}
    </div>
  )
}
