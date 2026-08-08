'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { getI18n } from '../../../i18n'
import {
  listCapsulesFromWeb,
  createCapsuleFromWeb,
  updateCapsuleFromWeb,
  favoriteCapsuleFromWeb,
  deleteCapsuleFromWeb,
  listGarmentsFromWeb,
  resolveCurrentUserId,
} from '../../../lib/wardrobe'
import { AccessibleModal } from '../../components/accessible-modal'
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

/** The strong entity tag the API issues and requires back on every mutation. */
function capsuleETag(capsule: OutfitCapsuleContract): string {
  return `"capsule:${capsule.id}:${capsule.revision}"`
}

export default function WardrobeCapsulesPage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      <CapsulesView />
    </I18nextProvider>
  )
}

function CapsulesView() {
  const { t } = useTranslation()
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
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

  /** The owner defaults to the signed-in user, read from the session token. */
  useEffect(() => {
    try {
      setOwnerUserId(resolveCurrentUserId())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in to manage capsules.')
      setIsLoading(false)
    }
  }, [])

  /** Debounce keystrokes into a single query rather than one request per key. */
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchCapsules = useCallback(async () => {
    if (!ownerUserId) {
      return
    }

    inFlightRef.current?.abort()
    const controller = new AbortController()
    inFlightRef.current = controller

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
        listGarmentsFromWeb(),
      ])

      if (controller.signal.aborted) {
        return
      }
      setCapsules(page.items)
      setTotal(page.total)
      setGarments(garmentList)
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        return
      }
      setError(err instanceof Error ? err.message : t('wardrobe.capsules.errors.load'))
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [ownerUserId, searchQuery, selectedOccasion, favoriteOnly, t])

  useEffect(() => {
    void fetchCapsules()
  }, [fetchCapsules])

  useEffect(() => () => inFlightRef.current?.abort(), [])

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
    if (!ownerUserId) return

    if (editingCapsule && options.ifMatch) {
      await updateCapsuleFromWeb(ownerUserId, editingCapsule.id, input, options.ifMatch)
      setStatusMessage(t('wardrobe.capsules.updated'))
    } else {
      await createCapsuleFromWeb(ownerUserId, input, options.idempotencyKey)
      setStatusMessage(t('wardrobe.capsules.created'))
    }
    await fetchCapsules()
  }

  const handleToggleFavorite = async (capsule: OutfitCapsuleContract) => {
    if (!ownerUserId) return
    try {
      await favoriteCapsuleFromWeb(
        ownerUserId,
        capsule.id,
        !capsule.isFavorite,
        capsuleETag(capsule)
      )
      setStatusMessage(t('wardrobe.capsules.favoriteUpdated'))
      await fetchCapsules()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wardrobe.capsules.errors.save'))
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deletingCapsule || !ownerUserId) return
    try {
      await deleteCapsuleFromWeb(
        ownerUserId,
        deletingCapsule.id,
        capsuleETag(deletingCapsule)
      )
      setDeletingCapsule(null)
      setStatusMessage(t('wardrobe.capsules.deleted'))
      await fetchCapsules()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('wardrobe.capsules.errors.delete'))
    }
  }

  const hiddenCount = useMemo(
    () => Math.max(0, total - capsules.length),
    [total, capsules]
  )

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Success announcements are polite so they do not interrupt a screen reader. */}
      <p aria-live="polite" className="sr-only" data-testid="capsule-status-region">
        {statusMessage ?? ''}
      </p>

      <div className="flex items-center justify-between border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {t('wardrobe.capsules.title')}
          </h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Curate and manage your custom outfit combinations.
          </p>
        </div>
        <button
          ref={createButtonRef}
          type="button"
          onClick={() => {
            setEditingCapsule(null)
            setIsModalOpen(true)
          }}
          className="flex min-h-[44px] min-w-[44px] items-center rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 focus:ring-2 focus:ring-black focus:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
          className="min-h-[44px] rounded-lg border border-zinc-300 px-3 py-2 text-xs focus:ring-2 focus:ring-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          data-testid="capsule-search-input"
        />

        <label htmlFor="capsule-occasion" className="sr-only">
          Filter by occasion
        </label>
        <select
          id="capsule-occasion"
          value={selectedOccasion}
          onChange={(event) =>
            setSelectedOccasion(event.target.value as CapsuleOccasion | 'all')
          }
          className="min-h-[44px] rounded-lg border border-zinc-300 px-3 py-2 text-xs focus:ring-2 focus:ring-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          data-testid="capsule-occasion-filter"
        >
          <option value="all">{t('wardrobe.capsules.filterAll')}</option>
          <option value="work">Work</option>
          <option value="casual">Casual</option>
          <option value="formal">Formal</option>
          <option value="sport">Sport</option>
          <option value="travel">Travel</option>
          <option value="evening">Evening</option>
          <option value="outdoor">Outdoor</option>
          <option value="home">Home</option>
        </select>

        <label className="flex min-h-[44px] cursor-pointer items-center space-x-2 text-xs text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={favoriteOnly}
            onChange={(event) => setFavoriteOnly(event.target.checked)}
            className="h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-black focus:ring-offset-2"
            data-testid="capsule-favorite-filter"
          />
          <span>{t('wardrobe.capsules.filterFavorites')}</span>
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg bg-red-50 p-4 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
          data-testid="capsule-error-banner"
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <div
          className="mt-12 text-center text-sm text-zinc-500"
          data-testid="capsule-loading-state"
        >
          Loading outfit capsules…
        </div>
      ) : capsules.length === 0 ? (
        <div
          className="mt-12 text-center text-sm text-zinc-500"
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
            {capsules.map((capsule) => (
              <div
                key={capsule.id}
                className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                data-testid={`capsule-card-${capsule.id}`}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      {capsule.name}
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        void handleToggleFavorite(capsule)
                      }}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-lg text-yellow-500 focus:ring-2 focus:ring-black focus:ring-offset-1"
                      aria-pressed={capsule.isFavorite}
                      aria-label={`Favorite capsule ${capsule.name}`}
                      data-testid={`favorite-button-${capsule.id}`}
                    >
                      {capsule.isFavorite ? '★' : '☆'}
                    </button>
                  </div>

                  {capsule.description && (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {capsule.description}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-1">
                    {capsule.occasions.map((occasion) => (
                      <span
                        key={occasion}
                        className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-medium capitalize text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      >
                        {occasion}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {capsule.garments.length} garments
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        capsule.availabilityStatus === 'ready'
                          ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                      }`}
                      data-testid={`capsule-status-badge-${capsule.id}`}
                    >
                      {capsule.availabilityStatus === 'ready' ? 'Ready' : 'Needs repair'}
                    </span>
                  </div>

                  {capsule.unavailableGarmentCount > 0 && (
                    <p
                      className="mt-2 text-[11px] text-amber-700 dark:text-amber-300"
                      data-testid={`capsule-unavailable-count-${capsule.id}`}
                    >
                      {capsule.unavailableGarmentCount === 1
                        ? t('wardrobe.capsules.unavailableCount', {
                            count: capsule.unavailableGarmentCount,
                          })
                        : t('wardrobe.capsules.unavailableCount', {
                            count: capsule.unavailableGarmentCount,
                          })}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-end space-x-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCapsule(capsule)
                      setIsModalOpen(true)
                    }}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:ring-2 focus:ring-black focus:ring-offset-1 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    data-testid={`edit-capsule-button-${capsule.id}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingCapsule(capsule)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 focus:ring-2 focus:ring-black focus:ring-offset-1 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                    data-testid={`delete-capsule-button-${capsule.id}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hiddenCount > 0 && (
            <p
              className="mt-4 text-center text-xs text-zinc-500"
              data-testid="capsule-truncation-notice"
            >
              Showing {capsules.length} of {total}. Refine your search to see the rest.
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
          closeLabel="Cancel deletion"
        >
          <div className="mt-5 flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setDeletingCapsule(null)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium focus:ring-2 focus:ring-black focus:ring-offset-2 dark:border-zinc-700"
              data-testid="cancel-delete-capsule-button"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              ref={deleteConfirmRef}
              type="button"
              onClick={() => {
                void handleDeleteConfirm()
              }}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700 focus:ring-2 focus:ring-black focus:ring-offset-2"
              data-testid="confirm-delete-capsule-button"
            >
              {t('wardrobe.capsules.delete')}
            </button>
          </div>
        </AccessibleModal>
      )}
    </div>
  )
}
