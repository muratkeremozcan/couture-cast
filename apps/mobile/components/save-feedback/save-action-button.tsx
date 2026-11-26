import { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Svg, { Path } from 'react-native-svg'
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
import { useHeroPalette } from '@/components/hero/hero-theme'
import { useSchemeColors } from '@/components/themed'
import {
  checkNetworkOnlineForAction,
  getNetworkOnline,
  hasReliableBrowserOnline,
  readBrowserOnline,
  reportNetworkOffline,
  reportNetworkOnline,
} from './network-status'
import {
  dispatchMobileAnnouncement,
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
  const controlId = useId()
  const { t } = useTranslation()
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
  const probeAttemptRef = useRef<number | null>(null)
  const probeSeqRef = useRef(0)
  const activeTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const standaloneNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeNoticeIdRef = useRef<string | null>(null)
  const standaloneAnnouncedIdsRef = useRef<Set<string>>(new Set())
  const ownerKeyRef = useRef(ownerKey)
  ownerKeyRef.current = ownerKey
  const resetKeyRef = useRef(resetKey)
  resetKeyRef.current = resetKey
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const isOnlineRef = useRef(statusBar.isOnline)
  isOnlineRef.current = statusBar.isOnline
  const prevResetPairRef = useRef<{
    resetKey: string | number | undefined
    ownerKey: string | null | undefined
  }>({ resetKey, ownerKey })
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

  const clearAllSlowTimers = useCallback(() => {
    for (const timer of activeTimersRef.current) {
      clearTimeout(timer)
    }
    activeTimersRef.current.clear()
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

  const readLiveOnline = useCallback(() => isOnlineRef.current && getNetworkOnline(), [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      probeAttemptRef.current = null
      clearAllSlowTimers()
      clearStandaloneNoticeTimer()
      dismissActiveNotice()
    }
  }, [clearAllSlowTimers, clearStandaloneNoticeTimer, dismissActiveNotice])

  useEffect(() => {
    const prev = prevResetPairRef.current
    if (prev.resetKey === resetKey && prev.ownerKey === ownerKey) {
      return
    }
    prevResetPairRef.current = { resetKey, ownerKey }
    resetKeyRef.current = resetKey
    probeAttemptRef.current = null
    clearAllSlowTimers()
    dismissActiveNotice()
    runIdRef.current += 1
    const nextState = initialSaved ? 'saved' : 'idle'
    stateRef.current = nextState
    dispatch({ type: 'reset', nextState })
  }, [clearAllSlowTimers, dismissActiveNotice, initialSaved, ownerKey, resetKey])

  useEffect(() => {
    if (statusBar.isOnline && stateRef.current === 'offline') {
      runIdRef.current += 1
      const nextState = initialSaved ? 'saved' : 'idle'
      stateRef.current = nextState
      dispatch({ type: 'reset', nextState })
    }
  }, [initialSaved, snapshot.state, statusBar.isOnline])

  const emitAnnouncement = useCallback(
    (
      message: string,
      options: { announcementId: string; urgency?: 'polite' | 'assertive' }
    ) => {
      const trimmed = message.trim()
      if (!trimmed) return
      if (statusBarRef.current.hasProvider) {
        statusBarRef.current.announce(trimmed, options)
        return
      }
      if (standaloneAnnouncedIdsRef.current.has(options.announcementId)) return
      if (standaloneAnnouncedIdsRef.current.size > 200) {
        standaloneAnnouncedIdsRef.current.clear()
      }
      standaloneAnnouncedIdsRef.current.add(options.announcementId)
      const urgency = options.urgency ?? 'polite'
      const entry: AnnouncementEntry = {
        id: options.announcementId,
        message: trimmed,
        urgency,
      }
      setStandaloneAnnouncement(entry)
      dispatchMobileAnnouncement(trimmed, urgency)
      onAnnounceRef.current?.(entry)
    },
    []
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
      if (statusBarRef.current.hasProvider) {
        const shown = statusBarRef.current.showNotice(input)
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
    [clearStandaloneNoticeTimer, emitAnnouncement, showStatusBar]
  )

  const showOfflineNotice = useCallback(
    (prefix: 'save' | 'undo', id: number) => {
      presentNotice({
        id: `${prefix}-offline-${controlId}-${id}`,
        announcementId: createAnnouncementToken(`${controlId}:offline`, id),
        message: labelsRef.current.offlineMessage,
        tone: 'offline',
        actions: [],
      })
    },
    [controlId, presentNotice]
  )

  const reportUndoFailure = useCallback(
    (undoRunId: number) => {
      presentNotice({
        id: `undo-failed-${controlId}-${undoRunId}`,
        announcementId: createAnnouncementToken(`${controlId}:undo-failed`, undoRunId),
        message: labelsRef.current.failedMessage,
        tone: 'error',
      })
    },
    [controlId, presentNotice]
  )

  const matchesOrigin = useCallback(
    (origin?: {
      ownerKey: string | null | undefined
      resetKey: string | number | undefined
      expectedRunId?: number
    }): boolean => {
      if (!origin) return true
      return (
        ownerKeyRef.current === origin.ownerKey &&
        resetKeyRef.current === origin.resetKey &&
        (origin.expectedRunId === undefined || runIdRef.current === origin.expectedRunId)
      )
    },
    []
  )

  const canRunUndo = useCallback(
    (
      startOwner: string | null | undefined,
      startReset: string | number | undefined,
      expectedRunId: number
    ) =>
      mountedRef.current &&
      ownerKeyRef.current === startOwner &&
      resetKeyRef.current === startReset &&
      runIdRef.current === expectedRunId &&
      !isSaveFeedbackBusy(stateRef.current) &&
      probeAttemptRef.current === null,
    []
  )

  const ensureOnlineForUndo = useCallback(
    async (
      startOwner: string | null | undefined,
      startReset: string | number | undefined,
      preProbeRunId: number
    ): Promise<boolean> => {
      if (!requiresNetwork || readLiveOnline()) return true
      const reachable = hasReliableBrowserOnline()
        ? readBrowserOnline()
        : await checkNetworkOnlineForAction()
      if (!canRunUndo(startOwner, startReset, preProbeRunId)) return false
      if (!reachable) {
        showOfflineNotice('undo', ++runIdRef.current)
        return false
      }
      return true
    },
    [canRunUndo, readLiveOnline, requiresNetwork, showOfflineNotice]
  )

  const triggerUndo = useCallback(
    async (origin?: {
      ownerKey: string | null | undefined
      resetKey: string | number | undefined
      expectedRunId?: number
    }) => {
      const startOwner = ownerKeyRef.current
      const startReset = resetKeyRef.current
      const preProbeRunId = runIdRef.current
      if (!canRunUndo(startOwner, startReset, preProbeRunId) || !matchesOrigin(origin)) {
        return false
      }

      // Capture the original operation and identity before any async connectivity probe.
      const undoHandler = onUndoRef.current
      if (!undoHandler) return false
      if (!(await ensureOnlineForUndo(startOwner, startReset, preProbeRunId))) {
        return false
      }

      const undoRunId = ++runIdRef.current
      const stillCurrent = () =>
        mountedRef.current &&
        runIdRef.current === undoRunId &&
        ownerKeyRef.current === startOwner &&
        resetKeyRef.current === startReset

      try {
        const result = await undoHandler()
        if (!stillCurrent()) return false
        if (result === false) {
          reportUndoFailure(undoRunId)
          return false
        }
        stateRef.current = 'idle'
        dispatch({ type: 'undo', runId: undoRunId })
        presentNotice({
          id: `undo-${controlId}-${undoRunId}`,
          announcementId: createAnnouncementToken(`${controlId}:undo`, undoRunId),
          message: labelsRef.current.undoneMessage,
          tone: 'neutral',
          actions: [],
        })
        return true
      } catch (error) {
        if (!stillCurrent()) return false
        if (requiresNetwork && (isOfflineError(error) || !readLiveOnline())) {
          reportNetworkOffline()
          showOfflineNotice('undo', undoRunId)
          return false
        }
        reportUndoFailure(undoRunId)
        return false
      }
    },
    [
      canRunUndo,
      controlId,
      ensureOnlineForUndo,
      matchesOrigin,
      presentNotice,
      readLiveOnline,
      reportUndoFailure,
      requiresNetwork,
      showOfflineNotice,
    ]
  )

  const executeSave = useCallback(
    (startOwner: string | null | undefined, startReset: string | number | undefined) => {
      const runId = ++runIdRef.current
      stateRef.current = 'saving'
      dispatch({ type: 'start', runId })
      emitAnnouncement(labelsRef.current.saving, {
        announcementId: createAnnouncementToken(`${controlId}:saving`, runId),
        urgency: getSaveFeedbackUrgency('saving'),
      })

      const isStale = () =>
        !mountedRef.current ||
        runIdRef.current !== runId ||
        ownerKeyRef.current !== startOwner ||
        resetKeyRef.current !== startReset

      let runTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        if (runTimer !== null) {
          activeTimersRef.current.delete(runTimer)
          runTimer = null
        }
        if (isStale()) return
        stateRef.current = 'still-saving'
        dispatch({ type: 'slow', runId })
        emitAnnouncement(labelsRef.current.stillSaving, {
          announcementId: createAnnouncementToken(`${controlId}:still-saving`, runId),
          urgency: getSaveFeedbackUrgency('still-saving'),
        })
      }, SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs)
      activeTimersRef.current.add(runTimer)

      const clearRunTimer = () => {
        if (runTimer !== null) {
          clearTimeout(runTimer)
          activeTimersRef.current.delete(runTimer)
          runTimer = null
        }
      }

      const settleSuccess = (allowUndo = true) => {
        clearRunTimer()
        if (isStale()) return false
        if (requiresNetwork) {
          reportNetworkOnline()
        }
        stateRef.current = 'saved'
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
        if (allowUndo && onUndoRef.current) {
          actions.push({
            id: 'undo',
            kind: 'undo',
            label: labelsRef.current.undo,
            onPress: () =>
              void triggerUndo({
                ownerKey: startOwner,
                resetKey: startReset,
                expectedRunId: runId,
              }),
          })
        }
        if (extraActionsRef.current?.length) {
          actions.push(...extraActionsRef.current)
        }
        presentNotice({
          id: `save-success-${controlId}-${runId}`,
          announcementId: createAnnouncementToken(`${controlId}:saved`, runId),
          message: labelsRef.current.savedMessage,
          tone: 'success',
          actions: clampStatusBarActions(actions),
        })
        return true
      }

      const settleFailure = (error?: unknown) => {
        clearRunTimer()
        if (isStale()) return false
        if (requiresNetwork && (isOfflineError(error) || !readLiveOnline())) {
          reportNetworkOffline()
          const offlineRunId = ++runIdRef.current
          stateRef.current = 'offline'
          dispatch({ type: 'offline', runId: offlineRunId })
          presentNotice({
            id: `save-offline-${controlId}-${offlineRunId}`,
            announcementId: createAnnouncementToken(`${controlId}:offline`, offlineRunId),
            message: labelsRef.current.offlineMessage,
            tone: 'offline',
            actions: [],
          })
          return false
        }
        stateRef.current = 'failed'
        dispatch({
          type: 'fail',
          runId,
          errorMessage: labelsRef.current.failedMessage,
        })
        presentNotice({
          id: `save-failed-${controlId}-${runId}`,
          announcementId: createAnnouncementToken(`${controlId}:failed`, runId),
          message: labelsRef.current.failedMessage,
          tone: 'error',
          actions: [
            {
              id: 'retry',
              kind: 'retry',
              label: labelsRef.current.retry,
              onPress: () => {
                void triggerSaveRef.current({
                  ownerKey: startOwner,
                  resetKey: startReset,
                })
              },
            },
          ],
        })
        return false
      }

      let outcome: unknown
      try {
        outcome = onSaveRef.current()
      } catch (error) {
        return Promise.resolve(settleFailure(error))
      }

      const resolveSaveValue = (value: unknown) => {
        if (value === false) return settleFailure()
        if (
          value &&
          typeof value === 'object' &&
          'saved' in value &&
          (value as { saved?: unknown }).saved === false
        ) {
          return settleFailure()
        }
        const allowUndo = !(
          value &&
          typeof value === 'object' &&
          'undoable' in value &&
          (value as { undoable?: unknown }).undoable === false
        )
        return settleSuccess(allowUndo)
      }

      if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
        return (outcome as Promise<unknown>).then(
          (value) => resolveSaveValue(value),
          (error: unknown) => settleFailure(error)
        )
      }

      return Promise.resolve(resolveSaveValue(outcome))
    },
    [
      controlId,
      emitAnnouncement,
      presentNotice,
      readLiveOnline,
      requiresNetwork,
      triggerUndo,
    ]
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
      if (isSaveFeedbackBusy(stateRef.current) || probeAttemptRef.current !== null) {
        return Promise.resolve(false)
      }

      dismissActiveNotice()
      const startOwner = ownerKeyRef.current
      const startReset = resetKeyRef.current

      if (requiresNetwork && !readLiveOnline()) {
        if (hasReliableBrowserOnline()) {
          if (!readBrowserOnline()) {
            const offlineRunId = ++runIdRef.current
            stateRef.current = 'offline'
            dispatch({ type: 'offline', runId: offlineRunId })
            presentNotice({
              id: `save-offline-${controlId}-${offlineRunId}`,
              announcementId: createAnnouncementToken(
                `${controlId}:offline`,
                offlineRunId
              ),
              message: labelsRef.current.offlineMessage,
              tone: 'offline',
              actions: [],
            })
            return Promise.resolve(false)
          }
          return executeSave(startOwner, startReset)
        }
        const attemptId = ++probeSeqRef.current
        probeAttemptRef.current = attemptId
        return checkNetworkOnlineForAction().then(
          (reachable) => {
            if (probeAttemptRef.current !== attemptId) {
              return false
            }
            probeAttemptRef.current = null
            if (
              !mountedRef.current ||
              ownerKeyRef.current !== startOwner ||
              resetKeyRef.current !== startReset ||
              isSaveFeedbackBusy(stateRef.current)
            ) {
              return false
            }
            if (!reachable) {
              const offlineRunId = ++runIdRef.current
              stateRef.current = 'offline'
              dispatch({ type: 'offline', runId: offlineRunId })
              presentNotice({
                id: `save-offline-${controlId}-${offlineRunId}`,
                announcementId: createAnnouncementToken(
                  `${controlId}:offline`,
                  offlineRunId
                ),
                message: labelsRef.current.offlineMessage,
                tone: 'offline',
                actions: [],
              })
              return false
            }
            return executeSave(startOwner, startReset)
          },
          () => {
            if (probeAttemptRef.current === attemptId) {
              probeAttemptRef.current = null
            }
            return false
          }
        )
      }

      return executeSave(startOwner, startReset)
    },
    [
      controlId,
      dismissActiveNotice,
      executeSave,
      presentNotice,
      readLiveOnline,
      requiresNetwork,
    ]
  )

  const triggerSaveRef = useRef(triggerSave)
  triggerSaveRef.current = triggerSave

  const reset = useCallback(
    (nextState: 'idle' | 'saved' = 'idle') => {
      probeAttemptRef.current = null
      clearAllSlowTimers()
      runIdRef.current += 1
      stateRef.current = nextState
      dispatch({ type: 'reset', nextState })
    },
    [clearAllSlowTimers]
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

export interface SaveActionButtonProps extends UseSaveActionOptions {
  testID?: string
  idleLabel?: string
  disabled?: boolean
  accessibilityLabel?: string
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
  testID,
  disabled = false,
  accessibilityLabel,
  barPlacement = 'floating',
}: SaveActionButtonProps) {
  const palette = useHeroPalette()
  const colors = useSchemeColors()
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

  const visual = (() => {
    switch (controller.state) {
      case 'saved':
        return {
          backgroundColor: colors.card,
          borderColor: colors.successInk,
          textColor: colors.successInk,
        }
      case 'failed':
        return {
          backgroundColor: colors.dangerSurface,
          borderColor: colors.dangerLine,
          textColor: colors.dangerInk,
        }
      case 'saving':
      case 'still-saving':
        return {
          backgroundColor: colors.card,
          borderColor: colors.lineStrong,
          textColor: palette.ink,
        }
      case 'offline':
      case 'idle':
        return {
          backgroundColor: palette.page,
          borderColor: palette.line,
          textColor: palette.ink,
        }
    }
  })()

  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled}
        style={[
          styles.button,
          {
            backgroundColor: visual.backgroundColor,
            borderColor: visual.borderColor,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={() => {
          if (disabled) return
          void controller.triggerSave()
        }}
      >
        {busy && (
          <ActivityIndicator
            testID="save-action-spinner"
            size="small"
            color={visual.textColor}
          />
        )}
        {controller.state === 'saved' && (
          <Svg
            testID="save-action-check-icon"
            width={16}
            height={16}
            viewBox="0 0 16 16"
            accessible={false}
          >
            <Path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              fill="none"
              stroke={visual.textColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        )}
        {controller.state === 'failed' && (
          <Svg
            testID="save-action-failed-icon"
            width={16}
            height={16}
            viewBox="0 0 16 16"
            accessible={false}
          >
            <Path
              d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 3.25v4m0 2.5h.01"
              fill="none"
              stroke={visual.textColor}
              strokeWidth={1.75}
              strokeLinecap="round"
            />
          </Svg>
        )}
        <Text style={[styles.buttonText, { color: visual.textColor }]}>{label}</Text>
      </Pressable>
      {!controller.hasProvider && (
        <>
          <StatusFeedbackBar
            notice={controller.standaloneNotice}
            onDismiss={controller.dismissStandaloneNotice}
            placement={barPlacement}
          />
          {Platform.OS === 'web' && (
            <Text
              testID="save-feedback-announcer"
              accessibilityLiveRegion={controller.standaloneAnnouncement.urgency}
              style={styles.visuallyHidden}
            >
              {controller.standaloneAnnouncement.message ? (
                <Text key={controller.standaloneAnnouncement.id}>
                  {controller.standaloneAnnouncement.message}
                </Text>
              ) : null}
            </Text>
          )}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
})
