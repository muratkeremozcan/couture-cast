import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit
import WidgetKit

class WatchConnectivityManager: NSObject, WCSessionDelegate, ObservableObject {
  static let shared = WatchConnectivityManager()

  private let payloadKey = "widgetPayload"
  private let syncQueue = DispatchQueue(label: "com.anonymous.mobile.watch.connectivity.sync")
  private lazy var payloadStorage = UserDefaultsWatchPayloadStorage(
    appGroup: "group.com.anonymous.mobile.watch",
    payloadKey: payloadKey,
    alertFingerprintKey: "lastSevereAlertFingerprint"
  )
  private lazy var payloadProcessor = WatchPayloadProcessor(
    storage: payloadStorage,
    publisher: MainQueueWatchPayloadPublisher(manager: self),
    timeline: WatchWidgetTimelineReloader(),
    alertDelivery: WatchSystemAlertDelivery()
  )
  private lazy var handoffCoordinator = WatchHandoffCoordinator(
    session: WatchConnectivityHandoffSession(session: WCSession.default)
  )

  @Published var currentPayload: String?

  private override init() {
    super.init()
  }

  func activate() {
    guard WCSession.isSupported() else {
      return
    }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  func handoffToPhone(slot: String) {
    guard WCSession.isSupported() else {
      return
    }
    handoffCoordinator.handoff(slot: slot)
  }

  private func persistPayload(_ payload: String) {
    syncQueue.async { [weak self] in
      guard let self else {
        return
      }
      switch payloadProcessor.process(payload) {
      case .accepted, .duplicate:
        break
      case .invalid:
        print("[WatchConnectivityManager] Rejected an invalid watch payload.")
      case .stale:
        print("[WatchConnectivityManager] Ignored an older watch payload.")
      case .persistenceFailed:
        print("[WatchConnectivityManager] Watch payload persistence failed.")
      }
    }
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    if let error {
      print("[WatchConnectivityManager] Activation failed: \(error.localizedDescription)")
      return
    }
    guard activationState == .activated else {
      return
    }

    if let payload = session.receivedApplicationContext[payloadKey] as? String {
      persistPayload(payload)
    }
    handoffCoordinator.activationDidComplete()
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any])
  {
    if let payload = applicationContext[payloadKey] as? String {
      persistPayload(payload)
    }
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    if let payload = userInfo[payloadKey] as? String {
      persistPayload(payload)
    }
  }
}

private final class UserDefaultsWatchPayloadStorage: WatchPayloadStoring {
  private let defaults: UserDefaults?
  private let payloadKey: String
  private let alertFingerprintKey: String

  init(
    appGroup: String,
    payloadKey: String,
    alertFingerprintKey: String
  ) {
    defaults = UserDefaults(suiteName: appGroup)
    self.payloadKey = payloadKey
    self.alertFingerprintKey = alertFingerprintKey
  }

  var payload: String? {
    get { defaults?.string(forKey: payloadKey) }
    set { defaults?.set(newValue, forKey: payloadKey) }
  }

  var alertFingerprint: String? {
    get { defaults?.string(forKey: alertFingerprintKey) }
    set { defaults?.set(newValue, forKey: alertFingerprintKey) }
  }

  func store(_ payload: String) -> Bool {
    guard let defaults else {
      return false
    }
    defaults.set(payload, forKey: payloadKey)
    return defaults.string(forKey: payloadKey) == payload
  }
}

private final class MainQueueWatchPayloadPublisher: WatchPayloadPublishing {
  private weak var manager: WatchConnectivityManager?

  init(manager: WatchConnectivityManager) {
    self.manager = manager
  }

  func publish(_ payload: String) {
    DispatchQueue.main.async { [weak manager] in
      manager?.currentPayload = payload
    }
  }
}

private struct WatchWidgetTimelineReloader: WidgetTimelineReloading {
  func reloadAllTimelines() {
    WidgetCenter.shared.reloadAllTimelines()
  }
}

private final class WatchSystemAlertDelivery: WatchAlertDelivering {
  var isApplicationActive: Bool {
    if Thread.isMainThread {
      return WKApplication.shared().applicationState == .active
    }
    return DispatchQueue.main.sync {
      WKApplication.shared().applicationState == .active
    }
  }

  func playNotificationHaptic() {
    DispatchQueue.main.async {
      WKInterfaceDevice.current().play(.notification)
    }
  }

  func scheduleNotification(for data: WidgetData) {
    let notificationCenter = UNUserNotificationCenter.current()
    notificationCenter.getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral:
        Self.addNotification(for: data, through: notificationCenter)
      case .notDetermined:
        notificationCenter.requestAuthorization(options: [.alert, .sound]) {
          granted,
          error in
          if let error {
            print(
              "[WatchConnectivityManager] Notification permission failed: "
                + error.localizedDescription
            )
          }
          if granted {
            Self.addNotification(for: data, through: notificationCenter)
          }
        }
      case .denied:
        print("[WatchConnectivityManager] Notification permission is denied.")
      @unknown default:
        print("[WatchConnectivityManager] Unknown notification permission state.")
      }
    }
  }

  private static func addNotification(
    for data: WidgetData,
    through notificationCenter: UNUserNotificationCenter
  ) {
    guard let fingerprint = data.alertFingerprint else {
      return
    }
    let content = UNMutableNotificationContent()
    content.title = data.severeAlertTitle
    content.body = data.severeAlertDescription
    content.sound = .default
    let request = UNNotificationRequest(
      identifier: fingerprint,
      content: content,
      trigger: nil
    )
    notificationCenter.add(request) { error in
      if let error {
        print(
          "[WatchConnectivityManager] Notification scheduling failed: "
            + error.localizedDescription
        )
      }
    }
  }
}

private final class WatchConnectivityHandoffSession: WatchHandoffSession {
  private let session: WCSession

  init(session: WCSession) {
    self.session = session
  }

  var activationState: WatchTransferActivationState {
    session.activationState == .activated ? .activated : .inactive
  }

  var isReachable: Bool {
    session.isReachable
  }

  func activate() {
    session.activate()
  }

  func sendMessage(
    _ message: [String: String],
    errorHandler: @escaping () -> Void
  ) {
    session.sendMessage(message, replyHandler: nil) { _ in
      errorHandler()
    }
  }

  func transferUserInfo(_ message: [String: String]) {
    session.transferUserInfo(message)
  }
}
