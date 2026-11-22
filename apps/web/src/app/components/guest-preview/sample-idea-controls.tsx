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

type Props = {
  strings: GuestPreviewStrings
  preferences?: SampleStylePreferences
  onPreferences: (preferences: SampleStylePreferences) => void
  bookmarks: SampleBookmark[]
  lookId?: string
  onSave: () => unknown
  onUndoSave?: () => unknown
  onViewSaved?: () => void
  onOpen: (bookmark: SampleBookmark) => void
  onRemove: (lookId: string) => void
  weather?: SampleWeatherKey
  onWeather?: (weather: SampleWeatherKey) => void
  persistent?: boolean
  ownerKey?: string | null
  saveResetKey?: string
}

const buttonClass =
  'min-h-11 rounded-lg border border-[#C9C9D1] px-3 text-sm font-semibold'

export function SampleIdeaControls({
  strings,
  preferences,
  onPreferences,
  bookmarks,
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
}: Props) {
  const labels = strings.styleIdeas
  const dimensions = Object.keys(SAMPLE_STYLE_OPTIONS) as (keyof SampleStylePreferences)[]
  const isBookmarked = Boolean(
    lookId && bookmarks.some((bookmark) => bookmark.lookId === lookId)
  )
  return (
    <div className="space-y-4 rounded-lg border border-[#E6E6ED] bg-white p-5 text-sm text-[#111111]">
      {lookId && (
        <SaveActionButton
          data-testid="sample-save-look"
          idleLabel={isBookmarked ? labels.update : labels.save}
          onSave={onSave}
          onUndo={onUndoSave}
          onView={onViewSaved}
          ownerKey={ownerKey}
          resetKey={saveResetKey ?? lookId}
        />
      )}
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
              return (
                <li key={bookmark.lookId} className="flex flex-wrap gap-2">
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
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => onRemove(bookmark.lookId)}
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
            className="min-h-11 rounded-lg border border-[#C9C9D1] bg-white px-2"
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
      <details>
        <summary className="cursor-pointer py-2 font-semibold">{labels.heading}</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {dimensions.map((dimension) => (
            <label key={dimension} className="flex flex-col gap-1 font-medium">
              {labels[dimension]}
              <select
                className="min-h-11 rounded-lg border border-[#C9C9D1] bg-white px-2"
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
    </div>
  )
}
