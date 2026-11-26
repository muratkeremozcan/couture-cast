'use client'
// Story CC-7.12 D6: moved from `/wardrobe/capsules`, which now redirects to Looks.
// Story 4.3 Task 5 step 2 owner: implement web wardrobe capsules page in apps/web/src/app/wardrobe/capsules/page.tsx

import { getGuestPreviewStrings } from '@couture/utils'
import { useSearchParams } from 'next/navigation'
import React, { Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { getI18n } from '../../../i18n'
import {
  isLiveOwner,
  MemberScope,
  useMountSignal,
  type MemberSession,
} from '../../../lib/use-web-session'
import {
  listCapsulesFromWeb,
  getCapsuleFromWeb,
  createCapsuleFromWeb,
  updateCapsuleFromWeb,
  favoriteCapsuleFromWeb,
  deleteCapsuleFromWeb,
  listGarmentsFromWeb,
  resolveCurrentUserId,
} from '../../../lib/wardrobe'
import { AccessibleModal } from '../../components/accessible-modal'
import { AppPage, APP_MAIN_CLASS } from '../../components/app-page'
import { AppTopBar } from '../../components/app-top-bar'
import { StickyBottomNav } from '../../components/sticky-bottom-nav'
import {
  CapsuleBuilderModal,
  type CapsuleSaveOptions,
} from '../../components/capsule-builder-modal'
import type {
  OutfitCapsuleContract,
  GarmentItemContract,
  CapsuleOccasion,
  CreateOutfitCapsuleInput,
} from '@couture/api-client/contracts/http'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 250
/** The occasion filter's choices, in the order the builder lists them. */
const CAPSULE_OCCASIONS: readonly CapsuleOccasion[] = [
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
]

/** The strong entity tag the API issues and requires back on every mutation. */
function capsuleETag(capsule: OutfitCapsuleContract): string {
  return `"capsule:${capsule.id}:${capsule.revision}"`
}

/**
 * Codex #4: the capsule a Looks tile opened, read on its own when the loaded page lacks it. A
 * failed or missing read pins nothing.
 */
async function readPinnedCapsule(
  ownerUserId: string,
  capsuleId: string | null,
  loaded: readonly OutfitCapsuleContract[],
  signal: AbortSignal
): Promise<OutfitCapsuleContract | null> {
  if (!capsuleId || loaded.some((capsule) => capsule.id === capsuleId)) return null
  try {
    return await getCapsuleFromWeb(ownerUserId, capsuleId, signal)
  } catch {
    return null
  }
}

function CapsuleErrorBanner({
  session,
  error,
}: {
  session: MemberSession
  error: string | null
}) {
  const { t, i18n } = useTranslation()
  const message =
    session.status === 'signed_out'
      ? t('wardrobe.capsules.signIn')
      : session.status === 'unavailable'
        ? t('wardrobe.capsules.errors.load')
        : error
  if (!message) return null

  return (
    <div
      role="alert"
      className="mt-4 rounded-lg border border-danger-line bg-danger-surface p-4 text-xs font-medium text-danger-ink"
      data-testid="capsule-error-banner"
    >
      {message}
      {session.status === 'unavailable' && (
        <button
          type="button"
          onClick={session.retry}
          className="ml-2 min-h-11 px-2 font-semibold underline"
        >
          {getGuestPreviewStrings(i18n.language).chrome.retry}
        </button>
      )}
    </div>
  )
}

export default function WardrobeCapsulesPage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      {/* Story CC-7.9 D6, D7, D8: the shared top bar and page surface render outside the
          member scope, so the bar sits in its final place while the session is read. */}
      <AppPage>
        {/* Story CC-7.12 D6: the manager lives under Looks; back returns to Saved > Capsules. */}
        <AppTopBar
          titleKey="wardrobe.capsules.title"
          parentHref="/looks?segment=saved&filter=capsules"
        />
        <Suspense fallback={null}>
          <MemberScope>{(session) => <CapsulesView session={session} />}</MemberScope>
        </Suspense>
        {/* Story CC-7.11 (TEA e): the tab bar, as on every other sub-screen. */}
        <StickyBottomNav />
      </AppPage>
    </I18nextProvider>
  )
}

