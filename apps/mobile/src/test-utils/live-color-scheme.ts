// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9: a stand-in for `useColorScheme` that re-renders its readers when the scheme
// flips, the way the OS setting does while the app is open (R9). Use it from a `react-native`
// mock: `useColorScheme: liveColorScheme.useColorScheme`.
import { useSyncExternalStore } from 'react'

type Scheme = 'light' | 'dark'

let current: Scheme = 'light'
const listeners = new Set<() => void>()

export const liveColorScheme = {
  useColorScheme: (): Scheme =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => current
    ),
  /** Flips the scheme and re-renders every reader (wrap in `act`). */
  set: (next: Scheme) => {
    current = next
    listeners.forEach((listener) => listener())
  },
  reset: () => {
    current = 'light'
  },
}
