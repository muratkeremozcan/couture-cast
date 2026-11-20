'use client'
// Story 6.16 D4, D5, D6: the sample outfit, its weather, and "Why this works", all read
// from one policy result so the outfit and its explanation can never disagree.
import {
  formatPreviewString,
  formatSampleExplanation,
  SAMPLE_CATALOG,
  sampleGarmentText,
  sampleLookText,
  type GuestPreviewStrings,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { SampleGarmentArt } from './sample-garment-art'

export function GuestPreviewOutfit({
  result,
  strings,
  locale,
  noAlternative,
  hasSwaps,
  onTryAnother,
  onSwap,
  onUndoSwaps,
  onBrowseWardrobe,
  onReviewChoices,
  onResetChoices,
  heading,
  continuation,
}: {
  result: SampleOutfitResult
  strings: GuestPreviewStrings
  locale: string
  noAlternative: boolean
  hasSwaps: boolean
  onTryAnother: () => void
  onSwap: (category: SampleGarmentCategory, invoker: HTMLButtonElement) => void
  onUndoSwaps: () => void
  onBrowseWardrobe?: () => void
  onReviewChoices: () => void
  onResetChoices: () => void
  heading?: string
  continuation?: React.ReactNode
}) {
  const look = result.look
  const explanation = result.explanation.map((item) =>
    formatSampleExplanation(item, { strings, locale, catalog: SAMPLE_CATALOG })
  )

  if (!look) {
    return (
      <section
        data-testid="guest-preview-empty"
        aria-labelledby="guest-preview-empty-heading"
        className="space-y-4 rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-6"
      >
        <h2
          id="guest-preview-empty-heading"
          className="lookbook-display text-xl font-semibold"
        >
          {result.reason === 'all-disliked'
            ? strings.outfit.allDisliked
            : strings.outfit.noEligible}
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onReviewChoices}
            data-testid="guest-preview-review-choices"
            className="min-h-11 rounded-lg border border-[#111111] px-4 text-sm font-semibold"
          >
            {strings.outfit.reviewChoices}
          </button>
          <button
            type="button"
            onClick={onResetChoices}
            data-testid="guest-preview-reset-choices"
            className="min-h-11 rounded-lg bg-[#111111] px-4 text-sm font-semibold text-[#FFFFFF]"
          >
            {strings.outfit.resetChoices}
          </button>
        </div>
      </section>
    )
  }

  const lookText = sampleLookText(look, strings)
  return (
    <section
      aria-labelledby="guest-preview-outfit-heading"
      data-testid="guest-preview-outfit"
      data-look-id={look.id}
      className="space-y-5 rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="lookbook-metrics text-xs uppercase tracking-[0.12em] text-[#8A691F]">
            {heading ?? strings.outfit.heading}
          </p>
          <h2
            id="guest-preview-outfit-heading"
            data-testid="guest-preview-look-name"
            className="lookbook-display text-2xl font-semibold text-[#111111]"
          >
            {lookText.name}
          </h2>
          <p className="text-sm text-[#36363D]">{lookText.description}</p>
        </div>
        <span
          data-testid="guest-preview-weather-chip"
          className="lookbook-metrics rounded-full border border-[#E6E6ED] bg-[#F5F5F7] px-3 py-1 text-xs text-[#111111]"
        >
          {strings.values.weather[result.context.weather]}
        </span>
      </div>

      <div className="space-y-2">
        {continuation}
        <button
          type="button"
          onClick={onTryAnother}
          data-testid="guest-preview-try-another"
          className="min-h-11 rounded-lg bg-[#111111] px-4 text-sm font-semibold text-[#FFFFFF]"
        >
          {strings.outfit.tryAnother}
        </button>
        {noAlternative ? (
          <p
            role="status"
            data-testid="guest-preview-no-alternative"
            className="text-sm text-[#36363D]"
          >
            {strings.outfit.noAlternative}
          </p>
        ) : null}
      </div>

      <ul
        data-testid="guest-preview-garments"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-3 sm:grid-cols-3"
      >
        {result.garments.map((garment) => {
          const text = sampleGarmentText(garment, strings)
          const category = strings.values.category[garment.category]
          return (
            <li
              key={garment.category}
              data-testid="guest-preview-garment"
              data-garment-id={garment.id}
              className="flex flex-col items-center gap-2 rounded-[8px] border border-[#E6E6ED] bg-[#F5F5F7] p-3 text-center"
            >
              <SampleGarmentArt
                garment={garment}
                label={text.description}
                className="h-auto w-20 max-w-full"
              />
              <span className="text-sm font-medium text-[#111111]">{text.name}</span>
              <button
                type="button"
                onClick={(event) => onSwap(garment.category, event.currentTarget)}
                data-testid={`guest-preview-swap-${garment.category}`}
                aria-label={`${formatPreviewString(strings.outfit.swap, { category })}: ${text.name}`}
                className="min-h-11 rounded-lg border border-[#C9C9D1] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#111111] hover:border-[#C9A14A]"
              >
                {formatPreviewString(strings.outfit.swap, { category })}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#111111]">
          {strings.outfit.whyThisWorks}
        </h3>
        <ul
          data-testid="guest-preview-explanation"
          aria-live="polite"
          className="list-disc space-y-1 pl-5 text-sm text-[#36363D]"
        >
          {explanation.map((line, index) => (
            <li key={`${result.explanation[index]?.key}-${index}`}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-3">
        {hasSwaps ? (
          <button
            type="button"
            onClick={onUndoSwaps}
            data-testid="guest-preview-undo-swaps"
            className="min-h-11 rounded-lg border border-[#111111] px-4 text-sm font-semibold"
          >
            {strings.outfit.undoSwaps}
          </button>
        ) : null}
        {onBrowseWardrobe && (
          <button
            type="button"
            onClick={onBrowseWardrobe}
            data-testid="guest-preview-browse-wardrobe"
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-[#8A691F] underline underline-offset-4"
          >
            {strings.outfit.browseWardrobe}
          </button>
        )}
      </div>
    </section>
  )
}
