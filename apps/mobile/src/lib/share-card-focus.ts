import { AccessibilityInfo } from 'react-native'
import { focusAccessibilityElement } from '../../modules/accessibility-focus'

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
