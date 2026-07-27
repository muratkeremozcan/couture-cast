import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else {
    fatalError(message)
  }
}

@main
struct WatchSyncSupportTests {
  static func main() {
    let pending = PendingWatchPayload()
    pending.replace(with: "first")
    pending.replace(with: "latest")
    require(pending.take() == "latest", "Pending synchronization must keep the latest payload")
    require(pending.take() == nil, "Taking a pending payload must clear it")

    let payload = """
      {
        "currentTemp": "70°F",
        "feelsLikeTemp": "68°F",
        "lastUpdated": "2026-07-27T12:00:00.000Z",
        "unknownField": "private"
      }
      """
    let optimized = WatchPayloadProjection.optimizedPayload(from: payload)
    require(optimized?.contains("feelsLikeTemp") == true, "Watch fields must be retained")
    require(optimized?.contains("currentTemp") == false, "Unused fields must be removed")
    require(optimized?.contains("unknownField") == false, "Unknown fields must be removed")

    let validMessage: [String: Any] = [
      WatchHandoff.messageKey: "mobile://(tabs)?source=watch&slot=now"
    ]
    require(
      WatchHandoff.validatedURL(from: validMessage) != nil,
      "Valid watch handoffs must be accepted"
    )
    let invalidMessage: [String: Any] = [
      WatchHandoff.messageKey: "https://example.com"
    ]
    require(
      WatchHandoff.validatedURL(from: invalidMessage) == nil,
      "External handoff URLs must be rejected"
    )

    print("WatchSyncSupportTests passed")
  }
}
