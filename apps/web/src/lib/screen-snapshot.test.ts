// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 D5 test owner: the per-member, memory-only tab snapshot.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-UNIT-010 to 7.7-UNIT-012). The Playwright side is 7.7-E2E-008 and 7.7-E2E-009.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './browser-persistence'
import type * as WebSession from './web-session'
import {
  createScreenSnapshotStore,
  SCREEN_SNAPSHOT_CAP,
  screenSnapshot,
  type ScreenName,
} from './screen-snapshot'

const session = vi.hoisted(() => ({ identity: null as string | null }))

vi.mock('./web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.identity !== null,
}))

/** What the session bridge does when it names (or clears) the member and their bearer. */
function publish(identity: string | null, bearer: string | null) {
  session.identity = identity
  if (bearer === null) window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, bearer)
  window.dispatchEvent(new Event('couture:session'))
}

const TABS: ScreenName[] = ['home', 'closet', 'community', 'profile']

beforeEach(() => {
  publish('member-a', 'bearer-a')
  screenSnapshot.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  screenSnapshot.clear()
  session.identity = null
  window.sessionStorage.clear()
})

describe('screen snapshot', () => {
  it('7.7-UNIT-010 remembers and recalls each tab per owner and screen, capped at the four tabs', () => {
    screenSnapshot.remember('member-a', 'home', 'ritual', { outfit: 'a-home' })
    screenSnapshot.remember('member-a', 'closet', 'closet', { garments: 3 })
    screenSnapshot.rememberScroll('member-a', 'closet', 640)
    screenSnapshot.markSettled('member-a', 'closet')

    expect(screenSnapshot.recall('member-a', 'home', 'ritual')).toEqual({
      outfit: 'a-home',
    })
    expect(screenSnapshot.recall('member-a', 'closet', 'closet')).toEqual({ garments: 3 })
    expect(screenSnapshot.recallScroll('member-a', 'closet')).toBe(640)
    expect(screenSnapshot.isSettled('member-a', 'closet')).toBe(true)
    // A part another screen owns, or a tab never settled, recalls nothing.
    expect(screenSnapshot.recall('member-a', 'community', 'ritual')).toBeUndefined()
    expect(screenSnapshot.isSettled('member-a', 'home')).toBe(false)

    // Several parts per tab across every tab still hold one entry per tab, never more than four.
    for (const tab of TABS) {
      for (const part of ['ritual', 'teaser', 'community-grid', 'closet'])
        screenSnapshot.remember('member-a', tab, part, { tab, part })
      screenSnapshot.rememberScroll('member-a', tab, 120)
      screenSnapshot.markSettled('member-a', tab)
      expect(screenSnapshot.size()).toBeLessThanOrEqual(SCREEN_SNAPSHOT_CAP)
    }
    expect(screenSnapshot.size()).toBe(TABS.length)
    for (const tab of TABS)
      expect(screenSnapshot.recall('member-a', tab, 'closet')).toEqual({
        tab,
        part: 'closet',
      })
  })

  it('7.7-UNIT-011 an owner change through couture:session clears it, sign-out clears it, and another owner recalls nothing', () => {
    screenSnapshot.remember('member-a', 'home', 'ritual', { outfit: 'a-home' })
    screenSnapshot.markSettled('member-a', 'home')

    // Another owner asks: nothing, even before any event.
    expect(screenSnapshot.recall('member-b', 'home', 'ritual')).toBeUndefined()
    expect(screenSnapshot.isSettled('member-b', 'home')).toBe(false)

    // A token refresh for the same member names a new bearer: the snapshot was taken under the
    // old one, so it goes too (fixture bearers all map to one owner).
    publish('member-a', 'bearer-a2')
    expect(screenSnapshot.recall('member-a', 'home', 'ritual')).toBeUndefined()

    screenSnapshot.remember('member-a', 'home', 'ritual', { outfit: 'a-home' })
    publish('member-b', 'bearer-b')
    expect(screenSnapshot.size()).toBe(0)
    expect(screenSnapshot.recall('member-a', 'home', 'ritual')).toBeUndefined()
    expect(screenSnapshot.recall('member-b', 'home', 'ritual')).toBeUndefined()

    screenSnapshot.remember('member-b', 'closet', 'closet', { garments: 1 })
    publish(null, null)
    expect(screenSnapshot.size()).toBe(0)
    expect(screenSnapshot.recall('member-b', 'closet', 'closet')).toBeUndefined()
  })

  it('7.7-UNIT-011 one owner with two bearers never shares a snapshot (E2E fixture members)', () => {
    let bearer = 'test-token-a'
    const store = createScreenSnapshotStore(() => bearer)
    store.remember('bearer', 'home', 'ritual', { outfit: 'fixture-a' })
    store.markSettled('bearer', 'home')

    bearer = 'test-token-b'
    expect(store.recall('bearer', 'home', 'ritual')).toBeUndefined()
    expect(store.isSettled('bearer', 'home')).toBe(false)
    store.follow('bearer')
    expect(store.size()).toBe(0)
  })

  it('7.7-UNIT-012 never writes to localStorage or sessionStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    for (const tab of TABS) {
      screenSnapshot.remember('member-a', tab, 'data', { tab })
      screenSnapshot.rememberScroll('member-a', tab, 100)
      screenSnapshot.markSettled('member-a', tab)
      screenSnapshot.recall('member-a', tab, 'data')
      screenSnapshot.recallScroll('member-a', tab)
    }
    screenSnapshot.follow('member-a')
    screenSnapshot.clear()

    expect(setItem).not.toHaveBeenCalled()
  })
})
