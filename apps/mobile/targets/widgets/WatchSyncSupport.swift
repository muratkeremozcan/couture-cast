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

enum WatchTransferActivationState: Equatable {
  case inactive
  case activated
}

protocol WatchTransferSession: AnyObject {
  var activationState: WatchTransferActivationState { get }
  var isComplicationEnabled: Bool { get }
  var remainingComplicationTransfers: Int { get }

  func activate()
  func updateApplicationContext(_ context: [String: String]) throws
  func transferCurrentComplicationUserInfo(_ context: [String: String])
}

protocol WidgetPayloadStoring {
  func store(_ payload: String) -> Bool
}

protocol WidgetTimelineReloading {
  func reloadAllTimelines()
}

protocol WatchPayloadSynchronizing {
  func synchronize(_ payload: String)
}

enum WidgetPayloadWriteOutcome: Equatable {
  case success
  case persistenceFailed
}

final class WidgetPayloadWriteCoordinator {
  private let storage: WidgetPayloadStoring
  private let timeline: WidgetTimelineReloading
  private let watchSynchronization: WatchPayloadSynchronizing

  init(
    storage: WidgetPayloadStoring,
    timeline: WidgetTimelineReloading,
    watchSynchronization: WatchPayloadSynchronizing
  ) {
    self.storage = storage
    self.timeline = timeline
    self.watchSynchronization = watchSynchronization
  }

  func write(_ payload: String) -> WidgetPayloadWriteOutcome {
    guard storage.store(payload) else {
      return .persistenceFailed
    }

    timeline.reloadAllTimelines()
    watchSynchronization.synchronize(payload)
    return .success
  }
}

final class WidgetWatchTransferCoordinator: WatchPayloadSynchronizing {
  private static let payloadKey = "widgetPayload"

  private let session: WatchTransferSession
  private let pendingPayload = PendingWatchPayload()

  init(session: WatchTransferSession) {
    self.session = session
  }

  func synchronize(_ payload: String) {
    guard let optimizedPayload = WatchPayloadProjection.optimizedPayload(from: payload) else {
      print("[WidgetWatchTransferCoordinator] Watch payload projection failed.")
      return
    }

    guard session.activationState == .activated else {
      pendingPayload.replace(with: optimizedPayload)
      session.activate()
      return
    }

    sendOrQueue(optimizedPayload)
  }

  func activationDidComplete() {
    guard session.activationState == .activated,
      let payload = pendingPayload.take()
    else {
      return
    }

    sendOrQueue(payload)
  }

  private func sendOrQueue(_ payload: String) {
    let context = [Self.payloadKey: payload]
    do {
      try session.updateApplicationContext(context)
    } catch {
      pendingPayload.replace(with: payload)
      print(
        "[WidgetWatchTransferCoordinator] Failed to update watch context: "
          + error.localizedDescription
      )
      return
    }

    if session.isComplicationEnabled,
      session.remainingComplicationTransfers > 0
    {
      session.transferCurrentComplicationUserInfo(context)
    }
  }
}
