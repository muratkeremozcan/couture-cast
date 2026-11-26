// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-UNIT-010..012, the in-app history the top bar back reads
// (D11, P1, P8): entry positions stamped into `history.state` (`__ccIdx`), never URL equality
// (Codex 7.11 #1). Browser proof: playwright/tests/sub-screen-back.spec.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AppHistory from './app-history'

/**
 * Every test loads a fresh document: the jsdom history methods are restored, the entry on show
 * gets the state the app router writes, and a fresh module installs its wrappers over them. The
 * tests then navigate the way the router does (`pushState` / `replaceState` with its state
 * object) and traverse with the real `history.back()` / `forward()`, whose popstate jsdom
 * delivers on a later task.
 */
type Listener = [
  string,
  EventListenerOrEventListenerObject,
  boolean | AddEventListenerOptions | undefined,
]
/** jsdom's own addEventListener on window, around the spy that records module listeners. */
function nativeAddEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
) {
  EventTarget.prototype.addEventListener.call(window, type, listener, options)
}
let listeners: Listener[] = []

function removeModuleListeners() {
  for (const [type, listener, options] of listeners)
    window.removeEventListener(type, listener, options)
  listeners = []
}

function restoreNativeHistory() {
  Reflect.deleteProperty(window.history, 'pushState')
  Reflect.deleteProperty(window.history, 'replaceState')
}

/** The router state for a URL, as the app router writes it (its own keys only). */
const routerState = (url: string) => ({
  __NA: true,
  __PRIVATE_NEXTJS_INTERNALS_TREE: url,
})

/**
 * Loads `url` as a new document. `state` is what `history.state` holds on load: the router's own
 * keys on a first visit, or a stamped state on a reload (the browser keeps it).
 */
async function loadDocument(
  url: string,
  state: unknown = routerState(url)
): Promise<typeof AppHistory> {
  removeModuleListeners()
  restoreNativeHistory()
  window.history.replaceState(state, '', url)
  vi.resetModules()
  return import('./app-history')
}

const push = (url: string) => window.history.pushState(routerState(url), '', url)
const replace = (url: string) => window.history.replaceState(routerState(url), '', url)
const stateIndex = () => (window.history.state as Record<string, unknown>).__ccIdx

