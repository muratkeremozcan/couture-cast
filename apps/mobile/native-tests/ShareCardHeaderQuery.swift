import XCTest

@MainActor
func existingShareCardHeader(in app: XCUIApplication, expected: String) throws -> XCUIElement {
  let predicate = NSPredicate(format: "label == %@", expected)
  let titles = app.staticTexts.matching(predicate)
  XCTAssertTrue(titles.firstMatch.waitForExistence(timeout: 20))
  let elements = titles.allElementsBoundByIndex
  let candidates = elements.map {
    ShareCardHeaderCandidate(
      label: $0.label, frame: $0.frame, isHittable: $0.isHittable,
      matchingDescendantFrames: $0.descendants(matching: .staticText).matching(predicate)
        .allElementsBoundByIndex.map { $0.frame }
    )
  }
  let selected = try selectShareCardHeader(candidates, expected: expected, screen: app.frame)
  return elements[selected]
}
