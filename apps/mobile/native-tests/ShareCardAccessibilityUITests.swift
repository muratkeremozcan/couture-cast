import XCTest

/// Coordinator-approved simulator substitute for unavailable physical VoiceOver.
/// Tests inspect the real app's AX tree and run Apple's audit. Genuine UI sign-in
/// happens in the shared native harness before this standalone runner activates it.
@MainActor
final class ShareCardAccessibilityUITests: XCTestCase {
  var currentLocale = "en-US"
  let app = XCUIApplication(bundleIdentifier: "com.couturecast.story68")

  override func setUpWithError() throws {
    continueAfterFailure = false
    app.activate()
    if element("share-card-cancel").exists { element("share-card-cancel").tap() }
    element("tab-settings").tap()
    let english = element("locale-btn-en-US")
    for _ in 0..<8 where !english.isHittable { app.swipeDown() }
    XCTAssertTrue(english.exists)
    english.tap()
    currentLocale = "en-US"
  }

  override func tearDownWithError() throws {
    fixture("release")
    fixture("real")
    if element("share-card-cancel").exists { element("share-card-cancel").tap() }
  }

  func element(_ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  func loaded() -> XCUIElement {
    app.images.matching(NSPredicate(format: "identifier BEGINSWITH %@", "share-card-preview-loaded-")).firstMatch
  }

  func openCard(waitForPreview: Bool = true) {
    if element("share-card-cancel").exists { element("share-card-cancel").tap() }
    element("tab-home").tap()
    let opener = app.buttons.matching(identifier: "outfit-share-card-open").firstMatch
    for _ in 0..<8 where !opener.isHittable { app.swipeUp() }
    XCTAssertTrue(opener.waitForExistence(timeout: 20))
    opener.tap()
    if waitForPreview { XCTAssertTrue(loaded().waitForExistence(timeout: 20)) }
  }

  static func allowsRasterOCRIssue(type: XCUIAccessibilityAuditType, description: String, detail: String, state: String, hasElement: Bool, previewVerified: Bool) -> Bool {
    let signatures = [
      "Potentially inaccessible element": "This element contains content that could potentially form one or more separate accessibility elements.",
      "Potentially inaccessible text": "This element appears to display text that should be represented using the accessibility API.",
    ]
    return type == .elementDetection && signatures[description] == detail && ["open", "unavailable", "saved", "storage-failure", "offline", "denied", "permanent-denied", "limited", "pending"].contains(state) && !hasElement && previewVerified
  }

  func testRasterOCRExceptionRejectsEveryNearMiss() {
    XCTAssertTrue(Self.allowsRasterOCRIssue(type: .elementDetection, description: "Potentially inaccessible element", detail: "This element contains content that could potentially form one or more separate accessibility elements.", state: "open", hasElement: false, previewVerified: true))
    XCTAssertTrue(Self.allowsRasterOCRIssue(type: .elementDetection, description: "Potentially inaccessible element", detail: "This element contains content that could potentially form one or more separate accessibility elements.", state: "unavailable", hasElement: false, previewVerified: true))
    for state in ["preparing", "cancel", "unknown", ""] {
      XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: "Potentially inaccessible element", detail: "This element contains content that could potentially form one or more separate accessibility elements.", state: state, hasElement: false, previewVerified: true))
    }
    XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: "Potentially inaccessible element", detail: "This element contains content that could potentially form one or more separate accessibility elements. ", state: "open", hasElement: false, previewVerified: true))
    for description in ["Potentially inaccessible element.", "Potentially inaccessible element ", "Element has no description", ""] {
      XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: description, detail: "This element contains content that could potentially form one or more separate accessibility elements.", state: "open", hasElement: false, previewVerified: true))
    }
    XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: "Potentially inaccessible element", detail: "This element contains content that could potentially form one or more separate accessibility elements.", state: "open", hasElement: true, previewVerified: true))
    for type: XCUIAccessibilityAuditType in [.contrast, .dynamicType, .hitRegion, .sufficientElementDescription, .trait, .textClipped] {
      XCTAssertFalse(Self.allowsRasterOCRIssue(type: type, description: "Potentially inaccessible element", detail: "This element contains content that could potentially form one or more separate accessibility elements.", state: "open", hasElement: false, previewVerified: true))
    }
  }

  func testTextOCRExceptionRejectsEveryNearMiss() {
    let compact = "Potentially inaccessible text"
    let detail = "This element appears to display text that should be represented using the accessibility API."
    for state in ["open", "unavailable"] {
      XCTAssertTrue(Self.allowsRasterOCRIssue(type: .elementDetection, description: compact, detail: detail, state: state, hasElement: false, previewVerified: true))
      XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: compact, detail: detail, state: state, hasElement: true, previewVerified: true))
      XCTAssertFalse(Self.allowsRasterOCRIssue(type: .contrast, description: compact, detail: detail, state: state, hasElement: false, previewVerified: true))
      XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: compact + ".", detail: detail, state: state, hasElement: false, previewVerified: true))
      XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: compact, detail: detail + " ", state: state, hasElement: false, previewVerified: true))
    }
    for state in ["preparing", "cancel", "unknown", ""] {
      XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: compact, detail: detail, state: state, hasElement: false, previewVerified: true))
    }
    XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: "Potentially inaccessible element", detail: detail, state: "open", hasElement: false, previewVerified: true))
  }

  func testRasterExceptionsRequirePresentExactlyLabelledPreview() {
    for state in ["open", "unavailable", "saved", "storage-failure", "offline", "denied", "permanent-denied", "limited", "pending"] {
      for (compact, detail) in [
        ("Potentially inaccessible element", "This element contains content that could potentially form one or more separate accessibility elements."),
        ("Potentially inaccessible text", "This element appears to display text that should be represented using the accessibility API."),
      ] {
        XCTAssertTrue(Self.allowsRasterOCRIssue(type: .elementDetection, description: compact, detail: detail, state: state, hasElement: false, previewVerified: true))
        // Missing preview or a wrong full label both leave verification false.
        XCTAssertFalse(Self.allowsRasterOCRIssue(type: .elementDetection, description: compact, detail: detail, state: state, hasElement: false, previewVerified: false))
      }
    }
  }

  func audit(_ state: String) throws {
    var previewVerified = false
    if loaded().exists {
      XCTAssertEqual(loaded().elementType, .image, state)
      let url = Bundle(for: Self.self).url(forResource: currentLocale, withExtension: "json")!
      let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
      let categories = catalog["categories"] as! [String: String]
      let scenarios = catalog["scenarios"] as! [String: String]
      let watermark = element("share-card-watermark").value as? String != "0"
      var expected = [catalog["outfit"] as! String, scenarios["morning"]!, categories["top"]!, categories["bottom"]!, categories["shoes"]!, "CoutureCast"]
      if watermark { expected.append("\(catalog["watermarkRole"] as! String): CoutureCast") }
      let exact = expected.joined(separator: ". ")
      let matched = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", exact), object: loaded())
      XCTAssertEqual(XCTWaiter.wait(for: [matched], timeout: 20), .completed, "Current exact rendered preview must load before audit")
      XCTAssertEqual(loaded().label, exact, "Full drawn-text label before audit: \(state)")
      previewVerified = loaded().elementType == .image && loaded().label == expected.joined(separator: ". ")
    }
    let clientURL = Bundle(for: Self.self).url(forResource: "client-\(currentLocale)", withExtension: "json")!
    let client = try JSONSerialization.jsonObject(with: Data(contentsOf: clientURL)) as! [String: Any]
    let labels = client["shareCard"] as! [String: Any]
    let statusKeys = ["preparing": "preparing", "saved": "saved", "storage-failure": "storage", "offline": "offline", "denied": "permissionDenied", "permanent-denied": "permissionPermanent", "limited": "saved", "pending": "saving", "unavailable": "nativeSaveUnavailable"]
    if let key = statusKeys[state] {
      let status = element(["saved", "limited", "pending", "preparing"].contains(state) ? "share-card-feedback" : "share-card-error")
      XCTAssertTrue(status.exists, "Own exact localized status element: \(state)")
      let exactStatus = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", labels[key] as! String), object: status)
      XCTAssertEqual(XCTWaiter.wait(for: [exactStatus], timeout: 20), .completed, "Current localized status must settle: \(state)")
      XCTAssertEqual(status.label, labels[key] as! String)
      XCTAssertEqual(status.elementType, .staticText)
    }
    if loaded().exists { print("CC68_PREVIEW_LABEL \(state): \(loaded().label)") }
    try app.performAccessibilityAudit(for: .all) { issue in
      print("CC68_AUDIT_CLOSED \(state)|\(issue.auditType.rawValue)|\(issue.element != nil)|\(issue.compactDescription)")
      let description = "\(issue.compactDescription): \(issue.detailedDescription) ELEMENT \(issue.element?.debugDescription ?? "none")"
      let detail = XCTAttachment(string: description)
      detail.name = "audit-\(state)"
      detail.lifetime = .keepAlways
      self.add(detail)
      print("CC68_AUDIT \(state): \(description)")
      // Apple's raster OCR heuristic has no AX element for this fixed artwork.
      // Coordinator-approved exception requires its exact issue signature/state.
      return Self.allowsRasterOCRIssue(type: issue.auditType, description: issue.compactDescription, detail: issue.detailedDescription, state: state, hasElement: issue.element != nil, previewVerified: previewVerified)
    }
    let title = element("share-card-title")
    let watermark = element("share-card-watermark")
    let save = element("share-card-save")
    let cancel = element("share-card-cancel")
    XCTAssertTrue(title.exists, state)
    XCTAssertFalse(title.label.isEmpty, state)
    XCTAssertEqual(title.elementType, .staticText, state)
    XCTAssertEqual(save.elementType, .button, state)
    XCTAssertEqual(cancel.elementType, .button, state)
    XCTAssertEqual(save.label, labels["save"] as! String, state)
    XCTAssertEqual(cancel.label, labels["cancel"] as! String, state)
    // One serialized AX snapshot preserves reading order across UIKit's transient
    // audit windows. Recursive index-bound queries can become stale mid-traversal.
    let hierarchy = app.debugDescription
    func position(_ id: String) -> String.Index {
      let found = hierarchy.range(of: "identifier: '\(id)'")
      XCTAssertNotNil(found, "AX traversal contains \(id): \(state)")
      return found?.lowerBound ?? hierarchy.endIndex
    }
    XCTAssertLessThan(position(title.identifier), position(watermark.identifier), state)
    XCTAssertLessThan(position(watermark.identifier), position(save.identifier), state)
    XCTAssertLessThan(position(save.identifier), position(cancel.identifier), state)
    let targets = ["preparing": "share-card-title", "open": "share-card-title", "unavailable": "share-card-title", "saved": "share-card-save", "limited": "share-card-save", "pending": "share-card-save", "denied": "share-card-retry", "permanent-denied": "share-card-settings", "storage-failure": "share-card-retry", "offline": "share-card-retry"]
    if let id = targets[state] {
      let target = element(id)
      XCTAssertTrue(target.exists, "Intended native focus bridge target: \(state)")
      XCTAssertTrue(target.isHittable, "Intended focus target attached and visible: \(state)")
      XCTAssertFalse(target.label.isEmpty)
    }
    print("CC68_STATE_PASS \(currentLocale) \(state) \(loaded().exists ? (element("share-card-watermark").value as? String == "0" ? "off" : "on") : "none")")
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "share-card-\(state)"
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func exactFeedback(_ expected: String) {
    let status = element("share-card-feedback")
    XCTAssertTrue(status.waitForExistence(timeout: 20))
    let matched = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", expected), object: status)
    XCTAssertEqual(XCTWaiter.wait(for: [matched], timeout: 20), .completed)
    XCTAssertEqual(status.label, expected)
  }

  func clientCatalog() throws -> [String: Any] {
    let url = Bundle(for: Self.self).url(forResource: "client-\(currentLocale)", withExtension: "json")!
    return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
  }

  func assertExistingHeader(_ expected: String, removedContentHeading: String) throws {
    let header = try existingShareCardHeader(in: app, expected: expected)
    XCTAssertEqual(header.label, expected)
    XCTAssertTrue(header.isHittable)
    XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label == %@", removedContentHeading)).firstMatch.exists)
  }

  func fixture(_ mode: String) {
    let done = expectation(description: "Owned fixture ingress")
    let url = URL(string: "http://127.0.0.1:63068/fixture?mode=\(mode)")!
    URLSession.shared.dataTask(with: url) { _, response, error in
      XCTAssertNil(error)
      XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
      done.fulfill()
    }.resume()
    wait(for: [done], timeout: 10)
  }

  func testAllLocalesAndWatermarkOFFFullLabels() throws {
    fixture("real")
    for locale in ["en-US", "en-CA", "fr-FR", "fr-CA", "de-DE", "es-419", "it-IT", "pt-BR", "pt-PT", "tr-TR"] {
      if element("share-card-cancel").exists { element("share-card-cancel").tap() }
      element("tab-settings").tap()
      let choice = element("locale-btn-\(locale)")
      for _ in 0..<8 where !choice.isHittable { app.swipeDown() }
      XCTAssertTrue(choice.exists)
      choice.tap()
      currentLocale = locale
      openCard()
      try audit("open")
      element("share-card-watermark").tap()
      XCTAssertTrue(loaded().waitForExistence(timeout: 20))
      try audit("open")
      element("share-card-cancel").tap()
    }
    element("tab-settings").tap()
    let english = element("locale-btn-en-US")
    for _ in 0..<8 where !english.isHittable { app.swipeDown() }
    english.tap()
    currentLocale = "en-US"
  }

  func testOpenSaveCancelAndFailureTraversal() throws {
    fixture("real")
    openCard()
    try audit("open")
    element("share-card-save").tap()
    XCTAssertTrue(element("share-card-feedback").waitForExistence(timeout: 20))
    try audit("saved")
    let opener = app.buttons.matching(identifier: "outfit-share-card-open").firstMatch
    element("share-card-cancel").tap()
    XCTAssertFalse(element("share-card-title").exists)
    XCTAssertTrue(opener.exists)
    XCTAssertTrue(opener.isHittable)
    let client = try clientCatalog()
    let labels = client["shareCard"] as! [String: Any]
    let tabs = client["tabs"] as! [String: String]
    XCTAssertEqual(opener.label, labels["launcher"] as! String)
    try assertExistingHeader(tabs["home"]!, removedContentHeading: labels["sourceOutfit"] as! String)
    element("tab-community").tap()
    let communityLabels = client["community"] as! [String: Any]
    try assertExistingHeader(tabs["community"]!, removedContentHeading: communityLabels["heading"] as! String)
    print("CC68_NATIVE_BEHAVIOR_PASS existing-header-labels")
    element("tab-home").tap()
    try app.performAccessibilityAudit(for: .all)
    openCard()
    fixture("storage")
    element("share-card-save").tap()
    XCTAssertTrue(element("share-card-error").waitForExistence(timeout: 20))
    try audit("storage-failure")
    fixture("real")
    element("share-card-cancel").tap()
  }

  func testDeniedPermanentLimitedAndPendingTraversal() throws {
    fixture("permission_denied")
    openCard()
    element("share-card-save").tap()
    XCTAssertTrue(element("share-card-error").waitForExistence(timeout: 20))
    try audit("denied")
    fixture("permission_permanent")
    element("share-card-save").tap()
    XCTAssertTrue(element("share-card-error").waitForExistence(timeout: 20))
    try audit("permanent-denied")
    fixture("limited")
    element("share-card-save").tap()
    XCTAssertTrue(element("share-card-feedback").waitForExistence(timeout: 20))
    try audit("limited")
    fixture("deferred")
    element("share-card-save").tap()
    XCTAssertTrue(element("share-card-feedback").waitForExistence(timeout: 20))
    try audit("pending")
    element("share-card-cancel").tap()
    fixture("release")
    fixture("real")
  }

  func testOwnedSavingAndReopenedFinishingRestoreWatermark() throws {
    fixture("deferred")
    openCard()
    let labels = try clientCatalog()["shareCard"] as! [String: Any]
    let save = element("share-card-save")
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: save)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
    save.tap()
    exactFeedback(labels["saving"] as! String)
    try audit("pending")
    exactFeedback(labels["saving"] as! String)
    print("CC68_NATIVE_BEHAVIOR_PASS owned-saving")
    element("share-card-cancel").tap()
    openCard()
    exactFeedback(labels["finishingSave"] as! String)
    XCTAssertFalse(element("share-card-save").isEnabled)
    print("CC68_NATIVE_BEHAVIOR_PASS reopened-finishing")
    fixture("release")
    let watermark = element("share-card-watermark")
    let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: watermark)
    XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 20), .completed)
    XCTAssertFalse(element("share-card-feedback").exists)
    for _ in 0..<8 where !watermark.isHittable { app.swipeDown() }
    XCTAssertTrue(watermark.isHittable)
    let previous = String(describing: watermark.value)
    watermark.tap()
    XCTAssertNotEqual(String(describing: watermark.value), previous)
    XCTAssertTrue(loaded().waitForExistence(timeout: 20))
    print("CC68_NATIVE_BEHAVIOR_PASS watermark-reenabled")
    element("share-card-cancel").tap()
  }

  func testPreparingCancelAndRetryTraversal() throws {
    fixture("prepare_deferred")
    element("tab-wardrobe").tap()
    openCard(waitForPreview: false)
    XCTAssertTrue(element("share-card-feedback").waitForExistence(timeout: 20))
    XCTAssertFalse(loaded().exists)
    try audit("preparing")
    element("share-card-cancel").tap()
    fixture("release")
    XCTAssertFalse(element("share-card-title").exists)
    XCTAssertFalse(app.staticTexts.matching(identifier: "share-card-feedback").matching(NSPredicate(format: "label == %@", "Saved to photos")).firstMatch.exists)
    let opener = element("outfit-share-card-open")
    XCTAssertTrue(opener.exists)
    XCTAssertTrue(opener.isHittable)
    fixture("real")
    openCard()
    try audit("open")
    element("share-card-cancel").tap()
  }

  func testUnavailableAndOfflineTraversal() throws {
    fixture("unavailable")
    openCard()
    XCTAssertTrue(element("share-card-error").exists)
    XCTAssertFalse(element("share-card-save").isEnabled)
    try audit("unavailable")
    element("share-card-cancel").tap()
    fixture("real")
    openCard()
    fixture("offline")
    element("share-card-save").tap()
    XCTAssertTrue(element("share-card-error").waitForExistence(timeout: 20))
    try audit("offline")
    fixture("real")
    element("share-card-cancel").tap()
  }
}
