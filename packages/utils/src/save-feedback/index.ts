export type SaveFeedbackState =
  | 'idle'
  | 'saving'
  | 'still-saving'
  | 'saved'
  | 'failed'
  | 'offline'

export type StatusBarTone = 'neutral' | 'success' | 'error' | 'offline'

export type StatusBarActionKind = 'view' | 'undo' | 'retry'

export const SAVE_FEEDBACK_TIMINGS = {
  /** Maximum latency before entering visible saving state after tap. */
  savingResponseMs: 100,
  /** Delay before promoting an uncommitted save to "Still saving". */
  stillSavingAfterMs: 1_000,
  /** Auto-dismiss window for the bottom status bar. */
  statusBarDurationMs: 5_000,
  /** Upper bound for feedback transitions when motion is enabled. */
  maxTransitionMs: 200,
} as const

export const MAX_STATUS_BAR_ACTIONS = 2
export const DEFAULT_MAX_LOOK_UNDO_DEPTH = 10
export const DEFAULT_MAX_SAVED_ENTRIES = 8

export interface StatusBarAction {
  id: string
  kind?: StatusBarActionKind
  label: string
  onPress: () => void | Promise<void>
}

export interface StatusBarNotice {
  id: string
  announcementId: string
  message: string
  tone: StatusBarTone
  urgency: 'polite' | 'assertive'
  actions: readonly StatusBarAction[]
  durationMs: number
}

export interface StatusBarNoticeInput {
  id: string
  announcementId?: string
  message: string
  tone?: StatusBarTone
  urgency?: 'polite' | 'assertive'
  actions?: readonly StatusBarAction[]
  durationMs?: number
}

export interface SaveFeedbackSnapshot {
  state: SaveFeedbackState
  runId: number
  announcementId: string | null
  errorMessage: string | null
}

export type SaveFeedbackEvent =
  | { type: 'start'; runId: number }
  | { type: 'slow'; runId: number }
  | { type: 'succeed'; runId: number }
  | { type: 'fail'; runId: number; errorMessage?: string | null }
  | { type: 'offline'; runId: number }
  | { type: 'undo'; runId: number }
  | { type: 'reset'; nextState?: 'idle' | 'saved' }

export function createSaveFeedbackSnapshot(
  initialState: 'idle' | 'saved' = 'idle'
): SaveFeedbackSnapshot {
  return {
    state: initialState,
    runId: 0,
    announcementId: null,
    errorMessage: null,
  }
}

export function createAnnouncementToken(kind: string, sequence: number | string): string {
  return `${kind}:${sequence}`
}

export function clampStatusBarActions<T>(
  actions: readonly T[],
  max: number = MAX_STATUS_BAR_ACTIONS
): T[] {
  if (max <= 0) return []
  return actions.slice(0, max)
}

export function isSaveFeedbackBusy(state: SaveFeedbackState): boolean {
  return state === 'saving' || state === 'still-saving'
}

export function getSaveFeedbackUrgency(
  stateOrTone: SaveFeedbackState | StatusBarTone
): 'polite' | 'assertive' {
  return stateOrTone === 'failed' || stateOrTone === 'error' || stateOrTone === 'offline'
    ? 'assertive'
    : 'polite'
}

export function createStatusBarNotice(input: StatusBarNoticeInput): StatusBarNotice {
  const tone: StatusBarTone = input.tone ?? 'neutral'
  const urgency = input.urgency ?? getSaveFeedbackUrgency(tone)
  return {
    id: input.id,
    announcementId: input.announcementId ?? createAnnouncementToken(tone, input.id),
    message: input.message,
    tone,
    urgency,
    actions: clampStatusBarActions(input.actions ?? []),
    durationMs:
      typeof input.durationMs === 'number' && input.durationMs > 0
        ? input.durationMs
        : SAVE_FEEDBACK_TIMINGS.statusBarDurationMs,
  }
}

