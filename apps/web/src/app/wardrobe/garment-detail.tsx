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
  GarmentUsageResponse,
  GarmentWithColor,
} from '@couture/api-client/contracts/http'
import {
  classifyGarmentTagSaveError,
  COMFORT_RANGES,
  createAnnouncementToken,
  getSaveFeedbackUrgency,
  SAVE_FEEDBACK_TIMINGS,
  formatGarmentAlt,
  formatGarmentCategory,
  formatGarmentTagLabels,
  garmentTagDraft,
  garmentTagsEqual,
  isOfflineError,
  getGuestPreviewStrings,
  getStylePieceStrings,
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_GARMENT_MATERIALS,
  type GarmentTagDraft,
  type GarmentTagSaveFailure,
  type StylePieceSelection,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { getGarmentUsageFromWeb, updateGarmentTagsFromWeb } from '../../lib/wardrobe'
import { currentWebSessionOwner } from '../../lib/use-web-session'
import { SaveFeedbackProvider, useStatusBar } from '../components/save-feedback'
import { StylePieceEntry } from './style-piece-panel'
import type { GarmentDeleteMode } from './garment-deletion'

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
  /**
   * Called when a tag save is sent; whatever it returns comes back with that save's
   * `onTagsSaved`, so the page can tell whether a newer closet read landed meanwhile.
   */
  onTagSaveStart?: () => number
  onTagsSaved: (garment: GarmentWithColor, startToken?: number) => void
  onRefresh: () => void
  onStylePiece: (selection: StylePieceSelection, button: HTMLButtonElement) => void
  /**
   * Story CC-7.6: the member deletes this piece. `deferred`: in no saved look or capsule, so it
   * gets an Undo window. `immediate`: confirmed after the prompt named its looks. `gone`: the
   * usage read answered 404, so it already left the closet. Absent, no Delete is offered.
   */
  onDelete?: (garmentId: string, mode: GarmentDeleteMode) => void
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
  // A current read failure comes first: an id missing from an older read may be back.
  const failed = loadFailed && !loading
  const missing = hasLoaded && !failed
  return (
    <section
      data-testid={missing ? 'garment-detail-missing' : 'garment-detail-loading'}
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
      {missing ? (
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

/**
 * Notice and announcement ids come from one counter for the whole page, so they stay unique
 * across detail mounts: the root provider announces each id once and would drop a repeat,
 * such as the first "Saved" after the detail is reopened.
 */
let garmentTagRunSeq = 0
const nextGarmentTagSeq = () => ++garmentTagRunSeq

type GarmentTagSaveState = 'idle' | 'saving' | 'still-saving'

/**
 * The tag editor's save lifecycle, on the CC-7.1 timings: "Saving" at once, "Still saving"
 * after `SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs`, each announced once; then "Saved" with
 * Undo, "No changes", or a distinct failure. Done sends the tags it loaded as `expected` and
 * Undo the tags it saved, so neither overwrites a newer edit (409 GARMENT_TAGS_CHANGED). A new
 * Done retires the previous Undo, so a stale Undo cannot run.
 */
function useGarmentTagEditor({
  garment,
  owner,
  onTagSaveStart,
  onTagsSaved,
  onRefresh,
}: {
  garment: ClosetGarment
  owner: string | null
  onTagSaveStart?: () => number
  onTagsSaved: (garment: GarmentWithColor, startToken?: number) => void
  onRefresh: () => void
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const mountedRef = useRef(true)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const focusEditAfterCloseRef = useRef(false)
  const handleDoneRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const saveRunRef = useRef(0)
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoRef = useRef<{ noticeId: string; epoch: number } | null>(null)
  const undoEpochRef = useRef(0)
  const undoInFlightRef = useRef(false)
  // Counts committed Done saves. An Undo answer that lands after a newer Done committed must
  // not replace that Done's garment.
  const doneCommitsRef = useRef(0)
  const editorRef = useRef<HTMLDivElement | null>(null)
  // The tags the editor opened with. A background closet read can change `saved` while the
  // editor is open; No changes, `expected` and the Undo target all use this snapshot instead.
  const baselineRef = useRef<GarmentTagDraft | null>(null)
  // Set by a 409: the next closet read is the member's review point, so it becomes the baseline.
  const rebaseAfterConflictRef = useRef(false)
  // True from a 409 until that re-read lands: Done waits, so it never compares the draft with
  // the pre-conflict baseline.
  const [awaitingRead, setAwaitingRead] = useState(false)
  const awaitingReadRef = useRef(false)
  const setAwaiting = (value: boolean) => {
    awaitingReadRef.current = value
    setAwaitingRead(value)
  }
  const [draft, setDraft] = useState<GarmentTagDraft | null>(null)
  const [saveState, setSaveState] = useState<GarmentTagSaveState>('idle')
  const [failure, setFailure] = useState<GarmentTagSaveFailure | null>(null)
  const garmentId = garment.id
  const saved = garmentTagDraft(garment)
  const editorOpen = draft !== null

  const clearSlowTimer = () => {
    if (slowTimerRef.current !== null) clearTimeout(slowTimerRef.current)
    slowTimerRef.current = null
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (slowTimerRef.current !== null) clearTimeout(slowTimerRef.current)
    }
  }, [])

  // A newly opened garment starts with no open editor and no run in flight.
  useEffect(() => {
    saveRunRef.current++
    setDraft(null)
    setFailure(null)
    setSaveState('idle')
  }, [garmentId])

  // After a conflict the editor keeps the draft and the closet is read again. When that read
  // lands, the rows above show the stored tags and they become the baseline, so the member's
  // next Done is a deliberate retry against what is stored now.
  useEffect(() => {
    if (!rebaseAfterConflictRef.current || !baselineRef.current) return
    rebaseAfterConflictRef.current = false
    baselineRef.current = garmentTagDraft(garment)
    awaitingReadRef.current = false
    setAwaitingRead(false)
  }, [garment])

  // Opening the editor moves focus to its first control, the selected category; closing it
  // returns focus to Edit tags.
  useEffect(() => {
    if (editorOpen) {
      editorRef.current
        ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus()
      return
    }
    if (focusEditAfterCloseRef.current) {
      focusEditAfterCloseRef.current = false
      editButtonRef.current?.focus()
    }
  }, [editorOpen])

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
  ): string | null => {
    if (!isActiveOwner(actionOwner)) return null
    const seq = nextGarmentTagSeq()
    const id = `garment-tags-${kind}-${seq}`
    statusBarRef.current.showNotice({
      ...notice,
      id,
      announcementId: createAnnouncementToken(`garment-tags-${kind}`, seq),
    })
    return id
  }

  const announce = (state: 'saving' | 'still-saving', runId: number) =>
    statusBarRef.current.announce(
      state === 'saving' ? t('feedback.saving') : t('feedback.stillSaving'),
      {
        announcementId: createAnnouncementToken(`garment-tags-${state}`, runId),
        urgency: getSaveFeedbackUrgency(state),
      }
    )

  const retireUndo = () => {
    undoEpochRef.current++
    const previous = undoRef.current
    undoRef.current = null
    if (previous) statusBarRef.current.dismissNotice(previous.noticeId)
  }

  const saveTags = (
    actionOwner: string | null,
    target: GarmentTagDraft,
    expected: GarmentTagDraft,
    applies: () => boolean
  ): Promise<GarmentWithColor> => {
    const startToken = onTagSaveStart?.()
    return updateGarmentTagsFromWeb(garment.id, { ...target, expected }).then(
      (updated) => {
        if (applies() && isActiveOwner(actionOwner)) onTagsSaved(updated, startToken)
        return updated
      }
    )
  }

  const runUndo = async (
    actionOwner: string | null,
    previous: GarmentTagDraft,
    savedTags: GarmentTagDraft,
    epoch: number
  ) => {
    if (epoch !== undoEpochRef.current || undoInFlightRef.current) return
    if (!isActiveOwner(actionOwner)) return
    const retry = {
      id: 'retry' as const,
      kind: 'retry' as const,
      label: t('feedback.retry'),
      onPress: () => void runUndo(actionOwner, previous, savedTags, epoch),
    }
    if (!readLiveOnline()) {
      showNotice(actionOwner, 'undo-offline', {
        message: t('feedback.offlineAction'),
        tone: 'offline',
        actions: [retry],
      })
      return
    }
    undoInFlightRef.current = true
    try {
      const doneCommits = doneCommitsRef.current
      await saveTags(
        actionOwner,
        previous,
        savedTags,
        () => doneCommitsRef.current === doneCommits
      )
      // A newer Done retired this Undo while it ran; its notice must not cover that Saved.
      if (epoch !== undoEpochRef.current) return
      retireUndo()
      showNotice(actionOwner, 'undone', {
        message: t('feedback.undone'),
        tone: 'neutral',
      })
    } catch (error) {
      if (epoch !== undoEpochRef.current) return
      const kind = classifyGarmentTagSaveError(error, readLiveOnline())
      // Another device changed the tags: show what is stored now. The rejected Undo stays final.
      if (kind === 'conflict') onRefresh()
      showNotice(actionOwner, `undo-${kind}`, {
        message:
          kind === 'offline'
            ? t('feedback.offlineAction')
            : kind === 'conflict'
              ? t('wardrobe.detail.conflict')
              : t('wardrobe.detail.undoFailed'),
        tone: kind === 'offline' ? 'offline' : 'error',
        actions: kind === 'conflict' ? [] : [retry],
      })
    } finally {
      undoInFlightRef.current = false
    }
  }

  const closeEditor = () => {
    focusEditAfterCloseRef.current = true
    baselineRef.current = null
    rebaseAfterConflictRef.current = false
    setAwaiting(false)
    setDraft(null)
    setFailure(null)
  }

  const openEditor = () => {
    if (!saved) return
    baselineRef.current = saved
    rebaseAfterConflictRef.current = false
    setAwaiting(false)
    setFailure(null)
    setDraft(saved)
  }

  const failSave = (actionOwner: string | null, kind: GarmentTagSaveFailure) => {
    setSaveState('idle')
    setFailure(kind)
    // Another edit landed first: keep the draft open, read the stored tags again and use them
    // as the baseline once they land. The conflict message asks the member to check them.
    if (kind === 'conflict') {
      rebaseAfterConflictRef.current = true
      setAwaiting(true)
      onRefresh()
    }
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
  }

  const handleDone = async () => {
    const baseline = baselineRef.current
    if (!draft || !baseline || saveState !== 'idle' || awaitingReadRef.current) return
    const actionOwner = owner
    if (!isActiveOwner(actionOwner)) return
    retireUndo()
    if (garmentTagsEqual(draft, baseline)) {
      closeEditor()
      showNotice(actionOwner, 'unchanged', {
        message: t('wardrobe.detail.noChanges'),
        tone: 'neutral',
      })
      return
    }
    if (!readLiveOnline()) {
      failSave(actionOwner, 'offline')
      return
    }
    const previous = baseline
    const target = draft
    const runId = nextGarmentTagSeq()
    saveRunRef.current = runId
    const isCurrentRun = () => mountedRef.current && saveRunRef.current === runId
    setSaveState('saving')
    setFailure(null)
    announce('saving', runId)
    clearSlowTimer()
    slowTimerRef.current = setTimeout(() => {
      slowTimerRef.current = null
      if (!isCurrentRun()) return
      setSaveState('still-saving')
      announce('still-saving', runId)
    }, SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs)
    let updated: GarmentWithColor
    try {
      updated = await saveTags(actionOwner, target, previous, () => {
        doneCommitsRef.current++
        return true
      })
    } catch (error) {
      if (!isCurrentRun()) return
      clearSlowTimer()
      if (!isActiveOwner(actionOwner)) return
      failSave(actionOwner, classifyGarmentTagSaveError(error, readLiveOnline()))
      return
    }
    if (isCurrentRun()) {
      clearSlowTimer()
      setSaveState('idle')
      closeEditor()
    }
    const savedTags = garmentTagDraft(updated) ?? target
    const epoch = ++undoEpochRef.current
    const noticeId = showNotice(actionOwner, 'saved', {
      message: t('feedback.saved'),
      tone: 'success',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => void runUndo(actionOwner, previous, savedTags, epoch),
        },
      ],
    })
    undoRef.current = noticeId ? { noticeId, epoch } : null
  }
  handleDoneRef.current = handleDone

  return {
    draft,
    setDraft,
    saveState,
    awaitingRead,
    failure,
    failureMessage,
    editButtonRef,
    canEdit: Boolean(saved),
    editorRef,
    openEditor,
    closeEditor: () => closeEditor(),
    handleDone,
  }
}

type GarmentDeletePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'confirm'; count: number }

let garmentDeleteSeq = 0

/**
 * Story CC-7.6 D2/D3: Delete reads where the piece is used first. Used nowhere: the closet hides
 * it with Undo. Used: one prompt names how many looks (saved looks plus capsules); accepting
 * deletes at once. A failed read deletes nothing and offers Retry; a 404 means it is gone.
 */
function useGarmentDelete({
  garment,
  owner,
  onDelete,
}: {
  garment: ClosetGarment
  owner: string | null
  onDelete?: (garmentId: string, mode: GarmentDeleteMode) => void
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const [phase, setPhase] = useState<GarmentDeletePhase>({ kind: 'idle' })
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const runRef = useRef(0)
  const garmentId = garment.id
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Another garment abandons a read in flight; so does an unmount (`mountedRef`).
  useEffect(() => {
    runRef.current++
    setPhase({ kind: 'idle' })
  }, [garmentId])

  // The prompt opens on Cancel, the safe choice.
  useEffect(() => {
    if (phase.kind === 'confirm') cancelButtonRef.current?.focus()
  }, [phase.kind])

  const isActiveOwner = (actionOwner: string | null) => {
    if (!actionOwner || ownerRef.current !== actionOwner) return false
    const verified = currentWebSessionOwner()
    return verified === null || verified === actionOwner
  }

  const showUsageFailed = (error: unknown) => {
    const online =
      statusBarRef.current.isOnline &&
      (typeof navigator === 'undefined' || navigator.onLine !== false)
    const seq = ++garmentDeleteSeq
    statusBarRef.current.showNotice({
      id: `garment-delete-usage-failed-${seq}`,
      announcementId: createAnnouncementToken('garment-delete-usage-failed', seq),
      message: t('wardrobe.detail.deleteUsageFailed'),
      tone: !online || isOfflineError(error) ? 'offline' : 'error',
      actions: [
        {
          id: 'retry',
          kind: 'retry',
          label: t('feedback.retry'),
          onPress: () => void startDeleteRef.current(),
        },
      ],
    })
  }

  /** A 404 is gone; no looks gets the Undo window; any looks asks first. */
  const settleUsage = (usage: GarmentUsageResponse | null) => {
    if (!onDelete) return
    const count = usage ? usage.savedLookCount + usage.capsuleCount : 0
    if (usage && count > 0) {
      setPhase({ kind: 'confirm', count })
      return
    }
    setPhase({ kind: 'idle' })
    onDelete(garmentId, usage ? 'deferred' : 'gone')
  }

  const startDelete = async () => {
    if (!onDelete || phaseRef.current.kind !== 'idle') return
    const actionOwner = ownerRef.current
    if (!isActiveOwner(actionOwner)) return
    const run = ++runRef.current
    const current = () => run === runRef.current && mountedRef.current
    setPhase({ kind: 'checking' })
    let usage: GarmentUsageResponse | null
    try {
      usage = await getGarmentUsageFromWeb(garmentId)
    } catch (error) {
      if (!current()) return
      setPhase({ kind: 'idle' })
      if (isActiveOwner(actionOwner)) showUsageFailed(error)
      return
    }
    if (current() && isActiveOwner(actionOwner)) settleUsage(usage)
  }
  const startDeleteRef = useRef(startDelete)
  startDeleteRef.current = startDelete

  const cancel = () => {
    setPhase({ kind: 'idle' })
    deleteButtonRef.current?.focus()
  }

  const accept = () => {
    if (phaseRef.current.kind !== 'confirm' || !onDelete) return
    if (!isActiveOwner(ownerRef.current)) return
    setPhase({ kind: 'idle' })
    onDelete(garmentId, 'immediate')
  }

  return {
    phase,
    available: Boolean(onDelete) && garment.status === 'ready',
    deleteButtonRef,
    cancelButtonRef,
    startDelete: () => void startDelete(),
    cancel,
    accept,
  }
}

type GarmentDeleteState = ReturnType<typeof useGarmentDelete>

function GarmentDeleteButton({ deletion }: { deletion: GarmentDeleteState }) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  if (!deletion.available) return null
  return (
    <button
      ref={deletion.deleteButtonRef}
      type="button"
      data-testid="garment-delete"
      aria-busy={deletion.phase.kind === 'checking'}
      // aria-disabled keeps focus on Delete while the usage read runs.
      aria-disabled={deletion.phase.kind !== 'idle'}
      aria-expanded={deletion.phase.kind === 'confirm'}
      aria-controls={
        deletion.phase.kind === 'confirm' ? 'garment-delete-confirm' : undefined
      }
      onClick={deletion.startDelete}
      className="min-h-11 rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700 aria-disabled:opacity-60 dark:border-red-800 dark:text-red-300"
    >
      {t('wardrobe.detail.delete')}
    </button>
  )
}

