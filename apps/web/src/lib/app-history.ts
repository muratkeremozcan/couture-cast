// Story CC-7.11 D11 owner: the in-app history the top bar back reads.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
//
// Entry identity, not URL equality (review #1): the `history.pushState` and `replaceState`
// wrappers below stamp each entry's position into its state (`__ccIdx`). A push stamps the next
// position, a replace keeps the position of the entry it replaces, and a popstate reads the
// position it landed on. The Next app router owns the rest of `history.state`, so the stamp rides
// alongside its keys. Memory only (TEA P1): this document's first position is where it loaded,
// so a reload or a typed URL is a direct entry and its back replaces to the parent tab. Sign-out
// moves the first position up to the current one (TEA P8).

/** The state key that carries an entry's position in this tab's history. */
export const APP_HISTORY_INDEX_KEY = '__ccIdx'

/** The browser event sign-out dispatches; open layers close and the stack clears on it. */
export const APP_SIGNED_OUT_EVENT = 'couture:signed-out'

/** The position of the entry on screen. */
let current = 0
/** The position this document started at, or the last sign-out; nothing below it counts. */
let first = 0
let installed = false

type HistoryState = Record<string, unknown>

/** The position stamped into a history state, or undefined for an entry without one. */
export function appHistoryIndexOf(state: unknown): number | undefined {
  if (state === null || typeof state !== 'object') return undefined
  const index = (state as HistoryState)[APP_HISTORY_INDEX_KEY]
  return typeof index === 'number' && Number.isInteger(index) ? index : undefined
}

/**
 * The state with its position stamped in. A null state passes through unstamped: the router
 * reloads the page on a popstate to a non-null state without its own keys, so only a state that
 * is already an object is extended.
 */
function stamped(data: unknown, index: number): unknown {
  if (data === null || typeof data !== 'object') return data
  return { ...(data as HistoryState), [APP_HISTORY_INDEX_KEY]: index }
}

/** The position of the entry on screen. */
export function currentAppHistoryIndex(): number {
  return current
}

/** Whether an in-app entry sits below the one on screen, so a back step stays in the app. */
export function hasAppHistoryBelow(): boolean {
  return current > first
}

/** Forgets every entry below the one on screen (sign-out, and test isolation). */
export function clearAppHistory(): void {
  first = current
}

/**
 * Wraps `pushState` and `replaceState` and follows `popstate`. Runs once, when this module loads
 * in the browser: before the app router patches the same methods, so the router's wrapper calls
 * these and every navigation, the router's own included, is stamped.
 */
export function installAppHistory(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const { history } = window
  const push = history.pushState.bind(history)
  const replace = history.replaceState.bind(history)

  const loaded = appHistoryIndexOf(history.state)
  current = loaded ?? 0
  first = current
  if (loaded === undefined && history.state !== null && typeof history.state === 'object')
    replace(stamped(history.state, current), '')

  history.pushState = function pushState(
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    const index = current + 1
    push(stamped(data, index), unused, url)
    current = index
  }
  history.replaceState = function replaceState(
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    replace(stamped(data, current), unused, url)
  }
  // Capture, so the position is known before any other popstate listener reads it.
  window.addEventListener(
    'popstate',
    (event: PopStateEvent) => {
      const index = appHistoryIndexOf(event.state)
      current = index ?? first
      if (current < first) first = current
    },
    true
  )
  window.addEventListener(APP_SIGNED_OUT_EVENT, clearAppHistory)
}

installAppHistory()