function transitionToTerminal(
  snapshot: SaveFeedbackSnapshot,
  runId: number,
  state: 'saved' | 'failed',
  errorMessage: string | null
): SaveFeedbackSnapshot {
  if (!isSaveFeedbackBusy(snapshot.state) || runId !== snapshot.runId) {
    return snapshot
  }
  return {
    state,
    runId,
    announcementId: createAnnouncementToken(state, runId),
    errorMessage,
  }
}

export function reduceSaveFeedback(
  snapshot: SaveFeedbackSnapshot,
  event: SaveFeedbackEvent
): SaveFeedbackSnapshot {
  switch (event.type) {
    case 'start':
      return event.runId <= snapshot.runId
        ? snapshot
        : {
            state: 'saving',
            runId: event.runId,
            announcementId: createAnnouncementToken('saving', event.runId),
            errorMessage: null,
          }
    case 'slow':
      return snapshot.state !== 'saving' || event.runId !== snapshot.runId
        ? snapshot
        : {
            ...snapshot,
            state: 'still-saving',
            announcementId: createAnnouncementToken('still-saving', event.runId),
          }
    case 'succeed':
      return transitionToTerminal(snapshot, event.runId, 'saved', null)
    case 'fail':
      return transitionToTerminal(
        snapshot,
        event.runId,
        'failed',
        event.errorMessage ?? null
      )
    case 'offline':
      return event.runId <= snapshot.runId
        ? snapshot
        : {
            state: 'offline',
            runId: event.runId,
            announcementId: createAnnouncementToken('offline', event.runId),
            errorMessage: null,
          }
    case 'undo': {
      if (event.runId < snapshot.runId) return snapshot
      const nextRunId = Math.max(snapshot.runId + 1, event.runId)
      return {
        state: 'idle',
        runId: nextRunId,
        announcementId: createAnnouncementToken('undo', nextRunId),
        errorMessage: null,
      }
    }
    case 'reset':
      return {
        state: event.nextState ?? 'idle',
        runId: snapshot.runId + 1,
        announcementId: null,
        errorMessage: null,
      }
  }
}

export function pushLookUndoSnapshot<T>(
  stack: readonly T[],
  snapshot: T,
  maxDepth: number = DEFAULT_MAX_LOOK_UNDO_DEPTH
): T[] {
  if (maxDepth <= 0) return []
  const next = [...stack, snapshot]
  if (next.length <= maxDepth) return next
  return next.slice(next.length - maxDepth)
}

export function popLookUndoSnapshot<T>(stack: readonly T[]): {
  snapshot: T | undefined
  rest: T[]
} {
  if (stack.length === 0) {
    return { snapshot: undefined, rest: [] }
  }
  return {
    snapshot: stack[stack.length - 1],
    rest: stack.slice(0, -1),
  }
}

export interface BoundedSaveMutation<T> {
  next: T[]
  savedKey: string
  savedEntry: T
  previousEntry: T | undefined
  previousIndex: number
  evictedEntry: T | undefined
}

export interface BoundedRemoveMutation<T> {
  next: T[]
  removedKey: string
  removedEntry: T
  removedIndex: number
}

export type BoundedUndoResult<T> =
  | { ok: true; next: T[] }
  | { ok: false; conflict: true; next: T[] }

export function applyBoundedListSave<T>(options: {
  entries: readonly T[]
  entry: T
  getKey: (item: T) => string
  maxEntries?: number
}): BoundedSaveMutation<T> {
  const { entries, entry, getKey, maxEntries = DEFAULT_MAX_SAVED_ENTRIES } = options
  const savedKey = getKey(entry)
  const previousIndex = entries.findIndex((item) => getKey(item) === savedKey)
  const previousEntry = previousIndex >= 0 ? entries[previousIndex] : undefined
  const remaining = entries.filter((item) => getKey(item) !== savedKey)
  const combined = [entry, ...remaining]
  const next = combined.slice(0, maxEntries)
  const evictedEntry = combined.length > maxEntries ? combined[maxEntries] : undefined
  return {
    next,
    savedKey,
    savedEntry: entry,
    previousEntry,
    previousIndex,
    evictedEntry,
  }
}