/** The one prompt for a piece in use: it names how many looks lose it (D2). */
function GarmentDeleteConfirm({ deletion }: { deletion: GarmentDeleteState }) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const { phase } = deletion
  if (phase.kind !== 'confirm') return null
  return (
    <div
      id="garment-delete-confirm"
      data-testid="garment-delete-confirm"
      role="alertdialog"
      aria-labelledby="garment-delete-confirm-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          deletion.cancel()
        }
      }}
      className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/60"
    >
      <p
        id="garment-delete-confirm-title"
        data-testid="garment-delete-confirm-count"
        data-count={phase.count}
        className="text-sm font-semibold text-red-900 dark:text-red-100"
      >
        {t('wardrobe.detail.deleteConfirmTitle', {
          count: phase.count,
        })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="garment-delete-confirm-accept"
          onClick={deletion.accept}
          className="min-h-11 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 dark:bg-red-300 dark:text-red-950"
        >
          {t('wardrobe.detail.deleteConfirmAccept')}
        </button>
        <button
          ref={deletion.cancelButtonRef}
          type="button"
          data-testid="garment-delete-cancel"
          onClick={deletion.cancel}
          className="min-h-11 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {t('wardrobe.detail.deleteCancel')}
        </button>
      </div>
    </div>
  )
}

