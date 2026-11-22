'use client'

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  clampStatusBarActions,
  createAnnouncementToken,
  createSaveFeedbackSnapshot,
  createStatusBarNotice,
  getSaveFeedbackUrgency,
  isOfflineError,
  isSaveFeedbackBusy,
  reduceSaveFeedback,
  SAVE_FEEDBACK_TIMINGS,
  type SaveFeedbackState,
  type StatusBarAction,
  type StatusBarNotice,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import {
  StatusFeedbackBar,
  useStatusBar,
  type AnnouncementEntry,
} from './save-feedback-context'

export interface SaveActionLabels {
  idle: string
  saving: string
  stillSaving: string
  saved: string
  failed: string
  retry: string
  undo: string
  view: string
  savedMessage: string
  failedMessage: string
  offlineMessage: string
  undoneMessage: string
}

export interface UseSaveActionOptions {
  onSave: () => unknown
  onUndo?: () => unknown
  onView?: () => void
  requiresNetwork?: boolean
  initialSaved?: boolean
  resetKey?: string | number
  ownerKey?: string | null
  showStatusBar?: boolean
  extraActions?: readonly StatusBarAction[]
  labels?: Partial<SaveActionLabels>
  onAnnounce?: (entry: AnnouncementEntry) => void
}

export function useSaveAction({
  onSave,
  onUndo,
  onView,
  requiresNetwork = false,
  initialSaved = false,
  resetKey,
  ownerKey,
  showStatusBar = true,
  extraActions,
  labels: labelOverrides,
  onAnnounce,
}: UseSaveActionOptions) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const statusBar = useStatusBar()

  const resolvedLabels: SaveActionLabels = {
    idle: labelOverrides?.idle ?? t('feedback.save'),
    saving: labelOverrides?.saving ?? t('feedback.saving'),
    stillSaving: labelOverrides?.stillSaving ?? t('feedback.stillSaving'),
    saved: labelOverrides?.saved ?? t('feedback.saved'),
    failed: labelOverrides?.failed ?? t('feedback.failed'),
    retry: labelOverrides?.retry ?? t('feedback.retry'),
    undo: labelOverrides?.undo ?? t('feedback.undo'),
    view: labelOverrides?.view ?? t('feedback.view'),
    savedMessage: labelOverrides?.savedMessage ?? t('feedback.savedToLooks'),
    failedMessage: labelOverrides?.failedMessage ?? t('feedback.saveFailed'),
    offlineMessage: labelOverrides?.offlineMessage ?? t('feedback.offlineAction'),
    undoneMessage: labelOverrides?.undoneMessage ?? t('feedback.undone'),
  }

  const [snapshot, dispatch] = useReducer(
    reduceSaveFeedback,
    initialSaved ? 'saved' : 'idle',
    createSaveFeedbackSnapshot
  )
  const [standaloneNotice, setStandaloneNotice] = useState<StatusBarNotice | null>(null)
  const [standaloneAnnouncement, setStandaloneAnnouncement] = useState<AnnouncementEntry>(
    {
      id: '',
      message: '',
      urgency: 'polite',
    }
  )

  const runIdRef = useRef(0)
  const mountedRef = useRef(true)
  const stillSavingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const standaloneNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeNoticeIdRef = useRef<string | null>(null)
  const standaloneAnnouncedIdsRef = useRef<Set<string>>(new Set())
  const ownerKeyRef = useRef(ownerKey)
  ownerKeyRef.current = ownerKey
  const resetKeyRef = useRef(resetKey)
  resetKeyRef.current = resetKey
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const prevResetPairRef = useRef<{
    resetKey: string | number | undefined
    ownerKey: string | null | undefined
  }>({
    resetKey,
    ownerKey,
  })
  const stateRef = useRef<SaveFeedbackState>(snapshot.state)
  stateRef.current = snapshot.state
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onUndoRef = useRef(onUndo)
  onUndoRef.current = onUndo
  const onViewRef = useRef(onView)
  onViewRef.current = onView
  const extraActionsRef = useRef(extraActions)
  extraActionsRef.current = extraActions
  const labelsRef = useRef(resolvedLabels)
  labelsRef.current = resolvedLabels
  const onAnnounceRef = useRef(onAnnounce)
  onAnnounceRef.current = onAnnounce

  const clearStillSavingTimer = useCallback(() => {
    if (stillSavingTimerRef.current !== null) {
      clearTimeout(stillSavingTimerRef.current)
      stillSavingTimerRef.current = null
    }
  }, [])

  const clearStandaloneNoticeTimer = useCallback(() => {
    if (standaloneNoticeTimerRef.current !== null) {
      clearTimeout(standaloneNoticeTimerRef.current)
      standaloneNoticeTimerRef.current = null
    }
  }, [])

  const dismissActiveNotice = useCallback(() => {
    const activeId = activeNoticeIdRef.current
    if (!activeId) return
    activeNoticeIdRef.current = null
    if (statusBarRef.current.hasProvider) {
      statusBarRef.current.dismissNotice(activeId)
    } else {
      clearStandaloneNoticeTimer()
      setStandaloneNotice((current) => (current?.id === activeId ? null : current))
    }
  }, [clearStandaloneNoticeTimer])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearStillSavingTimer()
      clearStandaloneNoticeTimer()
      dismissActiveNotice()
    }
  }, [clearStandaloneNoticeTimer, clearStillSavingTimer, dismissActiveNotice])

  useEffect(() => {
    const prev = prevResetPairRef.current
    if (prev.resetKey === resetKey && prev.ownerKey === ownerKey) {
      return
    }
    prevResetPairRef.current = { resetKey, ownerKey }
    resetKeyRef.current = resetKey
    clearStillSavingTimer()
    dismissActiveNotice()
    runIdRef.current += 1
    dispatch({ type: 'reset', nextState: initialSaved ? 'saved' : 'idle' })
  }, [clearStillSavingTimer, dismissActiveNotice, initialSaved, ownerKey, resetKey])

  // Clear offline button state automatically once connectivity returns.
  useEffect(() => {
    if (statusBar.isOnline && stateRef.current === 'offline') {
      runIdRef.current += 1
      dispatch({ type: 'reset', nextState: initialSaved ? 'saved' : 'idle' })
    }
  }, [initialSaved, snapshot.state, statusBar.isOnline])

  const emitAnnouncement = useCallback(
    (
      message: string,
      options: { announcementId: string; urgency?: 'polite' | 'assertive' }
    ) => {
      const trimmed = message.trim()
      if (!trimmed) return
      if (statusBar.hasProvider) {
        statusBar.announce(trimmed, options)
        return
      }
      if (standaloneAnnouncedIdsRef.current.has(options.announcementId)) return
      if (standaloneAnnouncedIdsRef.current.size > 200) {
        standaloneAnnouncedIdsRef.current.clear()
      }
      standaloneAnnouncedIdsRef.current.add(options.announcementId)
      const entry: AnnouncementEntry = {
        id: options.announcementId,
        message: trimmed,
        urgency: options.urgency ?? 'polite',
      }
      setStandaloneAnnouncement(entry)
      onAnnounceRef.current?.(entry)
    },
    [statusBar]
  )

  const dismissStandaloneNotice = useCallback(
    (noticeId?: string) => {
      setStandaloneNotice((current) => {
        if (!current) return null
        if (noticeId !== undefined && current.id !== noticeId) return current
        clearStandaloneNoticeTimer()
        return null
      })
    },
    [clearStandaloneNoticeTimer]
  )

  const presentNotice = useCallback(
    (input: Parameters<typeof createStatusBarNotice>[0]) => {
      if (!showStatusBar) {
        const normalized = createStatusBarNotice(input)
        emitAnnouncement(normalized.message, {
          announcementId: normalized.announcementId,
          urgency: normalized.urgency,
        })
        return
      }
      if (statusBar.hasProvider) {
        const shown = statusBar.showNotice(input)
        activeNoticeIdRef.current = shown.id
        return
      }
      const normalized = createStatusBarNotice(input)
      activeNoticeIdRef.current = normalized.id
      clearStandaloneNoticeTimer()
      setStandaloneNotice(normalized)
      standaloneNoticeTimerRef.current = setTimeout(() => {
        setStandaloneNotice((current) => (current?.id === normalized.id ? null : current))
        if (activeNoticeIdRef.current === normalized.id) {
          activeNoticeIdRef.current = null
        }
        standaloneNoticeTimerRef.current = null
      }, normalized.durationMs)
      emitAnnouncement(normalized.message, {
        announcementId: normalized.announcementId,
        urgency: normalized.urgency,
      })
    },
    [clearStandaloneNoticeTimer, emitAnnouncement, showStatusBar, statusBar]
  )

  const triggerUndo = useCallback(
    async (origin?: {
      ownerKey: string | null | undefined
      resetKey: string | number | undefined
    }) => {
      if (!mountedRef.current) return false
      if (
        origin &&
        (ownerKeyRef.current !== origin.ownerKey ||
          resetKeyRef.current !== origin.resetKey)
      ) {
        return false
      }
      const undoHandler = onUndoRef.current
      if (!undoHandler) return false
      const startOwner = ownerKeyRef.current
      const startReset = resetKeyRef.current
      try {
        const result = await undoHandler()
        if (
          !mountedRef.current ||
          ownerKeyRef.current !== startOwner ||
          resetKeyRef.current !== startReset
        ) {
          return false
        }
        if (result === false) {
          const failRunId = ++runIdRef.current
          presentNotice({
            id: `undo-failed-${failRunId}`,
            announcementId: createAnnouncementToken('undo-failed', failRunId),
            message: labelsRef.current.failedMessage,
            tone: 'error',
          })
          return false
        }
        const undoRunId = ++runIdRef.current
        dispatch({ type: 'undo', runId: undoRunId })
        presentNotice({
          id: `undo-${undoRunId}`,
          announcementId: createAnnouncementToken('undo', undoRunId),
          message: labelsRef.current.undoneMessage,
          tone: 'neutral',
          actions: [],
        })
        return true
      } catch {
        if (!mountedRef.current || ownerKeyRef.current !== startOwner) return false
        const failRunId = ++runIdRef.current
        presentNotice({
          id: `undo-failed-${failRunId}`,
          announcementId: createAnnouncementToken('undo-failed', failRunId),
          message: labelsRef.current.failedMessage,
          tone: 'error',
        })
        return false
      }
    },
    [presentNotice]
  )

  const triggerSave = useCallback(
    (origin?: {
      ownerKey: string | null | undefined
      resetKey: string | number | undefined
    }): Promise<boolean> => {
      if (!mountedRef.current) {
        return Promise.resolve(false)
      }
      if (
        origin &&
        (ownerKeyRef.current !== origin.ownerKey ||
          resetKeyRef.current !== origin.resetKey)
      ) {
        return Promise.resolve(false)
      }
      if (isSaveFeedbackBusy(stateRef.current)) {
        return Promise.resolve(false)
      }

      if (requiresNetwork && !statusBar.isOnline) {
        const offlineRunId = ++runIdRef.current
        dispatch({ type: 'offline', runId: offlineRunId })
        presentNotice({
          id: `save-offline-${offlineRunId}`,
          announcementId: createAnnouncementToken('offline', offlineRunId),
          message: labelsRef.current.offlineMessage,
          tone: 'offline',
          actions: [],
        })
        return Promise.resolve(false)
      }

      const runId = ++runIdRef.current
      const startOwner = ownerKeyRef.current
      const startReset = resetKeyRef.current
      clearStillSavingTimer()
      stateRef.current = 'saving'
      dispatch({ type: 'start', runId })
      emitAnnouncement(labelsRef.current.saving, {
        announcementId: createAnnouncementToken('saving', runId),
        urgency: getSaveFeedbackUrgency('saving'),
      })

      const isStale = () =>
        !mountedRef.current ||
        runIdRef.current !== runId ||
        ownerKeyRef.current !== startOwner ||
        resetKeyRef.current !== startReset

      stillSavingTimerRef.current = setTimeout(() => {
        if (isStale()) return
        dispatch({ type: 'slow', runId })
        emitAnnouncement(labelsRef.current.stillSaving, {
          announcementId: createAnnouncementToken('still-saving', runId),
          urgency: getSaveFeedbackUrgency('still-saving'),
        })
      }, SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs)

      const settleSuccess = () => {
        clearStillSavingTimer()
        if (isStale()) return false
        dispatch({ type: 'succeed', runId })
        const actions: StatusBarAction[] = []
        if (onViewRef.current) {
          actions.push({
            id: 'view',
            kind: 'view',
            label: labelsRef.current.view,
            onPress: () => {
              if (
                !mountedRef.current ||
                ownerKeyRef.current !== startOwner ||
                resetKeyRef.current !== startReset
              ) {
                return
              }
              onViewRef.current?.()
            },
          })
        }
        if (onUndoRef.current) {
          actions.push({
            id: 'undo',
            kind: 'undo',
            label: labelsRef.current.undo,
            onPress: () =>
              void triggerUndo({ ownerKey: startOwner, resetKey: startReset }),
          })
        }
        if (extraActionsRef.current?.length) {
          actions.push(...extraActionsRef.current)
        }
        presentNotice({
          id: `save-success-${runId}`,
          announcementId: createAnnouncementToken('saved', runId),
          message: labelsRef.current.savedMessage,
          tone: 'success',
          actions: clampStatusBarActions(actions),
        })
        return true
      }

      const settleFailure = (error?: unknown) => {
        clearStillSavingTimer()
        if (isStale()) return false
        if (requiresNetwork && (isOfflineError(error) || !statusBar.isOnline)) {
          const offlineRunId = ++runIdRef.current
          dispatch({ type: 'offline', runId: offlineRunId })
          presentNotice({
            id: `save-offline-${offlineRunId}`,
            announcementId: createAnnouncementToken('offline', offlineRunId),
            message: labelsRef.current.offlineMessage,
            tone: 'offline',
            actions: [],
          })
          return false
        }
        dispatch({
          type: 'fail',
          runId,
          errorMessage: labelsRef.current.failedMessage,
        })
        presentNotice({
          id: `save-failed-${runId}`,
          announcementId: createAnnouncementToken('failed', runId),
          message: labelsRef.current.failedMessage,
          tone: 'error',
          actions: [
            {
              id: 'retry',
              kind: 'retry',
              label: labelsRef.current.retry,
              onPress: () => {
                void triggerSave({ ownerKey: startOwner, resetKey: startReset })
              },
            },
          ],
        })
        return false
      }

      // Invoke onSave synchronously so synchronous localStorage writes complete within the
      // click turn, while still awaiting async promises before entering the saved state.
      let outcome: unknown
      try {
        outcome = onSaveRef.current()
      } catch (error) {
        return Promise.resolve(settleFailure(error))
      }

      if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
        return (outcome as Promise<unknown>).then(
          (value) => (value === false ? settleFailure() : settleSuccess()),
          (error: unknown) => settleFailure(error)
        )
      }

      return Promise.resolve(outcome === false ? settleFailure() : settleSuccess())
    },
    [
      clearStillSavingTimer,
      emitAnnouncement,
      presentNotice,
      requiresNetwork,
      statusBar.isOnline,
      triggerUndo,
    ]
  )

  const reset = useCallback(
    (nextState: 'idle' | 'saved' = 'idle') => {
      clearStillSavingTimer()
      runIdRef.current += 1
      dispatch({ type: 'reset', nextState })
    },
    [clearStillSavingTimer]
  )

  return {
    state: snapshot.state,
    snapshot,
    labels: resolvedLabels,
    isOnline: statusBar.isOnline,
    hasProvider: statusBar.hasProvider,
    triggerSave,
    triggerUndo,
    reset,
    standaloneNotice,
    dismissStandaloneNotice,
    standaloneAnnouncement,
  }
}

