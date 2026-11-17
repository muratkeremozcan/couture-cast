/**
 * One OS accessibility-focus change. `tags` are the native view tags from the
 * focused element outwards, so the first is the element itself and the rest
 * are its ancestors; empty when nothing holds accessibility focus.
 */
export interface AccessibilityFocusChange {
  tags: number[]
}

export type AccessibilityFocusListener = (change: AccessibilityFocusChange) => void

/**
 * How an Android focus move that waits for TalkBack's own first focus in a new window ended:
 * `focused` once the view holds TalkBack focus; `superseded` when a later focus request replaced
 * it; otherwise the stage that did not complete within the bound (`no_screen_reader` at once).
 */
export type InitialFocusPlacementOutcome =
  | 'focused'
  | 'superseded'
  | 'no_screen_reader'
  | 'no_target'
  | 'no_window_focus'
  | 'no_initial_placement'
  | 'not_held'
