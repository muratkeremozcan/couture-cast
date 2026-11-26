// Story 1.2b owner: the Locations section of Web settings.
//
// Lists saved locations (label, place, primary marker), adds through city
// search, and switches primary, renames and deletes in place. Switching primary
// is one press. Outcomes are announced once through the status region below;
// failures render as alerts. Signed out, it renders the same calm shell the
// unauthenticated accessibility audit of `/settings` scans.
//
// The section follows the session (`useWebSession`): while a stored session is
// still being verified it stays `checking`, and it lists once per member. A
// one-shot check on mount once told a signed-in member to sign in (Jade,
// 2026-11-19).
'use client'

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  resolveSupportedLocale,
  type SavedLocation,
} from '@couture/api-client/contracts/http'
import {
  captureLocationCredentials,
  deleteLocationFromWeb,
  listLocationsFromWeb,
  LocationRequestError,
  renameLocationFromWeb,
  setPrimaryLocationFromWeb,
  type LocationCredentials,
  type LocationFailureReason,
} from '../../../lib/locations'
import {
  errorKey,
  formatPlace,
  MAX_SAVED_LOCATIONS,
  safeReturnPath,
} from './location-format'
import {
  currentWebSessionOwner,
  MemberScope,
  type MemberSession,
} from '../../../lib/use-web-session'
import { LocationSearchForm, type LocationClaim } from './location-search-form'
import {
  GuestText,
  useGuestFirstPaint,
  useScreenGateRead,
  useSectionSnapshot,
} from '../screen-gate'

type SectionState = 'checking' | 'signed_out' | 'loading' | 'ready' | 'load_failed'

export const ADD_LOCATION_QUERY = 'addLocation'
export const RETURN_TO_QUERY = 'returnTo'

function reasonOf(error: unknown): LocationFailureReason {
  return error instanceof LocationRequestError ? error.reason : 'unknown'
}

/** The guided city setup a link asked for (`?addLocation=1&returnTo=...`). */
type GuidedEntry = { guided: boolean; returnTo: string | null }

const NO_GUIDED_ENTRY: GuidedEntry = { guided: false, returnTo: null }

/**
 * Codex review P2-3: reads the guided-entry query on its own, inside its own Suspense boundary.
 * A statically rendered `/settings` bails out of search params during prerender; only this
 * reader waits for the client, so the section's chrome is in the first HTML and nothing of it
 * is inserted above Profile's visible controls when the query arrives.
 */
function GuidedEntryQuery({ onRead }: { onRead: (entry: GuidedEntry) => void }) {
  const searchParams = useSearchParams()
  const guided = searchParams.get(ADD_LOCATION_QUERY) === '1'
  const returnTo = searchParams.get(RETURN_TO_QUERY)
  useLayoutEffect(() => {
    onRead(guided || returnTo !== null ? { guided, returnTo } : NO_GUIDED_ENTRY)
  }, [guided, returnTo, onRead])
  return null
}

/**
 * Everything in the section belongs to the member the session bridge names right now: it is
 * keyed by that owner, so a change of member (or sign-out) discards the last member's rows,
 * editors, status, form and every handler they hold in the same render, before any effect runs.
 */
export function LocationsSection() {
  const [entry, setEntry] = useState<GuidedEntry>(NO_GUIDED_ENTRY)
  return (
    <>
      <Suspense fallback={null}>
        <GuidedEntryQuery onRead={setEntry} />
      </Suspense>
      <MemberScope>
        {(session) => <MemberLocationsSection session={session} entry={entry} />}
      </MemberScope>
    </>
  )
}

/**
 * Guided setup belongs to a member's list: a signed-out page, whose gate is open from the first
 * paint, never has its Cancel inserted above the hint when the query arrives (P2-3).
 */
function showGuidedCancel(
  guided: boolean,
  sectionState: SectionState,
  guestHint: boolean
): boolean {
  return guided && sectionState !== 'signed_out' && !guestHint
}

/** The saved list a return to Profile shows first (Story CC-7.7 D5, Codex review P1-2). */
type LocationsSnapshot = { locations: SavedLocation[] }

