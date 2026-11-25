// Story CC-7.5: the garment detail and its inline tag editor. D2: the Closet page renders it in
// place of the grid for `/wardrobe?garment=<id>`, so the grid stays mounted and keeps its scroll.
// Done saves through the CC-7.1 status bar: "Saved" with Undo, "No changes", and a distinct
// message for a concurrent update, a guardian block and a lost connection.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GarmentComfortRange,
  GarmentMaterial,
  GarmentWithColor,
} from '@couture/api-client/contracts/http'
import {
  classifyGarmentTagSaveError,
  COMFORT_RANGES,
  createAnnouncementToken,
  formatGarmentAlt,
  formatGarmentCategory,
  formatGarmentTagLabels,
  garmentTagDraft,
  garmentTagsEqual,
  getGuestPreviewStrings,
  getStylePieceStrings,
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_GARMENT_MATERIALS,
  type GarmentTagDraft,
  type GarmentTagSaveFailure,
  type StylePieceSelection,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { updateGarmentTagsFromWeb } from '../../lib/wardrobe'
import { currentWebSessionOwner } from '../../lib/use-web-session'
import { SaveFeedbackProvider, useStatusBar } from '../components/save-feedback'
import { StylePieceEntry } from './style-piece-panel'

/** A Closet garment: list reads carry `colorFamily`; a just-committed upload may not yet. */
export type ClosetGarment = Omit<GarmentWithColor, 'colorFamily'> &
  Partial<Pick<GarmentWithColor, 'colorFamily'>>

/** D6: the alt text of a member garment photo ("Blue top"), shared by the grid and the detail. */
export function garmentPhotoAlt(locale: string, garment: ClosetGarment): string {
  return formatGarmentAlt(locale, {
    colorFamily: garment.colorFamily ?? null,
    category: garment.category,
  })
}

export type GarmentDetailProps = {
  /** The ready garment for the open id, or null when the closet has no such ready garment. */
  garment: ClosetGarment | null
  owner: string | null
  hasLoaded: boolean
  loadFailed: boolean
  loading: boolean
  onBack: () => void
  onTagsSaved: (garment: GarmentWithColor) => void
  onRefresh: () => void
  onStylePiece: (selection: StylePieceSelection, button: HTMLButtonElement) => void
}

export function GarmentDetail(props: GarmentDetailProps) {
  const { hasProvider } = useStatusBar()
  const { garment } = props
  if (!garment) return <GarmentDetailUnavailable {...props} />
  const inner = <GarmentDetailInner {...props} garment={garment} />
  if (hasProvider) return inner
  return (
    <SaveFeedbackProvider inline renderOfflineLine={false}>
      {inner}
    </SaveFeedbackProvider>
  )
}

/** No ready garment for the open id: still loading, the read failed, or it left the closet. */
function GarmentDetailUnavailable({
  hasLoaded,
  loadFailed,
  loading,
  onBack,
  onRefresh,
}: GarmentDetailProps) {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const retry = getGuestPreviewStrings(i18n.language).chrome.retry
  const failed = !hasLoaded && loadFailed && !loading
  return (
    <section
      data-testid={hasLoaded ? 'garment-detail-missing' : 'garment-detail-loading'}
      className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button
        type="button"
        data-testid="garment-detail-back"
        className={BACK_BUTTON_CLASS}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span> {t('wardrobe.detail.back')}
      </button>
      {hasLoaded ? (
        <p className="mt-4 text-base font-semibold text-zinc-800 dark:text-zinc-100">
          {t('wardrobe.detail.missing')}
        </p>
      ) : (
        <p role="status" className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
          {failed ? t('wardrobe.detail.loadFailed') : t('wardrobe.detail.loading')}
        </p>
      )}
      {failed && (
        <button
          type="button"
          className="mt-2 min-h-11 px-2 text-sm font-semibold underline"
          onClick={onRefresh}
        >
          {retry}
        </button>
      )}
    </section>
  )
}

const BACK_BUTTON_CLASS =
  'inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white'

function GarmentDetailInner({
  garment,
  owner,
  loadFailed,
  loading,
  onBack,
  onTagsSaved,
  onRefresh,
  onStylePiece,
}: GarmentDetailProps & { garment: ClosetGarment }) {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const locale = i18n.language
  const styleLabels = getStylePieceStrings(locale)
  const samples = getGuestPreviewStrings(locale)
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const mountedRef = useRef(true)
  const noticeSeqRef = useRef(0)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const [draft, setDraft] = useState<GarmentTagDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<GarmentTagSaveFailure | null>(null)
  const focusEditAfterCloseRef = useRef(false)
  const handleDoneRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const garmentId = garment.id

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // A newly opened garment starts with its heading focused and no open editor.
  useEffect(() => {
    setDraft(null)
    setFailure(null)
    setSaving(false)
    headingRef.current?.focus()
  }, [garmentId])

  useEffect(() => {
    if (draft === null && focusEditAfterCloseRef.current) {
      focusEditAfterCloseRef.current = false
      editButtonRef.current?.focus()
    }
  }, [draft])

  const isActiveOwner = (actionOwner: string | null) => {
    if (!actionOwner || ownerRef.current !== actionOwner) return false
    const verified = currentWebSessionOwner()
    return verified === null || verified === actionOwner
  }

  const readLiveOnline = () =>
    statusBarRef.current.isOnline &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)

  const failureMessage = (kind: GarmentTagSaveFailure) =>
    kind === 'conflict'
      ? t('wardrobe.detail.conflict')
      : kind === 'not-allowed'
        ? t('wardrobe.detail.notAllowed')
        : kind === 'offline'
          ? t('feedback.offlineAction')
          : t('feedback.saveFailed')

  const showNotice = (
    actionOwner: string | null,
    kind: string,
    notice: Omit<Parameters<typeof statusBar.showNotice>[0], 'id' | 'announcementId'>
  ) => {
    if (!isActiveOwner(actionOwner)) return
    const seq = ++noticeSeqRef.current
    statusBarRef.current.showNotice({
      ...notice,
      id: `garment-tags-${kind}-${seq}`,
      announcementId: createAnnouncementToken(`garment-tags-${kind}`, seq),
    })
  }

  const alt = garmentPhotoAlt(locale, garment)
  const labels = formatGarmentTagLabels(locale, garment)
  const saved = garmentTagDraft(garment)

  const saveTags = async (
    actionOwner: string | null,
    target: GarmentTagDraft
  ): Promise<GarmentWithColor> =>
    updateGarmentTagsFromWeb(garment.id, {
      category: target.category,
      material: target.material,
      comfortRange: target.comfortRange,
    }).then((updated) => {
      if (isActiveOwner(actionOwner)) onTagsSaved(updated)
      return updated
    })

  const runUndo = async (actionOwner: string | null, previous: GarmentTagDraft) => {
    if (!isActiveOwner(actionOwner)) return
    const retry = {
      id: 'retry' as const,
      kind: 'retry' as const,
      label: t('feedback.retry'),
      onPress: () => void runUndo(actionOwner, previous),
    }
    if (!readLiveOnline()) {
      showNotice(actionOwner, 'undo-offline', {
        message: t('feedback.offlineAction'),
        tone: 'offline',
        actions: [retry],
      })
      return
    }
    try {
      await saveTags(actionOwner, previous)
      showNotice(actionOwner, 'undone', {
        message: t('feedback.undone'),
        tone: 'neutral',
      })
    } catch (error) {
      const kind = classifyGarmentTagSaveError(error, readLiveOnline())
      showNotice(actionOwner, `undo-${kind}`, {
        message:
          kind === 'offline'
            ? t('feedback.offlineAction')
            : t('wardrobe.detail.undoFailed'),
        tone: kind === 'offline' ? 'offline' : 'error',
        actions: [retry],
      })
    }
  }

  const closeEditor = () => {
    focusEditAfterCloseRef.current = true
    setDraft(null)
    setFailure(null)
  }

  const handleDone = async () => {
    if (!draft || !saved || saving) return
    const actionOwner = owner
    if (!isActiveOwner(actionOwner)) return
    if (garmentTagsEqual(draft, saved)) {
      closeEditor()
      showNotice(actionOwner, 'unchanged', {
        message: t('wardrobe.detail.noChanges'),
        tone: 'neutral',
      })
      return
    }
    if (!readLiveOnline()) {
      setFailure('offline')
      showNotice(actionOwner, 'offline', {
        message: failureMessage('offline'),
        tone: 'offline',
      })
      return
    }
    const previous = saved
    const target = draft
    setSaving(true)
    setFailure(null)
    try {
      await saveTags(actionOwner, target)
    } catch (error) {
      if (!mountedRef.current || !isActiveOwner(actionOwner)) return
      const kind = classifyGarmentTagSaveError(error, readLiveOnline())
      setSaving(false)
      setFailure(kind)
      showNotice(actionOwner, kind, {
        message: failureMessage(kind),
        tone: kind === 'offline' ? 'offline' : 'error',
        actions:
          kind === 'offline' || kind === 'failed'
            ? [
                {
                  id: 'retry',
                  kind: 'retry',
                  label: t('feedback.retry'),
                  onPress: () => void handleDoneRef.current(),
                },
              ]
            : [],
      })
      return
    }
    if (mountedRef.current) {
      setSaving(false)
      closeEditor()
    }
    showNotice(actionOwner, 'saved', {
      message: t('feedback.saved'),
      tone: 'success',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => void runUndo(actionOwner, previous),
        },
      ],
    })
  }
  handleDoneRef.current = handleDone

  const field = <V extends string>(
    name: 'category' | 'material' | 'comfort',
    legend: string,
    options: readonly { value: V; label: string }[],
    selected: V,
    onSelect: (value: V) => void
  ) => (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        {legend}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const pressed = option.value === selected
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              data-testid={`garment-tag-option-${name}-${option.value}`}
              disabled={saving}
              onClick={() => onSelect(option.value)}
              className={`min-h-11 rounded-lg border px-3 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none disabled:opacity-60 ${
                pressed
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-300 text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )

  const { values } = samples
  const tagRow = (testId: string, label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-2 last:border-b-0 dark:border-zinc-800">
      <dt className="text-sm text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd
        data-testid={testId}
        className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {value}
      </dd>
    </div>
  )

  return (
    <section
      data-testid="garment-detail"
      aria-labelledby="garment-detail-title"
      className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button
        type="button"
        data-testid="garment-detail-back"
        className={BACK_BUTTON_CLASS}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span> {t('wardrobe.detail.back')}
      </button>

      <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,16rem)_1fr]">
        {garment.imageAccess ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            data-testid="garment-detail-photo"
            src={garment.imageAccess.url}
            alt={alt}
            className="aspect-[3/4] w-full max-w-xs rounded-lg object-cover"
          />
        ) : (
          <div
            data-testid="garment-detail-photo"
            role="img"
            aria-label={alt}
            className="flex aspect-[3/4] w-full max-w-xs items-center justify-center rounded-lg bg-zinc-100 text-4xl dark:bg-zinc-800"
          >
            <span aria-hidden="true">👗</span>
          </div>
        )}

        <div>
          <h2
            id="garment-detail-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-bold text-zinc-900 outline-none dark:text-zinc-50"
          >
            {alt}
          </h2>

          <dl className="mt-3">
            {tagRow(
              'garment-detail-category',
              t('wardrobe.detail.category'),
              labels.category ?? ''
            )}
            {tagRow(
              'garment-detail-material',
              t('wardrobe.detail.material'),
              labels.material ?? t('wardrobe.detail.noMaterial')
            )}
            {tagRow(
              'garment-detail-comfort',
              t('wardrobe.detail.comfort'),
              labels.comfort ?? ''
            )}
          </dl>

          {draft ? (
            <div data-testid="garment-tag-editor" className="mt-2">
              {field(
                'category',
                t('wardrobe.detail.category'),
                SAMPLE_GARMENT_CATEGORIES.map((value) => ({
                  value,
                  label: formatGarmentCategory(locale, value),
                })),
                draft.category,
                (category) => setDraft({ ...draft, category })
              )}
              {field<GarmentMaterial | 'none'>(
                'material',
                t('wardrobe.detail.material'),
                [
                  ...SAMPLE_GARMENT_MATERIALS.map((value) => ({
                    value,
                    label: values.material[value],
                  })),
                  { value: 'none' as const, label: t('wardrobe.detail.noMaterial') },
                ],
                draft.material ?? 'none',
                (material) =>
                  setDraft({ ...draft, material: material === 'none' ? null : material })
              )}
              {field<GarmentComfortRange>(
                'comfort',
                t('wardrobe.detail.comfort'),
                COMFORT_RANGES.map((value) => ({
                  value,
                  label:
                    formatGarmentTagLabels(locale, { comfortRange: value }).comfort ??
                    value,
                })),
                draft.comfortRange,
                (comfortRange) => setDraft({ ...draft, comfortRange })
              )}

              {failure && (
                <p
                  data-testid="garment-tag-error"
                  data-failure={failure}
                  className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/60 dark:text-red-200"
                >
                  {failureMessage(failure)}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="garment-tag-done"
                  data-primary-action="true"
                  aria-busy={saving}
                  disabled={saving}
                  onClick={() => void handleDone()}
                  className="min-h-11 min-w-[5.5rem] rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-zinc-800 motion-reduce:transition-none disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {saving ? t('feedback.saving') : t('wardrobe.detail.done')}
                </button>
                <button
                  type="button"
                  data-testid="garment-tag-cancel"
                  disabled={saving}
                  onClick={closeEditor}
                  className="min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100"
                >
                  {t('wardrobe.detail.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                ref={editButtonRef}
                type="button"
                data-testid="garment-edit-tags"
                disabled={!saved}
                onClick={() => {
                  if (!saved) return
                  setFailure(null)
                  setDraft(saved)
                }}
                className="min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100"
              >
                {t('wardrobe.detail.editTags')}
              </button>
              <StylePieceEntry
                garment={garment}
                owner={owner}
                unavailable={loadFailed}
                loading={loading}
                labels={styleLabels}
                onRefresh={onRefresh}
                onOpen={onStylePiece}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
