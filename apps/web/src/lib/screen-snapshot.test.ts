// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 D5 test owner: the per-member, memory-only tab snapshot.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-UNIT-010 to 7.7-UNIT-012). The Playwright side is 7.7-E2E-008 and 7.7-E2E-009.
// Codex review of 8327b4fb: 7.7-UNIT-014 pins the session scope (P2-1), 7.7-UNIT-015 the
// revocation when Community access is lost (P3-1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './browser-persistence'
import type * as WebSession from './web-session'
import {
  COMMUNITY_GRID_SNAPSHOT_PART,
  COMMUNITY_SNAPSHOT_PARTS,
  createScreenSnapshotStore,
  HOME_TEASER_SNAPSHOT_PART,
  SCREEN_SNAPSHOT_CAP,
  screenSnapshot,
  type ScreenName,
} from './screen-snapshot'
import { currentWebSessionScope, UNVERIFIED_BEARER_OWNER } from './use-web-session'

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

    // A token refresh names a new bearer for the same verified member: their scope is their
    // owner, so the snapshot stays (Codex review P2-1).
    publish('member-a', 'bearer-a2')
    expect(screenSnapshot.recall('member-a', 'home', 'ritual')).toEqual({
      outfit: 'a-home',
    })
    expect(screenSnapshot.isSettled('member-a', 'home')).toBe(true)

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
    const fixtureA = `${UNVERIFIED_BEARER_OWNER}\u0000test-token-a`
    const fixtureB = `${UNVERIFIED_BEARER_OWNER}\u0000test-token-b`
    let live = fixtureA
    const store = createScreenSnapshotStore(() => live)
    store.remember(fixtureA, 'home', 'ritual', { outfit: 'fixture-a' })
    store.markSettled(fixtureA, 'home')

    live = fixtureB
    expect(store.recall(fixtureA, 'home', 'ritual')).toBeUndefined()
    expect(store.recall(fixtureB, 'home', 'ritual')).toBeUndefined()
    expect(store.isSettled(fixtureB, 'home')).toBe(false)
    store.follow()
    expect(store.size()).toBe(0)
  })

  it('7.7-UNIT-014 the session scope is the verified owner, or the fixture owner with its bearer', () => {
    // A verified member: the owner alone, whatever bearer the tab holds now.
    expect(currentWebSessionScope()).toBe('member-a')
    publish('member-a', 'bearer-a2')
    expect(currentWebSessionScope()).toBe('member-a')

    // The e2e fixture: one owner for every bearer, so the bearer is part of the scope.
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    publish(null, 'test-token-a')
    const fixtureA = currentWebSessionScope()
    publish(null, 'test-token-b')
    const fixtureB = currentWebSessionScope()
    vi.unstubAllEnvs()

    expect(fixtureA).toBe(`${UNVERIFIED_BEARER_OWNER}\u0000test-token-a`)
    expect(fixtureB).toBe(`${UNVERIFIED_BEARER_OWNER}\u0000test-token-b`)
  })

  it('7.7-UNIT-014 a write captured under a scope that is no longer live is dropped', () => {
    const fixtureA = `${UNVERIFIED_BEARER_OWNER}\u0000test-token-a`
    const fixtureB = `${UNVERIFIED_BEARER_OWNER}\u0000test-token-b`
    let live = fixtureA
    const store = createScreenSnapshotStore(() => live)
    store.remember(fixtureA, 'closet', 'closet', { garments: ['a-coat'] })

    // Fixture B is live now; a closet read fixture A started lands late.
    live = fixtureB
    store.remember(fixtureA, 'closet', 'closet', { garments: ['a-coat', 'a-scarf'] })
    store.markSettled(fixtureA, 'closet')
    store.rememberScroll(fixtureA, 'closet', 300)

    expect(store.recall(fixtureB, 'closet', 'closet')).toBeUndefined()
    expect(store.isSettled(fixtureB, 'closet')).toBe(false)
    expect(store.recallScroll(fixtureB, 'closet')).toBeUndefined()
    // A write nobody captured a scope for is dropped too.
    store.remember(null, 'closet', 'closet', { garments: [] })
    expect(store.recall(fixtureB, 'closet', 'closet')).toBeUndefined()

    // B's own read is kept.
    store.remember(fixtureB, 'closet', 'closet', { garments: ['b-boots'] })
    expect(store.recall(fixtureB, 'closet', 'closet')).toEqual({ garments: ['b-boots'] })
  })

  it('7.7-UNIT-015 losing Community access drops its parts, fences pending writes, and a read with access allows them again', () => {
    screenSnapshot.remember('member-a', 'home', 'ritual', { outfit: 'a-home' })
    screenSnapshot.remember('member-a', 'home', COMMUNITY_GRID_SNAPSHOT_PART, { rows: 3 })
    screenSnapshot.remember('member-a', 'home', HOME_TEASER_SNAPSHOT_PART, { teaser: 1 })
    screenSnapshot.remember('member-a', 'community', COMMUNITY_GRID_SNAPSHOT_PART, {
      rows: 5,
    })
    screenSnapshot.markSettled('member-a', 'community')
    screenSnapshot.markSettled('member-a', 'home')

    screenSnapshot.revoke(COMMUNITY_SNAPSHOT_PARTS, ['community'])

    for (const tab of ['home', 'community'] as const)
      for (const part of COMMUNITY_SNAPSHOT_PARTS)
        expect(screenSnapshot.recall('member-a', tab, part)).toBeUndefined()
    // The rest of Home stays; a Community return waits for its reads again.
    expect(screenSnapshot.recall('member-a', 'home', 'ritual')).toEqual({
      outfit: 'a-home',
    })
    expect(screenSnapshot.isSettled('member-a', 'home')).toBe(true)
    expect(screenSnapshot.isSettled('member-a', 'community')).toBe(false)

    // A teaser read started before the loss answers now: it is not kept.
    screenSnapshot.remember('member-a', 'home', HOME_TEASER_SNAPSHOT_PART, { teaser: 2 })
    expect(
      screenSnapshot.recall('member-a', 'home', HOME_TEASER_SNAPSHOT_PART)
    ).toBeUndefined()

    // A feed read that answered with access allows the parts again.
    screenSnapshot.allow(COMMUNITY_SNAPSHOT_PARTS)
    screenSnapshot.remember('member-a', 'home', HOME_TEASER_SNAPSHOT_PART, { teaser: 3 })
    expect(screenSnapshot.recall('member-a', 'home', HOME_TEASER_SNAPSHOT_PART)).toEqual({
      teaser: 3,
    })
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
    screenSnapshot.follow()
    screenSnapshot.revoke(COMMUNITY_SNAPSHOT_PARTS, ['community'])
    screenSnapshot.allow(COMMUNITY_SNAPSHOT_PARTS)
    screenSnapshot.clear()

    expect(setItem).not.toHaveBeenCalled()
  })
})
