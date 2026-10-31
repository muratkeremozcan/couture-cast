import XCTest

/// N-IOS-PRESENTER-UI against the installed story68 dev client, fixture mode `real`.
/// Share presents the real UIActivityViewController. On an iPhone simulator the compact sheet
/// ignores the popover anchor, so the module's test-build anchor report
/// (`Documents/cc69-share-anchor.json`, served by the harness at `/share-anchor`) proves the
/// presenter wiring: presented on the main thread from the top-most controller, sourceView set to
/// that controller's view, sourceRect equal to the Share button frame at handoff. Closing the
/// sheet must settle `shareClosed` and return focus to Share. The local iPad proof covers the real
/// popover.
@MainActor
final class ShareCardShareSheetUITests: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "com.couturecast.story68")
  let ingress = "http://127.0.0.1:63068"

  /// What the module records after presentation. Window points, like `XCUIElement.frame`.
  struct AnchorReport: Decodable, Equatable {
    struct Rect: Decodable, Equatable { let x, y, width, height: Double }
    let session: String
    let sequence: Int
    let presented: Bool
    let mainThread: Bool
    let sourceViewSet: Bool
    let sourceViewIsPresenterView: Bool
    let sourceRect: Rect
  }

  /// The accessibility-focus module's record of the last posted focus request.
  struct FocusObservation: Decodable {
    let session: String
    let sequence: Int
    let identifier: String
    let label: String
    let attached: Bool
    let posted: Bool
  }

  struct Copy: Decodable { let share: String; let shareClosed: String }

  enum ReadError: Error { case unavailable, timedOut }

  override func setUpWithError() throws {
    continueAfterFailure = false
    app.activate()
    dismissShareSheetIfPresent()
    if element("share-card-cancel").exists { element("share-card-cancel").tap() }
    let settingsTab = element("tab-settings")
    XCTAssertTrue(settingsTab.waitForExistence(timeout: 15))
    settingsTab.tap()
    if !element("settings-screen").waitForExistence(timeout: 10) { settingsTab.tap() }
    XCTAssertTrue(element("settings-screen").waitForExistence(timeout: 10))
    let english = element("locale-btn-en-US")
    for _ in 0..<8 where !english.isHittable { app.swipeDown() }
    XCTAssertTrue(english.exists)
    english.tap()
  }

  override func tearDownWithError() throws {
    dismissShareSheetIfPresent()
    fixture("real")
    if element("share-card-cancel").exists { element("share-card-cancel").tap() }
  }

  func element(_ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  /// iOS 26 names the sheet's Close button `header.closeButton`; earlier releases expose the
  /// activity list as `ActivityListView`.
  func shareSheetClose() -> XCUIElement { app.buttons["header.closeButton"] }

  func shareSheetPresented() -> Bool { shareSheetClose().exists || element("ActivityListView").exists }

  func waitForShareSheet(_ presented: Bool, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if shareSheetPresented() == presented { return true }
      RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    } while Date() < deadline
    return false
  }

  func localizedCopy() throws -> Copy {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "share-sheet-fixture", withExtension: "json"))
    return try JSONDecoder().decode(Copy.self, from: Data(contentsOf: url))
  }

  func fixture(_ mode: String) {
    let done = expectation(description: "Owned fixture ingress")
    URLSession.shared.dataTask(with: URL(string: "\(ingress)/fixture?mode=\(mode)")!) { _, response, error in
      XCTAssertNil(error)
      XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
      done.fulfill()
    }.resume()
    wait(for: [done], timeout: 10)
  }

  /// One GET against the harness ingress; nil when the record does not exist yet.
  func read<T: Decodable>(_ path: String, as type: T.Type) throws -> T? {
    let done = expectation(description: "Read \(path)")
    var result: Result<T?, Error> = .failure(ReadError.unavailable)
    var request = URLRequest(url: URL(string: "\(ingress)\(path)")!)
    request.timeoutInterval = 6
    URLSession.shared.dataTask(with: request) { data, response, error in
      result = Result {
        if let error { throw error }
        let status = (response as? HTTPURLResponse)?.statusCode
        if status == 404 { return nil }
        guard status == 200, let data else { throw ReadError.unavailable }
        return try JSONDecoder().decode(T.self, from: data)
      }
      done.fulfill()
    }.resume()
    wait(for: [done], timeout: 8)
    return try result.get()
  }

  /// Polls until `accept` holds; the harness answers from a busy host.
  func poll<T: Decodable>(_ path: String, as type: T.Type, within seconds: TimeInterval = 20,
                           _ accept: (T) -> Bool) throws -> T {
    let deadline = Date().addingTimeInterval(seconds)
    repeat {
      if let value = try? read(path, as: type), accept(value) { return value }
      RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    } while Date() < deadline
    throw ReadError.timedOut
  }

  func openCard() {
    if element("share-card-cancel").exists { element("share-card-cancel").tap() }
    element("tab-home").tap()
    let opener = app.buttons.matching(identifier: "outfit-share-card-open").firstMatch
    for _ in 0..<8 where !opener.isHittable { app.swipeUp() }
    XCTAssertTrue(opener.waitForExistence(timeout: 20))
    opener.tap()
    let loaded = app.images.matching(NSPredicate(format: "identifier BEGINSWITH %@", "share-card-preview-loaded-")).firstMatch
    XCTAssertTrue(loaded.waitForExistence(timeout: 20))
  }

  /// The sheet's own Close button (`header.closeButton`, verified on iOS 26.1), else the older
  /// header Close, else a drag of the sheet header down.
  func dismissShareSheetIfPresent() {
    guard shareSheetPresented() else { return }
    let legacyClose = app.otherElements["UIActivityContentView"].buttons["Close"]
    if shareSheetClose().exists {
      shareSheetClose().tap()
    } else if legacyClose.exists {
      legacyClose.tap()
    } else {
      let header = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12))
      header.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
    }
    XCTAssertTrue(waitForShareSheet(false, timeout: 10), "share sheet dismissed")
  }

  func testSheetPresentsFromTheTopMostControllerAnchoredToShareAndClosesBackToShare() throws {
    let labels = try localizedCopy()
    fixture("real")
    openCard()
    let share = element("share-card-share")
    for _ in 0..<8 where !share.isHittable { app.swipeUp() }
    let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true AND hittable == true"), object: share)
    XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 20), .completed)
    XCTAssertEqual(share.label, labels.share)
    let previousAnchor = try read("/share-anchor", as: AnchorReport.self)
    // nil when no focus request was posted yet: the harness answers 503 until the record exists,
    // so a short poll rides out a busy host and an absent record no longer fails the test.
    let previousFocus = try? poll("/focus-observation", as: FocusObservation.self, within: 5) { _ in true }
    // The feedback slot is reserved, so the `sharing` copy never moves Share: the frame here is
    // the frame JS measures at handoff, before the sheet hides Share or a later scroll moves it.
    let shareFrame = share.frame

    share.tap()
    XCTAssertTrue(waitForShareSheet(true, timeout: 20), "UIActivityViewController presented")
    let anchor = try poll("/share-anchor", as: AnchorReport.self) {
      $0.session != previousAnchor?.session || $0.sequence != previousAnchor?.sequence
    }
    XCTAssertTrue(anchor.presented, "presented by the top-most controller")
    XCTAssertTrue(anchor.mainThread, "presented on the main thread")
    XCTAssertTrue(anchor.sourceViewSet, "popover sourceView set")
    XCTAssertTrue(anchor.sourceViewIsPresenterView, "sourceView is the presenter's view")
    // The header names the card by its public name; the cache file name never shows.
    let labelled = { (format: String, value: String) in
      self.app.descendants(matching: .any).matching(NSPredicate(format: format, value)).firstMatch
    }
    XCTAssertTrue(
      labelled("label == %@", "couturecast-card.png").waitForExistence(timeout: 10),
      "header shows couturecast-card.png")
    XCTAssertFalse(labelled("label CONTAINS %@", "cc69-share").exists, "header hides the cache file name")
    print("CC69_PRESENTER_PUBLIC_NAME_PASS")

    dismissShareSheetIfPresent()
    let feedback = element("share-card-feedback")
    XCTAssertTrue(feedback.waitForExistence(timeout: 20))
    let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", labels.shareClosed), object: feedback)
    XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 20), .completed, "shareClosed settles")
    XCTAssertEqual(anchor.sourceRect.x, Double(shareFrame.minX), accuracy: 1, "sourceRect x")
    XCTAssertEqual(anchor.sourceRect.y, Double(shareFrame.minY), accuracy: 1, "sourceRect y")
    XCTAssertEqual(anchor.sourceRect.width, Double(shareFrame.width), accuracy: 1, "sourceRect width")
    XCTAssertEqual(anchor.sourceRect.height, Double(shareFrame.height), accuracy: 1, "sourceRect height")
    print("CC69_PRESENTER_ANCHOR_PASS")
    let focus = try poll("/focus-observation", as: FocusObservation.self) {
      (previousFocus == nil || $0.session == previousFocus?.session)
        && $0.sequence > (previousFocus?.sequence ?? -1)
        && $0.posted && $0.attached && $0.identifier == "share-card-share"
    }
    XCTAssertEqual(focus.label, labels.share, "focus returns to Share")
    XCTAssertTrue(share.isHittable, "Share stays available")
    print("CC69_PRESENTER_CLOSED_PASS")
  }
}
