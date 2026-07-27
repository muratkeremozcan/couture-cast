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
      let url = URL(string: rawURL),
      url.scheme == "mobile"
    else {
      return nil
    }

    let host = url.host
    guard host == "(tabs)" || host == "%28tabs%29" else {
      return nil
    }

    // Bypass URLComponents limitation by substituting the host for validation
    let standardURLString = rawURL.replacingOccurrences(of: "(tabs)", with: "tabs")
    guard let standardURL = URL(string: standardURLString),
      let components = URLComponents(url: standardURL, resolvingAgainstBaseURL: false),
      components.queryItems?.contains(
        where: { $0.name == "source" && $0.value == "watch" }
      ) == true
    else {
      return nil
    }

    return url
  }
}