/** Waits until jsdom's queued traversal tasks have run and their popstate was delivered. */
async function settle() {
  for (let round = 0; round < 10; round++)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

async function back() {
  window.history.back()
  await settle()
}

async function forward() {
  window.history.forward()
  await settle()
}

beforeEach(() => {
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
  removeModuleListeners()
  restoreNativeHistory()
  vi.restoreAllMocks()
})

describe('7.11-UNIT-010 push, pop and replace by entry position (D11)', () => {
  it('a direct entry has nothing below it, and its router state is stamped in place', async () => {
    const history = await loadDocument('/wardrobe/capsules')

    expect(history.hasAppHistoryBelow()).toBe(false)
    expect(history.currentAppHistoryIndex()).toBe(0)
    expect(window.history.state).toEqual({
      ...routerState('/wardrobe/capsules'),
      [history.APP_HISTORY_INDEX_KEY]: 0,
    })
  })

  it('a push stamps the next position beside the router keys, so back stays in the app', async () => {
    const history = await loadDocument('/looks')

    push('/wardrobe/capsules')

    expect(history.hasAppHistoryBelow()).toBe(true)
    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(window.history.state).toEqual({
      ...routerState('/wardrobe/capsules'),
      __ccIdx: 1,
    })
  })

  it('browser back lands on the position below and forward returns to it', async () => {
    const history = await loadDocument('/settings')
    push('/settings/style')
    push('/palette')

    await back()
    expect(window.location.pathname).toBe('/settings/style')
    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(history.hasAppHistoryBelow()).toBe(true)

    await back()
    expect(window.location.pathname).toBe('/settings')
    expect(history.hasAppHistoryBelow()).toBe(false)

    await forward()
    expect(window.location.pathname).toBe('/settings/style')
    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(history.hasAppHistoryBelow()).toBe(true)
  })

  it('[Codex 7.11 #1] Plan opened directly, then Today, then Plan again: back from Plan goes to Today', async () => {
    const history = await loadDocument('/looks/plan')
    push('/')
    push('/looks/plan')

    // The second Plan has two entries below it. The old URL stack read the repeat Plan URL as a
    // pop to the first one, found nothing below and replaced to Looks.
    expect(history.currentAppHistoryIndex()).toBe(2)
    expect(history.hasAppHistoryBelow()).toBe(true)

    await back()
    expect(window.location.pathname).toBe('/')
    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(history.hasAppHistoryBelow()).toBe(true)

    await back()
    expect(window.location.pathname).toBe('/looks/plan')
    expect(history.hasAppHistoryBelow(), 'the first Plan is the direct entry').toBe(false)
  })

  it('[Codex 7.11 #1] a visit to the URL two entries back is a push, never a pop', async () => {
    const history = await loadDocument('/settings')
    push('/settings/style')
    push('/settings')

    expect(history.currentAppHistoryIndex()).toBe(2)
    expect(stateIndex()).toBe(2)
    expect(history.hasAppHistoryBelow()).toBe(true)

    await back()
    expect(window.location.pathname).toBe('/settings/style')
    expect(history.hasAppHistoryBelow()).toBe(true)
  })

  it('the same URL pushed again (a layer entry) takes its own position', async () => {
    const history = await loadDocument('/community')

    window.history.pushState({ ...window.history.state, __ccLayer: 1 }, '', '/community')

    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(history.hasAppHistoryBelow()).toBe(true)
    await back()
    expect(history.currentAppHistoryIndex()).toBe(0)
    expect(history.hasAppHistoryBelow()).toBe(false)
  })

  it('query strings are their own entries (garment detail is /wardrobe?garment=)', async () => {
    const history = await loadDocument('/wardrobe')
    push('/wardrobe?garment=g-1')

    expect(history.hasAppHistoryBelow()).toBe(true)
    await back()
    expect(window.location.search).toBe('')
    expect(history.hasAppHistoryBelow()).toBe(false)
  })

  it('a replace keeps the position of the entry it replaces', async () => {
    const history = await loadDocument('/looks')
    push('/wardrobe/capsules')

    replace('/looks/plan')

    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(window.history.state).toEqual({ ...routerState('/looks/plan'), __ccIdx: 1 })
    expect(history.hasAppHistoryBelow()).toBe(true)
    // The replaced capsules entry is gone: Looks is the entry below.
    await back()
    expect(window.location.pathname).toBe('/looks')
    expect(history.hasAppHistoryBelow()).toBe(false)
  })

  it('[Codex 7.11 #1] after the legacy /?planner=1 redirect (a replace), the next push is a push and back works', async () => {
    // The server redirects /?planner=1 to /looks/plan with its query; Plan drops the query
    // through a router replace.
    const history = await loadDocument('/looks/plan?planner=1')
    replace('/looks/plan')
    expect(history.currentAppHistoryIndex()).toBe(0)
    expect(history.hasAppHistoryBelow()).toBe(false)

    // No replace flag outlives the redirect: the next navigation pushes.
    push('/looks')
    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(history.hasAppHistoryBelow()).toBe(true)

    await back()
    expect(window.location.pathname).toBe('/looks/plan')
    expect(history.hasAppHistoryBelow()).toBe(false)
  })

  it('[Codex 7.11 #1] the legacy redirect reached from inside the app keeps the entry below it', async () => {
    const history = await loadDocument('/looks')
    push('/looks/plan?planner=1')
    replace('/looks/plan')
    push('/')

    expect(history.currentAppHistoryIndex()).toBe(2)
    await back()
    expect(window.location.pathname).toBe('/looks/plan')
    expect(history.hasAppHistoryBelow()).toBe(true)
    await back()
    expect(window.location.pathname).toBe('/looks')
    expect(history.hasAppHistoryBelow()).toBe(false)
  })

  it('the back arrow on a direct entry replaces to the parent: one entry, nothing below', async () => {
    const history = await loadDocument('/wardrobe/silhouette')

    replace('/wardrobe')
    expect(history.hasAppHistoryBelow()).toBe(false)

    push('/wardrobe/onboarding')
    expect(history.hasAppHistoryBelow()).toBe(true)
  })

  it('a reload is a direct entry: the stamped position it reloads at has nothing below', async () => {
    let history = await loadDocument('/looks')
    push('/looks/plan')
    expect(stateIndex()).toBe(1)

    // The browser keeps `history.state` across a reload, stamp included.
    history = await loadDocument('/looks/plan', window.history.state)
    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(history.hasAppHistoryBelow()).toBe(false)

    push('/')
    expect(history.currentAppHistoryIndex()).toBe(2)
    expect(history.hasAppHistoryBelow()).toBe(true)

    await back()
    expect(history.hasAppHistoryBelow()).toBe(false)

    // Back below the reload reaches an entry of the previous document: still nothing below.
    await back()
    expect(window.location.pathname).toBe('/looks')
    expect(history.currentAppHistoryIndex()).toBe(0)
    expect(history.hasAppHistoryBelow()).toBe(false)
  })

  it('a popstate onto an entry without a position counts as the first one', async () => {
    const history = await loadDocument('/wardrobe')
    push('/wardrobe/silhouette')

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))

    expect(history.currentAppHistoryIndex()).toBe(0)
    expect(history.hasAppHistoryBelow()).toBe(false)
  })

  it('a null state passes through unstamped', async () => {
    await loadDocument('/wardrobe')

    window.history.pushState(null, '', '/wardrobe/silhouette')

    expect(window.history.state).toBeNull()
  })

  it('the position is known before any other popstate listener reads it (capture)', async () => {
    const history = await loadDocument('/looks')
    push('/looks/plan')
    push('/')
    const seen: number[] = []
    const read = () => seen.push(history.currentAppHistoryIndex())
    nativeAddEventListener('popstate', read)

    try {
      await back()
    } finally {
      window.removeEventListener('popstate', read)
    }
    expect(seen).toEqual([1])
  })

  it('installing twice wraps once: one push moves one position', async () => {
    const history = await loadDocument('/looks')
    const wrapped: unknown = Reflect.get(window.history, 'pushState')

    history.installAppHistory()
    push('/looks/plan')

    expect(Reflect.get(window.history, 'pushState')).toBe(wrapped)
    expect(history.currentAppHistoryIndex()).toBe(1)
    expect(stateIndex()).toBe(1)
  })

  it('appHistoryIndexOf reads only an integer position', async () => {
    const history = await loadDocument('/looks')

    expect(history.appHistoryIndexOf({ __ccIdx: 3 })).toBe(3)
    expect(history.appHistoryIndexOf({ __ccIdx: 1.5 })).toBeUndefined()
    expect(history.appHistoryIndexOf({ __ccIdx: '3' })).toBeUndefined()
    expect(history.appHistoryIndexOf({})).toBeUndefined()
    expect(history.appHistoryIndexOf(null)).toBeUndefined()
    expect(history.appHistoryIndexOf('3')).toBeUndefined()
  })
})