function CapsulesView({ session }: { session: MemberSession }) {
  const { t, i18n } = useTranslation()
  const { owner, status } = session
  const mountSignal = useMountSignal()
  const current = useCallback(
    (signal: AbortSignal) => !signal.aborted && isLiveOwner(owner),
    [owner]
  )
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
  // Story CC-7.12 D6: the capsule a Looks tile opened, read once from the address.
  // Fable review P1: read through `useSearchParams`, since a client navigation renders this page
  // before `window.location` holds its URL.
  const focusCapsuleId = useSearchParams()?.get('capsule') || null
  // Codex #4: a capsule outside the first page is read on its own and shown first, so the tile
  // always lands on its card. It shows only while no search or filter narrows the list.
  const [pinnedCapsule, setPinnedCapsule] = useState<OutfitCapsuleContract | null>(null)
  /** The `capsule` id the last landed read was made for (TEA W1). */
  const [loadedForCapsule, setLoadedForCapsule] = useState<string | null>(null)
  /** A first read has landed, so later reads keep the grid on screen. */
  const [hasShownCapsules, setHasShownCapsules] = useState(false)
  const [capsules, setCapsules] = useState<OutfitCapsuleContract[]>([])
  const [total, setTotal] = useState(0)
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedOccasion, setSelectedOccasion] = useState<CapsuleOccasion | 'all'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCapsule, setEditingCapsule] = useState<OutfitCapsuleContract | null>(null)
  const [deletingCapsule, setDeletingCapsule] = useState<OutfitCapsuleContract | null>(
    null
  )

  const createButtonRef = useRef<HTMLButtonElement | null>(null)
  const deleteConfirmRef = useRef<HTMLButtonElement | null>(null)
  /** Aborts the previous request so a slow earlier response cannot win. */
  const inFlightRef = useRef<AbortController | null>(null)

  /** The owner defaults to the signed-in user, as confirmed by the API. */
  useEffect(() => {
    const signal = mountSignal()
    if (!current(signal)) return
    let cancelled = false

    void (async () => {
      try {
        const userId = await resolveCurrentUserId()
        if (!cancelled && current(signal)) {
          setOwnerUserId(userId)
        }
      } catch (err: unknown) {
        if (cancelled || !current(signal)) {
          return
        }
        setError(err instanceof Error ? err.message : i18n.t('wardrobe.capsules.signIn'))
        setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [current, mountSignal, i18n])

  /** Debounce keystrokes into a single query rather than one request per key. */
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchCapsules = useCallback(async () => {
    const signal = mountSignal()
    if (!ownerUserId || !current(signal)) {
      return
    }

    inFlightRef.current?.abort()
    const controller = new AbortController()
    inFlightRef.current = controller
    const reading = () => !controller.signal.aborted && current(signal)

    setIsLoading(true)
    setError(null)
    try {
      const [page, garmentList] = await Promise.all([
        listCapsulesFromWeb(
          ownerUserId,
          {
            limit: PAGE_SIZE,
            offset: 0,
            q: searchQuery || undefined,
            occasion: selectedOccasion !== 'all' ? selectedOccasion : undefined,
            isFavorite: favoriteOnly ? true : undefined,
          },
          controller.signal
        ),
        listGarmentsFromWeb(controller.signal),
      ])

      if (!reading()) {
        return
      }
      setCapsules(page.items)
      setHasShownCapsules(true)
      setTotal(page.total)
      // Every read refreshes the pinned capsule too, so an edit, favorite or delete shows.
      const unfilteredRead = !searchQuery && selectedOccasion === 'all' && !favoriteOnly
      const pinned = await readPinnedCapsule(
        ownerUserId,
        unfilteredRead ? focusCapsuleId : null,
        page.items,
        controller.signal
      )
      if (reading()) {
        setPinnedCapsule(pinned)
        setLoadedForCapsule(focusCapsuleId)
      }
      setGarments(garmentList)
    } catch (err: unknown) {
      if (!reading()) {
        return
      }
      setError(err instanceof Error ? err.message : t('wardrobe.capsules.errors.load'))
    } finally {
      if (reading()) {
        setIsLoading(false)
      }
    }
  }, [
    current,
    mountSignal,
    ownerUserId,
    searchQuery,
    selectedOccasion,
    favoriteOnly,
    focusCapsuleId,
    t,
  ])

  useEffect(() => {
    void fetchCapsules()
  }, [fetchCapsules])

  useEffect(() => () => inFlightRef.current?.abort(), [])

  // Story CC-7.12 D6: a Looks capsule tile opens the manager on its card. The id is matched by
  // equality against the loaded capsules (TEA P7). TEA W1: focus waits for the read made for
  // that id, and each id is focused once, so a second tile's id gets its own focus.
  const focusedCapsuleRef = useRef<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const unfiltered = !searchQuery && selectedOccasion === 'all' && !favoriteOnly
  const shownCapsules = useMemo(() => {
    if (!pinnedCapsule || !unfiltered) return capsules
    const fresh = capsules.find((capsule) => capsule.id === pinnedCapsule.id)
    return fresh ? capsules : [pinnedCapsule, ...capsules]
  }, [capsules, pinnedCapsule, unfiltered])
  useEffect(() => {
    if (!focusCapsuleId || focusedCapsuleRef.current === focusCapsuleId) return
    if (isLoading || loadedForCapsule !== focusCapsuleId) return
    const match = shownCapsules.find((capsule) => capsule.id === focusCapsuleId)
    if (!match) return
    focusedCapsuleRef.current = focusCapsuleId
    const card = cardRefs.current.get(match.id)
    card?.scrollIntoView({ block: 'center' })
    card?.focus({ preventScroll: true })
  }, [focusCapsuleId, shownCapsules, isLoading, loadedForCapsule])

  /**
   * Another client's committed changes appear on refocus, which is the
   * cross-surface refresh the story requires without live push.
   */
  useEffect(() => {
    const onFocus = () => void fetchCapsules()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchCapsules])

  const handleSaveCapsule = async (
    input: CreateOutfitCapsuleInput,
    options: CapsuleSaveOptions
  ) => {
    const signal = mountSignal()
    if (!ownerUserId || !current(signal)) return

    if (editingCapsule && options.ifMatch) {
      await updateCapsuleFromWeb(
        ownerUserId,
        editingCapsule.id,
        input,
        options.ifMatch,
        signal
      )
    } else {
      await createCapsuleFromWeb(ownerUserId, input, options.idempotencyKey, signal)
    }
    if (!current(signal)) return
    setStatusMessage(
      t(
        editingCapsule && options.ifMatch
          ? 'wardrobe.capsules.updated'
          : 'wardrobe.capsules.created'
      )
    )
    await fetchCapsules()
  }

  const handleToggleFavorite = async (capsule: OutfitCapsuleContract) => {
    const signal = mountSignal()
    if (!ownerUserId || !current(signal)) return
    try {
      await favoriteCapsuleFromWeb(
        ownerUserId,
        capsule.id,
        !capsule.isFavorite,
        capsuleETag(capsule),
        signal
      )
      if (!current(signal)) return
      setStatusMessage(t('wardrobe.capsules.favoriteUpdated'))
      await fetchCapsules()
    } catch (err: unknown) {
      if (!current(signal)) return
      setError(err instanceof Error ? err.message : t('wardrobe.capsules.errors.save'))
    }
  }

  const handleDeleteConfirm = async () => {
    const signal = mountSignal()
    if (!deletingCapsule || !ownerUserId || !current(signal)) return
    try {
      await deleteCapsuleFromWeb(
        ownerUserId,
        deletingCapsule.id,
        capsuleETag(deletingCapsule),
        signal
      )
      if (!current(signal)) return
      setDeletingCapsule(null)
      setStatusMessage(t('wardrobe.capsules.deleted'))
      await fetchCapsules()
    } catch (err: unknown) {
      if (!current(signal)) return
      setError(err instanceof Error ? err.message : t('wardrobe.capsules.errors.delete'))
    }
  }

  const hiddenCount = useMemo(
    () => Math.max(0, total - capsules.length),
    [total, capsules]
  )
  // A refetch (a new tile id, a mutation) keeps the shown grid in place; only the first read
  // shows the loading line (TEA W1).
  const loading =
    status === 'checking' || (status === 'signed_in' && isLoading && !hasShownCapsules)

  return (
    /*
     * The global "Skip to main content" link targets #main-content, so this page
     * needs the landmark like every other route. Without it the skip link is a
     * dead anchor and the page exposes no main landmark to assistive tech.
     */
    <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
      {/* Success announcements are polite so they do not interrupt a screen reader. */}
      <p aria-live="polite" className="sr-only" data-testid="capsule-status-region">
        {statusMessage ?? ''}
      </p>

      {/* Story CC-7.9 D6: the top bar owns the title and the back control; the screen's one
          main action opens the body. */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <p className="text-sm text-ink-muted">{t('wardrobe.capsules.subtitle')}</p>
        <button
          ref={createButtonRef}
          type="button"
          disabled={!ownerUserId}
          onClick={() => {
            setEditingCapsule(null)
            setIsModalOpen(true)
          }}
          data-gold="primary"
          className="flex min-h-11 min-w-11 items-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          data-testid="create-capsule-button"
        >
          {t('wardrobe.capsules.create')}
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <label htmlFor="capsule-search" className="sr-only">
          {t('wardrobe.capsules.searchLabel')}
        </label>
        <input
          id="capsule-search"
          type="search"
          placeholder={t('wardrobe.capsules.searchPlaceholder')}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="min-h-11 rounded-lg border border-line-strong bg-page px-3 py-2 text-xs text-ink placeholder:text-ink-muted"
          data-testid="capsule-search-input"
        />

        <label htmlFor="capsule-occasion" className="sr-only">
          {t('wardrobe.capsules.filterOccasionLabel')}
        </label>
        <select
          id="capsule-occasion"
          value={selectedOccasion}
          onChange={(event) =>
            setSelectedOccasion(event.target.value as CapsuleOccasion | 'all')
          }
          className="min-h-11 rounded-lg border border-line-strong bg-page px-3 py-2 text-xs text-ink"
          data-testid="capsule-occasion-filter"
        >
          <option value="all">{t('wardrobe.capsules.filterAll')}</option>
          {CAPSULE_OCCASIONS.map((occasion) => (
            <option key={occasion} value={occasion}>
              {t(`wardrobe.capsules.occasions.${occasion}`)}
            </option>
          ))}
        </select>

        <label className="flex min-h-11 cursor-pointer items-center space-x-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={favoriteOnly}
            onChange={(event) => setFavoriteOnly(event.target.checked)}
            className="h-5 w-5 rounded-md border-line-strong accent-ink"
            data-testid="capsule-favorite-filter"
          />
          <span>{t('wardrobe.capsules.filterFavorites')}</span>
        </label>
      </div>

      <CapsuleErrorBanner session={session} error={error} />

      {loading ? (
        <div
          className="mt-12 text-center text-sm text-ink-muted"
          data-testid="capsule-loading-state"
        >
          {t('wardrobe.capsules.loading')}
        </div>
      ) : !owner ? null : shownCapsules.length === 0 ? (
        <div
          className="mt-12 text-center text-sm text-ink-muted"
          data-testid="capsule-empty-state"
        >
          <p className="font-medium">{t('wardrobe.capsules.emptyTitle')}</p>
          <p className="mt-1 text-xs">{t('wardrobe.capsules.emptyBody')}</p>
        </div>
      ) : (
        <>
          <div
            className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="capsule-grid"
          >
            {shownCapsules.map((capsule) => (
              <div
                key={capsule.id}
                ref={(element) => {
                  if (element) cardRefs.current.set(capsule.id, element)
                  else cardRefs.current.delete(capsule.id)
                }}
                tabIndex={capsule.id === focusCapsuleId ? -1 : undefined}
                data-surface="card"
                className="flex flex-col justify-between rounded-xl border border-line bg-card p-5 shadow-card"
                data-testid={`capsule-card-${capsule.id}`}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <h2 className="text-lg font-semibold text-ink">{capsule.name}</h2>
                    <button
                      type="button"
                      onClick={() => {
                        void handleToggleFavorite(capsule)
                      }}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-lg text-ink"
                      aria-pressed={capsule.isFavorite}
                      aria-label={t('wardrobe.capsules.favoriteCapsule', {
                        name: capsule.name,
                      })}
                      data-testid={`favorite-button-${capsule.id}`}
                    >
                      {capsule.isFavorite ? '★' : '☆'}
                    </button>
                  </div>

                  {capsule.description && (
                    <p className="mt-2 text-xs text-ink-muted">{capsule.description}</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-1">
                    {capsule.occasions.map((occasion) => (
                      <span
                        key={occasion}
                        className="rounded-md bg-card-muted px-2 py-0.5 text-xs font-medium text-ink-soft"
                      >
                        {t(`wardrobe.capsules.occasions.${occasion}`)}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                    <span className="text-xs font-medium text-ink-muted">
                      {t('wardrobe.capsules.garmentCount', {
                        count: capsule.garments.length,
                      })}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        capsule.availabilityStatus === 'ready'
                          ? 'bg-page text-success-ink'
                          : 'bg-notice-surface text-notice-ink'
                      }`}
                      data-testid={`capsule-status-badge-${capsule.id}`}
                    >
                      {capsule.availabilityStatus === 'ready'
                        ? t('wardrobe.capsules.status.ready')
                        : t('wardrobe.capsules.status.needsRepair')}
                    </span>
                  </div>

                  {capsule.unavailableGarmentCount > 0 && (
                    <p
                      className="mt-2 text-xs text-notice-ink"
                      data-testid={`capsule-unavailable-count-${capsule.id}`}
                    >
                      {t('wardrobe.capsules.unavailableCount', {
                        count: capsule.unavailableGarmentCount,
                      })}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-end space-x-2 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCapsule(capsule)
                      setIsModalOpen(true)
                    }}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line-strong bg-page px-3 py-2 text-xs font-medium text-ink hover:bg-card-muted"
                    data-testid={`edit-capsule-button-${capsule.id}`}
                  >
                    {t('wardrobe.capsules.editAction')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingCapsule(capsule)}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-danger-line bg-page px-3 py-2 text-xs font-medium text-danger-ink hover:bg-danger-surface"
                    data-testid={`delete-capsule-button-${capsule.id}`}
                  >
                    {t('wardrobe.capsules.deleteAction')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hiddenCount > 0 && (
            <p
              className="mt-4 text-center text-xs text-ink-muted"
              data-testid="capsule-truncation-notice"
            >
              {t('wardrobe.capsules.truncation', { shown: capsules.length, total })}
            </p>
          )}
        </>
      )}

      {isModalOpen && (
        <CapsuleBuilderModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveCapsule}
          ownerUserId={ownerUserId ?? ''}
          availableGarments={garments}
          initialCapsule={editingCapsule}
          invokingElementRef={createButtonRef}
          onStaleCapsule={() => void fetchCapsules()}
        />
      )}

      {/*
        The destructive confirmation uses the same accessible dialog as the
        builder. As a bare div it had no role, no accessible name, no focus trap,
        and no Escape handling, so a screen-reader user was never told it opened.
      */}
      {deletingCapsule && (
        <AccessibleModal
          isOpen={Boolean(deletingCapsule)}
          onClose={() => setDeletingCapsule(null)}
          titleId="capsule-delete-title"
          title={t('wardrobe.capsules.deleteConfirmTitle')}
          descriptionId="capsule-delete-description"
          description={t('wardrobe.capsules.deleteConfirmBody')}
          initialFocusRef={deleteConfirmRef}
          closeLabel={t('wardrobe.capsules.cancelDeletion')}
        >
          <div className="mt-5 flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setDeletingCapsule(null)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-page px-4 py-2 text-xs font-medium text-ink"
              data-testid="cancel-delete-capsule-button"
            >
              {t('wardrobe.capsules.cancel')}
            </button>
            <button
              ref={deleteConfirmRef}
              type="button"
              onClick={() => {
                void handleDeleteConfirm()
              }}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-danger px-4 py-2 text-xs font-medium text-on-danger hover:bg-danger/90"
              data-testid="confirm-delete-capsule-button"
            >
              {t('wardrobe.capsules.delete')}
            </button>
          </div>
        </AccessibleModal>
      )}
    </main>
  )
}
