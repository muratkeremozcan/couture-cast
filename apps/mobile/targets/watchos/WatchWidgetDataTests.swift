import Foundation

@main
struct WatchWidgetDataTests {
  static func main() throws {
    try scenario("[3.4-UNIT-001][P0] legacy payload defaults remain compatible") {
      let legacy = try decode(
        """
        {
          "feelsLikeTemp": "72°F",
          "lastUpdated": "2026-07-27T12:00:00.000Z",
          "locale": "en-US"
        }
        """
      )
      require(legacy.feelsLikeTemp == "72°F", "Legacy values must survive decoding")
      require(!legacy.alertsEnabled, "Legacy payloads must default alerts to disabled")
      require(
        legacy.nextOutfitSummary == legacy.unavailableLabel,
        "Missing next-hour content must use an unavailable state"
      )
    }

    try scenario("[3.4-UNIT-002][P0] freshness expires at thirty minutes") {
      let payload = try decode(
        """
        {
          "lastUpdated": "2026-07-27T12:00:00.000Z"
        }
        """
      )
      let freshDate = try parseTimestamp("2026-07-27T12:10:00.000Z")
      let staleDate = try parseTimestamp("2026-07-27T12:31:00.000Z")
      require(
        !payload.isStale(at: freshDate),
        "A recent payload must remain fresh"
      )
      require(
        payload.isStale(at: staleDate),
        "A payload older than 30 minutes must be stale"
      )
    }

    try scenario("[3.4-UNIT-003][P0] quiet hours cross midnight and fail closed") {
      let quietDate = try parseTimestamp("2026-07-27T23:00:00.000Z")
      let midday = try parseTimestamp("2026-07-27T12:10:00.000Z")
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
          date: midday,
          start: "25:00",
          end: "07:00",
          timeZoneIdentifier: "UTC"
        ),
        "Malformed quiet hours must fail closed"
      )
    }

    try scenario("[3.4-UNIT-004][P0] severe alerts require opt-in and an active window") {
      let now = try parseTimestamp("2026-07-27T12:10:00.000Z")
      let severe = try decode(
        """
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
      )
      require(
        severe.hasActiveSevereAlert(at: now),
        "Active opted-in severe alerts must be actionable"
      )

      let disabled = try decode(
        """
        {
          "lastUpdated": "2026-07-27T12:15:00.000Z",
          "alertsEnabled": false,
          "hasSevereAlert": true,
          "severeAlertId": "storm|start|end",
          "severeAlertStart": "2026-07-27T12:00:00.000Z",
          "severeAlertEnd": "2026-07-27T13:00:00.000Z"
        }
        """
      )
      require(
        !disabled.hasActiveSevereAlert(at: now),
        "Disabled alert settings must suppress severe alerts"
      )

      let ended = try decode(
        """
        {
          "lastUpdated": "2026-07-27T12:15:00.000Z",
          "alertsEnabled": true,
          "hasSevereAlert": true,
          "severeAlertId": "storm|start|end",
          "severeAlertStart": "2026-07-27T11:00:00.000Z",
          "severeAlertEnd": "2026-07-27T12:00:00.000Z"
        }
        """
      )
      require(
        !ended.hasActiveSevereAlert(at: now),
        "Out of window alerts must not be active"
      )
    }

    try scenario("[3.4-UNIT-005][P0] newer payloads replace older state") {
      let older = try decode(
        """
        {
          "lastUpdated": "2026-07-27T12:00:00.000Z"
        }
        """
      )
      let newer = try decode(
        """
        {
          "lastUpdated": "2026-07-27T12:15:00.000Z"
        }
        """
      )
      require(
        WatchPayloadAcceptance.shouldAccept(incoming: newer, current: older),
        "A newer payload must replace an older payload"
      )
      require(
        !WatchPayloadAcceptance.shouldAccept(incoming: older, current: newer),
        "An older payload must never replace a newer payload"
      )
    }

    print("WatchWidgetDataTests passed")
  }
}

private func scenario(_ name: String, body: () throws -> Void) rethrows {
  print(name)
  try body()
}

private func decode(_ payload: String) throws -> WidgetData {
  try JSONDecoder().decode(WidgetData.self, from: Data(payload.utf8))
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else {
    fatalError(message)
  }
}

private func parseTimestamp(_ value: String) throws -> Date {
  guard let date = WatchTimestamp.parse(value) else {
    throw TimestampError.invalid(value)
  }
  return date
}

private enum TimestampError: Error {
  case invalid(String)
}
