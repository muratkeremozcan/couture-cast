'use client'

import {
  SAMPLE_STYLE_OPTIONS,
  SAMPLE_WEATHER_KEYS,
  formatPreviewString,
  sampleLookText,
  type GuestPreviewStrings,
  type SampleBookmark,
  type SampleStylePreferences,
  type SampleWeatherKey,
} from '@couture/utils'
import { SaveActionButton } from '../save-feedback'

type SampleBookmarkItem<Weather extends SampleWeatherKey> = SampleBookmark<Weather> & {
  savedLookId?: string
  needsReview?: boolean
}

type Props<Weather extends SampleWeatherKey> = {
  strings: GuestPreviewStrings
  preferences?: SampleStylePreferences
  onPreferences?: (preferences: SampleStylePreferences) => void
  bookmarks: SampleBookmarkItem<Weather>[]
  needsReviewLabel?: string
  lookId?: string
  onSave: () => unknown
  onUndoSave?: () => unknown
  onViewSaved?: () => void
  onOpen: (bookmark: SampleBookmarkItem<Weather>) => void
  onRemove: (id: string) => void
  weather?: SampleWeatherKey
  onWeather?: (weather: SampleWeatherKey) => void
  persistent?: boolean
  ownerKey?: string | null
  saveResetKey?: string
  useSharedFeedback?: boolean
  requiresNetwork?: boolean
  /**
   * Story CC-7.9 D7: true where a parent card already holds these controls (Home's hero), so
   * they render as a plain section; on /preview they are their own card.
   */
  nested?: boolean
}

const buttonClass =
  'min-h-11 rounded-lg border border-line-strong bg-page px-3 text-sm font-semibold text-ink'

export function SampleIdeaControls<Weather extends SampleWeatherKey>({
  strings,
  preferences,
  onPreferences,
  bookmarks,
  needsReviewLabel,
  lookId,
  onSave,
  onUndoSave,
  onViewSaved,
  onOpen,
  onRemove,
  weather,
  onWeather,
  persistent = true,
  ownerKey,
  saveResetKey,
  useSharedFeedback = false,
  requiresNetwork = false,
  nested = false,
}: Props<Weather>) {
  const labels = strings.styleIdeas
  const isBookmarked = Boolean(
    lookId && bookmarks.some((bookmark) => bookmark.lookId === lookId)
  )
  return (
    <div
      data-surface={nested ? undefined : 'card'}
      className={`space-y-4 text-sm text-ink ${
        nested ? 'border-t border-line pt-4' : 'rounded-xl border border-line bg-card p-5'
      }`}
    >
      {lookId &&
        (useSharedFeedback ? (
          <SaveActionButton
            data-testid="sample-save-look"
            idleLabel={isBookmarked ? labels.update : labels.save}
            onSave={onSave}
            onUndo={onUndoSave}
            onView={onViewSaved}
            ownerKey={ownerKey}
            resetKey={saveResetKey ?? lookId}
            requiresNetwork={requiresNetwork}
          />
        ) : (
          <button
            type="button"
            data-testid="sample-save-look"
            className={buttonClass}
            onClick={() => {
              void onSave()
            }}
          >
            {isBookmarked ? labels.update : labels.save}
          </button>
        ))}
      {bookmarks.length > 0 && (
        <section
          aria-label={labels.saved}
          data-testid="sample-saved-looks"
          className="space-y-2"
        >
          <p role="status" aria-live="off" className="font-semibold">
            {persistent ? labels.saved : strings.chrome.storageUnavailable}
          </p>
          <ul className="space-y-2">
            {bookmarks.map((bookmark) => {
              const look = sampleLookText({ id: bookmark.lookId }, strings).name
              const entryId = bookmark.savedLookId ?? bookmark.lookId
              return (
                <li key={entryId} className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      onOpen(bookmark)
                      requestAnimationFrame(() =>
                        document.getElementById('guest-preview-outfit-heading')?.focus()
                      )
                    }}
                  >
                    {look}
                  </button>
                  {bookmark.needsReview && needsReviewLabel && (
                    <span
                      data-testid="saved-look-needs-review"
                      className="rounded-md bg-notice-surface px-2 py-0.5 text-xs font-semibold text-notice-ink"
                    >
                      {needsReviewLabel}
                    </span>
                  )}
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => onRemove(entryId)}
                  >
                    {formatPreviewString(labels.remove, { look })}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {onWeather && (
        <label className="flex flex-col gap-1 font-medium">
          {strings.preferences.weather}
          <select
            className="min-h-11 rounded-lg border border-line-strong bg-page px-2 text-ink"
            value={weather}
            onChange={(event) => {
              const next = SAMPLE_WEATHER_KEYS.find(
                (value) => value === event.currentTarget.value
              )
              if (next) onWeather(next)
            }}
          >
            {SAMPLE_WEATHER_KEYS.map((value) => (
              <option key={value} value={value}>
                {strings.values.weather[value]}
              </option>
            ))}
          </select>
        </label>
      )}
      {onPreferences && (
        <GuestStyleChoices
          labels={labels}
          preferences={preferences}
          onPreferences={onPreferences}
        />
      )}
    </div>
  )
}

export function GuestStyleChoices({
  labels,
  preferences,
  onPreferences,
}: {
  labels: GuestPreviewStrings['styleIdeas']
  preferences?: SampleStylePreferences
  onPreferences: (preferences: SampleStylePreferences) => void
}) {
  const dimensions = ['palette', 'texture'] as const
  return (
    <details>
      <summary
        className="cursor-pointer py-2 text-sm font-semibold"
        data-testid="sample-style-preferences"
      >
        {labels.heading}
      </summary>
      <div className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
        {dimensions.map((dimension) => (
          <label key={dimension} className="flex flex-col gap-1 font-medium">
            {labels[dimension]}
            <select
              className="min-h-11 rounded-lg border border-line-strong bg-page px-2 text-ink"
              value={preferences?.[dimension] ?? ''}
              onChange={(event) =>
                onPreferences({
                  ...preferences,
                  [dimension]: event.currentTarget.value || undefined,
                })
              }
            >
              <option value="">{labels.any}</option>
              {SAMPLE_STYLE_OPTIONS[dimension].map((option) => (
                <option key={option} value={option}>
                  {labels[option]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </details>
  )
}
