// Story 6.7 owner: native build of the accessibility-focus module. React Native
// reports no screen-reader focus, and TalkBack ignores its Android focus call for
// a view that cannot take input focus, so this local module talks to the OS. It
// moves the screen reader's cursor (Android `ACTION_ACCESSIBILITY_FOCUS`, iOS a
// layout-changed notification) and reports where the cursor is (iOS
// `UIAccessibility.elementFocusedNotification`, Android the accessibility events
// passing the window's decor view). Expo Go carries no local module, so there it
// is absent and callers fall back to React Native and to what they can see.
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core'
import type { AccessibilityFocusChange, AccessibilityFocusListener } from './types'

export type { AccessibilityFocusChange, AccessibilityFocusListener } from './types'

interface AccessibilityFocusModule {
  focus(tag: number): Promise<boolean>
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

/**
 * Asks the screen reader to move its cursor to the view with this native tag.
 * Resolves whether the view accepted it; null when this build has no module.
 */
export function focusAccessibilityElement(tag: number): Promise<boolean> | null {
  return nativeModule ? nativeModule.focus(tag) : null
}
