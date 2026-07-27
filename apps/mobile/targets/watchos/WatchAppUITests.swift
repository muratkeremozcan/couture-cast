import Foundation
import XCTest

final class WatchAppUITests: XCTestCase {
  private let timeout: TimeInterval = 10

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testP1_nowAndNextHourJourney() throws {
    // [P1] Exercise the complete wrist glance journey through the production SwiftUI app.
    let app = launchWatchApp(payload: try freshPayload())

    assertElement(
      app.otherElements,
      identifier: "watch.page.now"
    )
    assertElement(
      app.staticTexts,
      identifier: "watch.now.label",
      label: "NOW"
    )
    assertElement(
      app.staticTexts,
      identifier: "watch.now.feelsLikeTemp",
      label: "72°"
    )
    assertElement(
      app.images,
      identifier: "watch.now.condition",
      label: "Clear skies"
    )
    assertElement(
      app.staticTexts,
      identifier: "watch.now.outfitSummary",
      label: "Light jacket and loafers"
    )
    assertElement(
      app.buttons,
      identifier: "watch.now.handoff"
    )
    attachScreenshot(app, name: "watch-now-page")

    app.otherElements["watch.page.now"].swipeLeft()

    assertElement(
      app.otherElements,
      identifier: "watch.page.next"
    )
    assertElement(
      app.staticTexts,
      identifier: "watch.next.label",
      label: "NEXT HOUR"
    )
    assertElement(
      app.staticTexts,
      identifier: "watch.next.time",
      label: "2 PM"
    )
    assertElement(
      app.staticTexts,
      identifier: "watch.next.temperature",
      label: "75°"
    )
    assertElement(
      app.images,
      identifier: "watch.next.condition",
      label: "Partly cloudy"
    )
    assertElement(
      app.staticTexts,
      identifier: "watch.next.precipitation",
      label: "PRECIPITATION 40%"
    )
    assertElement(
      app.staticTexts,
      identifier: "watch.next.outfitSummary",
      label: "Remove the jacket after lunch"
    )
    assertElement(
      app.buttons,
      identifier: "watch.next.handoff"
    )
    attachScreenshot(app, name: "watch-next-hour-page")
  }

  @MainActor
  private func launchWatchApp(payload: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-CoutureCastWatchUITestMode", "1"]
    app.launchEnvironment = [
      "COUTURECAST_WATCH_UI_TEST_PAYLOAD": payload
    ]
    app.launch()
    return app
  }

  private func freshPayload() throws -> String {
    let payload: [String: Any] = [
      "currentTemp": "74°",
      "feelsLikeTemp": "72°",
      "currentConditionIcon": "clear",
      "currentConditionText": "Clear skies",
      "nowOutfitSummary": "Light jacket and loafers",
      "nextHourTime": "2 PM",
      "nextHourTemp": "75°",
      "nextHourIcon": "partly_cloudy",
      "nextConditionText": "Partly cloudy",
      "nextHourPrecipitation": "40%",
      "nextOutfitSummary": "Remove the jacket after lunch",
      "lastUpdated": ISO8601DateFormatter().string(from: Date()),
      "locale": "en-US",
      "nowLabel": "NOW",
      "nextHourLabel": "NEXT HOUR",
      "staleLabel": "STALE",
      "unavailableLabel": "OPEN APP",
      "precipitationLabel": "PRECIPITATION",
      "alertsEnabled": false,
      "hasSevereAlert": false,
      "severeAlertTitle": "",
      "severeAlertDescription": "",
      "quietHoursEnabled": false,
      "quietHoursStart": "22:00",
      "quietHoursEnd": "07:00",
      "timezone": "America/Chicago"
    ]
    let data = try JSONSerialization.data(
      withJSONObject: payload,
      options: [.sortedKeys]
    )
    return try XCTUnwrap(String(data: data, encoding: .utf8))
  }

  @MainActor
  private func assertElement(
    _ query: XCUIElementQuery,
    identifier: String,
    label: String? = nil,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let matches = query.matching(identifier: identifier)
    XCTAssertEqual(
      matches.count,
      1,
      "Expected exactly one accessible element with identifier \(identifier)",
      file: file,
      line: line
    )
    let element = matches.firstMatch
    XCTAssertTrue(
      element.waitForExistence(timeout: timeout),
      "Expected \(identifier) to become visible",
      file: file,
      line: line
    )
    if let label {
      XCTAssertEqual(element.label, label, file: file, line: line)
    }
  }

  @MainActor
  private func attachScreenshot(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

