import UIKit

/// The UIKit decisions behind the accessibility-focus module, kept free of Expo
/// so they can be tested on their own.
public enum AccessibilityFocusTarget {
  /// Whether VoiceOver can be moved to `view` now: it exists, sits in a window
  /// and neither it nor an ancestor is hidden. A view React Native has not yet
  /// reattached after a navigation fails this, and the caller asks again.
  public static func canTakeFocus(_ view: UIView?) -> Bool {
    guard let view, view.window != nil else { return false }
    var current: UIView? = view
    while let node = current {
      if node.isHidden || node.alpha <= 0.01 { return false }
      current = node.superview
    }
    return true
  }

  /// The native view tags from a focused element outwards. React Native views
  /// carry their React tag as `UIView.tag`.
  public static func tags(of element: Any?) -> [Int] {
    var view = element as? UIView
    if view == nil, let accessibilityElement = element as? UIAccessibilityElement {
      view = accessibilityElement.accessibilityContainer as? UIView
    }
    var tags: [Int] = []
    while let current = view {
      if current.tag > 0 { tags.append(current.tag) }
      view = current.superview
    }
    return tags
  }
}
