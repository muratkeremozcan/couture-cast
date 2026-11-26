// Story CC-7.11 D11 owner: the in-app history the top bar back reads.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
//
// A URL stack, since the Next app router owns `history.state`. It lives in memory only (TEA P1):
// a reload or a typed URL starts a fresh document with an empty stack, so its back is a direct
// entry and replaces to the parent tab. Sign-out clears it (TEA P8).

/** The URLs of this document's in-app history, oldest first; the last one is on screen. */
let stack: string[] = []

/** Set by a replace to another URL, so the next URL takes the top's place. */
let replaceNext = false

/**
 * Records the URL on screen: one equal to the entry below is a back step and pops; a new one
 * pushes, or takes the top's place after a replace.
 */
export function recordAppUrl(url: string): void {
  const replacing = replaceNext
  replaceNext = false
  if (stack[stack.length - 1] === url) return
  if (replacing) {
    stack[Math.max(stack.length - 1, 0)] = url
    return
  }
  if (stack[stack.length - 2] === url) {
    stack.pop()
    return
  }
  stack.push(url)
}

/** Whether an in-app entry sits below the URL on screen, so a back step stays in the app. */
export function hasAppHistoryBelow(): boolean {
  return stack.length >= 2
}

/**
 * Marks the next URL as a replace. `history.replaceState` to another URL marks it already (see
 * `watchReplaces`); this is for a replace that does not go through it.
 */
export function markAppHistoryReplace(): void {
  replaceNext = true
}

/** Forgets every entry (sign-out, and test isolation). */
export function clearAppHistory(): void {
  stack = []
  replaceNext = false
}

/** The browser event sign-out dispatches; open layers close and the stack clears on it. */
export const APP_SIGNED_OUT_EVENT = 'couture:signed-out'

/**
 * Every replace to another URL goes through `history.replaceState`: `router.replace`, and the
 * app's own in-place URL edits (the garment detail closing on a direct entry, a consumed query).
 * The router also calls it with the URL already shown on each commit, which is no navigation.
 */
function watchReplaces() {
  const original = window.history.replaceState.bind(window.history)
  window.history.replaceState = function replaceState(
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    if (url !== undefined && url !== null) {
      // The tracker records path and query only, so a hash-only replace is no navigation: a
      // mark left by one would turn the next real push into a replace.
      const next = new URL(String(url), window.location.href)
      const here = new URL(window.location.href)
      if (next.pathname !== here.pathname || next.search !== here.search)
        replaceNext = true
    }
    return original(data, unused, url)
  }
}

if (typeof window !== 'undefined') {
  watchReplaces()
  window.addEventListener(APP_SIGNED_OUT_EVENT, clearAppHistory)
}
