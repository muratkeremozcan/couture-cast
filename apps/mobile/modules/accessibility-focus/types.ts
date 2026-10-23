/**
 * One OS accessibility-focus change. `tags` are the native view tags from the
 * focused element outwards, so the first is the element itself and the rest
 * are its ancestors; empty when nothing holds accessibility focus.
 */
export interface AccessibilityFocusChange {
  tags: number[]
}

export type AccessibilityFocusListener = (change: AccessibilityFocusChange) => void
