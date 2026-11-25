// Story CC-7.7 D5 owner: the per-member, memory-only snapshot of each signed-in tab.
//
// A return to a tab in the same session shows the tab's last settled content and scroll offset in
// its first frame, then refreshes in place. The snapshot lives in this module's memory only:
// nothing here touches localStorage, sessionStorage or any other store, so a reload, a new tab or
// a closed browser starts from nothing. It holds one member at a time: any change of the member
// the session bridge names (another account, or sign-out), or of the bearer this tab holds,
// clears it before the next render can read it, so one member's content never reaches another.
// The bearer matters because the end-to-end fixture bearers all map to one owner
// (UNVERIFIED_BEARER_OWNER): the owner alone would let one fixture member recall another's.
// The bearer is only compared, in memory, and never stored anywhere else.
'use client'

import { currentWebSessionBearer, currentWebSessionOwner } from './use-web-session'

/** The four signed-in tabs; the snapshot never holds more than these. */
export type ScreenName = 'home' | 'closet' | 'community' | 'profile'

export const SCREEN_SNAPSHOT_CAP = 4

type Entry = {
  /** The tab's body settled at least once in this session (its gate opened from its reads). */
  settled: boolean
  /** The last window scroll offset while the tab was shown. */
  scrollY: number
  /** Named parts of the tab's last settled data, written by the sections that own them. */
  parts: Map<string, unknown>
}

export interface ScreenSnapshotStore {
  /** Stores one named part of a tab's last settled data for `owner`. */
  remember(owner: string, screen: ScreenName, part: string, value: unknown): void
  /** The part stored for `owner`, or undefined when another member (or none) owns the snapshot. */
  recall<T>(owner: string | null, screen: ScreenName, part: string): T | undefined
  /** Marks the tab settled for `owner`: its next mount opens its gate at once. */
  markSettled(owner: string, screen: ScreenName): void
  isSettled(owner: string | null, screen: ScreenName): boolean
  rememberScroll(owner: string, screen: ScreenName, scrollY: number): void
  recallScroll(owner: string | null, screen: ScreenName): number | undefined
  /** Drops everything. */
  clear(): void
  /** Clears the snapshot unless `liveOwner` and the tab's bearer are the ones it was taken under. */
  follow(liveOwner: string | null): void
  /** Tabs held right now, for tests. */
  size(): number
}

export function createScreenSnapshotStore(
  readBearer: () => string | null = currentWebSessionBearer
): ScreenSnapshotStore {
  let owner: string | null = null
  let bearer: string | null = null
  const entries = new Map<ScreenName, Entry>()

  const entryFor = (member: string, screen: ScreenName): Entry => {
    const live = readBearer()
    if (owner !== member || bearer !== live) {
      entries.clear()
      owner = member
      bearer = live
    }
    let entry = entries.get(screen)
    if (!entry) {
      entry = { settled: false, scrollY: 0, parts: new Map() }
      entries.set(screen, entry)
      // The cap: the oldest tab leaves first. Only four names exist, so this is a guard.
      while (entries.size > SCREEN_SNAPSHOT_CAP) {
        const oldest = entries.keys().next().value as ScreenName
        entries.delete(oldest)
      }
    }
    return entry
  }

  const read = (member: string | null, screen: ScreenName): Entry | undefined =>
    member !== null && member === owner && bearer === readBearer()
      ? entries.get(screen)
      : undefined

  return {
    remember(member, screen, part, value) {
      entryFor(member, screen).parts.set(part, value)
    },
    recall<T>(member: string | null, screen: ScreenName, part: string) {
      return read(member, screen)?.parts.get(part) as T | undefined
    },
    markSettled(member, screen) {
      entryFor(member, screen).settled = true
    },
    isSettled(member, screen) {
      return read(member, screen)?.settled === true
    },
    rememberScroll(member, screen, scrollY) {
      entryFor(member, screen).scrollY = scrollY
    },
    recallScroll(member, screen) {
      return read(member, screen)?.scrollY
    },
    clear() {
      owner = null
      bearer = null
      entries.clear()
    },
    follow(liveOwner) {
      if (owner === null) return
      if (liveOwner === null || owner !== liveOwner || bearer !== readBearer()) {
        owner = null
        bearer = null
        entries.clear()
      }
    },
    size() {
      return entries.size
    },
  }
}

/** The app's one snapshot. */
export const screenSnapshot = createScreenSnapshotStore()

/**
 * Follows the session bridge: `couture:session` names, changes or clears the member, and
 * `storage` carries a sign-out from another tab. Registered when this module loads, so it runs
 * before any component's listener re-renders a tab with another member's snapshot.
 */
function followSession() {
  screenSnapshot.follow(currentWebSessionOwner())
}

if (typeof window !== 'undefined') {
  window.addEventListener('couture:session', followSession)
  window.addEventListener('storage', followSession)
}
