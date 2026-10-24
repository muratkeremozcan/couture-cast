// Story 6.7 owner: web and test build of the accessibility-focus module. The
// DOM moves and reports focus itself, so nothing here does either.
import type { AccessibilityFocusListener } from './types'

export type { AccessibilityFocusChange, AccessibilityFocusListener } from './types'

/**
 * Subscribes to OS accessibility-focus changes. Returns the unsubscribe, or null
 * when this build cannot observe them.
 */
export function observeAccessibilityFocus(
  _listener: AccessibilityFocusListener
): (() => void) | null {
  return null
}

/**
 * Asks the screen reader to move its cursor to the view with this native tag.
 * Resolves whether the view accepted it; null when this build has no module.
 */
export function focusAccessibilityElement(_tag: number): Promise<boolean> | null {
  return null
}
