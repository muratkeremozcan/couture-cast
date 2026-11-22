// Story CC-7.2: Temporary "Saved looks" row at the top of the Closet screen until CC-7.12 ships.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  createAnnouncementToken,
  getGuestPreviewStrings,
  isOfflineError,
  SAMPLE_CATALOG,
  sampleGarmentText,
  sampleLookText,
  savedLookToStylePieceRecipe,
  stylePieceAnchor,
  stylePieceLooks,
  visibleStylePieceLooks,
  type SampleWeatherKey,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import {
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
  getSavedLookFromWeb,
  notifySavedLooksChanged,
  restoreSavedLookFromWeb,
  SavedLookRequestError,
} from '../../lib/saved-looks'
import {
  currentWebSessionBearer,
  currentWebSessionOwner,
} from '../../lib/use-web-session'
import { AccessibleModal } from '../components/accessible-modal'
import { SampleGarmentArt } from '../components/guest-preview/sample-garment-art'
import { SaveFeedbackProvider, useStatusBar } from '../components/save-feedback'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

function sortedSlots(look: SavedLookContract) {
  return [...look.composition].sort((a, b) => a.slotIndex - b.slotIndex)
}

function editorPreservesExactComposition(
  look: SavedLookContract,
  anchor: GarmentItemContract
): boolean {
  const selection = stylePieceAnchor(anchor)
  const recipe = savedLookToStylePieceRecipe(look)
  if (!selection || !recipe) return false
  const generated = visibleStylePieceLooks(
    stylePieceLooks(selection, recipe.weather, SAMPLE_CATALOG).looks,
    { [recipe.lookId]: recipe },
    { reopenedLookId: recipe.lookId }
  )
  const matched = generated.find((entry) => entry.recipe.lookId === recipe.lookId)
  if (!matched) return false
  const expectedSlots = [
    { kind: 'garment', category: selection.category, itemId: anchor.id },
    ...matched.companions.map((companion) => ({
      kind: 'catalog',
      category: companion.category,
      itemId: companion.id,
    })),
  ]
  const stored = sortedSlots(look)
  if (stored.length !== expectedSlots.length) return false
  return stored.every((slot, index) => {
    const expected = expectedSlots[index]
    return (
      expected !== undefined &&
      slot.slotIndex === index &&
      slot.kind === expected.kind &&
      slot.category === expected.category &&
      slot.itemId === expected.itemId
    )
  })
}

function isSlotImageValid(
  lookId: string,
  slot: SavedLookContract['composition'][number],
  failedImageKeys: ReadonlySet<string>
): boolean {
  if (!slot.imageAccess?.url) return false
  const expiresAtMs = Date.parse(slot.imageAccess.expiresAt)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return false
  return !failedImageKeys.has(`${lookId}:${slot.slotIndex}:${slot.imageAccess.url}`)
}

function SavedLookStatusBadges({
  status,
  missingLabel,
  needsReviewLabel,
}: {
  status: SavedLookContract['availabilityStatus']
  missingLabel: string
  needsReviewLabel: string
}) {
  if (status === 'ready') return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {status === 'missing_garment' && (
        <span
          data-testid="saved-look-missing-garment"
          className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {missingLabel}
        </span>
      )}
      {status === 'needs_review' && (
        <span
          data-testid="saved-look-needs-review"
          className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-200"
        >
          {needsReviewLabel}
        </span>
      )}
    </div>
  )
}

function SavedLookDetailNotices({
  status,
  missingDetail,
  needsReviewDetail,
}: {
  status: SavedLookContract['availabilityStatus']
  missingDetail: string
  needsReviewDetail: string
}) {
  if (status === 'missing_garment') {
    return (
      <p
        role="status"
        data-testid="saved-look-detail-missing"
        className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
      >
        {missingDetail}
      </p>
    )
  }
  if (status === 'needs_review') {
    return (
      <p
        role="status"
        data-testid="saved-look-detail-needs-review"
        className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/50 dark:text-blue-200"
      >
        {needsReviewDetail}
      </p>
    )
  }
  return null
}

