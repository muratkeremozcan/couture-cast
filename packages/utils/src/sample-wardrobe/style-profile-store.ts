import {
  activeStyleDay,
  styleLocalDay,
  type StyleDay,
  type StyleProfileAnswers,
} from './style-profile'

export type StyleProfilePatch = Partial<StyleProfileAnswers>

export type StyleProfileRequest =
  | { method: 'GET' | 'DELETE' }
  | { method: 'PATCH'; input: StyleProfilePatch }

type Snapshot = {
  profile: StyleProfileAnswers | null
  status: 'idle' | 'loading' | 'ready' | 'failed'
  saving: boolean
  day: StyleDay | null
}

const INITIAL: Snapshot = { profile: null, status: 'idle', saving: false, day: null }

/** One in-memory profile cache and day override for each platform's authenticated session. */
export function createStyleProfileStore(
  currentScope: () => string | null,
  request: (scope: string, operation: StyleProfileRequest) => Promise<StyleProfileAnswers>
) {
  let scope: string | null = null
  let snapshot = INITIAL
  let expired: { source: Snapshot; result: Snapshot } | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  function publish(next: Snapshot) {
    if (next === snapshot) return
    snapshot = next
    expired = undefined
    notify()
  }

  function read(): Snapshot {
    const live = currentScope()
    if (live !== scope) {
      scope = live
      clearTimeout(expiry)
      snapshot = INITIAL
      expired = undefined
    }
    if (!snapshot.day || activeStyleDay(snapshot.day)) return snapshot
    if (expired?.source !== snapshot) {
      expired = { source: snapshot, result: { ...snapshot, day: null } }
    }
    return expired.result
  }

  function refreshDay() {
    clearTimeout(expiry)
    const previous = snapshot
    const next = read()
    if (next !== snapshot) publish(next)
    else if (next !== previous) notify()
    if (!next.day) return
    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    expiry = setTimeout(refreshDay, midnight.getTime() - now.getTime())
  }

  async function perform(
    owner: string,
    operation: StyleProfileRequest
  ): Promise<boolean> {
    const state = read()
    if (owner !== scope || state.status === 'loading' || state.saving) return false
    const reading = operation.method === 'GET'
    if (reading && state.status === 'ready') return true
    publish(reading ? { ...state, status: 'loading' } : { ...state, saving: true })
    try {
      const profile = await request(owner, operation)
      const latest = read()
      if (owner !== scope) return false
      publish({ ...latest, profile, status: 'ready', saving: false })
      return true
    } catch {
      const latest = read()
      if (owner === scope) {
        publish({ ...latest, status: reading ? 'failed' : latest.status, saving: false })
      }
      return false
    }
  }

  return {
    read,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refreshDay,
    load: (owner: string) => perform(owner, { method: 'GET' }),
    save: (owner: string, input: StyleProfilePatch) =>
      perform(owner, { method: 'PATCH', input }),
    clear: (owner: string) => perform(owner, { method: 'DELETE' }),
    updateDay(
      owner: string,
      change: { [Key in keyof Omit<StyleDay, 'date'>]?: StyleDay[Key] | null } | null
    ) {
      const state = read()
      if (owner !== scope) return
      const next = { ...state.day, ...change }
      const day =
        change && (next.temperature || next.mood)
          ? {
              date: styleLocalDay(),
              ...(next.temperature && { temperature: next.temperature }),
              ...(next.mood && { mood: next.mood }),
            }
          : null
      publish({ ...state, day })
      refreshDay()
    },
  }
}
