'use client'
// Story 6.16 D4, D5, D6: the sample outfit, its weather, and "Why this works", all read
// from one policy result so the outfit and its explanation can never disagree.
import {
  formatPreviewString,
  formatSampleExplanation,
  hasAppliedSampleSwaps,
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
  onTryAnother,
  onSwap,
  onUndoSwaps,
  onBrowseWardrobe,
  onReviewChoices,
  onResetChoices,
  heading,
  continuation,
  shuffleLabel,
  saveAction,
  mood,
  nested = false,
}: {
  result: SampleOutfitResult
  strings: GuestPreviewStrings
  locale: string
  noAlternative: boolean
  onTryAnother: () => void
  onSwap: (category: SampleGarmentCategory, invoker: HTMLButtonElement) => void
  onUndoSwaps: () => void
  onBrowseWardrobe?: () => void
  onReviewChoices: () => void
  onResetChoices: () => void
  heading?: string
  continuation?: React.ReactNode
  shuffleLabel?: string
  saveAction?: React.ReactNode
  mood?: React.ReactNode
  /**
   * Story CC-7.9 D7: true where a parent card already holds the outfit (Home's hero), so it
   * renders as a plain section; on /preview it is its own card.
   */
  nested?: boolean
}) {
  const cardSurface = nested ? undefined : 'card'
  const cardClass = nested ? '' : 'rounded-xl border border-line bg-card'
  const look = result.look
  const hasSwaps = hasAppliedSampleSwaps(result)
  const explanation = result.explanation.map((item) =>
    formatSampleExplanation(item, { strings, locale, catalog: SAMPLE_CATALOG })
  )

  if (!look) {
    return (
      <section
        data-testid="guest-preview-empty"
        aria-labelledby="guest-preview-empty-heading"
        data-surface={cardSurface}
        className={`min-w-0 space-y-4 [overflow-wrap:anywhere] ${nested ? '' : 'p-3 min-[361px]:p-6'} ${cardClass}`}
      >
        <h2 id="guest-preview-empty-heading" className="text-xl font-semibold">
          {result.reason === 'all-disliked'
            ? strings.outfit.allDisliked
            : strings.outfit.noEligible}
        </h2>
        {mood}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onReviewChoices}
            data-testid="guest-preview-review-choices"
            className="min-h-11 rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink"
          >
            {strings.outfit.reviewChoices}
          </button>
          <button
            type="button"
            onClick={onResetChoices}
            data-testid="guest-preview-reset-choices"
            className="min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse"
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
      data-surface={cardSurface}
      data-first-run={Boolean(saveAction)}
      className={`group min-w-0 space-y-5 [overflow-wrap:anywhere] ${nested ? '' : 'p-3 min-[361px]:p-5 sm:p-6'} ${cardClass}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 max-w-full">
          {(heading || !hasSwaps) && (
            <p className="text-xs uppercase tracking-[0.12em] text-ink-muted group-data-[first-run=true]:hidden">
              {heading ?? strings.outfit.heading}
            </p>
          )}
          <h2
            id="guest-preview-outfit-heading"
            tabIndex={-1}
            data-testid="guest-preview-look-name"
            className="text-2xl font-semibold text-ink"
          >
            {hasSwaps ? strings.outfit.heading : lookText.name}
          </h2>
          {!hasSwaps && <p className="text-sm text-ink-soft">{lookText.description}</p>}
        </div>
        <span
          data-testid="guest-preview-weather-chip"
          className="rounded-full border border-line bg-page px-3 py-1 text-xs text-ink"
        >
          {strings.values.weather[result.context.weather]}
        </span>
      </div>

      <div className="space-y-2">
        {continuation}
        <OutfitActions
          saveAction={saveAction}
          shuffleLabel={shuffleLabel}
          defaultShuffleLabel={strings.outfit.tryAnother}
          onShuffle={onTryAnother}
        />
        {noAlternative ? (
          <p
            role="status"
            data-testid="guest-preview-no-alternative"
            className="text-sm text-ink-soft"
          >
            {strings.outfit.noAlternative}
          </p>
        ) : null}
      </div>

      <p className="text-xs text-ink-muted group-data-[first-run=true]:hidden">
        {strings.styleIdeas.illustrations}
      </p>
      <ul
        data-testid="guest-preview-garments"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-3 group-data-[first-run=true]:grid-cols-[repeat(auto-fit,minmax(min(100%,5.5rem),1fr))] group-data-[first-run=true]:gap-2 sm:grid-cols-3"
      >
        {result.garments.map((garment) => {
          const text = sampleGarmentText(garment, strings)
          const category = strings.values.category[garment.category]
          return (
            <li
              key={garment.category}
              data-testid="guest-preview-garment"
              data-garment-id={garment.id}
              className="flex min-w-0 flex-col items-center gap-2 rounded-lg border border-line bg-page p-3 text-center group-data-[first-run=true]:p-2"
            >
              <SampleGarmentArt
                garment={garment}
                label={text.description}
                className="h-auto w-20 max-w-full group-data-[first-run=true]:w-16"
              />
              <span className="text-sm font-medium text-ink">{text.name}</span>
              <button
                type="button"
                onClick={(event) => onSwap(garment.category, event.currentTarget)}
                data-testid={`guest-preview-swap-${garment.category}`}
                aria-label={`${formatPreviewString(strings.outfit.swap, { category })}: ${text.name}`}
                className="mt-auto min-h-11 max-w-full rounded-lg border border-line-strong bg-page px-3 text-xs font-semibold text-ink hover:border-ink group-data-[first-run=true]:px-[4px]"
              >
                {formatPreviewString(strings.outfit.swap, { category })}
              </button>
            </li>
          )
        })}
      </ul>
      {mood}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{strings.outfit.whyThisWorks}</h3>
        <ul
          data-testid="guest-preview-explanation"
          aria-live="polite"
          className="list-disc space-y-1 pl-5 text-sm text-ink-soft"
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
            className="min-h-11 rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink"
          >
            {strings.outfit.undoSwaps}
          </button>
        ) : null}
        {onBrowseWardrobe && (
          <button
            type="button"
            onClick={onBrowseWardrobe}
            data-testid="guest-preview-browse-wardrobe"
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-ink underline underline-offset-4"
          >
            {strings.outfit.browseWardrobe}
          </button>
        )}
      </div>
    </section>
  )
}

function OutfitActions({
  saveAction,
  shuffleLabel,
  defaultShuffleLabel,
  onShuffle,
}: {
  saveAction: React.ReactNode
  shuffleLabel?: string
  defaultShuffleLabel: string
  onShuffle: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {saveAction}
      <button
        type="button"
        onClick={onShuffle}
        data-testid="guest-preview-try-another"
        data-primary-action={saveAction ? undefined : 'true'}
        className={`min-h-11 max-w-full rounded-lg px-2 text-sm font-semibold min-[361px]:px-4 ${saveAction ? 'border border-line-strong bg-page text-ink' : 'bg-inverse text-on-inverse'}`}
      >
        {shuffleLabel ?? defaultShuffleLabel}
      </button>
    </div>
  )
}
