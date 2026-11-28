'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getStyleProfileStrings,
  SAMPLE_STYLE_OPTIONS,
  space,
  STYLE_PALETTE_SWATCHES,
  STYLE_TEMPERATURE_OPTIONS,
  STYLE_TUNE_GROUPS,
  STYLE_TUNE_STEPS,
  styleChoiceGarment,
  styleTunePatch,
  styleTuneSelected,
  toggleStyleTuneChoice,
  type StyleIllustratedChoice,
  type StyleMood,
  type StyleProfileAnswers,
} from '@couture/utils'
import type { useWebStyleProfile } from '../../lib/style-profile'
import { AccessibleModal } from './accessible-modal'
import { SampleGarmentArt } from './guest-preview/sample-garment-art'

type StyleState = ReturnType<typeof useWebStyleProfile>
const secondary =
  'min-h-11 rounded-lg px-2 text-sm font-semibold text-ink underline underline-offset-4 disabled:opacity-60'
const primary =
  'min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-60'

function useStyleCopy() {
  return getStyleProfileStrings(useTranslation().i18n.language)
}

function PictureChoice({
  id,
  label,
  choice,
  selected,
  disabled,
  compact = false,
  onSelect,
}: {
  id: string
  label: string
  choice: StyleIllustratedChoice | keyof typeof STYLE_PALETTE_SWATCHES
  selected: boolean
  disabled?: boolean
  compact?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-testid={id}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      style={{ paddingInline: compact ? 0 : space[1] }}
      className={`flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-lg border py-2 text-center text-xs font-semibold leading-tight [overflow-wrap:anywhere] disabled:opacity-60 ${selected ? 'border-primary bg-card ring-1 ring-primary' : 'border-line bg-page'}`}
    >
      {choice === 'neutral' || choice === 'colorful' ? (
        <span
          className="my-2 flex h-8 max-w-full overflow-hidden rounded-md border border-line"
          aria-hidden="true"
        >
          {STYLE_PALETTE_SWATCHES[choice].map((color) => (
            <span key={color} className="h-full w-5" style={{ backgroundColor: color }} />
          ))}
        </span>
      ) : (
        <SampleGarmentArt
          garment={styleChoiceGarment(choice)}
          className="h-8 w-8 max-w-full"
        />
      )}
      <span className="min-w-0 max-w-full">{label}</span>
    </button>
  )
}

export function StyleMoodRow({
  selected,
  onSelect,
  disabled,
  day = false,
}: {
  selected?: StyleMood | null
  onSelect: (mood: StyleMood) => void
  disabled?: boolean
  day?: boolean
}) {
  const copy = useStyleCopy()
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-semibold">{copy.mood}</legend>
      <div className="grid grid-cols-4" style={{ columnGap: space[1] }}>
        {SAMPLE_STYLE_OPTIONS.style.map((mood) => (
          <PictureChoice
            key={mood}
            id={`style-${day ? 'day-' : ''}mood-${mood}`}
            label={copy[mood]}
            choice={mood}
            selected={selected === mood}
            disabled={disabled}
            compact
            onSelect={() => onSelect(mood)}
          />
        ))}
      </div>
    </fieldset>
  )
}

export function StyleDayControls({
  style,
  showTune = false,
  showMood = true,
  nested = false,
  onInteract,
}: {
  style: StyleState
  showTune?: boolean
  showMood?: boolean
  nested?: boolean
  onInteract?: () => void
}) {
  const copy = useStyleCopy()
  const { scope, day, store } = style
  if (!scope) return null
  return (
    <details
      className={
        nested ? 'border-t border-line' : 'rounded-lg border border-line bg-card px-3'
      }
    >
      <summary
        data-testid="style-day-open"
        className="cursor-pointer py-3 text-sm font-semibold text-ink"
        onClick={onInteract}
      >
        {copy.day}
      </summary>
      <div className="space-y-3 pb-3">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{copy.temperature}</legend>
          <div className="grid grid-cols-3 gap-2">
            {STYLE_TEMPERATURE_OPTIONS.map((temperature) => (
              <button
                key={temperature}
                type="button"
                className={`min-h-11 rounded-lg border px-2 text-sm font-semibold ${day?.temperature === temperature ? 'border-primary bg-card ring-1 ring-primary' : 'border-line bg-page'}`}
                data-testid={`style-day-temperature-${temperature}`}
                aria-pressed={day?.temperature === temperature}
                onClick={() =>
                  store.updateDay(scope, {
                    temperature: day?.temperature === temperature ? null : temperature,
                  })
                }
              >
                {copy[temperature]}
              </button>
            ))}
          </div>
        </fieldset>
        {showMood && (
          <StyleMoodRow
            day
            selected={day?.mood}
            onSelect={(mood) =>
              store.updateDay(scope, { mood: day?.mood === mood ? null : mood })
            }
          />
        )}
        <button
          type="button"
          className={secondary}
          data-testid="style-day-reset"
          disabled={!day}
          onClick={() => store.updateDay(scope, null)}
        >
          {copy.reset}
        </button>
        {showTune && <StyleMemberControls style={style} showMood={false} />}
      </div>
    </details>
  )
}

