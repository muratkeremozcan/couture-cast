import { AccessibilityInfo } from 'react-native'
import {
  focusAccessibilityElement,
  focusAccessibilityElementAfterPlacement,
} from '../../modules/accessibility-focus'

/**
 * Android, a dialog window that just appeared: moves TalkBack to the element once TalkBack has
 * placed its own first focus there, which would otherwise overwrite the move (main run
 * 44076358778). When that did not land, the single-shot move runs; a newer request that
 * replaced it moves nothing. Without the native call (iOS, Expo Go) it is the single shot.
 */
export function focusShareCardElementAfterPlacement(
  tag: number | null,
  isCurrent: () => boolean = () => true
): void {
  if (!tag || !isCurrent()) return
  const placing = focusAccessibilityElementAfterPlacement(tag)
  if (!placing) return focusShareCardElement(tag, isCurrent)
  void placing
    .catch(() => null)
    .then((outcome) => {
      if (outcome !== 'focused' && outcome !== 'superseded')
        focusShareCardElement(tag, isCurrent)
    })
}

export function focusShareCardElement(
  tag: number | null,
  isCurrent: () => boolean = () => true
): void {
  if (!tag || !isCurrent()) return
  const moving = focusAccessibilityElement(tag)
  if (!moving) AccessibilityInfo.setAccessibilityFocus(tag)
  else
    void moving
      .catch(() => false)
      .then((focused) => {
        if (!focused && isCurrent()) AccessibilityInfo.setAccessibilityFocus(tag)
      })
}

export type ShareCardHeadingScope = 'outfit' | 'community'
const headingNodes = new Map<ShareCardHeadingScope, () => number | null>()
/** The existing navigation title remains the fallback when an invoking card disappears. */
export function registerShareCardHeading(
  scope: ShareCardHeadingScope,
  node: () => number | null
) {
  headingNodes.set(scope, node)
  return () => {
    if (headingNodes.get(scope) === node) headingNodes.delete(scope)
  }
}
export function shareCardHeadingNode(scope: ShareCardHeadingScope): number | null {
  return headingNodes.get(scope)?.() ?? null
}
