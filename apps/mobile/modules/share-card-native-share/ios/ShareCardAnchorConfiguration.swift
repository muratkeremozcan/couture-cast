import CoreGraphics
import Foundation

/// Where the iPad popover points. `sourceView` is the presenter's own view.
struct ShareCardPopoverAnchor<View: AnyObject> {
  let sourceView: View
  /// In `sourceView` coordinates.
  let sourceRect: CGRect
}

/// Pure anchor decisions, generic over the view type so they run under XCTest without UIKit.
enum ShareCardAnchorConfiguration {
  /// Reads the Share button frame JS measured in window coordinates. Anything malformed falls back
  /// to the presenter's center, so a bad anchor can never block the share.
  static func anchor(from value: [String: Any]?) -> CGRect? {
    guard let value else { return nil }
    let numbers = ["x", "y", "width", "height"].compactMap { (value[$0] as? NSNumber)?.doubleValue }
    guard numbers.count == 4, numbers.allSatisfy({ $0.isFinite && abs($0) <= 100_000 }),
      numbers[2] >= 0, numbers[3] >= 0
    else { return nil }
    return CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
  }

  /// `fromWindow` converts a window rect into `presenterView` coordinates.
  static func configure<View: AnyObject>(
    presenterView: View?,
    bounds: CGRect,
    anchor: CGRect?,
    fromWindow: (CGRect) -> CGRect
  ) -> Result<ShareCardPopoverAnchor<View>, ShareCardShareCode> {
    guard let presenterView else { return .failure(.presenterUnavailable) }
    let rect = anchor.map(fromWindow) ?? CGRect(x: bounds.midX, y: bounds.midY, width: 0, height: 0)
    return .success(ShareCardPopoverAnchor(sourceView: presenterView, sourceRect: rect))
  }
}
