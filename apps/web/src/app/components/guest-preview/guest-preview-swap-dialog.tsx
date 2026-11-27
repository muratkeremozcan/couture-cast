'use client'
// Story 6.16 D6: swap one garment for a valid alternative in the same category and context.
import type { RefObject } from 'react'
import {
  formatPreviewString,
  sampleGarmentText,
  type GuestPreviewStrings,
  type SampleGarmentCategory,
  type SampleSwapOptions,
} from '@couture/utils'
import { AccessibleModal } from '../accessible-modal'
import { SampleGarmentArt } from './sample-garment-art'
import { SampleSwapRows } from './sample-swap-rows'

export function GuestPreviewSwapDialog({
  category,
  candidates,
  current,
  range,
  strings,
  invokerRef,
  onChoose,
  onClose,
}: {
  category: SampleGarmentCategory | null
  strings: GuestPreviewStrings
  invokerRef: RefObject<HTMLElement | null>
  onChoose: (garmentId: string) => void
  onClose: () => void
} & SampleSwapOptions) {
  const label = category ? strings.values.category[category] : ''
  const title = formatPreviewString(strings.outfit.swapTitle, { category: label })
  return (
    <AccessibleModal
      isOpen={category !== null}
      onClose={onClose}
      titleId="guest-preview-swap-title"
      title={title}
      description={strings.chrome.sampleLabel}
      descriptionId="guest-preview-swap-label"
      invokingElementRef={invokerRef}
      closeLabel={strings.chrome.close}
    >
      {category !== null && (
        <SampleSwapRows
          options={{ current, candidates, range }}
          label={title}
          strings={strings}
          testId="guest-preview-swap-options"
          showMoreTestId="guest-preview-swap-show-more"
          noAlternativeTestId="guest-preview-no-suitable"
          renderOption={(garment, _, current, focus) => {
            const text = sampleGarmentText(garment, strings)
            return (
              <button
                key={garment.id}
                type="button"
                role="radio"
                aria-checked={current}
                {...focus}
                onClick={() => onChoose(garment.id)}
                data-testid={`guest-preview-swap-option-${garment.id.slice('sample:g:'.length)}`}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg border-2 p-2 text-start ${
                  current ? 'border-inverse' : 'border-line-strong hover:border-ink'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink"
                >
                  {current && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
                </span>
                {/* A muted tile sets the art off the dialog; its outline follows `ink`. */}
                <span className="rounded-md bg-card-muted p-1">
                  <SampleGarmentArt garment={garment} className="h-11 w-11" />
                </span>
                <span className="flex-1 text-sm">
                  {text.name}
                  {current ? (
                    <span className="ml-2 text-xs text-ink-muted">
                      ({strings.outfit.current})
                    </span>
                  ) : null}
                </span>
              </button>
            )
          }}
        />
      )}
    </AccessibleModal>
  )
}