/**
 * The detail photo. A signed URL within a minute of expiry asks the page for a fresh one; a
 * photo that fails to load shows the placeholder and asks for a fresh URL once per opened
 * garment, so a lasting fault never loops.
 */
function GarmentDetailPhoto({
  garment,
  alt,
  onRefresh,
}: {
  garment: ClosetGarment
  alt: string
  onRefresh: () => void
}) {
  const url = garment.imageAccess?.url ?? null
  const expiresAt = garment.imageAccess?.expiresAt ?? null
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const expiryRefreshedUrlsRef = useRef(new Set<string>())
  const errorRefreshUsedRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    errorRefreshUsedRef.current = false
    setFailedUrl(null)
  }, [garment.id])

  useEffect(() => {
    if (!url || !expiresAt) return
    if (Date.parse(expiresAt) - Date.now() > PHOTO_REFRESH_LEAD_MS) return
    if (expiryRefreshedUrlsRef.current.has(url)) return
    expiryRefreshedUrlsRef.current.add(url)
    onRefreshRef.current()
  }, [url, expiresAt])

  if (!url || failedUrl === url) {
    return (
      <div
        data-testid="garment-detail-photo"
        role="img"
        aria-label={alt}
        className="flex aspect-[3/4] w-full max-w-xs items-center justify-center rounded-lg bg-zinc-100 text-4xl dark:bg-zinc-800"
      >
        <span aria-hidden="true">👗</span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-testid="garment-detail-photo"
      src={url}
      alt={alt}
      onError={() => {
        setFailedUrl(url)
        if (errorRefreshUsedRef.current) return
        errorRefreshUsedRef.current = true
        onRefreshRef.current()
      }}
      className="aspect-[3/4] w-full max-w-xs rounded-lg object-cover"
    />
  )
}

