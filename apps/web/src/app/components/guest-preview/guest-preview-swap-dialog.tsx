'use client'
// Story 6.16 D6: swap one garment for a valid alternative in the same category and context.
import { useId, type RefObject } from 'react'
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
  const groupId = useId()
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
          renderOption={(garment, _, current) => {
            const text = sampleGarmentText(garment, strings)
            return (
              <label
                key={garment.id}
                // Story CC-7.9 D3: the current garment is marked with `inverse`; the radio itself
                // takes the global focus ring.
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border-2 p-2 ${
                  current ? 'border-inverse' : 'border-line-strong hover:border-ink'
                }`}
              >
                <input
                  type="radio"
                  name={groupId}
                  value={garment.id}
                  defaultChecked={current}
                  onClick={() => onChoose(garment.id)}
                  data-testid={`guest-preview-swap-option-${garment.id.slice('sample:g:'.length)}`}
                  className="h-5 w-5 accent-ink"
                />
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
              </label>
            )
          }}
        />
      )}
    </AccessibleModal>
  )
}
