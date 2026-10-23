// Story 1.2b owner: the Locations section of Web settings.
//
// Lists saved locations (label, place, primary marker), adds through city
// search, and switches primary, renames and deletes in place. Switching primary
// is one press. Outcomes are announced once through the status region below;
// failures render as alerts. Signed out, it renders the same calm shell the
// unauthenticated accessibility audit of `/settings` scans.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  resolveSupportedLocale,
  type SavedLocation,
} from '@couture/api-client/contracts/http'
import {
  deleteLocationFromWeb,
  hasWebSession,
  listLocationsFromWeb,
  LocationRequestError,
  renameLocationFromWeb,
  setPrimaryLocationFromWeb,
  type LocationFailureReason,
} from '../../../lib/locations'
import {
  errorKey,
  formatPlace,
  MAX_SAVED_LOCATIONS,
  safeReturnPath,
} from './location-format'
import { LocationSearchForm } from './location-search-form'

type SectionState = 'checking' | 'signed_out' | 'loading' | 'ready' | 'load_failed'

export const ADD_LOCATION_QUERY = 'addLocation'
export const RETURN_TO_QUERY = 'returnTo'

function reasonOf(error: unknown): LocationFailureReason {
  return error instanceof LocationRequestError ? error.reason : 'unknown'
}

