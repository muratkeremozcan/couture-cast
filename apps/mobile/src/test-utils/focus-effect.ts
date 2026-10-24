// Story 6.7: a navigator double for `useFocusEffect`. A screen rendered outside
// a navigator counts as focused while mounted, and a test can blur and refocus
// every mounted screen through `screenFocus`, the way a tab press or Android
// back does.
import { useEffect } from 'react'

type FocusListener = (focused: boolean) => void

export const screenFocus = {
  focused: true,
  listeners: new Set<FocusListener>(),
  set(focused: boolean) {
    this.focused = focused
    for (const listener of [...this.listeners]) listener(focused)
  },
  reset() {
    this.focused = true
    this.listeners.clear()
  },
}

export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(() => {
    let cleanup: (() => void) | undefined
    const apply = (focused: boolean) => {
      if (focused && !cleanup) cleanup = effect() ?? (() => undefined)
      else if (!focused && cleanup) {
        cleanup()
        cleanup = undefined
      }
    }
    apply(screenFocus.focused)
    screenFocus.listeners.add(apply)
    return () => {
      screenFocus.listeners.delete(apply)
      cleanup?.()
    }
  }, [effect])
}
