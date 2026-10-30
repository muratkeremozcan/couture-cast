import XCTest

// The job log is the only place a failed audit is readable, so name each failing issue.
func compactAuditText(_ text: String) -> String {
  String(text.components(separatedBy: .newlines).joined(separator: " ").replacingOccurrences(of: "|", with: "/").prefix(120))
}

@MainActor
func shareCardAuditIssueLine(_ scope: String, _ issue: XCUIAccessibilityAuditIssue) -> String {
  let element = issue.element
  return "CC68_AUDIT_ISSUE \(scope)|\(issue.auditType.rawValue)|\(compactAuditText(element?.identifier ?? "none"))|\(compactAuditText(element?.label ?? "none"))|\(compactAuditText(issue.compactDescription))"
}

/// An element-less issue names no text, so list what the screen exposes: the text it flags is not among these.
@MainActor
func shareCardAuditContextLines(_ scope: String, _ app: XCUIApplication) -> [String] {
  func line(_ kind: String, _ element: XCUIElement) -> String {
    let frame = element.frame
    return "CC68_AUDIT_ISSUE \(scope)-context|\(kind)|\(compactAuditText(element.identifier))|\(compactAuditText(element.label))|\(Int(frame.minX)),\(Int(frame.minY)),\(Int(frame.width)),\(Int(frame.height))"
  }
  return app.staticTexts.allElementsBoundByIndex.prefix(24).map { line("staticText", $0) }
    + app.images.allElementsBoundByIndex.prefix(8).map { line("image", $0) }
}

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

@MainActor
func readShareCardFocusObservation(_ test: XCTestCase) throws -> ShareCardFocusObservation {
  let done = test.expectation(description: "Read actual attached UIKit focus-request target")
  var result: Result<ShareCardFocusObservation, Error>?
  var request = URLRequest(url: URL(string: "http://127.0.0.1:63068/focus-observation")!)
  request.timeoutInterval = 6
  URLSession.shared.dataTask(with: request) { data, response, error in
    result = Result {
      if let error { throw error }
      guard (response as? HTTPURLResponse)?.statusCode == 200, let data else {
        throw ShareCardFocusObservationError.missingPostedTargetOrHeaderTrait
      }
      return try JSONDecoder().decode(ShareCardFocusObservation.self, from: data)
    }
    done.fulfill()
  }.resume()
  test.wait(for: [done], timeout: 8)
  return try XCTUnwrap(result).get()
}

/// The harness answers from a busy host; a transport failure is read again until the deadline.
@MainActor
func awaitShareCardFocusObservation(_ test: XCTestCase, within seconds: TimeInterval = 20) throws -> ShareCardFocusObservation {
  let deadline = Date().addingTimeInterval(seconds)
  var last: Error = ShareCardFocusObservationError.missingPostedTargetOrHeaderTrait
  repeat {
    do { return try readShareCardFocusObservation(test) } catch { last = error }
    RunLoop.current.run(until: Date().addingTimeInterval(0.2))
  } while Date() < deadline
  throw last
}

@MainActor
func assertPostedShareCardFocus(_ test: XCTestCase, after sequence: Int, label: String,
                               identifier: String?, header: Bool) throws {
  let deadline = Date().addingTimeInterval(20)
  var last: Error = ShareCardFocusObservationError.missingPostedTargetOrHeaderTrait
  repeat {
    do {
      let actual = try readShareCardFocusObservation(test)
      try requirePostedShareCardFocus(actual, after: sequence, label: label, identifier: identifier, header: header)
      return
    } catch { last = error }
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
  } while Date() < deadline
  throw last
}

@MainActor
func assertNativeShareCardHeader(_ test: XCTestCase, label: String) throws {
  let deadline = Date().addingTimeInterval(20)
  var last: Error = ShareCardFocusObservationError.missingPostedTargetOrHeaderTrait
  repeat {
    do {
      try requireNativeShareCardHeader(readShareCardFocusObservation(test), label: label)
      return
    } catch { last = error }
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
  } while Date() < deadline
  throw last
}

@MainActor
func assertNoNewShareCardFocus(_ test: XCTestCase, after sequence: Int) throws {
  try requireNoNewShareCardFocus(readShareCardFocusObservation(test), after: sequence)
}
