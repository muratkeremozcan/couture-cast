'use client'
// Story 6.16 D6: swap one garment for a valid alternative in the same category and context.
import type { RefObject } from 'react'
import {
  formatPreviewString,
  sampleGarmentText,
  type GuestPreviewStrings,
  type SampleGarment,
  type SampleGarmentCategory,
} from '@couture/utils'
import { AccessibleModal } from '../accessible-modal'
import { SampleGarmentArt } from './sample-garment-art'

export function GuestPreviewSwapDialog({
  category,
  candidates,
  currentId,
  strings,
  invokerRef,
  onChoose,
  onClose,
}: {
  category: SampleGarmentCategory | null
  candidates: readonly SampleGarment[]
  currentId: string | undefined
  strings: GuestPreviewStrings
  invokerRef: RefObject<HTMLElement | null>
  onChoose: (garmentId: string) => void
  onClose: () => void
}) {
  const label = category ? strings.values.category[category] : ''
  const alternatives = candidates.filter((garment) => garment.id !== currentId)
  return (
    <AccessibleModal
      isOpen={category !== null}
      onClose={onClose}
      titleId="guest-preview-swap-title"
      title={formatPreviewString(strings.outfit.swapTitle, { category: label })}
      description={strings.chrome.sampleLabel}
      descriptionId="guest-preview-swap-label"
      invokingElementRef={invokerRef}
      closeLabel={strings.chrome.close}
    >
      {alternatives.length === 0 ? (
        <p data-testid="guest-preview-no-suitable" className="text-sm">
          {strings.outfit.noSuitableAlternative}
        </p>
      ) : (
        <fieldset data-testid="guest-preview-swap-options" className="space-y-2">
          <legend className="sr-only">
            {formatPreviewString(strings.outfit.swapTitle, { category: label })}
          </legend>
          {candidates.map((garment) => {
            const text = sampleGarmentText(garment, strings)
            const current = garment.id === currentId
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
                  name="guest-preview-swap"
                  value={garment.id}
                  checked={current}
                  onChange={() => onChoose(garment.id)}
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
          })}
        </fieldset>
      )}
    </AccessibleModal>
  )
}
