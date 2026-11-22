// Story CC-7.2: Temporary "Saved looks" row at the top of the Closet screen until CC-7.12 ships.
'use client'

import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CreateSavedLookInput,
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  createAnnouncementToken,
  createIdempotencyKey,
  getGuestPreviewStrings,
  isOfflineError,
  SAMPLE_CATALOG,
  sampleGarmentText,
  sampleLookText,
  stylePieceAnchor,
  type SampleWeatherKey,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import {
  createSavedLookFromWeb,
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
} from '../../lib/saved-looks'
import { AccessibleModal } from '../components/accessible-modal'
import { SampleGarmentArt } from '../components/guest-preview/sample-garment-art'
import { SaveFeedbackProvider, useStatusBar } from '../components/save-feedback'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

function toRecreateInput(look: SavedLookContract): CreateSavedLookInput {
  return {
    source: look.source,
    lookId: look.lookId,
    weather: look.weather,
    title: look.title,
    anchorGarmentId: look.anchorGarmentId,
    anchorSnapshot: look.anchorSnapshot,
    composition: look.composition.map((slot) => ({
      slotIndex: slot.slotIndex,
      category: slot.category,
      kind: slot.kind,
      itemId: slot.itemId,
      label: slot.label,
    })),
    swaps: look.swaps,
    collection: look.collection,
    comfort: look.comfort,
  }
}

