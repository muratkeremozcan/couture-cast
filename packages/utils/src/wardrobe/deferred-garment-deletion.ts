import { SAVE_FEEDBACK_TIMINGS } from '../save-feedback'

/**
 * Story CC-7.6 D1: garment delete is a deferred client commit. Tapping Delete hides the piece
 * at once and the DELETE is sent when the Undo window ends; Undo inside the window cancels it.
 * Web and native share this one platform-free controller, so the window, flush and supersede
 * rules cannot drift; each app supplies the commit function and its own lifecycle hooks (web
 * `pagehide`/`visibilitychange`, native `AppState`).
 */

/**
 * What a commit is told. `keepalive` is true for a flush on page hide; the web commit sends
 * keepalive on every request anyway.
 */
export interface DeferredGarmentDeletionCommitOptions {
  keepalive: boolean
}

export type DeferredGarmentDeletionCommit = (
  options: DeferredGarmentDeletionCommitOptions
) => Promise<void>

/**
 * One state change. `scheduled`: hidden, inside its Undo window. `undone`: the window was
 * cancelled and the piece returns. `committing`: the DELETE is being sent (Undo no longer
 * applies). `committed`: the DELETE succeeded. `failed`: the DELETE failed and the piece
 * returns (D6). `failuresToReport`: the failed ids whose "Could not delete" notice may show
 * now. A failure that lands while another delete is inside its Undo window waits until no
 * window is open, so its notice never covers a live Undo (D9); every failure since the last
 * report comes in one event, with the last error of each.
 */
export type DeferredGarmentDeletionEvent =
  | { type: 'scheduled'; id: string }
  | { type: 'undone'; id: string }
  | { type: 'committing'; id: string }
  | { type: 'committed'; id: string }
  | { type: 'failed'; id: string; error: unknown }
  | {
      type: 'failuresToReport'
      failures: readonly { id: string; error: unknown }[]
    }

export type DeferredGarmentDeletionListener = (
  event: DeferredGarmentDeletionEvent
) => void

