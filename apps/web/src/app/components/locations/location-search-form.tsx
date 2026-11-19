// Story 1.2b owner: the add-location combobox on Web settings.
// Story 1.2b web owner: the combobox search in `apps/web/src/app/components/locations/location-search-form.tsx` and the section in `apps/web/src/app/components/locations/locations-section.tsx`
//
// ARIA 1.2 combobox: the input owns a listbox of candidates, arrow keys move the
// active option, Enter picks it and Escape closes the list. The result count and
// every outcome are announced once, through the section's single status region;
// errors render in this form's own alert.
//
// Use my location asks the browser for the position only when the member taps
// it, rounds it to two decimals and lists the nearest city as an option in the
// same listbox, so it saves through the same pick, name and save steps. Every
// failure explains itself and moves focus to the city search.
'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  LocationSearchCandidate,
  SavedLocation,
  SupportedLocale,
} from '@couture/api-client/contracts/http'
import {
  DevicePositionError,
  readApproximatePosition,
} from '../../../lib/device-position'
import {
  LocationRequestError,
  locationsFromCoordinatesFromWeb,
  saveLocationFromSearchFromWeb,
  searchLocationsFromWeb,
  type LocationFailureReason,
} from '../../../lib/locations'
import {
  errorKey,
  locateErrorKey,
  type LocateFailure,
  type LocationFailureStep,
} from './location-format'

/** Story 1.2b: search waits for 300 ms of quiet typing. */
export const LOCATION_SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2
const MAX_QUERY_LENGTH = 80

type SearchState = 'idle' | 'searching' | 'done'

interface LocationSearchFormProps {
  locale: SupportedLocale
  autoFocus: boolean
  announce: (message: string) => void
  onSaved: (location: SavedLocation) => void
}

function failureReason(error: unknown): LocationFailureReason {
  return error instanceof LocationRequestError ? error.reason : 'unknown'
}

type FormError =
  | { reason: LocationFailureReason; step: LocationFailureStep }
  | { reason: LocateFailure; step: 'locate' }

const LOCATE_FAILURES: ReadonlySet<string> = new Set<LocateFailure>([
  'location_denied',
  'location_unavailable',
  'no_city_nearby',
])

function isLocateFailure(reason: string): reason is LocateFailure {
  return LOCATE_FAILURES.has(reason)
}

function formErrorKey(error: FormError): string {
  return isLocateFailure(error.reason)
    ? locateErrorKey(error.reason)
    : errorKey(error.reason, error.step)
}