export type ClosetSavedLooksRowProps = {
  owner: string | null
  savedLooks: SavedLookContract[]
  totalCount?: number
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  isLoading: boolean
  loadError: string | null
  garments: GarmentItemContract[]
  onRetry: () => void
  onChanged: () => void
  onReopenStylePiece: (look: SavedLookContract, invoker: HTMLElement) => void
}

export function ClosetSavedLooksRow(props: ClosetSavedLooksRowProps) {
  const { hasProvider } = useStatusBar()
  if (!props.owner) return null
  if (hasProvider) {
    return <ClosetSavedLooksRowInner {...props} />
  }
  return (
    <SaveFeedbackProvider inline renderOfflineLine={false}>
      <ClosetSavedLooksRowInner {...props} />
    </SaveFeedbackProvider>
  )
}

function ClosetSavedLooksRowInner({
  owner,
  savedLooks,
  totalCount,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  isLoading,
  loadError,
  garments,
  onRetry,
  onChanged,
  onReopenStylePiece,
}: ClosetSavedLooksRowProps) {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const samples = getGuestPreviewStrings(i18n.language)
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const mountedRef = useRef(true)
  const ownedNoticeIdsRef = useRef<Set<string>>(new Set())
  const detailLookIdRef = useRef<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [detailLook, setDetailLook] = useState<SavedLookContract | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [failedImageKeys, setFailedImageKeys] = useState<Set<string>>(() => new Set())
  const detailInvokerRef = useRef<HTMLElement | null>(null)
  const noticeSeqRef = useRef(0)
  detailLookIdRef.current = detailLook?.id ?? null

  const isActiveOwnerSession = (actionOwner: string | null): boolean => {
    if (!mountedRef.current || !actionOwner || ownerRef.current !== actionOwner) {
      return false
    }
    const verified = currentWebSessionOwner()
    return verified === null || verified === actionOwner
  }

  const showOwnedNotice = (
    actionOwner: string | null,
    notice: Parameters<typeof statusBar.showNotice>[0]
  ) => {
    if (!isActiveOwnerSession(actionOwner)) return
    ownedNoticeIdsRef.current.add(notice.id)
    statusBarRef.current.showNotice(notice)
  }

  useEffect(() => {
    mountedRef.current = true
    const owned = ownedNoticeIdsRef.current
    return () => {
      mountedRef.current = false
      for (const id of owned) {
        statusBarRef.current.dismissNotice(id)
      }
      owned.clear()
    }
  }, [])

  useEffect(() => {
    const owned = ownedNoticeIdsRef.current
    setDetailLook(null)
    setRemovingId(null)
    setFailedImageKeys(new Set())
    return () => {
      for (const id of owned) {
        statusBarRef.current.dismissNotice(id)
      }
      owned.clear()
    }
  }, [owner])

  const readLiveOnline = () =>
    statusBarRef.current.isOnline &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)

  const weatherLabel = (weather: string) =>
    samples.values.weather[weather as SampleWeatherKey] ?? weather

  const isSlotPhotoUsable = (
    lookId: string,
    slot: SavedLookContract['composition'][number]
  ): boolean => isSlotImageValid(lookId, slot, failedImageKeys)

  const canReopenInStylePiece = (look: SavedLookContract): boolean => {
    if (look.source !== 'style_piece' || look.availabilityStatus !== 'ready') {
      return false
    }
    const anchor = garments.find((item) => item.id === look.anchorGarmentId)
    return Boolean(anchor && editorPreservesExactComposition(look, anchor))
  }

  const handleReopen = (look: SavedLookContract, invoker: HTMLElement) => {
    if (canReopenInStylePiece(look)) {
      onReopenStylePiece(look, invoker)
      return
    }
    detailInvokerRef.current = invoker
    setDetailLook(look)
    const needsPhotoRefresh = look.composition.some(
      (slot) =>
        slot.kind === 'garment' && !slot.missing && !isSlotPhotoUsable(look.id, slot)
    )
    if (needsPhotoRefresh && owner) {
      const actionOwner = owner
      const actionToken = currentWebSessionBearer() ?? undefined
      void getSavedLookFromWeb(look.id, { accessToken: actionToken })
        .then((fresh) => {
          if (!isActiveOwnerSession(actionOwner) || detailLookIdRef.current !== look.id) {
            return
          }
          setDetailLook(fresh)
        })
        .catch(() => undefined)
    }
  }

  const handleRemove = async (look: SavedLookContract) => {
    const actionOwner = owner
    const actionToken = currentWebSessionBearer() ?? undefined
    if (!isActiveOwnerSession(actionOwner)) return

    if (!readLiveOnline()) {
      const seq = ++noticeSeqRef.current
      showOwnedNotice(actionOwner, {
        id: `closet-saved-look-offline-${seq}`,
        announcementId: createAnnouncementToken('closet-saved-look-offline', seq),
        message: t('feedback.offlineAction'),
        tone: 'offline',
        actions: [],
      })
      return
    }

    setRemovingId(look.id)
    let alreadyDeleted = false
    try {
      await deleteSavedLookFromWeb(
        look.id,
        formatSavedLookIfMatch(look.id, look.revision),
        { accessToken: actionToken }
      )
    } catch (error) {
      if (!isActiveOwnerSession(actionOwner)) return
      if (error instanceof SavedLookRequestError && error.status === 404) {
        alreadyDeleted = true
      } else {
        const seq = ++noticeSeqRef.current
        if (isOfflineError(error) || !readLiveOnline()) {
          showOwnedNotice(actionOwner, {
            id: `closet-saved-look-remove-offline-${seq}`,
            announcementId: createAnnouncementToken(
              'closet-saved-look-remove-offline',
              seq
            ),
            message: t('feedback.offlineAction'),
            tone: 'offline',
            actions: [],
          })
        } else {
          showOwnedNotice(actionOwner, {
            id: `closet-saved-look-remove-failed-${seq}`,
            announcementId: createAnnouncementToken(
              'closet-saved-look-remove-failed',
              seq
            ),
            message: t('feedback.saveFailed'),
            tone: 'error',
            actions: [
              {
                id: 'retry',
                kind: 'retry',
                label: t('feedback.retry'),
                onPress: () => {
                  if (!isActiveOwnerSession(actionOwner)) return
                  void handleRemove(look)
                },
              },
            ],
          })
        }
        setRemovingId(null)
        return
      }
    }

    if (!isActiveOwnerSession(actionOwner)) return
    setRemovingId(null)
    if (detailLookIdRef.current === look.id) {
      setDetailLook(null)
    }
    onChanged()
    notifySavedLooksChanged(actionOwner)

    let undoInFlight = false
    const seq = ++noticeSeqRef.current
    showOwnedNotice(actionOwner, {
      id: `closet-saved-look-remove-${seq}`,
      announcementId: createAnnouncementToken('closet-saved-look-remove', seq),
      message: t('feedback.removed'),
      tone: 'neutral',
      actions: alreadyDeleted
        ? []
        : [
            {
              id: 'undo',
              kind: 'undo',
              label: t('feedback.undo'),
              onPress: async () => {
                if (undoInFlight || !isActiveOwnerSession(actionOwner)) return
                if (!readLiveOnline()) {
                  const offSeq = ++noticeSeqRef.current
                  showOwnedNotice(actionOwner, {
                    id: `closet-saved-look-undo-offline-${offSeq}`,
                    announcementId: createAnnouncementToken(
                      'closet-saved-look-undo-offline',
                      offSeq
                    ),
                    message: t('feedback.offlineAction'),
                    tone: 'offline',
                    actions: [],
                  })
                  return
                }
                undoInFlight = true
                try {
                  await restoreSavedLookFromWeb(look.id, {
                    accessToken: actionToken,
                  })
                  if (!isActiveOwnerSession(actionOwner)) return
                  onChanged()
                  notifySavedLooksChanged(actionOwner)
                  const undoSeq = ++noticeSeqRef.current
                  showOwnedNotice(actionOwner, {
                    id: `closet-saved-look-undo-${undoSeq}`,
                    announcementId: createAnnouncementToken(
                      'closet-saved-look-undo',
                      undoSeq
                    ),
                    message: t('feedback.undone'),
                    tone: 'neutral',
                  })
                } catch (undoError) {
                  if (!isActiveOwnerSession(actionOwner)) return
                  const errSeq = ++noticeSeqRef.current
                  const offline = isOfflineError(undoError) || !readLiveOnline()
                  showOwnedNotice(actionOwner, {
                    id: `closet-saved-look-undo-${offline ? 'offline' : 'failed'}-${errSeq}`,
                    announcementId: createAnnouncementToken(
                      `closet-saved-look-undo-${offline ? 'offline' : 'failed'}`,
                      errSeq
                    ),
                    message: offline
                      ? t('feedback.offlineAction')
                      : t('feedback.saveFailed'),
                    tone: offline ? 'offline' : 'error',
                    actions: [],
                  })
                } finally {
                  undoInFlight = false
                }
              },
            },
          ],
    })
  }

  const renderSlotVisual = (
    lookId: string,
    slot: SavedLookContract['composition'][number]
  ) => {
    if (slot.kind === 'catalog') {
      const catalogItem = CATALOG_BY_ID.get(slot.itemId)
      const label = catalogItem
        ? sampleGarmentText(catalogItem, samples).name
        : (slot.label ?? samples.values.category[slot.category])
      return (
        <div
          key={`${slot.slotIndex}-${slot.itemId}`}
          data-testid={`saved-look-slot-${slot.slotIndex}`}
          data-slot-item-id={slot.itemId}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
        >
          {catalogItem ? (
            <span className="shrink-0 rounded bg-[#F5F5F7] p-0.5">
              <SampleGarmentArt garment={catalogItem} className="h-7 w-7" />
            </span>
          ) : null}
          <span>{label}</span>
        </div>
      )
    }

    if (slot.missing) {
      return (
        <div
          key={`${slot.slotIndex}-${slot.itemId}`}
          data-testid={`saved-look-slot-${slot.slotIndex}`}
          data-slot-item-id={slot.itemId}
          className="flex items-center gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span aria-hidden="true">?</span>
          <span>
            {samples.values.category[slot.category]} · {t('savedLooks.missingPiece')}
          </span>
        </div>
      )
    }

    const photoUsable = isSlotPhotoUsable(lookId, slot)
    const photoKey = slot.imageAccess?.url
      ? `${lookId}:${slot.slotIndex}:${slot.imageAccess.url}`
      : null

    return (
      <div
        key={`${slot.slotIndex}-${slot.itemId}`}
        data-testid={`saved-look-slot-${slot.slotIndex}`}
        data-slot-item-id={slot.itemId}
        className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
      >
        {photoUsable && slot.imageAccess ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.imageAccess.url}
            alt={samples.values.category[slot.category]}
            referrerPolicy="no-referrer"
            className="h-7 w-7 rounded object-cover"
            onError={() => {
              if (!photoKey) return
              setFailedImageKeys((prev) => {
                if (prev.has(photoKey)) return prev
                const next = new Set(prev)
                next.add(photoKey)
                return next
              })
            }}
          />
        ) : (
          <span
            data-testid="saved-look-photo-placeholder"
            className="flex h-7 w-7 items-center justify-center rounded bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {samples.values.category[slot.category].slice(0, 2).toUpperCase()}
          </span>
        )}
        <span>
          {samples.values.category[slot.category]}
          {!photoUsable ? ` · ${t('savedLooks.photoUnavailable')}` : ''}
        </span>
      </div>
    )
  }

  const displayedCount = totalCount ?? savedLooks.length

  return (
    <section
      aria-label={t('savedLooks.title')}
      className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button
        type="button"
        data-testid="closet-saved-looks-row"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {t('savedLooks.title')}
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {isLoading && savedLooks.length === 0
              ? '…'
              : t('savedLooks.count', { count: displayedCount })}
          </p>
        </div>
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {expanded ? t('savedLooks.hideList') : t('savedLooks.showList')}
        </span>
      </button>

      {loadError && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          <span>{t('savedLooks.loadFailed')}</span>
          <button
            type="button"
            data-testid="saved-looks-retry"
            onClick={onRetry}
            className="min-h-11 px-2 font-semibold underline"
          >
            {t('savedLooks.retry')}
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-4 space-y-3" data-testid="closet-saved-looks-list">
          {savedLooks.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {t('savedLooks.empty')}
            </p>
          ) : (
            savedLooks.map((look) => {
              const title =
                look.title ||
                sampleLookText({ id: look.lookId }, samples).name ||
                look.lookId
              return (
                <article
                  key={look.id}
                  data-testid={`saved-look-card-${look.id}`}
                  className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {title}
                      </h3>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        {weatherLabel(look.weather)} ·{' '}
                        {look.source === 'style_piece'
                          ? t('savedLooks.sourceStylePiece')
                          : t('savedLooks.sourceHomeSample')}
                      </p>
                    </div>
                    <SavedLookStatusBadges
                      status={look.availabilityStatus}
                      missingLabel={t('savedLooks.missingPiece')}
                      needsReviewLabel={t('savedLooks.needsReview')}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {sortedSlots(look).map((slot) => renderSlotVisual(look.id, slot))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="saved-look-reopen"
                      onClick={(event) => handleReopen(look, event.currentTarget)}
                      className="min-h-11 rounded-lg border border-zinc-300 px-3 text-sm font-semibold dark:border-zinc-600"
                    >
                      {t('savedLooks.reopen')}
                    </button>
                    <button
                      type="button"
                      data-testid="saved-look-remove"
                      disabled={removingId === look.id}
                      onClick={() => void handleRemove(look)}
                      className="min-h-11 rounded-lg px-3 text-sm font-semibold underline disabled:opacity-60"
                    >
                      {t('savedLooks.remove')}
                    </button>
                  </div>
                </article>
              )
            })
          )}
          {hasMore && onLoadMore && (
            <button
              type="button"
              data-testid="saved-looks-load-more"
              disabled={isLoadingMore}
              onClick={onLoadMore}
              className="min-h-11 w-full rounded-lg border border-zinc-300 px-3 text-sm font-semibold disabled:opacity-60 dark:border-zinc-600"
            >
              {isLoadingMore ? '…' : t('savedLooks.showList')}
            </button>
          )}
        </div>
      )}

      {detailLook && (
        <AccessibleModal
          isOpen
          onClose={() => setDetailLook(null)}
          titleId="saved-look-detail-heading"
          title={t('savedLooks.detailTitle')}
          closeLabel={t('savedLooks.close')}
          invokingElementRef={detailInvokerRef}
        >
          <div data-testid="saved-look-detail-modal" className="mt-3 space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {weatherLabel(detailLook.weather)} ·{' '}
              {detailLook.source === 'style_piece'
                ? t('savedLooks.sourceStylePiece')
                : t('savedLooks.sourceHomeSample')}
            </p>
            <SavedLookDetailNotices
              status={detailLook.availabilityStatus}
              missingDetail={t('savedLooks.missingPieceDetail')}
              needsReviewDetail={t('savedLooks.needsReviewDetail')}
            />
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('savedLooks.slotOrderLabel')}</h3>
              <ol className="space-y-2">
                {sortedSlots(detailLook).map((slot) => (
                  <li key={`${slot.slotIndex}-${slot.itemId}`}>
                    {renderSlotVisual(detailLook.id, slot)}
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="saved-look-detail-remove"
                disabled={removingId === detailLook.id}
                onClick={() => void handleRemove(detailLook)}
                className="min-h-11 rounded-lg border border-zinc-300 px-3 text-sm font-semibold disabled:opacity-60 dark:border-zinc-600"
              >
                {t('savedLooks.remove')}
              </button>
            </div>
          </div>
        </AccessibleModal>
      )}
    </section>
  )
}