export function undoBoundedListSave<T>(options: {
  entries: readonly T[]
  mutation: BoundedSaveMutation<T>
  getKey: (item: T) => string
  isSameEntry: (a: T, b: T) => boolean
  maxEntries?: number
}): BoundedUndoResult<T> {
  const {
    entries,
    mutation,
    getKey,
    isSameEntry,
    maxEntries = DEFAULT_MAX_SAVED_ENTRIES,
  } = options
  const currentMatch = entries.find((item) => getKey(item) === mutation.savedKey)
  if (!currentMatch || !isSameEntry(currentMatch, mutation.savedEntry)) {
    return { ok: false, conflict: true, next: [...entries] }
  }
  const without = entries.filter((item) => getKey(item) !== mutation.savedKey)
  let next: T[]
  if (mutation.previousEntry !== undefined) {
    const idx = Math.min(Math.max(mutation.previousIndex, 0), without.length)
    next = [...without.slice(0, idx), mutation.previousEntry, ...without.slice(idx)]
  } else {
    next = [...without]
    if (
      mutation.evictedEntry !== undefined &&
      !next.some((item) => getKey(item) === getKey(mutation.evictedEntry!)) &&
      next.length < maxEntries
    ) {
      next.push(mutation.evictedEntry)
    }
  }
  if (next.length > maxEntries) {
    return { ok: false, conflict: true, next: [...entries] }
  }
  return { ok: true, next }
}

export function applyBoundedListRemove<T>(options: {
  entries: readonly T[]
  key: string
  getKey: (item: T) => string
}): BoundedRemoveMutation<T> | null {
  const { entries, key, getKey } = options
  const removedIndex = entries.findIndex((item) => getKey(item) === key)
  if (removedIndex < 0) return null
  const removedEntry = entries[removedIndex]!
  const next = entries.filter((item) => getKey(item) !== key)
  return {
    next,
    removedKey: key,
    removedEntry,
    removedIndex,
  }
}

export function undoBoundedListRemove<T>(options: {
  entries: readonly T[]
  mutation: BoundedRemoveMutation<T>
  getKey: (item: T) => string
  maxEntries?: number
}): BoundedUndoResult<T> {
  const { entries, mutation, getKey, maxEntries = DEFAULT_MAX_SAVED_ENTRIES } = options
  if (entries.some((item) => getKey(item) === mutation.removedKey)) {
    return { ok: false, conflict: true, next: [...entries] }
  }
  if (entries.length >= maxEntries) {
    return { ok: false, conflict: true, next: [...entries] }
  }
  const idx = Math.min(Math.max(mutation.removedIndex, 0), entries.length)
  const next = [...entries.slice(0, idx), mutation.removedEntry, ...entries.slice(idx)]
  return { ok: true, next }
}

const OFFLINE_ERROR_CODES = new Set([
  'ERR_NETWORK',
  'ECONNABORTED',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'OFFLINE',
])

const OFFLINE_MESSAGE_PATTERN =
  /\b(offline|network request failed|failed to fetch|load failed|networkerror|internet connection appears to be offline|no internet|network error)\b/i

export function isOfflineError(error: unknown): boolean {
  if (typeof error === 'string') {
    return OFFLINE_MESSAGE_PATTERN.test(error)
  }
  if (!error || typeof error !== 'object') {
    return false
  }
  const candidate = error as {
    code?: unknown
    name?: unknown
    message?: unknown
    cause?: unknown
  }
  if (typeof candidate.code === 'string' && OFFLINE_ERROR_CODES.has(candidate.code)) {
    return true
  }
  if (candidate.name === 'OfflineError') {
    return true
  }
  if (
    typeof candidate.message === 'string' &&
    OFFLINE_MESSAGE_PATTERN.test(candidate.message)
  ) {
    return true
  }
  if (candidate.cause && candidate.cause !== error) {
    return isOfflineError(candidate.cause)
  }
  return false
}
