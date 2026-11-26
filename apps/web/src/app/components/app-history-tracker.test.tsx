// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-UNIT-010 at the component seam: the root layout tracker
// installs the in-app history wrappers when it loads, so every router navigation is stamped with
// its entry position before the top bar back reads it. The history rules are
// lib/app-history.test.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = [
  string,
  EventListenerOrEventListenerObject,
  boolean | AddEventListenerOptions | undefined,
]
/**
 * jsdom's own addEventListener on window, taken before any spy replaces it. Vitest binds the
 * window's methods to the jsdom window, so calling EventTarget.prototype's with the test
 * global fails jsdom's brand check ("not a valid instance of EventTarget", CI job 140098473776).
 */
const originalAddEventListener = window.addEventListener.bind(window)
function nativeAddEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
) {
  originalAddEventListener(type, listener, options)
}
let listeners: Listener[] = []

function restoreNativeHistory() {
  Reflect.deleteProperty(window.history, 'pushState')
  Reflect.deleteProperty(window.history, 'replaceState')
}

/** A fresh document on `url` with the app router's own state, then the tracker module loaded. */
async function loadTracker(url: string) {
  restoreNativeHistory()
  window.history.replaceState({ __NA: true }, '', url)
  vi.resetModules()
  const tracker = await import('./app-history-tracker')
  const history = await import('../../lib/app-history')
  return { ...tracker, history }
}

beforeEach(() => {
  listeners = []
  vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    listeners.push([type, listener, options])
    nativeAddEventListener(type, listener, options)
  }) as typeof window.addEventListener)
})

afterEach(() => {
  for (const [type, listener, options] of listeners)
    window.removeEventListener(type, listener, options)
  restoreNativeHistory()
  vi.restoreAllMocks()
})

describe('7.11 AppHistoryTracker', () => {
  it('7.11-UNIT-010 renders nothing, and loading it makes the entry on show a direct entry', async () => {
    const { AppHistoryTracker, history } = await loadTracker('/wardrobe')

    const view = render(<AppHistoryTracker />)

    expect(view.container).toBeEmptyDOMElement()
    expect(history.hasAppHistoryBelow()).toBe(false)
    expect(window.history.state).toEqual({ __NA: true, __ccIdx: 0 })
  })

  it('7.11-UNIT-010 a router push after it loads is stamped with the next position', async () => {
    const { AppHistoryTracker, history } = await loadTracker('/wardrobe')
    render(<AppHistoryTracker />)

    window.history.pushState({ __NA: true }, '', '/wardrobe/silhouette')

    expect(window.history.state).toEqual({ __NA: true, __ccIdx: 1 })
    expect(history.hasAppHistoryBelow()).toBe(true)
  })

  it('7.11-UNIT-010 the module and its render install the wrappers once', async () => {
    const { AppHistoryTracker, history } = await loadTracker('/looks')
    const wrapped: unknown = Reflect.get(window.history, 'pushState')

    const view = render(<AppHistoryTracker />)
    view.rerender(<AppHistoryTracker />)
    history.installAppHistory()
    window.history.pushState({ __NA: true }, '', '/looks/plan')

    expect(Reflect.get(window.history, 'pushState')).toBe(wrapped)
    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(listeners.filter(([type]) => type === 'popstate')).toHaveLength(1)
  })
})
