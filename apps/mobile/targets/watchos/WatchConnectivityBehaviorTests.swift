import Foundation

#if COUTURECAST_XCTEST
import XCTest

final class WatchConnectivityBehaviorXCTests: XCTestCase {
  func testStory34ConnectivityScenarios() throws {
    try WatchConnectivityBehaviorScenarios.runAll()
  }
}
#else
@main
struct WatchConnectivityBehaviorTests {
  static func main() throws {
    try WatchConnectivityBehaviorScenarios.runAll()
    print("WatchConnectivityBehaviorTests passed")
  }
}
#endif

private enum WatchConnectivityBehaviorScenarios {
  static func runAll() throws {
    try scenario("[3.4-INT-001][P0] local widget write succeeds when WatchConnectivity update fails") {
      let payload = makePayload(lastUpdated: "2026-07-27T12:15:00.000Z")
      let session = FakeWatchTransferSession()
      session.activationState = .activated
      session.updateError = TestError.transportFailure
      let transfer = WidgetWatchTransferCoordinator(session: session)
      let storage = FakeWidgetPayloadStorage()
      let timeline = FakeTimelineReloader()
      let writer = WidgetPayloadWriteCoordinator(
        storage: storage,
        timeline: timeline,
        watchSynchronization: transfer
      )

      require(writer.write(payload) == .success, "Watch errors must not reject a local widget write")
      require(storage.payload == payload, "The local iOS widget payload must remain persisted")
      require(timeline.reloadCount == 1, "The iOS widget timeline must reload after persistence")
      require(session.updateContexts.count == 1, "The watch transfer must be attempted once")
    }

    try scenario("[3.4-INT-002][P0] inactive transfer queues only the latest payload and drains after activation") {
      let session = FakeWatchTransferSession()
      session.activationState = .inactive
      let transfer = WidgetWatchTransferCoordinator(session: session)
      let first = makePayload(lastUpdated: "2026-07-27T12:10:00.000Z", feelsLikeTemp: "70°F")
      let latest = makePayload(lastUpdated: "2026-07-27T12:15:00.000Z", feelsLikeTemp: "72°F")

      transfer.synchronize(first)
      transfer.synchronize(latest)
      require(session.updateContexts.isEmpty, "Inactive sessions must not send application context")
      require(session.activateCount >= 1, "Inactive sessions must be activated")

      session.activationState = .activated
      transfer.activationDidComplete()
      require(session.updateContexts.count == 1, "Activation must drain one latest-value context")
      require(
        session.updateContexts[0]["widgetPayload"]?.contains("72°F") == true,
        "Activation must drain the latest queued payload"
      )
    }

    try scenario("[3.4-INT-003][P1] complication transfer requires enablement and remaining budget") {
      let session = FakeWatchTransferSession()
      session.activationState = .activated
      session.isComplicationEnabled = true
      session.remainingComplicationTransfers = 0
      let transfer = WidgetWatchTransferCoordinator(session: session)

      transfer.synchronize(makePayload(lastUpdated: "2026-07-27T12:15:00.000Z"))
      require(
        session.complicationContexts.isEmpty,
        "An exhausted complication budget must suppress the priority transfer"
      )

      session.remainingComplicationTransfers = 1
      transfer.synchronize(makePayload(lastUpdated: "2026-07-27T12:16:00.000Z"))
      require(
        session.complicationContexts.count == 1,
        "An enabled complication with budget must receive priority transfer"
      )
    }

    try scenario("[3.4-INT-004][P0] newer watch payload persists publishes reloads and plays one active haptic") {
      let storage = FakeWatchPayloadStorage()
      storage.payload = makePayload(lastUpdated: "2026-07-27T12:10:00.000Z")
      let publisher = FakeWatchPayloadPublisher()
      let timeline = FakeTimelineReloader()
      let alerts = FakeWatchAlertDelivery()
      alerts.isApplicationActive = true
      let processor = WatchPayloadProcessor(
        storage: storage,
        publisher: publisher,
        timeline: timeline,
        alertDelivery: alerts
      )
      let incoming = makePayload(
        lastUpdated: "2026-07-27T12:15:00.000Z",
        alertsEnabled: true,
        hasSevereAlert: true,
        severeAlertId: "storm-1",
        severeAlertStart: "2026-07-27T12:00:00.000Z",
        severeAlertEnd: "2026-07-27T13:00:00.000Z"
      )

      let outcome = processor.process(incoming, now: try parseTimestamp("2026-07-27T12:20:00.000Z"))
      require(outcome == .accepted, "A valid newer payload must be accepted")
      require(storage.payload == incoming, "The accepted payload must be stored")
      require(publisher.payloads == [incoming], "The accepted payload must be published once")
      require(timeline.reloadCount == 1, "The complication timeline must reload once")
      require(alerts.hapticCount == 1, "An active severe alert must play one haptic")
      require(alerts.notifications.isEmpty, "The foreground path must not schedule a notification")
      require(storage.alertFingerprint == "storm-1", "The alert fingerprint must be persisted")
    }

    try scenario("[3.4-INT-005][P0] invalid watch payload has no persistence or UI side effects") {
      let fixture = makeWatchProcessorFixture()
      let outcome = fixture.processor.process("{invalid", now: Date(timeIntervalSince1970: 0))

      require(outcome == .invalid, "Malformed JSON must be rejected")
      require(fixture.storage.storeAttempts == 0, "Malformed JSON must not reach storage")
      require(fixture.publisher.payloads.isEmpty, "Malformed JSON must not publish state")
      require(fixture.timeline.reloadCount == 0, "Malformed JSON must not reload timelines")
      require(fixture.alerts.totalDeliveries == 0, "Malformed JSON must not trigger an alert")
    }

    try scenario("[3.4-INT-006][P0] duplicate watch payload is side-effect free") {
      let fixture = makeWatchProcessorFixture()
      let duplicate = makePayload(lastUpdated: "2026-07-27T12:15:00.000Z")
      fixture.storage.payload = duplicate

      let outcome = fixture.processor.process(duplicate, now: Date(timeIntervalSince1970: 0))
      require(outcome == .duplicate, "An identical payload must be classified as duplicate")
      require(fixture.storage.storeAttempts == 0, "A duplicate must not be written again")
      require(fixture.publisher.payloads.isEmpty, "A duplicate must not republish state")
      require(fixture.timeline.reloadCount == 0, "A duplicate must not reload timelines")
      require(fixture.alerts.totalDeliveries == 0, "A duplicate must not replay alerts")
    }

    try scenario("[3.4-INT-007][P0] older watch payload cannot overwrite newer state") {
      let fixture = makeWatchProcessorFixture()
      fixture.storage.payload = makePayload(lastUpdated: "2026-07-27T12:20:00.000Z")
      let older = makePayload(lastUpdated: "2026-07-27T12:15:00.000Z")

      let outcome = fixture.processor.process(older, now: Date(timeIntervalSince1970: 0))
      require(outcome == .stale, "An out-of-order payload must be classified as stale")
      require(fixture.storage.storeAttempts == 0, "An older payload must not overwrite storage")
      require(fixture.timeline.reloadCount == 0, "An older payload must not reload timelines")
      require(fixture.alerts.totalDeliveries == 0, "An older payload must not replay alerts")
    }

    try scenario("[3.4-INT-008][P1] failed watch persistence blocks publication timeline reload and alerts") {
      let fixture = makeWatchProcessorFixture()
      fixture.storage.storeSucceeds = false
      let incoming = makePayload(
        lastUpdated: "2026-07-27T12:15:00.000Z",
        alertsEnabled: true,
        hasSevereAlert: true,
        severeAlertId: "storm-2",
        severeAlertStart: "2026-07-27T12:00:00.000Z",
        severeAlertEnd: "2026-07-27T13:00:00.000Z"
      )

      let outcome = fixture.processor.process(
        incoming,
        now: try parseTimestamp("2026-07-27T12:20:00.000Z")
      )
      require(outcome == .persistenceFailed, "A failed write must be reported")
      require(fixture.publisher.payloads.isEmpty, "Unstored state must not be published")
      require(fixture.timeline.reloadCount == 0, "Unstored state must not reload timelines")
      require(fixture.alerts.totalDeliveries == 0, "Unstored state must not trigger alerts")
    }

    try scenario("[3.4-INT-009][P0] quiet hours suppress haptics after accepting fresh state") {
      let fixture = makeWatchProcessorFixture()
      let incoming = makePayload(
        lastUpdated: "2026-07-27T22:55:00.000Z",
        alertsEnabled: true,
        hasSevereAlert: true,
        severeAlertId: "storm-3",
        severeAlertStart: "2026-07-27T22:00:00.000Z",
        severeAlertEnd: "2026-07-28T01:00:00.000Z",
        quietHoursEnabled: true,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00"
      )

      let outcome = fixture.processor.process(
        incoming,
        now: try parseTimestamp("2026-07-27T23:00:00.000Z")
      )
      require(outcome == .accepted, "Quiet hours must not reject fresh weather state")
      require(fixture.timeline.reloadCount == 1, "Accepted state must still reload timelines")
      require(fixture.alerts.totalDeliveries == 0, "Quiet hours must suppress alert delivery")
      require(fixture.storage.alertFingerprint == nil, "A suppressed alert must remain eligible later")
    }

    try scenario("[3.4-INT-010][P1] repeated alert fingerprint suppresses a duplicate haptic") {
      let fixture = makeWatchProcessorFixture()
      fixture.storage.payload = makePayload(lastUpdated: "2026-07-27T12:10:00.000Z")
      fixture.storage.alertFingerprint = "storm-4"
      let incoming = makePayload(
        lastUpdated: "2026-07-27T12:15:00.000Z",
        alertsEnabled: true,
        hasSevereAlert: true,
        severeAlertId: "storm-4",
        severeAlertStart: "2026-07-27T12:00:00.000Z",
        severeAlertEnd: "2026-07-27T13:00:00.000Z"
      )

      let outcome = fixture.processor.process(
        incoming,
        now: try parseTimestamp("2026-07-27T12:20:00.000Z")
      )
      require(outcome == .accepted, "New weather state with a known alert must be accepted")
      require(fixture.alerts.totalDeliveries == 0, "A known alert fingerprint must not replay")
    }

    try scenario("[3.4-INT-011][P1] background severe alert schedules a notification instead of haptic") {
      let fixture = makeWatchProcessorFixture()
      fixture.alerts.isApplicationActive = false
      let incoming = makePayload(
        lastUpdated: "2026-07-27T12:15:00.000Z",
        alertsEnabled: true,
        hasSevereAlert: true,
        severeAlertId: "storm-5",
        severeAlertStart: "2026-07-27T12:00:00.000Z",
        severeAlertEnd: "2026-07-27T13:00:00.000Z"
      )

      _ = fixture.processor.process(
        incoming,
        now: try parseTimestamp("2026-07-27T12:20:00.000Z")
      )
      require(fixture.alerts.hapticCount == 0, "A background app must not play an immediate haptic")
      require(fixture.alerts.notifications.count == 1, "A background app must schedule one notification")
    }

    try scenario("[3.4-INT-012][P1] reachable handoff uses an immediate message") {
      let session = FakeWatchHandoffSession()
      session.activationState = .activated
      session.isReachable = true
      let handoff = WatchHandoffCoordinator(session: session)

      handoff.handoff(slot: "now")
      require(session.sentMessages.count == 1, "A reachable phone must receive an immediate message")
      require(session.transferredUserInfo.isEmpty, "A successful message must not enqueue fallback data")
      require(
        session.sentMessages[0]["handoffURL"] == "mobile://(tabs)?source=watch&slot=now",
        "The handoff URL must identify the watch source and requested slot"
      )
    }

    try scenario("[3.4-INT-013][P1] message failure falls back to background user info") {
      let session = FakeWatchHandoffSession()
      session.activationState = .activated
      session.isReachable = true
      session.sendFails = true
      let handoff = WatchHandoffCoordinator(session: session)

      handoff.handoff(slot: "next")
      require(session.sentMessages.count == 1, "The reachable path must try an immediate message")
      require(session.transferredUserInfo.count == 1, "Message failure must enqueue a durable fallback")
    }

    try scenario("[3.4-INT-014][P1] unreachable phone uses durable user info without sending") {
      let session = FakeWatchHandoffSession()
      session.activationState = .activated
      session.isReachable = false
      let handoff = WatchHandoffCoordinator(session: session)

      handoff.handoff(slot: "now")
      require(session.sentMessages.isEmpty, "An unreachable session must skip immediate messaging")
      require(session.transferredUserInfo.count == 1, "An unreachable session must enqueue user info")
    }

    try scenario("[3.4-INT-015][P1] inactive handoff queues the latest slot and flushes after activation") {
      let session = FakeWatchHandoffSession()
      session.activationState = .inactive
      let handoff = WatchHandoffCoordinator(session: session)

      handoff.handoff(slot: "now")
      handoff.handoff(slot: "next")
      require(session.activateCount >= 1, "An inactive handoff session must activate")
      require(session.sentMessages.isEmpty, "An inactive session must not send early")

      session.activationState = .activated
      session.isReachable = true
      handoff.activationDidComplete()
      require(session.sentMessages.count == 1, "Activation must flush one latest-value handoff")
      require(
        session.sentMessages[0]["handoffURL"]?.contains("slot=next") == true,
        "Activation must flush the latest requested slot"
      )
    }

  }
}