export function ClosetSavedLooksRow(props: {
  owner: string | null
  savedLooks: SavedLookContract[]
  isLoading: boolean
  loadError: string | null
  garments: GarmentItemContract[]
  onRetry: () => void
  onChanged: () => void
  onReopenStylePiece: (look: SavedLookContract, invoker: HTMLElement) => void
}) {
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
  savedLooks,
  isLoading,
  loadError,
  garments,
  onRetry,
  onChanged,
  onReopenStylePiece,
}: {
  owner: string | null
  savedLooks: SavedLookContract[]
  isLoading: boolean
  loadError: string | null
  garments: GarmentItemContract[]
  onRetry: () => void
  onChanged: () => void
  onReopenStylePiece: (look: SavedLookContract, invoker: HTMLElement) => void
}) {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const samples = getGuestPreviewStrings(i18n.language)
  const statusBar = useStatusBar()
  const [expanded, setExpanded] = useState(false)
  const [detailLook, setDetailLook] = useState<SavedLookContract | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const detailInvokerRef = useRef<HTMLElement | null>(null)
  const noticeSeqRef = useRef(0)

  const readLiveOnline = () =>
    statusBar.isOnline && (typeof navigator === 'undefined' || navigator.onLine !== false)

  const weatherLabel = (weather: string) =>
    samples.values.weather[weather as SampleWeatherKey] ?? weather

  const canReopenInStylePiece = (look: SavedLookContract): boolean => {
    if (look.source !== 'style_piece' || look.availabilityStatus !== 'ready') {
      return false
    }
    const anchor = garments.find((item) => item.id === look.anchorGarmentId)
    return Boolean(anchor && stylePieceAnchor(anchor))
  }

  const handleReopen = (look: SavedLookContract, invoker: HTMLElement) => {
    if (canReopenInStylePiece(look)) {
      onReopenStylePiece(look, invoker)
      return
    }
    detailInvokerRef.current = invoker
    setDetailLook(look)
  }

  const handleRemove = async (look: SavedLookContract) => {
    if (!readLiveOnline()) {
      const seq = ++noticeSeqRef.current
      statusBar.showNotice({
        id: `closet-saved-look-offline-${seq}`,
        announcementId: createAnnouncementToken('closet-saved-look-offline', seq),
        message: t('feedback.offlineAction'),
        tone: 'offline',
        actions: [],
      })
      return
    }

    setRemovingId(look.id)
    try {
      await deleteSavedLookFromWeb(
        look.id,
        formatSavedLookIfMatch(look.id, look.revision)
      )
      if (detailLook?.id === look.id) {
        setDetailLook(null)
      }
      onChanged()
      const seq = ++noticeSeqRef.current
      statusBar.showNotice({
        id: `closet-saved-look-remove-${seq}`,
        announcementId: createAnnouncementToken('closet-saved-look-remove', seq),
        message: t('feedback.removed'),
        tone: 'neutral',
        actions:
          look.availabilityStatus === 'missing_garment'
            ? []
            : [
                {
                  id: 'undo',
                  kind: 'undo',
                  label: t('feedback.undo'),
                  onPress: async () => {
                    if (!readLiveOnline()) {
                      const offSeq = ++noticeSeqRef.current
                      statusBar.showNotice({
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
                    try {
                      await createSavedLookFromWeb(toRecreateInput(look), {
                        idempotencyKey: createIdempotencyKey(),
                      })
                      onChanged()
                      const undoSeq = ++noticeSeqRef.current
                      statusBar.showNotice({
                        id: `closet-saved-look-undo-${undoSeq}`,
                        announcementId: createAnnouncementToken(
                          'closet-saved-look-undo',
                          undoSeq
                        ),
                        message: t('feedback.undone'),
                        tone: 'neutral',
                      })
                    } catch (undoError) {
                      const errSeq = ++noticeSeqRef.current
                      const offline = isOfflineError(undoError) || !readLiveOnline()
                      statusBar.showNotice({
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
                    }
                  },
                },
              ],
      })
    } catch (error) {
      const seq = ++noticeSeqRef.current
      if (isOfflineError(error) || !readLiveOnline()) {
        statusBar.showNotice({
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
        statusBar.showNotice({
          id: `closet-saved-look-remove-failed-${seq}`,
          announcementId: createAnnouncementToken('closet-saved-look-remove-failed', seq),
          message: t('feedback.saveFailed'),
          tone: 'error',
          actions: [
            {
              id: 'retry',
              kind: 'retry',
              label: t('feedback.retry'),
              onPress: () => {
                void handleRemove(look)
              },
            },
          ],
        })
      }
    } finally {
      setRemovingId(null)
    }
  }

  const renderSlotVisual = (slot: SavedLookContract['composition'][number]) => {
    if (slot.kind === 'catalog') {
      const catalogItem = CATALOG_BY_ID.get(slot.itemId)
      const label = catalogItem
        ? sampleGarmentText(catalogItem, samples).name
        : (slot.label ?? samples.values.category[slot.category])
      return (
        <div
          key={`${slot.slotIndex}-${slot.itemId}`}
          data-testid={`saved-look-slot-${slot.slotIndex}`}
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
          className="flex items-center gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span aria-hidden="true">?</span>
          <span>
            {samples.values.category[slot.category]} · {t('savedLooks.missingPiece')}
          </span>
        </div>
      )
    }

    return (
      <div
        key={`${slot.slotIndex}-${slot.itemId}`}
        data-testid={`saved-look-slot-${slot.slotIndex}`}
        className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
      >
        {slot.imageAccess ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.imageAccess.url}
            alt={samples.values.category[slot.category]}
            referrerPolicy="no-referrer"
            className="h-7 w-7 rounded object-cover"
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
          {!slot.imageAccess ? ` · ${t('savedLooks.photoUnavailable')}` : ''}
        </span>
      </div>
    )
  }

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
              : t('savedLooks.count', { count: savedLooks.length })}
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
                    <div className="flex flex-wrap gap-1.5">
                      {look.availabilityStatus === 'missing_garment' && (
                        <span
                          data-testid="saved-look-missing-garment"
                          className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                        >
                          {t('savedLooks.missingPiece')}
                        </span>
                      )}
                      {look.availabilityStatus === 'needs_review' && (
                        <span
                          data-testid="saved-look-needs-review"
                          className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-200"
                        >
                          {t('savedLooks.needsReview')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {look.composition.map((slot) => renderSlotVisual(slot))}
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
            {detailLook.availabilityStatus === 'missing_garment' && (
              <p
                role="status"
                data-testid="saved-look-detail-missing"
                className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              >
                {t('savedLooks.missingPieceDetail')}
              </p>
            )}
            {detailLook.availabilityStatus === 'needs_review' && (
              <p
                role="status"
                data-testid="saved-look-detail-needs-review"
                className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/50 dark:text-blue-200"
              >
                {t('savedLooks.needsReviewDetail')}
              </p>
            )}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('savedLooks.slotOrderLabel')}</h3>
              <ol className="space-y-2">
                {detailLook.composition.map((slot) => (
                  <li key={`${slot.slotIndex}-${slot.itemId}`}>
                    {renderSlotVisual(slot)}
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
                className="min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-semibold dark:border-zinc-600"
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