describe('7.11-UNIT-011 clear (D11)', () => {
  it('clearAppHistory forgets every entry below; later pushes count again', async () => {
    const history = await loadDocument('/looks')
    push('/looks/plan')
    push('/settings')

    history.clearAppHistory()
    expect(history.hasAppHistoryBelow()).toBe(false)

    push('/settings/style')
    expect(history.hasAppHistoryBelow()).toBe(true)
    await back()
    expect(history.hasAppHistoryBelow()).toBe(false)
    // Back past the cleared point still finds nothing below.
    await back()
    expect(window.location.pathname).toBe('/looks/plan')
    expect(history.hasAppHistoryBelow()).toBe(false)
  })
})

describe('7.11-UNIT-012 memory only, cleared on sign-out (P1, P8)', () => {
  it('writes nothing to localStorage or sessionStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await loadDocument('/wardrobe')

    push('/wardrobe?garment=previous-member-garment')
    replace('/wardrobe')
    await back()

    expect(setItem).not.toHaveBeenCalled()
    expect(
      JSON.stringify({ ...window.localStorage, ...window.sessionStorage })
    ).not.toContain('previous-member-garment')
  })

  it('the sign-out event empties the history, so the next member starts with nothing below', async () => {
    const history = await loadDocument('/wardrobe')
    push('/wardrobe?garment=previous-member-garment')
    expect(history.hasAppHistoryBelow()).toBe(true)

    window.dispatchEvent(new Event(history.APP_SIGNED_OUT_EVENT))
    expect(history.hasAppHistoryBelow()).toBe(false)

    push('/settings')
    expect(history.hasAppHistoryBelow(), 'the next member navigates normally').toBe(true)
    await back()
    expect(history.hasAppHistoryBelow(), 'nothing of the previous member below').toBe(
      false
    )
    await back()
    expect(history.hasAppHistoryBelow()).toBe(false)
  })
})
