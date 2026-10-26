import XCTest

/// Coordinator-approved XCUITest substitute. Actual cursor evidence is provided by Android TalkBack.
@MainActor
final class ShareCardFallbackUITests: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "com.couturecast.story68")
  func element(_ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  func testRemovedCommunityOpenerLeavesExistingHeaderAndPassesAllAudit() throws {
    continueAfterFailure = false
    let url = Bundle(for: Self.self).url(forResource: "fallback-fixture", withExtension: "json")!
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: String]
    let post = fixture["postId"]!
    app.activate()
    XCTAssertTrue(element("share-card-title").waitForExistence(timeout: 20))
    XCTAssertEqual(element("share-card-title").label, fixture["title"]!)
    XCTAssertTrue(app.images.matching(NSPredicate(format: "identifier BEGINSWITH %@", "share-card-preview-loaded-")).firstMatch.exists)
    let cancel = element("share-card-cancel")
    XCTAssertEqual(cancel.label, fixture["cancel"]!)
    for _ in 0..<8 where !cancel.isHittable { app.swipeUp() }
    XCTAssertTrue(cancel.isHittable)
    let focusSequence = try readShareCardFocusObservation(self).sequence
    cancel.tap()
    let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element("share-card-title"))
    XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 20), .completed)
    XCTAssertFalse(element("community-share-card-open-\(post)").exists)
    XCTAssertFalse(element("community-card-author-\(post)").exists)
    let header = try existingShareCardHeader(in: app, expected: fixture["community"]!)
    try assertPostedShareCardFocus(self, after: focusSequence, label: fixture["community"]!, identifier: nil, header: true)
    try assertNativeShareCardHeader(self, label: fixture["community"]!)
    XCTAssertTrue(header.isHittable)
    XCTAssertEqual(header.label, fixture["community"]!)
    XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label == %@", fixture["removedHeading"]!)).firstMatch.exists)
    try app.performAccessibilityAudit(for: .all)
    print("CC68_FALLBACK_PASS ios existing-header-target-and-all-audit")
  }
}
