import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit
import WidgetKit

class WatchConnectivityManager: NSObject, WCSessionDelegate, ObservableObject {
  static let shared = WatchConnectivityManager()

  private let appGroup = "group.com.anonymous.mobile.watch"
  private let payloadKey = "widgetPayload"
  private let lastAlertFingerprintKey = "lastSevereAlertFingerprint"
  private var pendingHandoffMessage: [String: Any]?
  private let syncQueue = DispatchQueue(label: "com.anonymous.mobile.watch.connectivity.sync")

  @Published var currentPayload: String?

  private override init() {
    super.init()
    if WCSession.isSupported() {
      let session = WCSession.default
      session.delegate = self
      session.activate()
    }
  }

  func activate() {
    if WCSession.isSupported() {
      WCSession.default.activate()
    }
  }

  private func persistPayload(_ payload: String) {
    syncQueue.async { [weak self] in
      self?.persistPayloadSync(payload)
    }
  }

  private func persistPayloadSync(_ payload: String) {
    guard let sharedDefaults = UserDefaults(suiteName: appGroup) else {
      print("[WatchConnectivityManager] Watch App Group store is unavailable.")
      return
    }

    guard let payloadData = payload.data(using: .utf8),
      let incoming = try? JSONDecoder().decode(
        WidgetData.self,
        from: payloadData
      )
    else {
      print("[WatchConnectivityManager] Rejected an invalid watch payload.")
      return
    }

    let storedPayload = sharedDefaults.string(forKey: payloadKey)
    if storedPayload == payload {
      return
    }
    let current =
      storedPayload
      .flatMap { $0.data(using: .utf8) }
      .flatMap { try? JSONDecoder().decode(WidgetData.self, from: $0) }
    guard
      WatchPayloadAcceptance.shouldAccept(
        incoming: incoming,
        current: current
      )
    else {
      print("[WatchConnectivityManager] Ignored an older watch payload.")
      return
    }

    sharedDefaults.set(payload, forKey: payloadKey)
    guard sharedDefaults.string(forKey: payloadKey) == payload else {
      print("[WatchConnectivityManager] Watch payload persistence failed.")
      return
    }

    DispatchQueue.main.async {
      self.currentPayload = payload
    }

    WidgetCenter.shared.reloadAllTimelines()

    triggerHapticsIfAppropriate(for: incoming, defaults: sharedDefaults)
  }

  private func triggerHapticsIfAppropriate(
    for data: WidgetData,
    defaults: UserDefaults,
    now: Date = Date()
  ) {
    guard data.hasActiveSevereAlert(at: now),
      let fingerprint = data.alertFingerprint,
      defaults.string(forKey: lastAlertFingerprintKey) != fingerprint
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
      print("[WatchConnectivityManager] Suppressed alert during quiet hours.")
      return
    }

    // Set fingerprint immediately on the syncQueue to prevent concurrent duplicates
    defaults.set(fingerprint, forKey: self.lastAlertFingerprintKey)

    DispatchQueue.main.async {
      if WKApplication.shared().applicationState == .active {
        WKInterfaceDevice.current().play(.notification)
      } else {
        self.dispatchLocalNotification(
          for: data,
          fingerprint: fingerprint,
          defaults: defaults
        )
      }
    }
  }

  private func dispatchLocalNotification(
    for data: WidgetData,
    fingerprint: String,
    defaults: UserDefaults
  ) {
    let notificationCenter = UNUserNotificationCenter.current()
    notificationCenter.getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral:
        self.scheduleLocalNotification(
          for: data,
          fingerprint: fingerprint,
          defaults: defaults
        )
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
            self.scheduleLocalNotification(
              for: data,
              fingerprint: fingerprint,
              defaults: defaults
            )
          }
        }
      case .denied:
        print("[WatchConnectivityManager] Notification permission is denied.")
      @unknown default:
        print("[WatchConnectivityManager] Unknown notification permission state.")
      }
    }
  }

  private func scheduleLocalNotification(
    for data: WidgetData,
    fingerprint: String,
    defaults: UserDefaults
  ) {
    let content = UNMutableNotificationContent()
    content.title = data.severeAlertTitle
    content.body = data.severeAlertDescription
    content.sound = .default

    let request = UNNotificationRequest(
      identifier: fingerprint,
      content: content,
      trigger: nil
    )

    UNUserNotificationCenter.current().add(request) { error in
      if let error = error {
        print(
          "[WatchConnectivityManager] Notification scheduling failed: "
            + error.localizedDescription
        )
      }
    }
  }

  func handoffToPhone(slot: String) {
    let message = [
      "handoffURL": "mobile://(tabs)?source=watch&slot=\(slot)"
    ]
    let session = WCSession.default
    guard session.activationState == .activated else {
      pendingHandoffMessage = message
      session.activate()
      return
    }
    sendHandoff(message, through: session)
  }

  private func sendHandoff(
    _ message: [String: Any],
    through session: WCSession
  ) {
    guard session.isReachable else {
      session.transferUserInfo(message)
      return
    }
    session.sendMessage(message, replyHandler: nil) { _ in
      session.transferUserInfo(message)
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
    if let message = pendingHandoffMessage {
      pendingHandoffMessage = nil
      sendHandoff(message, through: session)
    }
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
