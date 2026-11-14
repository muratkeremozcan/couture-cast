// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import Foundation
import XCTest

@testable import AccessibilityFocusTarget

/// The focus decisions without UIKit, so they run on Linux on every pull request (story 6.15
/// D6). AccessibilityFocusTargetTests drives the same rules through real UIKit views on macOS.
final class AccessibilityFocusRulesTests: XCTestCase {
  private let shown = AccessibilityFocusRules.Node(isHidden: false, alpha: 1)

  func testAViewOutsideAWindowCannotTakeFocus() {
    XCTAssertFalse(AccessibilityFocusRules.canTakeFocus(inWindow: false, chain: [shown]))
    XCTAssertTrue(AccessibilityFocusRules.canTakeFocus(inWindow: true, chain: [shown]))
  }

  func testAHiddenOrTransparentNodeAnywhereUpTheChainRefusesFocus() {
    let hidden = AccessibilityFocusRules.Node(isHidden: true, alpha: 1)
    let transparent = AccessibilityFocusRules.Node(isHidden: false, alpha: 0.01)
    let faint = AccessibilityFocusRules.Node(isHidden: false, alpha: 0.02)
    XCTAssertFalse(AccessibilityFocusRules.canTakeFocus(inWindow: true, chain: [shown, hidden, shown]))
    XCTAssertFalse(AccessibilityFocusRules.canTakeFocus(inWindow: true, chain: [shown, shown, transparent]))
    XCTAssertTrue(AccessibilityFocusRules.canTakeFocus(inWindow: true, chain: [shown, faint]))
  }

  func testTagsKeepOnlyReactTagsFromTheFocusedViewOutwards() {
    XCTAssertEqual(AccessibilityFocusRules.tags([30, 0, 20, -1, 7]), [30, 20, 7])
    XCTAssertEqual(AccessibilityFocusRules.tags([]), [])
  }

  func testObservationIdentifierPrefersTheElementThenTheRequestedView() {
    XCTAssertEqual(AccessibilityFocusRules.observationIdentifier(element: "semantic", requested: "requested"), "semantic")
    XCTAssertEqual(AccessibilityFocusRules.observationIdentifier(element: "", requested: "requested"), "requested")
    XCTAssertEqual(AccessibilityFocusRules.observationIdentifier(element: nil, requested: "requested"), "requested")
    XCTAssertEqual(AccessibilityFocusRules.observationIdentifier(element: nil, requested: nil), "")
  }

  func testAnElementCountsOnlyWithANonEmptyFrameInsideItsWindow() {
    let window = CGRect(x: 0, y: 0, width: 320, height: 640)
    XCTAssertTrue(AccessibilityFocusRules.isOnScreen(CGRect(x: 10, y: 20, width: 100, height: 30), window: window))
    XCTAssertFalse(AccessibilityFocusRules.isOnScreen(.zero, window: window))
    XCTAssertFalse(AccessibilityFocusRules.isOnScreen(CGRect(x: 1010, y: 20, width: 100, height: 30), window: window))
  }

  func testTheSemanticTargetIsTheOneElementWithTheViewsFrame() {
    let frame = CGRect(x: 20, y: 30, width: 200, height: 40)
    let other = CGRect(x: 0, y: 0, width: 10, height: 10)
    XCTAssertEqual(AccessibilityFocusRules.soleMatch(["leaf", "label"], frame: frame) { $0 == "leaf" ? frame : other }, "leaf")
    // Two elements with the view's frame are ambiguous, and none is no target.
    XCTAssertNil(AccessibilityFocusRules.soleMatch(["leaf", "sibling"], frame: frame) { _ in frame })
    XCTAssertNil(AccessibilityFocusRules.soleMatch(["label"], frame: frame) { _ in other })
  }
}
