// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-UNIT-010..012, the in-app URL stack the top bar back
// reads (D11, P1, P8). Browser proof: playwright/tests/sub-screen-back.spec.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_SIGNED_OUT_EVENT,
  clearAppHistory,
  hasAppHistoryBelow,
  markAppHistoryReplace,
  recordAppUrl,
} from './app-history'

beforeEach(() => clearAppHistory())

describe('7.11-UNIT-010 push, pop and replace (D11)', () => {
  it('a first URL is a direct entry: nothing below it', () => {
    recordAppUrl('/wardrobe/capsules')
    expect(hasAppHistoryBelow()).toBe(false)
  })

  it('a new URL pushes, so back stays in the app', () => {
    recordAppUrl('/looks')
    recordAppUrl('/wardrobe/capsules')
    expect(hasAppHistoryBelow()).toBe(true)
  })

  it('returning to the URL below is a back step and pops', () => {
    recordAppUrl('/settings')
    recordAppUrl('/settings/style')
    recordAppUrl('/palette')
    recordAppUrl('/settings/style')
    expect(hasAppHistoryBelow()).toBe(true)
    recordAppUrl('/settings')
    expect(hasAppHistoryBelow()).toBe(false)
  })

  it('the same URL again (a layer entry, a re-render) changes nothing', () => {
    recordAppUrl('/community')
    recordAppUrl('/community')
    expect(hasAppHistoryBelow()).toBe(false)
    recordAppUrl('/notification-settings')
    recordAppUrl('/notification-settings')
    recordAppUrl('/community')
    expect(hasAppHistoryBelow()).toBe(false)
  })

  it('query strings are part of the URL (garment detail is /wardrobe?garment=)', () => {
    recordAppUrl('/wardrobe')
    recordAppUrl('/wardrobe?garment=g-1')
    expect(hasAppHistoryBelow()).toBe(true)
    recordAppUrl('/wardrobe')
    expect(hasAppHistoryBelow()).toBe(false)
  })

  it('a marked replace takes the top place and keeps the depth', () => {
    recordAppUrl('/looks')
    recordAppUrl('/wardrobe/capsules')
    markAppHistoryReplace()
    recordAppUrl('/looks/plan')
    expect(hasAppHistoryBelow()).toBe(true)
    // The replaced capsules URL is gone: /looks is still the entry below.
    recordAppUrl('/looks')
    expect(hasAppHistoryBelow()).toBe(false)
  })

  it('the back arrow on a direct entry replaces to the parent: one entry, nothing below', () => {
    recordAppUrl('/wardrobe/silhouette')
    markAppHistoryReplace()
    recordAppUrl('/wardrobe')
    expect(hasAppHistoryBelow()).toBe(false)
    recordAppUrl('/wardrobe/onboarding')
    expect(hasAppHistoryBelow()).toBe(true)
  })

  it('a replace mark applies to the next URL only', () => {
    recordAppUrl('/looks')
    markAppHistoryReplace()
    recordAppUrl('/looks')
    recordAppUrl('/looks/plan')
    expect(hasAppHistoryBelow()).toBe(true)
  })

  it('a replace mark with nothing recorded yet starts the stack', () => {
    markAppHistoryReplace()
    recordAppUrl('/settings')
    expect(hasAppHistoryBelow()).toBe(false)
    recordAppUrl('/settings/style')
    expect(hasAppHistoryBelow()).toBe(true)
  })
})

describe('7.11-UNIT-011 clear (D11)', () => {
  it('clearAppHistory forgets every entry and a pending replace mark', () => {
    recordAppUrl('/looks')
    recordAppUrl('/looks/plan')
    markAppHistoryReplace()
    clearAppHistory()
    expect(hasAppHistoryBelow()).toBe(false)
    recordAppUrl('/settings')
    recordAppUrl('/settings/style')
    expect(hasAppHistoryBelow(), 'the mark did not survive the clear').toBe(true)
  })
})

describe('7.11-UNIT-012 memory only, cleared on sign-out (P1, P8)', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')

  beforeEach(() => setItem.mockClear())
  afterEach(() => setItem.mockClear())

  it('writes nothing to localStorage or sessionStorage', () => {
    recordAppUrl('/wardrobe')
    recordAppUrl('/wardrobe?garment=previous-member-garment')
    markAppHistoryReplace()
    recordAppUrl('/wardrobe')
    expect(setItem).not.toHaveBeenCalled()
    expect(
      JSON.stringify({ ...window.localStorage, ...window.sessionStorage })
    ).not.toContain('previous-member-garment')
  })

  it('the sign-out event empties the stack, so the next member starts with no history', () => {
    recordAppUrl('/wardrobe')
    recordAppUrl('/wardrobe?garment=previous-member-garment')
    expect(hasAppHistoryBelow()).toBe(true)
    window.dispatchEvent(new Event(APP_SIGNED_OUT_EVENT))
    expect(hasAppHistoryBelow()).toBe(false)
    recordAppUrl('/wardrobe?garment=previous-member-garment')
    expect(hasAppHistoryBelow(), 'nothing left below after sign-out').toBe(false)
  })
})