export function LocationsSection() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const locale = resolveSupportedLocale(i18n.language) ?? 'en-US'
  const guided = searchParams.get(ADD_LOCATION_QUERY) === '1'
  const returnTo = safeReturnPath(searchParams.get(RETURN_TO_QUERY))
  const [sectionState, setSectionState] = useState<SectionState>('checking')
  const [locations, setLocations] = useState<SavedLocation[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState<LocationFailureReason | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const headingRef = useRef<HTMLHeadingElement>(null)
  const pendingFocusRef = useRef<string | null>(null)

  const loadErrorMessage = t('locations.loadError')

  /*
   * Fresh text each time, so an identical outcome twice in a row (two deletes)
   * still reaches assistive technology: the region is cleared, then filled.
   */
  const announce = useCallback((message: string) => {
    setStatus('')
    requestAnimationFrame(() => setStatus(message))
  }, [])

  const reload = useCallback(async (signal?: AbortSignal) => {
    const next = await listLocationsFromWeb(signal)
    if (signal?.aborted) return
    setLocations(next)
    setSectionState('ready')
  }, [])

  useEffect(() => {
    if (!hasWebSession()) {
      setSectionState('signed_out')
      return
    }
    const controller = new AbortController()
    setSectionState('loading')
    reload(controller.signal).catch(() => {
      if (controller.signal.aborted) return
      setSectionState('load_failed')
    })
    return () => controller.abort()
  }, [reload, loadErrorMessage])

  // Focus moves to the item an action changed, once it has rendered.
  useEffect(() => {
    const id = pendingFocusRef.current
    if (!id) return
    pendingFocusRef.current = null
    const target = id === 'heading' ? headingRef.current : itemRefs.current.get(id)
    target?.focus()
  }, [locations, renamingId, confirmingId])

  async function run(
    locationId: string,
    work: () => Promise<string>,
    focusAfter: string
  ): Promise<void> {
    if (busyId) return
    setBusyId(locationId)
    setError(null)
    try {
      const message = await work()
      await reload()
      pendingFocusRef.current = focusAfter
      announce(message)
    } catch (caught) {
      setError(reasonOf(caught))
    } finally {
      setBusyId(null)
    }
  }

  function makePrimary(location: SavedLocation) {
    void run(
      location.id,
      async () => {
        await setPrimaryLocationFromWeb(location.id)
        return t('locations.primaryChanged', { label: location.label })
      },
      location.id
    )
  }

  function saveRename(location: SavedLocation) {
    const label = renameValue.trim()
    if (!label) return
    void run(
      location.id,
      async () => {
        await renameLocationFromWeb(location.id, label)
        setRenamingId(null)
        return t('locations.renamed', { label })
      },
      location.id
    )
  }

  function confirmDelete(location: SavedLocation) {
    void run(
      location.id,
      async () => {
        await deleteLocationFromWeb(location.id)
        setConfirmingId(null)
        return t('locations.deleted', { label: location.label })
      },
      'heading'
    )
  }

  async function handleSaved(location: SavedLocation) {
    await reload().catch(() => setSectionState('load_failed'))
    announce(t('locations.saved', { label: location.label }))
    pendingFocusRef.current = location.id
    if (returnTo) router.push(returnTo)
  }

  const isFull = locations.length >= MAX_SAVED_LOCATIONS

  return (
    <section
      id="locations"
      aria-labelledby="locations-title"
      data-testid="locations-section"
      data-state={sectionState}
      className="mt-10 max-w-2xl border-t border-neutral-800 pt-8"
    >
      <h2
        id="locations-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-white outline-none"
      >
        {t('locations.title')}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-neutral-200">
        {t('locations.intro')}
      </p>

      {sectionState === 'signed_out' && (
        <p className="mt-4 text-sm text-neutral-300" data-testid="locations-signed-out">
          {t('locations.signedOutHint')}
        </p>
      )}

      {sectionState === 'load_failed' && (
        <p
          role="alert"
          className="mt-4 text-sm text-red-300"
          data-testid="locations-load-error"
        >
          {loadErrorMessage}
        </p>
      )}

      {sectionState === 'ready' && (
        <>
          <p className="mt-4 text-sm text-neutral-300" data-testid="locations-count">
            {t('locations.count', { count: locations.length })}
          </p>
          {locations.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-200" data-testid="locations-empty">
              {t('locations.empty')}
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3" data-testid="locations-list">
              {locations.map((location) => (
                <li
                  key={location.id}
                  className="rounded-md border border-neutral-700 p-4"
                  data-testid="location-item"
                  data-primary={location.isPrimary}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3
                      ref={(node) => {
                        if (node) itemRefs.current.set(location.id, node)
                        else itemRefs.current.delete(location.id)
                      }}
                      tabIndex={-1}
                      className="text-base font-semibold text-white outline-none"
                      data-testid="location-item-label"
                    >
                      {location.label}
                    </h3>
                    {location.isPrimary && (
                      <span
                        className="rounded-full bg-[#c9a14a] px-2 text-xs font-semibold text-neutral-950"
                        data-testid="location-primary-badge"
                      >
                        {t('locations.primary')}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-1 text-sm text-neutral-300"
                    data-testid="location-item-place"
                  >
                    {formatPlace(location, locale)}
                  </p>

                  {renamingId === location.id ? (
                    <form
                      className="mt-3 flex flex-wrap items-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        saveRename(location)
                      }}
                    >
                      <label className="flex flex-col gap-1 text-sm text-white">
                        {t('locations.renameField')}
                        <input
                          autoFocus
                          type="text"
                          maxLength={80}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setRenamingId(null)
                              pendingFocusRef.current = location.id
                            }
                          }}
                          className="rounded-md border border-neutral-600 bg-neutral-900 px-3 text-white"
                          data-testid="location-rename-input"
                        />
                      </label>
                      <button
                        type="submit"
                        aria-busy={busyId === location.id}
                        className="min-h-[44px] rounded-md bg-[#c9a14a] px-3 font-semibold text-neutral-950"
                        data-testid="location-rename-save"
                      >
                        {t('locations.renameSave')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(null)
                          pendingFocusRef.current = location.id
                        }}
                        className="min-h-[44px] rounded-md border border-neutral-500 px-3 text-white"
                      >
                        {t('locations.cancel')}
                      </button>
                    </form>
                  ) : confirmingId === location.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-white">
                        {t('locations.deleteConfirm', { label: location.label })}
                      </p>
                      <button
                        type="button"
                        autoFocus
                        aria-busy={busyId === location.id}
                        onClick={() => confirmDelete(location)}
                        className="min-h-[44px] rounded-md border border-red-400 px-3 text-red-200"
                        data-testid="location-delete-confirm"
                      >
                        {t('locations.deleteConfirmAction')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingId(null)
                          pendingFocusRef.current = location.id
                        }}
                        className="min-h-[44px] rounded-md border border-neutral-500 px-3 text-white"
                      >
                        {t('locations.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!location.isPrimary && (
                        <button
                          type="button"
                          aria-busy={busyId === location.id}
                          onClick={() => makePrimary(location)}
                          className="min-h-[44px] rounded-md border border-[#c9a14a] px-3 text-white"
                          aria-label={`${t('locations.makePrimary')}, ${location.label}`}
                          data-testid="location-make-primary"
                        >
                          {t('locations.makePrimary')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingId(null)
                          setRenameValue(location.label)
                          setRenamingId(location.id)
                        }}
                        className="min-h-[44px] rounded-md border border-neutral-500 px-3 text-white"
                        aria-label={`${t('locations.rename')}, ${location.label}`}
                        data-testid="location-rename"
                      >
                        {t('locations.rename')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(null)
                          setConfirmingId(location.id)
                        }}
                        className="min-h-[44px] rounded-md border border-neutral-500 px-3 text-white"
                        aria-label={`${t('locations.delete')}, ${location.label}`}
                        data-testid="location-delete"
                      >
                        {t('locations.delete')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isFull ? (
            <p className="mt-4 text-sm text-neutral-200" data-testid="locations-limit">
              {t('locations.limit')}
            </p>
          ) : (
            <LocationSearchForm
              locale={locale}
              autoFocus={guided}
              announce={announce}
              onSaved={(location) => {
                void handleSaved(location)
              }}
            />
          )}
        </>
      )}

      <p
        role="status"
        className="mt-4 min-h-[1.25rem] text-sm text-emerald-300"
        data-testid="locations-status-region"
      >
        {status}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-1 text-sm text-red-300"
          data-testid="locations-error"
        >
          {t(errorKey(error))}
        </p>
      )}
    </section>
  )
}