private func scenario(_ name: String, body: () throws -> Void) rethrows {
  print(name)
  try body()
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else {
    fatalError(message)
  }
}

private func parseTimestamp(_ value: String) throws -> Date {
  guard let date = WatchTimestamp.parse(value) else {
    throw TestError.invalidTimestamp(value)
  }
  return date
}

private func makePayload(
  lastUpdated: String,
  feelsLikeTemp: String = "72°F",
  alertsEnabled: Bool = false,
  hasSevereAlert: Bool = false,
  severeAlertId: String? = nil,
  severeAlertStart: String? = nil,
  severeAlertEnd: String? = nil,
  quietHoursEnabled: Bool = false,
  quietHoursStart: String = "22:00",
  quietHoursEnd: String = "07:00"
) -> String {
  var object: [String: Any] = [
    "feelsLikeTemp": feelsLikeTemp,
    "lastUpdated": lastUpdated,
    "locale": "en-US",
    "alertsEnabled": alertsEnabled,
    "hasSevereAlert": hasSevereAlert,
    "severeAlertTitle": "Severe storm",
    "severeAlertDescription": "Seek shelter",
    "quietHoursEnabled": quietHoursEnabled,
    "quietHoursStart": quietHoursStart,
    "quietHoursEnd": quietHoursEnd,
    "timezone": "UTC",
  ]
  object["severeAlertId"] = severeAlertId
  object["severeAlertStart"] = severeAlertStart
  object["severeAlertEnd"] = severeAlertEnd
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  return String(decoding: data, as: UTF8.self)
}