const STATE_BUTTON_STYLES: Record<SaveFeedbackState, string> = {
  idle: 'border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
  offline:
    'border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
  saving:
    'border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100',
  'still-saving':
    'border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100',
  saved:
    'border-emerald-700 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-100',
  failed:
    'border-red-700 bg-red-50 text-red-900 dark:border-red-400 dark:bg-red-950 dark:text-red-100',
}

export interface SaveActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>,
    UseSaveActionOptions {
  idleLabel?: string
  barPlacement?: 'floating' | 'inline'
}

export function SaveActionButton({
  onSave,
  onUndo,
  onView,
  requiresNetwork = false,
  initialSaved = false,
  resetKey,
  ownerKey,
  showStatusBar = true,
  extraActions,
  labels,
  idleLabel,
  onAnnounce,
  barPlacement = 'floating',
  className = '',
  disabled,
  ...buttonProps
}: SaveActionButtonProps) {
  const mergedLabels = idleLabel ? { ...labels, idle: idleLabel } : labels
  const controller = useSaveAction({
    onSave,
    onUndo,
    onView,
    requiresNetwork,
    initialSaved,
    resetKey,
    ownerKey,
    showStatusBar,
    extraActions,
    labels: mergedLabels,
    onAnnounce,
  })

  const busy = isSaveFeedbackBusy(controller.state)
  const label = (() => {
    switch (controller.state) {
      case 'saving':
        return controller.labels.saving
      case 'still-saving':
        return controller.labels.stillSaving
      case 'saved':
        return controller.labels.saved
      case 'failed':
        return controller.labels.failed
      case 'offline':
      case 'idle':
        return controller.labels.idle
    }
  })()

  return (
    <>
      <button
        type="button"
        {...buttonProps}
        disabled={disabled}
        aria-busy={busy || undefined}
        aria-disabled={disabled || busy || undefined}
        data-save-state={controller.state}
        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600 disabled:opacity-60 ${STATE_BUTTON_STYLES[controller.state]} ${className}`.trim()}
        onClick={() => {
          if (disabled || busy) return
          void controller.triggerSave()
        }}
      >
        {busy && (
          <svg
            aria-hidden="true"
            data-testid="save-action-spinner"
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
            fill="none"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="2"
            />
            <path
              d="M14 8a6 6 0 0 0-6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
        {controller.state === 'saved' && (
          <svg
            aria-hidden="true"
            data-testid="save-action-check-icon"
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0"
            fill="none"
          >
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {controller.state === 'failed' && (
          <svg
            aria-hidden="true"
            data-testid="save-action-failed-icon"
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0"
            fill="none"
          >
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 4.75v4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
            <circle cx="8" cy="11.25" r="0.9" fill="currentColor" />
          </svg>
        )}
        <span>{label}</span>
      </button>
      {!controller.hasProvider && (
        <>
          <StatusFeedbackBar
            notice={controller.standaloneNotice}
            onDismiss={controller.dismissStandaloneNotice}
            placement={barPlacement}
          />
          <div
            data-testid="save-feedback-announcer"
            aria-live={controller.standaloneAnnouncement.urgency}
            aria-atomic="true"
            className="sr-only"
          >
            {controller.standaloneAnnouncement.message ? (
              <span key={controller.standaloneAnnouncement.id}>
                {controller.standaloneAnnouncement.message}
              </span>
            ) : null}
          </div>
        </>
      )}
    </>
  )
}
