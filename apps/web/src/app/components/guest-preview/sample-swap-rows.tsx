'use client'

import { useRef, useState, type ReactNode } from 'react'
import {
  SAMPLE_SWAP_INITIAL_LIMIT,
  sampleSwapDisplay,
  type GuestPreviewStrings,
  type SampleGarment,
  type SampleSwapOptions,
} from '@couture/utils'

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
  renderOption: (garment: SampleGarment, index: number, current: boolean) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const rows = useRef<HTMLDivElement>(null)
  const { current, groups, hasAlternatives, hasMore } = sampleSwapDisplay(
    options.current,
    options.candidates,
    options.range,
    expanded
  )

  return (
    <div data-testid={testId} className="space-y-3">
      <div ref={rows} role="radiogroup" aria-label={label} className="space-y-3">
        {current && renderOption(current, 0, true)}
        {groups.map(({ fit, type, garments, firstIndex }) => {
          const heading = strings.values.garmentType[type]
          return (
            <div
              key={`${fit}-${type}`}
              role="group"
              aria-label={heading}
              className="space-y-2"
            >
              <p className="text-sm font-semibold text-ink-muted" aria-hidden="true">
                {heading}
              </p>
              {garments.map((garment, index) =>
                renderOption(garment, firstIndex + index, false)
              )}
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
              rows.current
                ?.querySelectorAll<HTMLElement>('[role="radio"], input[type="radio"]')
                [SAMPLE_SWAP_INITIAL_LIMIT]?.focus()
            })
          }}
        >
          {strings.outfit.showMore}
        </button>
      )}
    </div>
  )
}
