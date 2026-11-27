'use client'
// Story 6.16 D5: the sample weather and the three real comfort settings.
import {
  formatPreviewString,
  formatRainChance,
  formatSampleTemperature,
  SAMPLE_WEATHER,
  SAMPLE_WEATHER_KEYS,
  type GuestPreviewState,
  type GuestPreviewStrings,
  type SampleComfort,
  type GuestSampleWeatherKey,
} from '@couture/utils'
import { GuestPreviewChoiceGroup } from './guest-preview-choice-group'

export type GuestPreviewControl = 'weather' | 'thermal' | 'wind' | 'rain'

const RUNS = ['cold', 'neutral', 'warm'] as const
const TOLERANCES = ['low', 'medium', 'high'] as const

export function GuestPreviewControls({
  state,
  strings,
  locale,
  onWeather,
  onComfort,
}: {
  state: GuestPreviewState
  strings: GuestPreviewStrings
  locale: string
  onWeather: (weather: GuestSampleWeatherKey) => void
  onComfort: (comfort: SampleComfort, control: GuestPreviewControl) => void
}) {
  const { values } = strings
  const weather = SAMPLE_WEATHER[state.weather]
  return (
    <section
      aria-labelledby="guest-preview-controls-heading"
      data-testid="guest-preview-controls"
      data-surface="card"
      className="min-w-0 space-y-5 rounded-xl border border-line bg-card p-3 [overflow-wrap:anywhere] min-[361px]:p-5"
    >
      <div className="space-y-1">
        <h2
          id="guest-preview-controls-heading"
          className="text-lg font-semibold text-ink"
        >
          {strings.preferences.heading}
        </h2>
        <p className="text-sm text-ink-soft">{strings.chrome.supporting}</p>
      </div>
      <GuestPreviewChoiceGroup
        legend={strings.preferences.weather}
        name="weather"
        testId="guest-preview-weather"
        value={state.weather}
        options={SAMPLE_WEATHER_KEYS.map((key) => ({
          value: key,
          label: values.weather[key],
        }))}
        onChange={onWeather}
      />
      <p className="text-xs text-ink-muted" data-testid="guest-preview-weather-detail">
        {formatPreviewString(strings.preferences.weatherDetail, {
          temperature: formatSampleTemperature(weather.feelsLike, locale),
          windSpeed: weather.windSpeed,
          rainPercent: formatRainChance(weather.precipitationProbability * 100, strings),
        })}
      </p>
      <GuestPreviewChoiceGroup
        legend={strings.preferences.thermal}
        name="thermal"
        testId="guest-preview-thermal"
        value={state.comfort.runsColdWarm}
        options={RUNS.map((run) => ({ value: run, label: values.runsColdWarm[run] }))}
        onChange={(runsColdWarm) =>
          onComfort({ ...state.comfort, runsColdWarm }, 'thermal')
        }
      />
      <GuestPreviewChoiceGroup
        legend={strings.preferences.wind}
        name="wind"
        testId="guest-preview-wind"
        value={state.comfort.windTolerance}
        options={TOLERANCES.map((level) => ({
          value: level,
          label: values.windTolerance[level],
        }))}
        onChange={(windTolerance) =>
          onComfort({ ...state.comfort, windTolerance }, 'wind')
        }
      />
      <GuestPreviewChoiceGroup
        legend={strings.preferences.rain}
        name="rain"
        testId="guest-preview-rain"
        value={state.comfort.precipPreparedness}
        options={TOLERANCES.map((level) => ({
          value: level,
          label: values.precipPreparedness[level],
        }))}
        onChange={(precipPreparedness) =>
          onComfort({ ...state.comfort, precipPreparedness }, 'rain')
        }
      />
    </section>
  )
}
