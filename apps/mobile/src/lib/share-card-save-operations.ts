// Story 6.8 Task 5 step 2 owner: own committed native saves in `apps/mobile/src/lib/share-card-save-operations.ts`
/** A process-lifetime owner. Navigation and identity changes cannot release a committed file. */
type Operation = {
  owner?: object
  fileUri: string
  save: () => Promise<void>
  cleanup: () => Promise<void>
}
let pending: Promise<void> | null = null
let pendingOwner: object | undefined
const precommitFiles = new Set<string>()
export function reserveShareCardFile(uri: string) {
  if (cleaningFiles.has(uri)) throw new Error('file_busy')
  precommitFiles.add(uri)
  return () => {
    precommitFiles.delete(uri)
    scheduleCleanup()
  }
}
type CleanupRetry = { cleanup: () => Promise<void>; attempts: number }
const cleanupRetries = new Map<string, CleanupRetry>()
const cleaningFiles = new Set<string>()
const retryDelays = [1000, 5000, 30000]
let retryTimer: ReturnType<typeof setTimeout> | undefined
let cleanupFlight: Promise<void> | null = null
function scheduleCleanup() {
  clearTimeout(retryTimer)
  retryTimer = undefined
  const next = [...cleanupRetries.entries()].filter(
    ([file, entry]) =>
      entry.attempts < retryDelays.length &&
      activeFile !== file &&
      !precommitFiles.has(file)
  )
  if (!next.length) return
  const attempt = Math.min(...next.map(([, entry]) => entry.attempts))
  retryTimer = setTimeout(() => {
    void runCleanup(true)
  }, retryDelays[attempt])
}
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}
export function nativeShareCardSavePending() {
  return pending !== null
}
export function ownsPendingShareCardSave(owner: object) {
  return pending !== null && pendingOwner === owner
}
export function enqueueShareCardCleanup(fileUri: string, cleanup: () => Promise<void>) {
  if (!cleanupRetries.has(fileUri)) cleanupRetries.set(fileUri, { cleanup, attempts: 0 })
  scheduleCleanup()
}
export function subscribeShareCardSave(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function ownsCommittedShareCardFile(uri: string) {
  return activeFile === uri
}
export function liveShareCardFiles() {
  return new Set([
    ...precommitFiles,
    ...cleanupRetries.keys(),
    ...(activeFile ? [activeFile] : []),
  ])
}
let activeFile: string | null = null
export function retryShareCardCleanup() {
  return runCleanup(false)
}
async function runCleanup(automatic: boolean): Promise<void> {
  if (cleanupFlight) return cleanupFlight
  cleanupFlight = (async () => {
    for (const [file, entry] of cleanupRetries) {
      if (activeFile === file || precommitFiles.has(file)) continue
      if (automatic && entry.attempts >= retryDelays.length) continue
      entry.attempts++
      cleaningFiles.add(file)
      try {
        await entry.cleanup()
        if (cleanupRetries.get(file) === entry) cleanupRetries.delete(file)
      } catch {
        /* Bounded in-session retries; startup can retry a persistent failure. */
      } finally {
        cleaningFiles.delete(file)
      }
    }
  })()
  try {
    await cleanupFlight
  } finally {
    cleanupFlight = null
    scheduleCleanup()
  }
}
/** Atomic commit is synchronous. The returned native promise alone owns settlement. */
export function commitShareCardSave(operation: Operation): Promise<void> {
  if (pending || cleaningFiles.has(operation.fileUri))
    return Promise.reject(new Error('finishingSave'))
  activeFile = operation.fileUri
  pendingOwner = operation.owner
  // Defer invocation until ownership and the duplicate guard are both installed.
  const native = Promise.resolve().then(operation.save)
  const owned = native.finally(async () => {
    try {
      await operation.cleanup()
    } catch {
      cleanupRetries.set(operation.fileUri, { cleanup: operation.cleanup, attempts: 0 })
    } finally {
      activeFile = null
      pending = null
      pendingOwner = undefined
      scheduleCleanup()
      notify()
    }
  })
  pending = owned
  notify()
  return owned
}
