// Story 6.16 D7: one guest preview store per platform, sharing this core. Web passes a
// localStorage adapter and mobile a file adapter. Every write is queued in order and
// carries the epoch it was made in; reset, exit, expiry and identity change bump the
// epoch, so a write from before them is dropped and cleared state cannot come back.
import type { SampleCatalog } from './types'
import {
  createGuestPreviewState,
  isGuestPreviewExpired,
  parseGuestPreviewState,
  resetGuestPreviewState,
  serializeGuestPreviewState,
  type GuestPreviewState,
} from './state'

export type GuestPreviewStorageAdapter = {
  read(): Promise<string | null>
  write(value: string): Promise<void>
  remove(): Promise<void>
}

export type GuestPreviewSnapshot = {
  state: GuestPreviewState | null
  /** False once storage has failed: the preview runs in memory and says it may reset. */
  persistent: boolean
}

export type GuestPreviewStore = {
  load(): Promise<GuestPreviewSnapshot>
  snapshot(): GuestPreviewSnapshot
  /** Starts a preview after the eligibility gate passes. */
  start(): GuestPreviewState
  update(
    change: (state: GuestPreviewState) => GuestPreviewState
  ): GuestPreviewState | null
  reset(): GuestPreviewState | null
  /** "Exit preview" and identity changes: drop everything, including stored text. */
  clear(): void
  epoch(): number
  /** Resolves when every queued storage operation has settled. */
  flush(): Promise<void>
  subscribe(listener: (snapshot: GuestPreviewSnapshot) => void): () => void
}

export function createGuestPreviewStore(options: {
  adapter: GuestPreviewStorageAdapter
  catalog: SampleCatalog
  now?: () => number
}): GuestPreviewStore {
  const { adapter, catalog } = options
  const now = options.now ?? Date.now
  let state: GuestPreviewState | null = null
  let persistent = true
  let currentEpoch = 0
  let queue: Promise<void> = Promise.resolve()
  const listeners = new Set<(snapshot: GuestPreviewSnapshot) => void>()

  const snapshot = (): GuestPreviewSnapshot => ({ state, persistent })
  const emit = () => {
    const current = snapshot()
    for (const listener of listeners) listener(current)
  }
  const failStorage = () => {
    if (!persistent) return
    persistent = false
    emit()
  }

  const enqueue = (operation: () => Promise<void>) => {
    queue = queue.then(operation).catch(failStorage)
  }

  const persist = (next: GuestPreviewState) => {
    const writeEpoch = currentEpoch
    const text = serializeGuestPreviewState(next)
    enqueue(async () => {
      if (writeEpoch !== currentEpoch) return
      await adapter.write(text)
    })
  }

  const removeStored = () => {
    enqueue(() => adapter.remove())
  }

  const expireIfNeeded = (): boolean => {
    if (state && isGuestPreviewExpired(state, now())) {
      currentEpoch += 1
      state = null
      removeStored()
      emit()
      return true
    }
    return false
  }

  return {
    async load() {
      const loadEpoch = currentEpoch
      let raw: string | null = null
      try {
        raw = await adapter.read()
      } catch {
        failStorage()
      }
      if (loadEpoch !== currentEpoch) return snapshot()
      state = parseGuestPreviewState(raw, now(), catalog)
      if (state === null && raw !== null) removeStored()
      emit()
      return snapshot()
    },
    snapshot() {
      expireIfNeeded()
      return snapshot()
    },
    start() {
      currentEpoch += 1
      state = createGuestPreviewState(now(), catalog)
      persist(state)
      emit()
      return state
    },
    update(change) {
      if (!state || expireIfNeeded()) return null
      state = change(state)
      persist(state)
      emit()
      return state
    },
    reset() {
      if (!state || expireIfNeeded()) return null
      currentEpoch += 1
      state = resetGuestPreviewState(state, catalog)
      persist(state)
      emit()
      return state
    },
    clear() {
      currentEpoch += 1
      state = null
      removeStored()
      emit()
    },
    epoch() {
      return currentEpoch
    },
    flush() {
      return queue
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
