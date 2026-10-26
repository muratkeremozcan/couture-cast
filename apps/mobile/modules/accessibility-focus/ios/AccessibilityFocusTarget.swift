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

  /// Reports a posted request only after the UIKit post call has been invoked.
  public static func requestLayoutChange(
    _ view: UIView?,
    post: (UIAccessibility.Notification, Any?) -> Void = { UIAccessibility.post(notification: $0, argument: $1) },
    didPost: (UIView) -> Void = { _ in }
  ) -> Bool {
    guard canTakeFocus(view), let view else { return false }
    post(.layoutChanged, view)
    didPost(view)
    return true
  }

  /// Read concrete UIKit types directly. UIView's declared category protocol
  /// conformance can be absent from a runtime protocol cast in a hostless runner.
  /// Fabric's semantic provider may omit its ID, so retain the requested view ID.
  public static func observationIdentifier(of element: NSObject?, requestedView: UIView?) -> String {
    let identifier: String?
    if let view = element as? UIView {
      identifier = view.accessibilityIdentifier
    } else if let provider = element as? UIAccessibilityElement {
      identifier = provider.accessibilityIdentifier
    } else {
      identifier = (element as? UIAccessibilityIdentification)?.accessibilityIdentifier
    }
    if let identifier, !identifier.isEmpty { return identifier }
    return requestedView?.accessibilityIdentifier ?? ""
  }

  /// UIKit containers may expose semantic elements outside the UIView subtree.
  /// Fabric paragraphs use this path for their RCTAccessibilityElement provider.
  public static func containerView(of element: NSObject?) -> UIView? {
    var current = element
    var seen = Set<ObjectIdentifier>()
    while let node = current, seen.insert(ObjectIdentifier(node)).inserted {
      if let view = node as? UIView { return view }
      current = (node as? UIAccessibilityElement)?.accessibilityContainer as? NSObject
    }
    return nil
  }

  public static func visibleSemanticElements(in root: UIView) -> [NSObject] {
    var seen = Set<ObjectIdentifier>()
    func visit(_ node: NSObject) -> [NSObject] {
      guard seen.insert(ObjectIdentifier(node)).inserted,
        let container = containerView(of: node),
        let window = (container as? UIWindow) ?? container.window,
        !window.isHidden, window.alpha > 0.01, !window.bounds.isEmpty,
        container is UIWindow || canTakeFocus(container)
      else { return [] }
      // UIWindow is the root container. Its own UIView.window can be nil and
      // UIKit may expose window semantics separately from its app descendants.
      if node.isAccessibilityElement && !(node is UIWindow) {
        let frame = node.accessibilityFrame
        return !frame.isEmpty && window.convert(window.bounds, to: nil).intersects(frame) ? [node] : []
      }
      let provided = (node.accessibilityElements ?? []).compactMap { $0 as? NSObject }
      let children: [NSObject] = (node as? UIView)?.subviews ?? []
      return (provided + children).flatMap { visit($0) }
    }
    return visit(root)
  }

  public static func semanticTarget(_ view: UIView?) -> NSObject? {
    guard let view, canTakeFocus(view) else { return nil }
    if view.isAccessibilityElement { return view }
    let frame = view.convert(view.bounds, to: nil)
    let elements = visibleSemanticElements(in: view).filter { $0.accessibilityFrame == frame }
    return elements.count == 1 ? elements[0] : nil
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
