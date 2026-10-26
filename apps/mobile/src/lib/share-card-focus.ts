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