/** The timer the controller uses; tests inject a fake one. */
export interface DeferredGarmentDeletionTimer {
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface DeferredGarmentDeletionOptions {
  /** Length of the Undo window. Defaults to the CC-7.1 status bar duration. */
  windowMs?: number
  timer?: DeferredGarmentDeletionTimer
}

export interface DeferredGarmentDeletionController {
  /**
   * Hides `id` and starts its Undo window; `commit` runs when the window ends. Any other
   * delete still inside its window commits at once (a second delete supersedes the first).
   * Returns false, changing nothing, when `id` is already hidden.
   */
  schedule: (id: string, commit: DeferredGarmentDeletionCommit) => boolean
  /**
   * Sends the DELETE at once with no Undo window: the confirmed delete of a piece in use (D2).
   * A piece still inside its window commits now, and so does every other delete still inside
   * its window (starting another delete flushes, D1). Resolves true when the DELETE succeeded.
   */
  commitNow: (id: string, commit: DeferredGarmentDeletionCommit) => Promise<boolean>
  /**
   * Retry after a failure (D9): sends the DELETE for `id` alone, at once. Every other delete
   * keeps its own Undo window. Resolves true when the DELETE succeeded.
   */
  retry: (id: string, commit: DeferredGarmentDeletionCommit) => Promise<boolean>
  /** Cancels `id` inside its window. False once its commit started, or for an unknown id. */
  undo: (id: string) => boolean
  /** Commits every delete still inside its window at once, and waits for every send. */
  flush: (options?: Partial<DeferredGarmentDeletionCommitOptions>) => Promise<void>
  /** Every hidden id: inside its window or being sent. */
  pendingIds: () => string[]
  /** True while any delete is inside its Undo window. */
  hasOpenWindow: () => boolean
  isPending: (id: string) => boolean
  subscribe: (listener: DeferredGarmentDeletionListener) => () => void
  /**
   * Drops every pending delete, timer and unreported failure without committing any: the
   * D10 test seam, and how a session that ended stops speaking for its member (D11).
   */
  reset: () => void
}

type Entry = {
  id: string
  commit: DeferredGarmentDeletionCommit
  state: 'waiting' | 'committing'
  handle: unknown
  sent: Promise<boolean> | null
}

const defaultTimer: DeferredGarmentDeletionTimer = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export function createDeferredGarmentDeletion(
  options: DeferredGarmentDeletionOptions = {}
): DeferredGarmentDeletionController {
  const windowMs = options.windowMs ?? SAVE_FEEDBACK_TIMINGS.statusBarDurationMs
  const timer = options.timer ?? defaultTimer
  const entries = new Map<string, Entry>()
  const listeners = new Set<DeferredGarmentDeletionListener>()
  let unreported: { id: string; error: unknown }[] = []

  // A listener that throws never rejects a send, surfaces as an unhandled rejection on the
  // timer path, or keeps the listeners after it from hearing the event.
  const emit = (event: DeferredGarmentDeletionEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // Listener faults stay with the listener.
      }
    }
  }

  const hasOpenWindow = () =>
    [...entries.values()].some((entry) => entry.state === 'waiting')

  const reportFailuresIfNoWindow = () => {
    if (unreported.length === 0 || hasOpenWindow()) return
    const failures = unreported
    unreported = []
    emit({ type: 'failuresToReport', failures })
  }

  const send = (
    entry: Entry,
    commitOptions: DeferredGarmentDeletionCommitOptions
  ): Promise<boolean> => {
    if (entry.sent) return entry.sent
    timer.clearTimeout(entry.handle)
    entry.state = 'committing'
    emit({ type: 'committing', id: entry.id })
    reportFailuresIfNoWindow()
    entry.sent = (async () => {
      try {
        await entry.commit(commitOptions)
      } catch (error) {
        if (entries.get(entry.id) !== entry) return false
        entries.delete(entry.id)
        emit({ type: 'failed', id: entry.id, error })
        unreported = [
          ...unreported.filter((failure) => failure.id !== entry.id),
          { id: entry.id, error },
        ]
        reportFailuresIfNoWindow()
        return false
      }
      if (entries.get(entry.id) !== entry) return false
      entries.delete(entry.id)
      emit({ type: 'committed', id: entry.id })
      return true
    })()
    return entry.sent
  }

  const commitWaiting = (commitOptions: DeferredGarmentDeletionCommitOptions) =>
    [...entries.values()]
      .filter((entry) => entry.state === 'waiting')
      .map((entry) => send(entry, commitOptions))

  const sendAlone = (id: string, commit: DeferredGarmentDeletionCommit) => {
    // A retried id leaves the unreported failures: its new send speaks for it.
    unreported = unreported.filter((failure) => failure.id !== id)
    const existing = entries.get(id)
    if (existing) return send(existing, { keepalive: false })
    const entry: Entry = { id, commit, state: 'waiting', handle: null, sent: null }
    entries.set(id, entry)
    return send(entry, { keepalive: false })
  }

  return {
    schedule(id, commit) {
      if (entries.has(id)) return false
      unreported = unreported.filter((failure) => failure.id !== id)
      void commitWaiting({ keepalive: false })
      const entry: Entry = { id, commit, state: 'waiting', handle: null, sent: null }
      entry.handle = timer.setTimeout(() => {
        void send(entry, { keepalive: false })
      }, windowMs)
      entries.set(id, entry)
      emit({ type: 'scheduled', id })
      return true
    },
    commitNow(id, commit) {
      for (const other of [...entries.values()]) {
        if (other.id !== id && other.state === 'waiting') {
          void send(other, { keepalive: false })
        }
      }
      return sendAlone(id, commit)
    },
    retry(id, commit) {
      return sendAlone(id, commit)
    },
    undo(id) {
      const entry = entries.get(id)
      if (!entry || entry.state !== 'waiting') return false
      timer.clearTimeout(entry.handle)
      entries.delete(id)
      emit({ type: 'undone', id })
      reportFailuresIfNoWindow()
      return true
    },
    async flush(flushOptions = {}) {
      const commitOptions = { keepalive: flushOptions.keepalive ?? false }
      const waiting = commitWaiting(commitOptions)
      const inFlight = [...entries.values()]
        .map((entry) => entry.sent)
        .filter((sent): sent is Promise<boolean> => sent !== null)
      await Promise.all([...waiting, ...inFlight])
    },
    pendingIds: () => [...entries.keys()],
    hasOpenWindow,
    isPending: (id) => entries.has(id),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset() {
      for (const entry of entries.values()) timer.clearTimeout(entry.handle)
      entries.clear()
      unreported = []
    },
  }
}
