// Story 6.7: a screen rendered outside a navigator counts as focused while it is
// mounted, so `useFocusEffect` runs once on mount and cleans up on unmount.
import { useEffect } from 'react'

export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(effect, [effect])
}
