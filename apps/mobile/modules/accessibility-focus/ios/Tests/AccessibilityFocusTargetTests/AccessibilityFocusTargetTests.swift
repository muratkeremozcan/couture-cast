import UIKit
import XCTest

@testable import AccessibilityFocusTarget

final class AccessibilityFocusTargetTests: XCTestCase {
  private var window: UIWindow!

  override func setUp() {
    super.setUp()
    window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 640))
    window.makeKeyAndVisible()
  }

  override func tearDown() {
    window.isHidden = true
    window = nil
    super.tearDown()
  }

  func testRefusesAViewThatIsNotInAWindowThenAcceptsItOnceAttached() {
    let screen = UIView()
    let link = UIView()
    link.tag = 574
    screen.addSubview(link)

    // Registered with React Native but not reattached after the navigation yet.
    XCTAssertFalse(AccessibilityFocusTarget.canTakeFocus(link))

    window.addSubview(screen)
    XCTAssertTrue(AccessibilityFocusTarget.canTakeFocus(link))
  }

  func testRefusesNoView() {
    XCTAssertFalse(AccessibilityFocusTarget.canTakeFocus(nil))
  }

  func testRefusesAViewUnderAHiddenAncestor() {
    let screen = UIView()
    let link = UIView()
    screen.addSubview(link)
    window.addSubview(screen)
    screen.isHidden = true
    XCTAssertFalse(AccessibilityFocusTarget.canTakeFocus(link))
    screen.isHidden = false
    XCTAssertTrue(AccessibilityFocusTarget.canTakeFocus(link))
  }

  func testReportsTheFocusedViewAndItsTaggedAncestors() {
    let screen = UIView()
    screen.tag = 20
    let untagged = UIView()
    let link = UIView()
    link.tag = 30
    untagged.addSubview(link)
    screen.addSubview(untagged)
    window.addSubview(screen)
    XCTAssertEqual(Array(AccessibilityFocusTarget.tags(of: link).prefix(2)), [30, 20])
  }

  func testReportsTheContainerOfANonViewElement() {
    let container = UIView()
    container.tag = 44
    let element = UIAccessibilityElement(accessibilityContainer: container)
    XCTAssertEqual(AccessibilityFocusTarget.tags(of: element), [44])
    XCTAssertEqual(AccessibilityFocusTarget.tags(of: nil), [])
  }
}