private struct WatchProcessorFixture {
  let processor: WatchPayloadProcessor
  let storage: FakeWatchPayloadStorage
  let publisher: FakeWatchPayloadPublisher
  let timeline: FakeTimelineReloader
  let alerts: FakeWatchAlertDelivery
}

private func makeWatchProcessorFixture() -> WatchProcessorFixture {
  let storage = FakeWatchPayloadStorage()
  let publisher = FakeWatchPayloadPublisher()
  let timeline = FakeTimelineReloader()
  let alerts = FakeWatchAlertDelivery()
  let processor = WatchPayloadProcessor(
    storage: storage,
    publisher: publisher,
    timeline: timeline,
    alertDelivery: alerts
  )
  return WatchProcessorFixture(
    processor: processor,
    storage: storage,
    publisher: publisher,
    timeline: timeline,
    alerts: alerts
  )
}

private enum TestError: Error {
  case transportFailure
  case invalidTimestamp(String)
}

private final class FakeWidgetPayloadStorage: WidgetPayloadStoring {
  var payload: String?
  var storeSucceeds = true

  func store(_ payload: String) -> Bool {
    guard storeSucceeds else {
      return false
    }
    self.payload = payload
    return true
  }
}

private final class FakeTimelineReloader: WidgetTimelineReloading {
  var reloadCount = 0

