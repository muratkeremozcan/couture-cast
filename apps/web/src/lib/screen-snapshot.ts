// Story CC-7.7 D5 owner: the per-member, memory-only snapshot of each signed-in tab.
//
// A return to a tab in the same session shows the tab's last settled content and scroll offset in
// its first frame, then refreshes in place. The snapshot lives in this module's memory only:
// nothing here touches localStorage, sessionStorage or any other store, so a reload, a new tab or
// a closed browser starts from nothing. It holds one session scope at a time
// (`currentWebSessionScope`): a verified member's scope is their owner, so a token refresh keeps
// it; the e2e fixture scope also names the bearer, because every fixture bearer maps to one owner
// (UNVERIFIED_BEARER_OWNER). Any change of scope (another account, another fixture bearer, or
// sign-out) clears it before the next render can read it, so one member's content never reaches
// another. A write carries the scope its read started under and is dropped when that scope is no
// longer live (Codex review P2-1).
'use client'

import { currentWebSessionScope } from './use-web-session'

/** Signed-in tabs and settings destinations with owner-scoped section data. */
export type ScreenName =
  | 'home'
  | 'closet'
  | 'looks'
  | 'community'
  | 'profile'
  | 'settings-about'
  | 'settings-places'
  | 'settings-premium'

export const SCREEN_SNAPSHOT_CAP = 8

/** The Community grid's part, on Home and on Community. */
export const COMMUNITY_GRID_SNAPSHOT_PART = 'community-grid'
/** The Home Spotlight teaser's part. */
export const HOME_TEASER_SNAPSHOT_PART = 'teaser'
/** Every part that holds Community content: losing Community access revokes them (P3-1). */
export const COMMUNITY_SNAPSHOT_PARTS = [
  COMMUNITY_GRID_SNAPSHOT_PART,
  HOME_TEASER_SNAPSHOT_PART,
] as const

type Entry = {
  /** The tab's body settled at least once in this session (its gate opened from its reads). */
  settled: boolean
  /** The last window scroll offset while the tab was shown. */
  scrollY: number
  /** Named parts of the tab's last settled data, written by the sections that own them. */
  parts: Map<string, unknown>
}

export interface ScreenSnapshotStore {
  /**
   * Stores one named part of a tab's last settled data under `scope`, the session scope its read
   * started under. Dropped when that scope is no longer live, or while the part is revoked.
   */
  remember(scope: string | null, screen: ScreenName, part: string, value: unknown): void
  /** The part stored for `scope`, or undefined when another scope (or none) owns the snapshot. */
  recall<T>(scope: string | null, screen: ScreenName, part: string): T | undefined
  /** Marks the tab settled for `scope`: its next mount opens its gate at once. */
  markSettled(scope: string | null, screen: ScreenName): void
  isSettled(scope: string | null, screen: ScreenName): boolean
  rememberScroll(scope: string | null, screen: ScreenName, scrollY: number): void
  recallScroll(scope: string | null, screen: ScreenName): number | undefined
  /**
   * Drops `parts` from every tab and refuses later writes of them until `allow`, and forgets
   * that `screens` ever settled (Community access lost, P3-1). A write already in flight, read
   * before the loss, can then never put the content back.
   */
  revoke(parts: readonly string[], screens: readonly ScreenName[]): void
  /** Accepts writes of `parts` again: a read started after the loss answered with access. */
  allow(parts: readonly string[]): void
  /** Drops everything. */
  clear(): void
  /** Clears the snapshot unless the live session scope is the one it was taken under. */
  follow(): void
  /** Tabs held right now, for tests. */
  size(): number
}

export function createScreenSnapshotStore(
  readScope: () => string | null = currentWebSessionScope
): ScreenSnapshotStore {
  let held: string | null = null
  const entries = new Map<ScreenName, Entry>()
  const revoked = new Set<string>()

  const reset = (scope: string | null) => {
    held = scope
    entries.clear()
    revoked.clear()
  }

  /** The live scope, adopted (clearing anything held for another), or null when none is live. */
  const adoptLive = (scope: string | null): string | null => {
    const live = readScope()
    if (scope === null || scope !== live) return null
    if (held !== live) reset(live)
    return live
  }

  const entryFor = (scope: string | null, screen: ScreenName): Entry | undefined => {
    if (adoptLive(scope) === null) return undefined
    let entry = entries.get(screen)
    if (!entry) {
      entry = { settled: false, scrollY: 0, parts: new Map() }
      entries.set(screen, entry)
      // The cap evicts the oldest entry when a new screen is added.
      while (entries.size > SCREEN_SNAPSHOT_CAP) {
        const oldest = entries.keys().next().value as ScreenName
        entries.delete(oldest)
      }
    }
    return entry
  }

  const read = (scope: string | null, screen: ScreenName): Entry | undefined =>
    scope !== null && scope === held && scope === readScope()
      ? entries.get(screen)
      : undefined

  return {
    remember(scope, screen, part, value) {
      if (held === scope && revoked.has(part)) return
      const entry = entryFor(scope, screen)
      if (!entry) return
      if (value === undefined) entry.parts.delete(part)
      else entry.parts.set(part, value)
    },
    recall<T>(scope: string | null, screen: ScreenName, part: string) {
      return read(scope, screen)?.parts.get(part) as T | undefined
    },
    markSettled(scope, screen) {
      const entry = entryFor(scope, screen)
      if (entry) entry.settled = true
    },
    isSettled(scope, screen) {
      return read(scope, screen)?.settled === true
    },
    rememberScroll(scope, screen, scrollY) {
      const entry = entryFor(scope, screen)
      if (entry) entry.scrollY = scrollY
    },
    recallScroll(scope, screen) {
      return read(scope, screen)?.scrollY
    },
    revoke(parts, screens) {
      const live = readScope()
      if (held !== live) reset(live)
      for (const part of parts) revoked.add(part)
      for (const entry of entries.values())
        for (const part of parts) entry.parts.delete(part)
      for (const screen of screens) {
        const entry = entries.get(screen)
        if (entry) {
          entry.settled = false
          entry.scrollY = 0
        }
      }
    },
    allow(parts) {
      if (held !== readScope()) return
      for (const part of parts) revoked.delete(part)
    },
    clear() {
      reset(null)
    },
    follow() {
      if (held !== null && held !== readScope()) reset(null)
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
  screenSnapshot.follow()
}

if (typeof window !== 'undefined') {
  window.addEventListener('couture:session', followSession)
  window.addEventListener('storage', followSession)
}
