// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
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
  func testPostedObservationFollowsTheActualUIKitLayoutChangedRequestForAttachedView() {
    let target = UIView()
    window.addSubview(target)
    var order: [String] = []
    XCTAssertTrue(AccessibilityFocusTarget.requestLayoutChange(target, post: { notification, argument in
      XCTAssertEqual(notification, .layoutChanged)
      XCTAssertTrue(argument as? UIView === target)
      order.append("post")
    }, didPost: { actual in
      XCTAssertTrue(actual === target)
      order.append("observe")
    }))
    XCTAssertEqual(order, ["post", "observe"])
    target.removeFromSuperview()
    XCTAssertFalse(AccessibilityFocusTarget.requestLayoutChange(target, post: { _, _ in XCTFail("Detached target posted") }, didPost: { _ in XCTFail("Detached target observed") }))
  }

  func testSemanticTargetResolvesSoleAccessibleFabricChildAndReadsItsRealHeaderTrait() throws {
    let paragraph = UIView(frame: CGRect(x: 20, y: 30, width: 200, height: 40))
    let leaf = UILabel(frame: paragraph.bounds)
    leaf.text = "Home"
    leaf.isAccessibilityElement = true
    leaf.accessibilityTraits.insert(.header)
    paragraph.addSubview(leaf)
    window.addSubview(paragraph)
    // The RN provider supplies its screen frame explicitly. A hostless UILabel
    // surrogate must supply that same geometry without relying on an AX service.
    leaf.accessibilityFrame = leaf.convert(leaf.bounds, to: nil)
    let actual = try XCTUnwrap(AccessibilityFocusTarget.semanticTarget(paragraph))
    XCTAssertTrue(actual === leaf)
    XCTAssertTrue(actual.accessibilityTraits.contains(.header))
    leaf.accessibilityTraits.remove(.header)
    let changed = try XCTUnwrap(AccessibilityFocusTarget.semanticTarget(paragraph))
    XCTAssertFalse(changed.accessibilityTraits.contains(.header))
    let sibling = UILabel(frame: paragraph.bounds)
    sibling.isAccessibilityElement = true
    sibling.accessibilityFrame = leaf.accessibilityFrame
    paragraph.addSubview(sibling)
    XCTAssertNil(AccessibilityFocusTarget.semanticTarget(paragraph))
  }

  func testActualFabricProviderElementsCarryHeaderTraitWithoutUIViewSubviewsAndDeduplicateCycles() throws {
    let paragraph = UIView(frame: CGRect(x: 20, y: 40, width: 200, height: 30))
    paragraph.isAccessibilityElement = false
    window.addSubview(paragraph)
    let element = UIAccessibilityElement(accessibilityContainer: paragraph)
    element.isAccessibilityElement = true
    element.accessibilityLabel = "Home"
    element.accessibilityTraits = [.header, .staticText]
    element.accessibilityFrame = paragraph.convert(paragraph.bounds, to: nil)
    paragraph.accessibilityElements = [element, element, paragraph]
    let actual = try XCTUnwrap(AccessibilityFocusTarget.semanticTarget(paragraph))
    XCTAssertTrue(actual === element)
    XCTAssertEqual(AccessibilityFocusTarget.visibleSemanticElements(in: window).count, 1)
    XCTAssertTrue(actual.accessibilityTraits.contains(.header))
    element.accessibilityTraits.remove(.header)
    let changed = try XCTUnwrap(AccessibilityFocusTarget.semanticTarget(paragraph))
    XCTAssertFalse(changed.accessibilityTraits.contains(.header))
    paragraph.isHidden = true
    XCTAssertTrue(AccessibilityFocusTarget.visibleSemanticElements(in: window).isEmpty)
  }

  func testWindowRootVisibilityAndDetachedNormalViewsRemainStrict() {
    let paragraph = UIView(frame: CGRect(x: 10, y: 20, width: 100, height: 30))
    window.addSubview(paragraph)
    let element = UIAccessibilityElement(accessibilityContainer: paragraph)
    element.isAccessibilityElement = true
    element.accessibilityLabel = "Home"
    element.accessibilityTraits = [.header]
    element.accessibilityFrame = paragraph.convert(paragraph.bounds, to: nil)
    paragraph.accessibilityElements = [element]
    XCTAssertEqual(AccessibilityFocusTarget.visibleSemanticElements(in: window).count, 1)
    window.isAccessibilityElement = true
    XCTAssertEqual(AccessibilityFocusTarget.visibleSemanticElements(in: window).count, 1)
    window.isAccessibilityElement = false
    let frame = element.accessibilityFrame
    element.accessibilityFrame = .zero
    XCTAssertNil(AccessibilityFocusTarget.semanticTarget(paragraph))
    XCTAssertTrue(AccessibilityFocusTarget.visibleSemanticElements(in: window).isEmpty)
    element.accessibilityFrame = frame.offsetBy(dx: 1000, dy: 0)
    XCTAssertTrue(AccessibilityFocusTarget.visibleSemanticElements(in: window).isEmpty)
    element.accessibilityFrame = frame
    window.isHidden = true
    XCTAssertTrue(AccessibilityFocusTarget.visibleSemanticElements(in: window).isEmpty)
    window.isHidden = false
    window.alpha = 0
    XCTAssertTrue(AccessibilityFocusTarget.visibleSemanticElements(in: window).isEmpty)
    window.alpha = 1
    paragraph.removeFromSuperview()
    XCTAssertFalse(AccessibilityFocusTarget.canTakeFocus(paragraph))
    XCTAssertTrue(AccessibilityFocusTarget.visibleSemanticElements(in: paragraph).isEmpty)
    XCTAssertTrue(AccessibilityFocusTarget.visibleSemanticElements(in: window).isEmpty)
  }

  func testObservationIdentifierUsesConcreteUIKitTypesAndRetainsRequestedViewFallback() {
    let view = UIView()
    view.accessibilityIdentifier = "requested-title"
    let element = UIAccessibilityElement(accessibilityContainer: view)
    element.accessibilityIdentifier = "semantic-title"
    XCTAssertEqual(AccessibilityFocusTarget.observationIdentifier(of: element, requestedView: view), "semantic-title")
    element.accessibilityIdentifier = nil
    XCTAssertEqual(AccessibilityFocusTarget.observationIdentifier(of: element, requestedView: view), "requested-title")
    element.accessibilityIdentifier = ""
    XCTAssertEqual(AccessibilityFocusTarget.observationIdentifier(of: element, requestedView: view), "requested-title")
    XCTAssertEqual(AccessibilityFocusTarget.observationIdentifier(of: element, requestedView: nil), "")
    XCTAssertEqual(AccessibilityFocusTarget.observationIdentifier(of: view, requestedView: nil), "requested-title")
    XCTAssertEqual(AccessibilityFocusTarget.observationIdentifier(of: NSObject(), requestedView: view), "requested-title")
    XCTAssertEqual(AccessibilityFocusTarget.observationIdentifier(of: NSObject(), requestedView: nil), "")
    XCTAssertEqual(AccessibilityFocusTarget.observationIdentifier(of: nil, requestedView: nil), "")
  }

}
