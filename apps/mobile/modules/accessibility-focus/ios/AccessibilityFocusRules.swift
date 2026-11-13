import Foundation

/// The focus decisions behind AccessibilityFocusTarget, without UIKit, so they build and are
/// tested on Linux on every pull request (story 6.15 D6). AccessibilityFocusTarget reads the
/// UIKit views and asks these rules.
enum AccessibilityFocusRules {
  /// What VoiceOver needs from one view between the target and its window.
  struct Node {
    let isHidden: Bool
    let alpha: CGFloat
  }

  /// At or below this alpha UIKit treats a view as transparent.
  static let transparentAlpha: CGFloat = 0.01

  /// Whether VoiceOver can be moved to a view now: it sits in a window and neither it nor an
  /// ancestor (`chain`, from the view outwards) is hidden or transparent.
  static func canTakeFocus(inWindow: Bool, chain: [Node]) -> Bool {
    inWindow && chain.allSatisfy { !$0.isHidden && $0.alpha > transparentAlpha }
  }

  /// The React tags from a focused view outwards: React Native views carry theirs as a positive
  /// `UIView.tag`.
  static func tags(_ chain: [Int]) -> [Int] {
    chain.filter { $0 > 0 }
  }

  /// The element's own identifier, or, when it has none, the requested view's. Fabric's semantic
  /// provider may omit its ID.
  static func observationIdentifier(element: String?, requested: String?) -> String {
    if let element, !element.isEmpty { return element }
    return requested ?? ""
  }

  /// A semantic element counts when its frame is not empty and meets its window's.
  static func isOnScreen(_ frame: CGRect, window: CGRect) -> Bool {
    !frame.isEmpty && window.intersects(frame)
  }

  /// The one element whose frame is the view's; none when no element or several match.
  static func soleMatch<Element>(
    _ elements: [Element], frame: CGRect, frameOf: (Element) -> CGRect
  ) -> Element? {
    let matches = elements.filter { frameOf($0) == frame }
    return matches.count == 1 ? matches[0] : nil
  }
}
