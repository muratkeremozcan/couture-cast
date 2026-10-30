import CoreGraphics
import XCTest
@testable import ShareCardShareCore

/// N-IOS-ANCHOR: sourceView is the presenter's view and sourceRect is the JS Share frame.
final class ShareCardAnchorConfigurationTests: XCTestCase {
  final class View {}

  func testSourceViewIsThePresenterViewAndSourceRectIsTheShareFrame() throws {
    let view = View()
    let share = CGRect(x: 24, y: 700, width: 160, height: 48)
    let configured = ShareCardAnchorConfiguration.configure(
      presenterView: view, bounds: CGRect(x: 0, y: 0, width: 390, height: 844), anchor: share,
      fromWindow: { $0 })
    let popover = try configured.get()
    XCTAssertTrue(popover.sourceView === view)
    XCTAssertEqual(popover.sourceRect, share)
  }

  func testWindowFrameIsConvertedIntoThePresenterView() throws {
    // An iPad form sheet whose view starts at (100, 50) in the window.
    let configured = ShareCardAnchorConfiguration.configure(
      presenterView: View(), bounds: CGRect(x: 0, y: 0, width: 540, height: 620),
      anchor: CGRect(x: 124, y: 610, width: 160, height: 48),
      fromWindow: { $0.offsetBy(dx: -100, dy: -50) })
    XCTAssertEqual(try configured.get().sourceRect, CGRect(x: 24, y: 560, width: 160, height: 48))
  }

  func testMissingAnchorFallsBackToThePresenterCenter() throws {
    let configured = ShareCardAnchorConfiguration.configure(
      presenterView: View(), bounds: CGRect(x: 0, y: 0, width: 390, height: 844), anchor: nil,
      fromWindow: { _ in XCTFail("no anchor to convert"); return .zero })
    XCTAssertEqual(try configured.get().sourceRect, CGRect(x: 195, y: 422, width: 0, height: 0))
  }

  func testMissingPresenterIsPresenterUnavailable() {
    let configured = ShareCardAnchorConfiguration.configure(
      presenterView: nil as View?, bounds: .zero, anchor: CGRect(x: 1, y: 2, width: 3, height: 4),
      fromWindow: { $0 })
    guard case .failure(let code) = configured else { return XCTFail("presenter required") }
    XCTAssertEqual(code, .presenterUnavailable)
  }

  func testAnchorParsingAcceptsOnlyFiniteNonNegativeFrames() {
    XCTAssertEqual(
      ShareCardAnchorConfiguration.anchor(from: ["x": 24.5, "y": 700, "width": 160, "height": 48]),
      CGRect(x: 24.5, y: 700, width: 160, height: 48))
    XCTAssertEqual(
      ShareCardAnchorConfiguration.anchor(from: ["x": NSNumber(value: 1), "y": NSNumber(value: 2), "width": NSNumber(value: 3), "height": NSNumber(value: 4)]),
      CGRect(x: 1, y: 2, width: 3, height: 4))
    XCTAssertNil(ShareCardAnchorConfiguration.anchor(from: nil))
    for malformed: [String: Any] in [
      [:], ["x": 1, "y": 2, "width": 3], ["x": "1", "y": 2, "width": 3, "height": 4],
      ["x": Double.nan, "y": 2, "width": 3, "height": 4], ["x": 1, "y": Double.infinity, "width": 3, "height": 4],
      ["x": 1, "y": 2, "width": -3, "height": 4], ["x": 1, "y": 2, "width": 3, "height": -4],
      ["x": 1e9, "y": 2, "width": 3, "height": 4],
    ] {
      XCTAssertNil(ShareCardAnchorConfiguration.anchor(from: malformed), "\(malformed)")
    }
  }
}
