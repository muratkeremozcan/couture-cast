import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else {
    fatalError(message)
  }
}

@main
struct WatchWidgetDataTests {
  static func main() throws {
    let legacyPayload = """
      {
        "feelsLikeTemp": "72°F",
        "lastUpdated": "2026-07-27T12:00:00.000Z",
        "locale": "en-US"
      }
      """
    let legacy = try JSONDecoder().decode(
      WidgetData.self,
      from: Data(legacyPayload.utf8)
    )
    require(legacy.feelsLikeTemp == "72°F", "Legacy values must survive decoding")
    require(!legacy.alertsEnabled, "Legacy payloads must default alerts to disabled")
    require(
      legacy.nextOutfitSummary == legacy.unavailableLabel,
      "Missing next-hour content must use an unavailable state"
    )

    let now = try XCTimestamp("2026-07-27T12:10:00.000Z")
    let staleDate = try XCTimestamp("2026-07-27T12:31:00.000Z")
    let quietDate = try XCTimestamp("2026-07-27T23:00:00.000Z")
    require(!legacy.isStale(at: now), "A recent payload must remain fresh")
    require(
      legacy.isStale(at: staleDate),
      "A payload older than 30 minutes must be stale"
    )

    require(
      WatchQuietHours.contains(
        date: quietDate,
        start: "22:00",
        end: "07:00",
        timeZoneIdentifier: "UTC"
      ),
      "Overnight quiet hours must include late evening"
    )
    require(
      WatchQuietHours.contains(
        date: now,
        start: "25:00",
        end: "07:00",
        timeZoneIdentifier: "UTC"
      ),
      "Malformed quiet hours must fail closed"
    )

    let severePayload = """
      {
        "lastUpdated": "2026-07-27T12:15:00.000Z",
        "alertsEnabled": true,
        "hasSevereAlert": true,
        "severeAlertId": "storm|start|end",
        "severeAlertTitle": "Severe storm",
        "severeAlertDescription": "Seek shelter",
        "severeAlertStart": "2026-07-27T12:00:00.000Z",
        "severeAlertEnd": "2026-07-27T13:00:00.000Z"
      }
      """
    let severe = try JSONDecoder().decode(
      WidgetData.self,
      from: Data(severePayload.utf8)
    )
    require(
      severe.hasActiveSevereAlert(at: now),
      "Active opted-in severe alerts must be actionable"
    )
    require(
      WatchPayloadAcceptance.shouldAccept(incoming: severe, current: legacy),
      "A newer payload must replace an older payload"
    )
    require(
      !WatchPayloadAcceptance.shouldAccept(incoming: legacy, current: severe),
      "An older payload must never replace a newer payload"
    )

    print("WatchWidgetDataTests passed")
  }
}

private func XCTimestamp(_ value: String) throws -> Date {
  guard let date = WatchTimestamp.parse(value) else {
    throw TimestampError.invalid(value)
  }
  return date
}

private enum TimestampError: Error {
  case invalid(String)
}
