// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the state half of the tab navigator double in
// `tab-navigation.tsx`. An expo-router mock factory imports this module, so it must import
// nothing that imports expo-router: AppTopBar does, and a factory that loads it waits on the
// module it is still building, which fails the mock (vitest "error when mocking a module").
// Only types come from app-top-bar here; they are erased at runtime.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import type { renderTabTopBar } from '@/src/components/app-top-bar'

export type TabOptions = Parameters<typeof renderTabTopBar>[0]['options']

const listeners = new Set<() => void>()
let current: TabOptions = {}

/** The one navigation object every screen in the suite gets (stable, as a real navigator's). */
export const tabNavigation = {
  setOptions: (next: Partial<TabOptions>) => {
    current = { ...current, ...next }
    for (const listener of [...listeners]) listener()
  },
  /** The options the screen has set so far. */
  get options(): TabOptions {
    return current
  },
  /** Clears the set options; call it in `afterEach`. */
  reset() {
    current = {}
    listeners.clear()
  },
}

/** The expo-router `useNavigation` the mock factory hands out. */
export function useTabNavigation() {
  return tabNavigation
}

/** Subscribes to option changes, for `useSyncExternalStore`. */
export function subscribeTabOptions(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The options the screen has set so far, for `useSyncExternalStore`. */
export function currentTabOptions(): TabOptions {
  return current
}