/** A signed photo URL this close to expiry is renewed before it is shown. */
const PHOTO_REFRESH_LEAD_MS = 60_000

function GarmentDetailInner({
  garment,
  owner,
  loadFailed,
  loading,
  onBack,
  onTagSaveStart,
  onTagsSaved,
  onRefresh,
  onStylePiece,
  onDelete,
}: GarmentDetailProps & { garment: ClosetGarment }) {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const locale = i18n.language
  const styleLabels = getStylePieceStrings(locale)
  const samples = getGuestPreviewStrings(locale)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const editor = useGarmentTagEditor({
    garment,
    owner,
    onTagSaveStart,
    onTagsSaved,
    onRefresh,
  })
  const { draft, setDraft, failure, saveState, awaitingRead } = editor
  const deletion = useGarmentDelete({ garment, owner, onDelete })
  const busy = saveState !== 'idle'
  const rereadFailed = awaitingRead && loadFailed && !loading
  const garmentId = garment.id

  // A newly opened garment starts with its heading focused.
  useEffect(() => {
    headingRef.current?.focus()
  }, [garmentId])

  const alt = garmentPhotoAlt(locale, garment)
  const labels = formatGarmentTagLabels(locale, garment)

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
              disabled={busy}
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
        <GarmentDetailPhoto garment={garment} alt={alt} onRefresh={onRefresh} />

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
            <div data-testid="garment-tag-editor" ref={editor.editorRef} className="mt-2">
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
                  {editor.failureMessage(failure)}
                </p>
              )}
              {rereadFailed && (
                <button
                  type="button"
                  data-testid="garment-tag-reread"
                  onClick={onRefresh}
                  className="mt-2 min-h-11 px-2 text-sm font-semibold underline"
                >
                  {t('feedback.retry')}
                </button>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="garment-tag-done"
                  data-primary-action="true"
                  aria-busy={busy}
                  data-save-state={saveState}
                  // aria-disabled keeps keyboard focus on Done while it saves or while the
                  // re-read after a conflict is pending; handleDone ignores those presses.
                  aria-disabled={busy || awaitingRead}
                  onClick={() => void editor.handleDone()}
                  className="min-h-11 min-w-[5.5rem] rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-zinc-800 motion-reduce:transition-none aria-disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {saveState === 'still-saving'
                    ? t('feedback.stillSaving')
                    : saveState === 'saving'
                      ? t('feedback.saving')
                      : t('wardrobe.detail.done')}
                </button>
                <button
                  type="button"
                  data-testid="garment-tag-cancel"
                  disabled={busy}
                  onClick={editor.closeEditor}
                  className="min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100"
                >
                  {t('wardrobe.detail.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  ref={editor.editButtonRef}
                  type="button"
                  data-testid="garment-edit-tags"
                  disabled={!editor.canEdit}
                  onClick={editor.openEditor}
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
                <GarmentDeleteButton deletion={deletion} />
              </div>
              <GarmentDeleteConfirm deletion={deletion} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}
