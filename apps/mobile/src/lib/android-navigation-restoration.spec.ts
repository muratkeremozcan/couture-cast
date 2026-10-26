import { beforeEach, describe, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({
  member: 'member-a' as string | null,
  listeners: new Set<() => void>(),
}))
vi.mock('./mobile-auth', () => ({
  mobileApplicationUserId: () => auth.member,
  subscribeMobileApplicationUser: (fn: () => void) => {
    auth.listeners.add(fn)
    return () => auth.listeners.delete(fn)
  },
}))
import {
  acquireAndroidNavigation,
  androidNavigationSnapshot as state,
  androidNavigationIntent,
  claimAndroidRestoration,
  externalAndroidNavigation,
  isCurrentAndroidRestoration,
  observeAndroidPath,
  setAndroidSpotlightDetail,
  subscribeAndroidNavigation,
} from './android-navigation-restoration'
function identity(member: string | null) {
  auth.member = member
  auth.listeners.forEach((fn) => fn())
}
function prior(path = '/community') {
  const old = {}
  const release = acquireAndroidNavigation(old, path)
  return { old, release }
}
beforeEach(() => {
  identity(null)
  acquireAndroidNavigation({}, '/')()
  identity('member-a')
})
describe('owned Android route checkpoint', () => {
  it('waits for ready, claims once, and identifies its completion without a new visit', () => {
    prior().release()
    const root = {}
    acquireAndroidNavigation(root, '/')
    expect(claimAndroidRestoration(root, false)).toBeNull()
    const request = claimAndroidRestoration(root, true)!
    expect(request.path).toBe('/community')
    expect(isCurrentAndroidRestoration(root, request.serial)).toBe(true)
    expect(claimAndroidRestoration(root, true)).toBeNull()
    expect(observeAndroidPath(root, '/')).toBe('waiting')
    expect(observeAndroidPath(root, '/community')).toBe('restored')
    expect(claimAndroidRestoration(root, true)).toBeNull()
    expect(observeAndroidPath(root, '/community')).toBe('unchanged')
  })
  it('old path observer, intent, detail setter and finalizer cannot affect a successor', () => {
    const { old, release } = prior()
    setAndroidSpotlightDetail(old, 'owned-post')
    const root = {}
    acquireAndroidNavigation(root, '/')
    const request = claimAndroidRestoration(root, true)!
    observeAndroidPath(old, '/settings')
    androidNavigationIntent(old, '/')
    setAndroidSpotlightDetail(old, null)
    release()
    expect(isCurrentAndroidRestoration(root, request.serial)).toBe(true)
    expect(state().checkpoint?.detailId).toBe('owned-post')
  })
  it.each(['/', '/settings'])('explicit user %s wins before readiness', (target) => {
    prior().release()
    const root = {}
    acquireAndroidNavigation(root, '/')
    androidNavigationIntent(root, target)
    expect(claimAndroidRestoration(root, true)).toBeNull()
    expect(state().checkpoint?.path).toBe(target)
    expect(state().checkpoint?.detailId).toBeNull()
  })
  it('an explicit initial route wins, and unknown/query paths are never retained', () => {
    prior().release()
    const root = {}
    acquireAndroidNavigation(root, '/settings')
    expect(claimAndroidRestoration(root, true)).toBeNull()
    expect(state().checkpoint?.path).toBe('/settings')
    observeAndroidPath(root, '/community?private=value')
    expect(state().checkpoint).toBeNull()
    observeAndroidPath(root, '/unknown')
    expect(state().checkpoint).toBeNull()
  })
  it.each([null, 'member-b'])(
    'identity %s in the gap prevents old restoration even after returning to A',
    (member) => {
      prior().release()
      identity(member)
      identity('member-a')
      const root = {}
      acquireAndroidNavigation(root, '/')
      expect(claimAndroidRestoration(root, true)).toBeNull()
      expect(state().checkpoint?.detailId).toBeNull()
    }
  )
  it('a different actual path beats pending restoration', () => {
    prior().release()
    const root = {}
    acquireAndroidNavigation(root, '/')
    expect(observeAndroidPath(root, '/wardrobe')).toBe('navigated')
    expect(claimAndroidRestoration(root, true)).toBeNull()
    expect(state().checkpoint?.path).toBe('/wardrobe')
  })
  it.each([
    'couturecast://settings?secret=a',
    'exp://127.0.0.1:8089/--/settings?secret=a',
    'https://app.test/settings?secret=a',
  ])('external %s wins and retains no URL/parameters', (url) => {
    const { old, release } = prior()
    setAndroidSpotlightDetail(old, 'owned-post')
    release()
    const root = {}
    acquireAndroidNavigation(root, '/')
    const request = claimAndroidRestoration(root, true)!
    externalAndroidNavigation(url)
    expect(isCurrentAndroidRestoration(root, request.serial)).toBe(false)
    expect(state().checkpoint).toEqual({
      member: 'member-a',
      path: '/settings',
      detailId: null,
    })
    expect(JSON.stringify(state())).not.toContain('secret')
  })
  it('a link arriving during a root gap never causes a competing replace', () => {
    prior().release()
    externalAndroidNavigation('couturecast://settings')
    const root = {}
    acquireAndroidNavigation(root, '/')
    expect(claimAndroidRestoration(root, true)).toBeNull()
    expect(state().checkpoint?.path).toBe('/settings')
    expect(observeAndroidPath(root, '/')).toBe('waiting')
    expect(observeAndroidPath(root, '/settings')).toBe('navigated')
  })
  it('invalid links still invalidate a claimed restoration', () => {
    prior().release()
    const root = {}
    acquireAndroidNavigation(root, '/')
    const request = claimAndroidRestoration(root, true)!
    externalAndroidNavigation('invalid')
    expect(isCurrentAndroidRestoration(root, request.serial)).toBe(false)
    expect(state().checkpoint).toBeNull()
  })
  it('retains a link listener across the gap and removes it when identity invalidates the checkpoint', () => {
    const remove = vi.fn()
    let incoming!: (url: string) => void
    const release = acquireAndroidNavigation({}, '/community', (listener) => {
      incoming = listener
      return remove
    })
    release()
    expect(remove).not.toHaveBeenCalled()
    incoming('couturecast://settings')
    expect(state().checkpoint?.path).toBe('/settings')
    identity(null)
    expect(remove).toHaveBeenCalledOnce()
  })
  it('a synchronous newer intent while claiming prevents the claim from being applied', () => {
    prior().release()
    const root = {}
    acquireAndroidNavigation(root, '/')
    const unsubscribe = subscribeAndroidNavigation(() => {
      if (state().restoration?.requested) androidNavigationIntent(root, '/')
    })
    const request = claimAndroidRestoration(root, true)!
    unsubscribe()
    expect(isCurrentAndroidRestoration(root, request.serial)).toBe(false)
  })
  it('detail IDs retain only in verified Community visits and clear on navigation', () => {
    const { old } = prior()
    setAndroidSpotlightDetail(old, 'own-post')
    expect(state().checkpoint?.detailId).toBe('own-post')
    setAndroidSpotlightDetail(old, 'own-post')
    expect(state().checkpoint?.detailId).toBe('own-post')
    observeAndroidPath(old, '/settings')
    setAndroidSpotlightDetail(old, 'foreign-detail')
    expect(state().checkpoint?.detailId).toBeNull()
  })
})