function TuneWizard({
  profile,
  saving,
  save,
  onClose,
}: {
  profile: StyleProfileAnswers
  saving: boolean
  save: (patch: Partial<StyleProfileAnswers>) => Promise<boolean>
  onClose: () => void
}) {
  const copy = useStyleCopy()
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(profile)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [failed, setFailed] = useState(false)
  const fields = STYLE_TUNE_STEPS[step]!
  const last = step === STYLE_TUNE_STEPS.length - 1
  const advance = () => {
    setFailed(false)
    if (last) onClose()
    else setStep(step + 1)
  }
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <fieldset key={field} className="space-y-2">
          <legend className="font-semibold">{copy[field]}</legend>
          <div
            className={`grid gap-2 ${field === 'avoid' ? 'grid-cols-3' : 'grid-cols-2'}`}
          >
            {STYLE_TUNE_GROUPS[field].map((choice) => (
              <PictureChoice
                key={choice}
                id={`style-${field}-${choice}`}
                label={copy[choice]}
                choice={choice}
                selected={styleTuneSelected(draft, field, choice)}
                disabled={saving}
                onSelect={() =>
                  setDraft((current) => toggleStyleTuneChoice(current, field, choice))
                }
              />
            ))}
          </div>
        </fieldset>
      ))}
      {failed && <p role="alert">{copy.saveFailed}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={secondary}
          data-testid="style-tune-skip"
          disabled={saving}
          onClick={advance}
        >
          {copy.skip}
        </button>
        <button
          type="button"
          className={primary}
          data-testid="style-tune-next"
          disabled={saving}
          onClick={() => {
            void save(styleTunePatch(draft, step)).then((saved) => {
              if (!mounted.current) return
              if (saved) advance()
              else setFailed(true)
            })
          }}
        >
          {saving ? copy.saving : last ? copy.finish : copy.next}
        </button>
      </div>
    </div>
  )
}

export function StyleMemberControls({
  style,
  showClear = false,
  showMood = true,
}: {
  style: StyleState
  showClear?: boolean
  showMood?: boolean
}) {
  const copy = useStyleCopy()
  const { scope, profile, status, saving, store } = style
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  if (!scope) return null
  const close = () => setOpen(false)
  const mutate = async (work: Promise<boolean>) => {
    setFailed(false)
    setFailed(!(await work))
  }
  return (
    <div className="space-y-2 text-ink">
      {showMood && (
        <StyleMoodRow
          selected={profile?.mood}
          disabled={!profile || saving}
          onSelect={(mood) =>
            void mutate(store.save(scope, { mood: profile?.mood === mood ? null : mood }))
          }
        />
      )}
      <div className="flex flex-wrap gap-x-2">
        <button
          type="button"
          data-testid="style-tune-open"
          aria-haspopup="dialog"
          ref={opener}
          className={secondary}
          onClick={() => {
            setFailed(false)
            setOpen(true)
            if (status === 'failed') void store.load(scope)
          }}
        >
          {copy.tune}
        </button>
        {showClear && (
          <button
            type="button"
            data-testid="style-profile-clear"
            className={secondary}
            disabled={!profile || saving}
            onClick={() => void mutate(store.clear(scope))}
          >
            {copy.clear}
          </button>
        )}
      </div>
      {!open && status === 'failed' && !profile && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm">
            {copy.loadFailed}
          </p>
          <button
            type="button"
            data-testid="style-profile-retry"
            className={secondary}
            onClick={() => void store.load(scope)}
          >
            {copy.retry}
          </button>
        </div>
      )}
      {failed && <p role="alert">{copy.saveFailed}</p>}
      <AccessibleModal
        isOpen={open}
        onClose={close}
        titleId={titleId}
        title={copy.tune}
        invokingElementRef={opener}
      >
        {profile ? (
          <TuneWizard
            profile={profile}
            onClose={close}
            save={(patch) => store.save(scope, patch)}
            saving={saving}
          />
        ) : status === 'failed' ? (
          <div className="space-y-2">
            <p role="alert">{copy.loadFailed}</p>
            <button
              type="button"
              className={secondary}
              onClick={() => void store.load(scope)}
            >
              {copy.retry}
            </button>
          </div>
        ) : (
          <p role="status">{copy.loading}</p>
        )}
      </AccessibleModal>
    </div>
  )
}