export function LocationSearchForm({
  locale,
  autoFocus,
  announce,
  onSaved,
}: LocationSearchFormProps) {
  const { t } = useTranslation()
  const baseId = useId()
  const inputId = `${baseId}-search`
  const listboxId = `${baseId}-listbox`
  const labelInputId = `${baseId}-label`
  const hintId = `${baseId}-hint`
  const searchInputRef = useRef<HTMLInputElement>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<LocationSearchCandidate[]>([])
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [selected, setSelected] = useState<LocationSearchCandidate | null>(null)
  const [label, setLabel] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<FormError | null>(null)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [isLocating, setIsLocating] = useState(false)
  const locateRef = useRef<AbortController | null>(null)

  const resultCountMessage = t('locations.resultCount', { count: candidates.length })
  const noResultsMessage = t('locations.noResults')
  const announceRef = useRef(announce)
  announceRef.current = announce

  useEffect(() => {
    if (autoFocus) searchInputRef.current?.focus()
  }, [autoFocus])

  // Unmounted (signed out, or another member) means a late save or locate is ignored.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      locateRef.current?.abort()
    }
  }, [])

  /** Typing takes over from a pending Use my location: its late answer is dropped. */
  function cancelLocate() {
    if (!locateRef.current) return
    locateRef.current.abort()
    locateRef.current = null
    setIsLocating(false)
  }

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setCandidates([])
      setSearchState('idle')
      setIsOpen(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearchState('searching')
      void searchLocationsFromWeb(trimmed, locale, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return
          setCandidates(results)
          setActiveIndex(results.length > 0 ? 0 : -1)
          setIsOpen(results.length > 0)
          setSearchState('done')
          setError(null)
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return
          setCandidates([])
          setIsOpen(false)
          setSearchState('done')
          setError({ reason: failureReason(caught), step: 'search' })
        })
    }, LOCATION_SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, locale, searchAttempt])

  // One announcement per finished search, never per keystroke.
  useEffect(() => {
    if (searchState !== 'done' || error) return
    announceRef.current(candidates.length > 0 ? resultCountMessage : noResultsMessage)
  }, [searchState, candidates, error, resultCountMessage, noResultsMessage])

  function choose(candidate: LocationSearchCandidate) {
    setSelected(candidate)
    setLabel(candidate.city)
    setIsOpen(false)
    setError(null)
    announce(t('locations.selected', { place: candidate.displayLabel }))
    requestAnimationFrame(() => labelInputRef.current?.focus())
  }

  /** A failed Use my location says why and hands the member the city search. */
  function locateFailed(next: FormError) {
    setCandidates([])
    setIsOpen(false)
    setSearchState('idle')
    setError(next)
    searchInputRef.current?.focus()
  }

  async function locateMe() {
    // A save in flight owns the form, as on mobile.
    if (isLocating || isSaving) return
    locateRef.current?.abort()
    const controller = new AbortController()
    locateRef.current = controller
    setIsLocating(true)
    setError(null)
    setSelected(null)
    setQuery('')
    setCandidates([])
    setIsOpen(false)
    setSearchState('idle')
    try {
      const position = await readApproximatePosition()
      if (controller.signal.aborted) return
      const results = await locationsFromCoordinatesFromWeb(
        position,
        locale,
        controller.signal
      )
      if (controller.signal.aborted) return
      if (results.length === 0) {
        locateFailed({ reason: 'no_city_nearby', step: 'locate' })
        return
      }
      setCandidates(results)
      setActiveIndex(0)
      setIsOpen(true)
      setSearchState('done')
      searchInputRef.current?.focus()
    } catch (caught) {
      if (controller.signal.aborted) return
      if (caught instanceof DevicePositionError) {
        locateFailed({
          reason: caught.reason === 'denied' ? 'location_denied' : 'location_unavailable',
          step: 'locate',
        })
        return
      }
      locateFailed({ reason: failureReason(caught), step: 'locate' })
    } finally {
      if (locateRef.current === controller) {
        locateRef.current = null
        setIsLocating(false)
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && candidates.length > 0) {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => (index + 1) % candidates.length)
    } else if (event.key === 'ArrowUp' && candidates.length > 0) {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => (index <= 0 ? candidates.length - 1 : index - 1))
    } else if (event.key === 'Enter' && isOpen && activeIndex >= 0) {
      event.preventDefault()
      const candidate = candidates[activeIndex]
      if (candidate) choose(candidate)
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      setIsOpen(false)
    }
  }

  async function save() {
    // Re-entrancy is refused here; disabling the button would drop focus.
    if (isSaving || !selected) return
    const trimmedLabel = label.trim() || selected.city
    setIsSaving(true)
    setError(null)
    try {
      const saved = await saveLocationFromSearchFromWeb(
        selected.candidateToken,
        trimmedLabel
      )
      if (!mountedRef.current) return
      setSelected(null)
      setQuery('')
      setLabel('')
      setCandidates([])
      setSearchState('idle')
      onSaved(saved)
    } catch (caught) {
      const reason = failureReason(caught)
      // An expired candidate cannot be retried; every other failure keeps the
      // chosen city so a retry is one press.
      if (reason === 'invalid_candidate') setSelected(null)
      setError({ reason, step: 'save' })
    } finally {
      setIsSaving(false)
    }
  }

  const activeOptionId =
    isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
  const canRetry =
    error?.reason === 'provider_unavailable' || error?.reason === 'service_unavailable'
  const retry =
    error?.step === 'locate'
      ? () => {
          void locateMe()
        }
      : () => {
          // Leave 'done' first: clearing the error on a finished,
          // empty search would announce "no cities match" before
          // the retry has asked anything.
          setSearchState('searching')
          setError(null)
          setSearchAttempt((attempt) => attempt + 1)
        }

  return (
    <form
      className="mt-6 flex flex-col gap-3"
      data-testid="location-add-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label htmlFor={inputId} className="text-base font-medium text-white">
        {t('locations.searchLabel')}
      </label>
      <div className="relative">
        <input
          ref={searchInputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-describedby={hintId}
          aria-busy={searchState === 'searching'}
          autoComplete="off"
          maxLength={MAX_QUERY_LENGTH}
          value={query}
          onChange={(event) => {
            cancelLocate()
            setQuery(event.target.value)
            setSelected(null)
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-md border border-neutral-600 bg-neutral-900 px-3 text-white"
          data-testid="location-search-input"
        />
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('locations.searchLabel')}
          hidden={!isOpen}
          className="mt-1 max-h-72 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900"
          data-testid="location-search-results"
        >
          {candidates.map((candidate, index) => (
            <li
              key={candidate.candidateToken}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(candidate)}
              className={`flex min-h-[44px] cursor-pointer items-center px-3 text-sm text-white ${
                index === activeIndex ? 'bg-neutral-700' : ''
              }`}
              data-testid="location-search-option"
            >
              {candidate.displayLabel}
            </li>
          ))}
        </ul>
      </div>
      <p id={hintId} className="text-sm text-neutral-300">
        {isLocating
          ? t('locations.locating')
          : searchState === 'searching'
            ? t('locations.searching')
            : t('locations.searchHint')}
      </p>
      <button
        type="button"
        aria-busy={isLocating}
        disabled={isSaving}
        onClick={() => {
          void locateMe()
        }}
        className="min-h-[44px] self-start rounded-md border border-[#c9a14a] px-4 text-white disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="location-use-my-location"
      >
        {t('locations.useMyLocation')}
      </button>

      {selected && (
        <div className="flex flex-col gap-3" data-testid="location-selected">
          <p className="text-sm text-neutral-100">
            {t('locations.selected', { place: selected.displayLabel })}
          </p>
          <label htmlFor={labelInputId} className="text-base font-medium text-white">
            {t('locations.labelField')}
          </label>
          <input
            ref={labelInputRef}
            id={labelInputId}
            type="text"
            maxLength={80}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="rounded-md border border-neutral-600 bg-neutral-900 px-3 text-white"
            data-testid="location-label-input"
          />
          <button
            type="submit"
            aria-busy={isSaving}
            className="min-h-[44px] self-start rounded-md bg-[#c9a14a] px-4 font-semibold text-neutral-950"
            data-testid="location-save-button"
          >
            {isSaving ? t('locations.saving') : t('locations.save')}
          </button>
        </div>
      )}

      {error && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-red-300" data-testid="location-error">
            {t(formErrorKey(error))}
          </p>
          {canRetry && (
            <button
              type={selected ? 'submit' : 'button'}
              onClick={selected ? undefined : retry}
              className="min-h-[44px] self-start rounded-md border border-neutral-500 px-4 text-white"
              data-testid="location-retry-button"
            >
              {t('locations.retry')}
            </button>
          )}
        </div>
      )}
    </form>
  )
}
