'use client'
// Story 6.16 D4: nine optional look cards. Like, Not for me, or neither; pressing the
// active choice clears it. Buttons only, so nothing needs a swipe.
import {
  formatPreviewString,
  SAMPLE_CATALOG,
  sampleFeedbackProgress,
  sampleGarmentText,
  sampleLookText,
  type GuestPreviewStrings,
  type SampleVote,
} from '@couture/utils'
import { SampleGarmentArt } from './sample-garment-art'

const garments = new Map(SAMPLE_CATALOG.garments.map((garment) => [garment.id, garment]))

export function GuestPreviewFeedback({
  votes,
  strings,
  onVote,
  onReset,
}: {
  votes: Readonly<Record<string, SampleVote>>
  strings: GuestPreviewStrings
  onVote: (lookId: string, vote: SampleVote) => void
  onReset: () => void
}) {
  const progress = sampleFeedbackProgress(votes, SAMPLE_CATALOG)
  return (
    <section
      aria-labelledby="guest-preview-feedback-heading"
      data-testid="guest-preview-feedback"
      className="space-y-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="guest-preview-feedback-heading"
            className="lookbook-display text-lg font-semibold text-[#111111]"
          >
            {strings.feedback.heading}
          </h2>
          <p className="text-sm text-[#36363D]">{strings.feedback.body}</p>
        </div>
        <p
          role="status"
          data-testid="guest-preview-feedback-progress"
          className="lookbook-metrics text-xs text-[#5C5C66]"
        >
          {formatPreviewString(strings.feedback.progress, {
            reviewed: progress.reviewed,
            total: progress.total,
          })}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {progress.cards.map((card) => {
          const text = sampleLookText(card, strings)
          const vote = votes[card.id]
          return (
            <li
              key={card.id}
              data-testid="guest-preview-card"
              data-look-id={card.id}
              className="space-y-3 rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-4"
            >
              <div className="flex gap-1" aria-hidden="true">
                {card.core.map((id) => {
                  const garment = garments.get(id)
                  return garment ? (
                    <SampleGarmentArt key={id} garment={garment} className="h-10 w-10" />
                  ) : null
                })}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">{text.name}</h3>
                <p className="text-xs text-[#36363D]">
                  {card.core
                    .map((id) => garments.get(id))
                    .map((garment) =>
                      garment ? sampleGarmentText(garment, strings).name : ''
                    )
                    .join(', ')}
                </p>
              </div>
              <div className="flex gap-2" role="group" aria-label={text.name}>
                {(['like', 'dislike'] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={vote === choice}
                    onClick={() => onVote(card.id, choice)}
                    data-testid={`guest-preview-vote-${choice}`}
                    className={`min-h-11 flex-1 rounded-lg border px-3 text-sm font-semibold ${
                      vote === choice
                        ? 'border-[#111111] bg-[#111111] text-[#FFFFFF]'
                        : 'border-[#C9C9D1] bg-[#FFFFFF] text-[#111111]'
                    }`}
                  >
                    {choice === 'like' ? strings.feedback.like : strings.feedback.dislike}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={onReset}
        data-testid="guest-preview-feedback-reset"
        className="min-h-11 rounded-lg border border-[#111111] px-4 text-sm font-semibold"
      >
        {strings.outfit.resetChoices}
      </button>
    </section>
  )
}