function MemberLocationsSection({
  session,
  entry,
}: {
  session: MemberSession
  entry: GuidedEntry
}) {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const locale = resolveSupportedLocale(i18n.language) ?? 'en-US'
  const { guided, returnTo } = entry
  const snapshot = useSectionSnapshot<LocationsSnapshot>('locations', session.owner)
  const { beginRead, remember, restoredFor } = snapshot
  const [sectionState, setSectionState] = useState<SectionState>(snapshot.startState)
  const sectionStateRef = useRef(sectionState)
  sectionStateRef.current = sectionState
  const [locations, setLocations] = useState<SavedLocation[]>(
    () => snapshot.restored?.locations ?? []
  )
  const [status, setStatus] = useState('')
  const [error, setError] = useState<LocationFailureReason | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const headingRef = useRef<HTMLHeadingElement>(null)
  /** Where focus goes once the change renders, with the ownership check of the work that set it. */
  const pendingFocusRef = useRef<{ target: string; current: () => boolean } | null>(null)
  const owner = session.owner
  const [loadAttempt, setLoadAttempt] = useState(0)
  /*
   * Bumped whenever the member changes (or leaves). Every async completion
   * checks it, so a late answer for one member never shows on another's
   * section, or after sign out.
   */
  const ownerGenerationRef = useRef(0)
  /** Only the newest list read lands; a mutation also retires the reads started before it. */
  const reloadGenerationRef = useRef(0)
  /**
   * One ownership token for work started now for `startedFor`: it may still
   * touch this section while the section is mounted for the same member and
   * the session bridge still names them. The bridge is read synchronously, so
   * a member change counts even before this section's effects have run. Every
   * completion (list, status, focus, navigation) checks it first.
   */
  const ownedBy = useCallback((startedFor: string | null) => {
    const generation = ownerGenerationRef.current
    return () =>
      generation === ownerGenerationRef.current &&
      startedFor !== null &&
      currentWebSessionOwner() === startedFor
  }, [])

  /**
   * Pins one member-owned operation to its owner at the moment the member acts:
   * the owner this section rendered for, which must still be the one the
   * session bridge names (null refuses the action). Each request reads the
   * bearer only when it is sent, after checking the owner is unchanged, so the
   * same member's refreshed token is used and another member's never is. Every
   * step after an await, and every deferred announcement, focus or navigation,
   * checks `current`.
   */
  const claim = useCallback((): LocationClaim | null => {
    if (owner === null || currentWebSessionOwner() !== owner) return null
    const current = ownedBy(owner)
    return {
      current,
      credentials: () => (current() ? captureLocationCredentials() : null),
    }
  }, [owner, ownedBy])

  const focusLater = useCallback((target: string, current: () => boolean) => {
    pendingFocusRef.current = { target, current }
  }, [])

  const loadErrorMessage = t('locations.loadError')

  /*
   * Fresh text each time, so an identical outcome twice in a row (two deletes)
   * still reaches assistive technology: the region is cleared, then filled.
   */
  const announce = useCallback((message: string, current: () => boolean) => {
    if (!current()) return
    setStatus('')
    requestAnimationFrame(() => {
      if (current()) setStatus(message)
    })
  }, [])

  /**
   * True when the list landed for the member who asked for it. The request is
   * not sent once its owner is gone, and its answer is dropped if the owner
   * left while it was in flight.
   */
  const reload = useCallback(
    async (claimed: LocationClaim, signal?: AbortSignal): Promise<boolean> => {
      const { current } = claimed
      const credentials = claimed.credentials()
      if (!credentials) return false
      const generation = ++reloadGenerationRef.current
      const next = await listLocationsFromWeb(signal, credentials)
      if (signal?.aborted || !current()) return false
      // A newer list read, or a change the member started since, outranks this answer.
      if (generation !== reloadGenerationRef.current) return false
      setLocations(next)
      setSectionState('ready')
      return true
    },
    []
  )

  // Unmounted, nothing pending may write here or start a request.
  useEffect(
    () => () => {
      ownerGenerationRef.current += 1
    },
    []
  )

  // A new member (or none) starts from an empty section; the member a return restored keeps
  // the list it shows.
  useEffect(() => {
    ownerGenerationRef.current += 1
    if (owner === null || owner !== restoredFor) setLocations([])
    setStatus('')
    setError(null)
    setBusyId(null)
    setRenamingId(null)
    setConfirmingId(null)
    pendingFocusRef.current = null
  }, [owner, restoredFor])

  // One list request per member: a session event that names the same member
  // again (a token refresh, the end of a verification already answered) asks
  // nothing. A retry after a failed load asks once more.
  useEffect(() => {
    if (session.status === 'checking') {
      setSectionState('checking')
      return
    }
    if (session.status === 'unavailable') {
      setSectionState('load_failed')
      return
    }
    if (!owner) {
      setSectionState('signed_out')
      return
    }
    // The bridge publishes again once it names a member; until then nothing is asked.
    const claimed = claim()
    if (!claimed) return
    const controller = new AbortController()
    // A restored list refreshes in place: no loading state, and a failed refresh keeps it.
    const inPlace = restoredFor === owner && sectionStateRef.current === 'ready'
    beginRead()
    if (!inPlace) setSectionState('loading')
    reload(claimed, controller.signal).catch(() => {
      if (controller.signal.aborted || !claimed.current() || inPlace) return
      setSectionState('load_failed')
    })
    return () => controller.abort()
  }, [reload, claim, session.status, owner, loadAttempt, restoredFor, beginRead])

  // What a return to Profile shows first: the list once it is ready, nothing after a failure.
  useEffect(() => {
    if (sectionState === 'ready') remember({ locations })
    else if (sectionState === 'load_failed' || sectionState === 'signed_out')
      remember(undefined)
  }, [locations, remember, sectionState])

  function retryLoad() {
    if (session.status === 'unavailable') session.retry()
    else setLoadAttempt((attempt) => attempt + 1)
  }

  // Focus moves to the item an action changed, once it has rendered.
  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    if (!pending.current()) return
    const target =
      pending.target === 'heading'
        ? headingRef.current
        : itemRefs.current.get(pending.target)
    target?.focus()
  }, [locations, renamingId, confirmingId])

  /**
   * One mutation for the member who started it. Ownership is checked the moment
   * the request settles, before any editor closes or a reload starts, and again
   * after the reload lands.
   */
  async function run(
    locationId: string,
    mutate: (credentials: LocationCredentials) => Promise<unknown>,
    settled: () => string,
    focusAfter: string
  ): Promise<void> {
    if (busyId) return
    const claimed = claim()
    if (!claimed) return
    const { current } = claimed
    // A list read still out (a return's in-place refresh) predates this change: drop it.
    reloadGenerationRef.current++
    setBusyId(locationId)
    setError(null)
    try {
      const credentials = claimed.credentials()
      if (!credentials) return
      await mutate(credentials)
      if (!current()) return
      const message = settled()
      if (!(await reload(claimed)) || !current()) return
      focusLater(focusAfter, current)
      announce(message, current)
    } catch (caught) {
      if (current()) setError(reasonOf(caught))
    } finally {
      if (current()) setBusyId(null)
    }
  }

  function makePrimary(location: SavedLocation) {
    void run(
      location.id,
      (credentials) => setPrimaryLocationFromWeb(location.id, credentials),
      () => t('locations.primaryChanged', { label: location.label }),
      location.id
    )
  }

  function saveRename(location: SavedLocation) {
    const label = renameValue.trim()
    if (!label) return
    void run(
      location.id,
      (credentials) => renameLocationFromWeb(location.id, label, credentials),
      () => {
        setRenamingId(null)
        return t('locations.renamed', { label })
      },
      location.id
    )
  }

  function confirmDelete(location: SavedLocation) {
    void run(
      location.id,
      (credentials) => deleteLocationFromWeb(location.id, credentials),
      () => {
        setConfirmingId(null)
        return t('locations.deleted', { label: location.label })
      },
      'heading'
    )
  }

  /** The form's save, continued with the claim the member made when they saved. */
  async function handleSaved(location: SavedLocation, claimed: LocationClaim) {
    const { current } = claimed
    if (!current()) return
    const target = safeReturnPath(returnTo, window.location.origin)
    if (target) {
      router.push(target)
      return
    }
    const loaded = await reload(claimed).catch(() => {
      if (current()) setSectionState('load_failed')
      return false
    })
    if (!loaded || !current()) return
    announce(t('locations.saved', { label: location.label }), current)
    focusLater(location.id, current)
  }

  const isFull = locations.length >= MAX_SAVED_LOCATIONS
  // Story CC-7.7: Profile's screen gate waits for the list, which sits above the sections it
  // would otherwise push down when it lands. A signed-out page paints the signed-out hint from
  // its first frame (hidden by globals.css on a page painted for a stored session).
  useScreenGateRead(
    'locations',
    sectionState !== 'checking' && sectionState !== 'loading'
  )
  const guestFirstPaint = useGuestFirstPaint()
  const guestHint = sectionState === 'checking' && guestFirstPaint

  return (
    <section
      id="locations"
      aria-labelledby="locations-title"
      data-testid="locations-section"
      data-state={sectionState}
      className="mt-10 max-w-2xl border-t border-line pt-8"
    >
      <h2
        id="locations-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-ink outline-none"
      >
        {t('locations.title')}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{t('locations.intro')}</p>

      {showGuidedCancel(guided, sectionState, guestHint) && (
        <button
          type="button"
          onClick={() =>
            router.push(safeReturnPath(returnTo, window.location.origin) ?? '/')
          }
          className="inline-flex min-h-11 items-center text-sm font-semibold underline"
          data-testid="locations-guided-cancel"
        >
          {t('locations.cancel')}
        </button>
      )}

      {sectionState === 'signed_out' && (
        <p className="mt-4 text-sm text-ink-soft" data-testid="locations-signed-out">
          {t('locations.signedOutHint')}
        </p>
      )}
      {guestHint && (
        <GuestText
          text={t('locations.signedOutHint')}
          className="mt-4 text-sm text-ink-soft"
        />
      )}

      {sectionState === 'load_failed' && (
        <div className="mt-4 flex flex-col gap-2">
          <p
            role="alert"
            className="text-sm text-danger-ink"
            data-testid="locations-load-error"
          >
            {loadErrorMessage}
          </p>
          <button
            type="button"
            onClick={retryLoad}
            className="min-h-11 self-start rounded-md border border-line-strong bg-page text-ink px-4"
            data-testid="locations-load-retry"
          >
            {t('locations.loadRetry')}
          </button>
        </div>
      )}

      {sectionState === 'ready' && (
        <>
          <p className="mt-4 text-sm text-ink-soft" data-testid="locations-count">
            {t('locations.count', { count: locations.length })}
          </p>
          {locations.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft" data-testid="locations-empty">
              {t('locations.empty')}
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3" data-testid="locations-list">
              {locations.map((location) => (
                <li
                  key={location.id}
                  data-surface="card"
                  className="rounded-lg border border-line bg-card p-4"
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
                      className="text-base font-semibold text-ink outline-none"
                      data-testid="location-item-label"
                    >
                      {location.label}
                    </h3>
                    {location.isPrimary && (
                      <span
                        className="rounded-full bg-inverse px-2 text-xs font-semibold text-on-inverse"
                        data-testid="location-primary-badge"
                      >
                        {t('locations.primary')}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-1 text-sm text-ink-soft"
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
                      <label className="flex flex-col gap-1 text-sm text-ink">
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
                              focusLater(location.id, ownedBy(owner))
                            }
                          }}
                          className="rounded-md border border-line-strong bg-page px-3 text-ink"
                          data-testid="location-rename-input"
                        />
                      </label>
                      <button
                        type="submit"
                        aria-busy={busyId === location.id}
                        className="min-h-11 rounded-md border border-line-strong bg-page text-ink px-3 font-semibold"
                        data-testid="location-rename-save"
                      >
                        {t('locations.renameSave')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(null)
                          focusLater(location.id, ownedBy(owner))
                        }}
                        className="min-h-11 rounded-md border border-line-strong bg-page text-ink px-3"
                      >
                        {t('locations.cancel')}
                      </button>
                    </form>
                  ) : confirmingId === location.id ? (
                    // Distinct keys keep React from reusing the actions row's
                    // buttons here: the focused Delete would become Cancel and
                    // "Yes, delete" would never mount, so autoFocus would not run.
                    <div key="confirm" className="mt-3 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-ink">
                        {t('locations.deleteConfirm', { label: location.label })}
                      </p>
                      <button
                        type="button"
                        autoFocus
                        aria-busy={busyId === location.id}
                        onClick={() => confirmDelete(location)}
                        className="min-h-11 rounded-md border border-danger-line bg-danger-surface px-3 text-danger-ink"
                        data-testid="location-delete-confirm"
                      >
                        {t('locations.deleteConfirmAction')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingId(null)
                          focusLater(location.id, ownedBy(owner))
                        }}
                        className="min-h-11 rounded-md border border-line-strong bg-page text-ink px-3"
                      >
                        {t('locations.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div key="actions" className="mt-3 flex flex-wrap gap-2">
                      {!location.isPrimary && (
                        <button
                          type="button"
                          aria-busy={busyId === location.id}
                          onClick={() => makePrimary(location)}
                          className="min-h-11 rounded-md border border-line-strong bg-page text-ink px-3"
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
                        className="min-h-11 rounded-md border border-line-strong bg-page text-ink px-3"
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
                        className="min-h-11 rounded-md border border-line-strong bg-page text-ink px-3"
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
            <p className="mt-4 text-sm text-ink-soft" data-testid="locations-limit">
              {t('locations.limit')}
            </p>
          ) : (
            <LocationSearchForm
              // A new member gets a fresh form: no query, pick or late save of the last one.
              key={owner ?? 'signed-out'}
              locale={locale}
              autoFocus={guided}
              claim={claim}
              announce={announce}
              onSaved={(location, claimed) => {
                void handleSaved(location, claimed)
              }}
            />
          )}
        </>
      )}

      <p
        role="status"
        className="mt-4 min-h-[1.25rem] text-sm text-success-ink"
        data-testid="locations-status-region"
      >
        {status}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-1 text-sm text-danger-ink"
          data-testid="locations-error"
        >
          {t(errorKey(error))}
        </p>
      )}
    </section>
  )
}
