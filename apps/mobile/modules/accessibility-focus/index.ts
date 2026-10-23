// Story 6.7 owner: web and test build of the accessibility-focus observer. The
// DOM reports focus itself, so nothing here observes anything.
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
