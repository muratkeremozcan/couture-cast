import Foundation

final class PendingWatchPayload {
  private let lock = NSLock()
  private var payload: String?

  func replace(with nextPayload: String) {
    lock.lock()
    payload = nextPayload
    lock.unlock()
  }

  func take() -> String? {
    lock.lock()
    defer { lock.unlock() }
    let current = payload
    payload = nil
    return current
  }
}

enum WatchPayloadProjection {
  private static let transferredKeys: Set<String> = [
    "feelsLikeTemp",
    "currentConditionIcon",
    "currentConditionText",
    "nowOutfitSummary",
    "nextHourTime",
    "nextHourTemp",
    "nextHourIcon",
    "nextHourPrecipitation",
    "nextOutfitSummary",
    "lastUpdated",
    "locale",
    "nowLabel",
    "nextHourLabel",
    "staleLabel",
    "unavailableLabel",
    "precipitationLabel",
    "alertsEnabled",
    "hasSevereAlert",
    "severeAlertId",
    "severeAlertTitle",
    "severeAlertDescription",
    "severeAlertStart",
    "severeAlertEnd",
    "quietHoursEnabled",
    "quietHoursStart",
    "quietHoursEnd",
    "timezone",
  ]

  static func optimizedPayload(from payload: String) -> String? {
    guard let data = payload.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data),
      let dictionary = object as? [String: Any]
    else {
      return nil
    }

    let optimized = dictionary.filter { transferredKeys.contains($0.key) }
    guard JSONSerialization.isValidJSONObject(optimized),
      let encoded = try? JSONSerialization.data(
        withJSONObject: optimized,
        options: [.sortedKeys]
      )
    else {
      return nil
    }
    return String(data: encoded, encoding: .utf8)
  }
}

enum WatchHandoff {
  static let messageKey = "handoffURL"

  static func validatedURL(from message: [String: Any]) -> URL? {
    guard let rawURL = message[messageKey] as? String,
      let components = URLComponents(string: rawURL),
      components.scheme == "mobile",
      components.host == "(tabs)",
      components.queryItems?.contains(
        where: { $0.name == "source" && $0.value == "watch" }
      ) == true,
      let url = components.url
    else {
      return nil
    }
    return url
  }
}