  func reloadAllTimelines() {
    reloadCount += 1
  }
}

private final class FakeWatchTransferSession: WatchTransferSession {
  var activationState: WatchTransferActivationState = .inactive
  var isComplicationEnabled = false
  var remainingComplicationTransfers = 0
  var activateCount = 0
  var updateContexts: [[String: String]] = []
  var complicationContexts: [[String: String]] = []
  var updateError: Error?

  func activate() {
    activateCount += 1
  }

  func updateApplicationContext(_ context: [String: String]) throws {
    updateContexts.append(context)
    if let updateError {
      throw updateError
    }
  }

  func transferCurrentComplicationUserInfo(_ context: [String: String]) {
    complicationContexts.append(context)
  }
}

private final class FakeWatchPayloadStorage: WatchPayloadStoring {
  var payload: String?
  var alertFingerprint: String?
  var storeSucceeds = true
  var storeAttempts = 0

  func store(_ payload: String) -> Bool {
    storeAttempts += 1
    guard storeSucceeds else {
      return false
    }
    self.payload = payload
    return true
  }
}

private final class FakeWatchPayloadPublisher: WatchPayloadPublishing {
  var payloads: [String] = []

  func publish(_ payload: String) {
    payloads.append(payload)
  }
}

private final class FakeWatchAlertDelivery: WatchAlertDelivering {
  var isApplicationActive = true
  var hapticCount = 0
  var notifications: [WidgetData] = []
  var totalDeliveries: Int { hapticCount + notifications.count }

  func playNotificationHaptic() {
    hapticCount += 1
  }

  func scheduleNotification(for data: WidgetData) {
    notifications.append(data)
  }
}

private final class FakeWatchHandoffSession: WatchHandoffSession {
  var activationState: WatchTransferActivationState = .inactive
  var isReachable = false
  var activateCount = 0
  var sendFails = false
  var sentMessages: [[String: String]] = []
  var transferredUserInfo: [[String: String]] = []

  func activate() {
    activateCount += 1
  }

  func sendMessage(
    _ message: [String: String],
    errorHandler: @escaping () -> Void
  ) {
    sentMessages.append(message)
    if sendFails {
      errorHandler()
    }
  }

  func transferUserInfo(_ message: [String: String]) {
    transferredUserInfo.append(message)
  }
}
