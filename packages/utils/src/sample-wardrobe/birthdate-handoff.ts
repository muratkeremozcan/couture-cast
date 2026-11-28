import type { GuestPreviewState } from './state'

/** Keeps the eligible date in the current app process for signup. */
export function createGuestPreviewBirthdateHandoff(
  readState: () => GuestPreviewState | null
) {
  let entry: { startedAt: number; expiresAt: number; birthdate: string } | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined

  function clear() {
    entry = undefined
    clearTimeout(expiry)
    expiry = undefined
  }

  return {
    remember(state: GuestPreviewState, birthdate: string) {
      clear()
      const { expiresAt } = state.eligibility
      const remaining = expiresAt - Date.now()
      if (remaining <= 0) return
      entry = { startedAt: state.startedAt, expiresAt, birthdate: birthdate.trim() }
      expiry = setTimeout(clear, remaining)
    },
    read() {
      if (!entry) return undefined
      const state = readState()
      if (state?.startedAt !== entry.startedAt || Date.now() >= entry.expiresAt) {
        clear()
        return undefined
      }
      return entry.birthdate
    },
    clear,
  }
}
