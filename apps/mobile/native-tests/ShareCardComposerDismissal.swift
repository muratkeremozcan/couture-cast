import XCTest

// React Native dismisses the composer's Modal after the Cancel tap returns, so the app can look
// idle while the sheet is still on its way out. A bare `if cancel.exists { cancel.tap() }` then
// sees the leaving sheet, and the tap fails with "No matches found" once it is gone (nightly
// iOS native runs 43385098696, 43438780572 and 43494979286, on iOS 18.5 and iOS 26.5). Every
// close waits until the composer is gone, and a guarded close never taps a sheet that is leaving.

private let shareCardDismissalTimeout: TimeInterval = 10
/// A composer still present after this long is open, not leaving.
private let shareCardLeavingWindow: TimeInterval = 2

@MainActor
private func shareCardCancel(_ app: XCUIApplication) -> XCUIElement {
  app.descendants(matching: .any).matching(identifier: "share-card-cancel").firstMatch
}

@MainActor
private func shareCardGone(_ element: XCUIElement, within timeout: TimeInterval) -> Bool {
  let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
  return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
}

/// Taps the open composer's Cancel and fails unless the composer is gone within 10 s.
@MainActor
func closeShareCard(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
  let cancel = shareCardCancel(app)
  XCTAssertTrue(cancel.waitForExistence(timeout: 20), "share-card Cancel present", file: file, line: line)
  cancel.tap()
  XCTAssertTrue(shareCardGone(cancel, within: shareCardDismissalTimeout), "share card closed", file: file, line: line)
}

/// For setUp, tearDown and openers, which may find the composer open, leaving or closed.
@MainActor
func closeShareCardIfOpen(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
  let cancel = shareCardCancel(app)
  guard cancel.exists, !shareCardGone(cancel, within: shareCardLeavingWindow) else { return }
  closeShareCard(app, file: file, line: line)
}
