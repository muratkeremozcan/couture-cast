// Story 6.7 owner: native build of the accessibility-focus observer. React
// Native reports no screen-reader focus, so this local module listens to the OS:
// iOS `UIAccessibility.elementFocusedNotification`, Android the accessibility
// events that pass the window's decor view. Expo Go carries no local module, so
// there the observer is absent and callers fall back to what they can see.
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core'
import type { AccessibilityFocusChange, AccessibilityFocusListener } from './types'

export type { AccessibilityFocusChange, AccessibilityFocusListener } from './types'

interface AccessibilityFocusModule {
  addListener(
    event: 'onAccessibilityFocusChange',
    listener: (change: AccessibilityFocusChange) => void
  ): EventSubscription
}

const nativeModule =
  requireOptionalNativeModule<AccessibilityFocusModule>('AccessibilityFocus')

/**
 * Subscribes to OS accessibility-focus changes. Returns the unsubscribe, or null
 * when this build cannot observe them.
 */
export function observeAccessibilityFocus(
  listener: AccessibilityFocusListener
): (() => void) | null {
  if (!nativeModule) return null
  const subscription = nativeModule.addListener('onAccessibilityFocusChange', listener)
  return () => subscription.remove()
}
