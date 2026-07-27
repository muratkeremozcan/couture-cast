import Foundation

protocol WatchPayloadStoring: AnyObject {
  var payload: String? { get set }
  var alertFingerprint: String? { get set }

  func store(_ payload: String) -> Bool
}

protocol WatchPayloadPublishing {
  func publish(_ payload: String)
}

protocol WatchAlertDelivering: AnyObject {
  var isApplicationActive: Bool { get }

  func playNotificationHaptic()
  func scheduleNotification(for data: WidgetData)
}

enum WatchPayloadProcessingOutcome: Equatable {
  case accepted
  case invalid
  case duplicate
  case stale
  case persistenceFailed
}

final class WatchPayloadProcessor {
  private let storage: WatchPayloadStoring
  private let publisher: WatchPayloadPublishing
  private let timeline: WidgetTimelineReloading
  private let alertDelivery: WatchAlertDelivering

  init(
    storage: WatchPayloadStoring,
    publisher: WatchPayloadPublishing,
    timeline: WidgetTimelineReloading,
    alertDelivery: WatchAlertDelivering
  ) {
    self.storage = storage
    self.publisher = publisher
    self.timeline = timeline
    self.alertDelivery = alertDelivery
  }

  func process(_ payload: String, now: Date = Date()) -> WatchPayloadProcessingOutcome {
    guard let payloadData = payload.data(using: .utf8),
      let incoming = try? JSONDecoder().decode(WidgetData.self, from: payloadData)
    else {
      return .invalid
    }

    if storage.payload == payload {
      return .duplicate
    }

    let current =
      storage.payload
      .flatMap { $0.data(using: .utf8) }
      .flatMap { try? JSONDecoder().decode(WidgetData.self, from: $0) }
    guard WatchPayloadAcceptance.shouldAccept(incoming: incoming, current: current) else {
      return .stale
    }

    guard storage.store(payload) else {
      return .persistenceFailed
    }

    publisher.publish(payload)
    timeline.reloadAllTimelines()
    deliverAlertIfAppropriate(for: incoming, now: now)
    return .accepted
  }

  private func deliverAlertIfAppropriate(for data: WidgetData, now: Date) {
    guard data.hasActiveSevereAlert(at: now),
      let fingerprint = data.alertFingerprint,
      storage.alertFingerprint != fingerprint
    else {
      return
    }

    if data.quietHoursEnabled,
      WatchQuietHours.contains(
        date: now,
        start: data.quietHoursStart,
        end: data.quietHoursEnd,
        timeZoneIdentifier: data.timezone
      )
    {
      return
    }

    storage.alertFingerprint = fingerprint
    if alertDelivery.isApplicationActive {
      alertDelivery.playNotificationHaptic()
    } else {
      alertDelivery.scheduleNotification(for: data)
    }
  }
}

protocol WatchHandoffSession: AnyObject {
  var activationState: WatchTransferActivationState { get }
  var isReachable: Bool { get }

  func activate()
  func sendMessage(
    _ message: [String: String],
    errorHandler: @escaping () -> Void
  )
  func transferUserInfo(_ message: [String: String])
}

final class WatchHandoffCoordinator {
  private let session: WatchHandoffSession
  private let pendingMessageLock = NSLock()
  private var pendingMessage: [String: String]?

  init(session: WatchHandoffSession) {
    self.session = session
  }

  func handoff(slot: String) {
    let message = [
      "handoffURL": "mobile://(tabs)?source=watch&slot=\(slot)"
    ]
    guard session.activationState == .activated else {
      replacePendingMessage(with: message)
      session.activate()
      return
    }

    send(message)
  }

  func activationDidComplete() {
    guard session.activationState == .activated,
      let message = takePendingMessage()
    else {
      return
    }
    send(message)
  }

  private func send(_ message: [String: String]) {
    guard session.isReachable else {
      session.transferUserInfo(message)
      return
    }

    session.sendMessage(message) { [weak self] in
      self?.session.transferUserInfo(message)
    }
  }

  private func replacePendingMessage(with message: [String: String]) {
    pendingMessageLock.lock()
    pendingMessage = message
    pendingMessageLock.unlock()
  }

  private func takePendingMessage() -> [String: String]? {
    pendingMessageLock.lock()
    defer { pendingMessageLock.unlock() }
    let message = pendingMessage
    pendingMessage = nil
    return message
  }
}
