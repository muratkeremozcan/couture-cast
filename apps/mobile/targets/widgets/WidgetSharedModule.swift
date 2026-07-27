import Foundation
import React
import UIKit
import WatchConnectivity
import WidgetKit

@objc(WidgetSharedModule)
class WidgetSharedModule: NSObject, WCSessionDelegate {
  private let appGroup = "group.com.anonymous.mobile"
  private let payloadKey = "widgetPayload"
  private var watchTransfer: WidgetWatchTransferCoordinator?

  override init() {
    super.init()
    if WCSession.isSupported() {
      let session = WCSession.default
      session.delegate = self
      watchTransfer = WidgetWatchTransferCoordinator(
        session: WidgetWatchTransferSession(session: session)
      )
      session.activate()
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc(setWidgetData:resolver:rejecter:)
  func setWidgetData(
    _ payload: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard let sharedDefaults = UserDefaults(suiteName: appGroup) else {
      reject(
        "widget_storage_unavailable",
        "The widget App Group store is unavailable.",
        nil
      )
      return
    }

    let writer = WidgetPayloadWriteCoordinator(
      storage: UserDefaultsWidgetPayloadStorage(
        defaults: sharedDefaults,
        payloadKey: payloadKey
      ),
      timeline: WidgetKitTimelineReloader(),
      watchSynchronization: watchTransfer ?? NoopWatchPayloadSynchronizer()
    )
    guard writer.write(payload) == .success else {
      reject("widget_storage_write_failed", "The widget payload could not be saved.", nil)
      return
    }

    resolve(nil)
  }

  private func openWatchHandoff(_ message: [String: Any]) {
    guard let url = WatchHandoff.validatedURL(from: message) else {
      print("[WidgetSharedModule] Rejected invalid watch handoff.")
      return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(url, options: [:])
    }
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    if let error {
      print("[WidgetSharedModule] WCSession activation failed: \(error.localizedDescription)")
      return
    }
    watchTransfer?.activationDidComplete()
  }

  func sessionDidBecomeInactive(_ session: WCSession) {
    print("[WidgetSharedModule] WCSession became inactive")
  }

  func sessionDidDeactivate(_ session: WCSession) {
    print("[WidgetSharedModule] WCSession deactivated. Reactivating.")
    let defaultSession = WCSession.default
    defaultSession.activate()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    print("[WidgetSharedModule] WCSession reachability changed: \(session.isReachable)")
    if session.isReachable {
      watchTransfer?.activationDidComplete()
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    openWatchHandoff(message)
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    openWatchHandoff(message)
    replyHandler(["accepted": true])
  }

  func session(
    _ session: WCSession,
    didReceiveUserInfo userInfo: [String: Any]
  ) {
    openWatchHandoff(userInfo)
  }
}

private final class UserDefaultsWidgetPayloadStorage: WidgetPayloadStoring {
  private let defaults: UserDefaults
  private let payloadKey: String

  init(defaults: UserDefaults, payloadKey: String) {
    self.defaults = defaults
    self.payloadKey = payloadKey
  }

  func store(_ payload: String) -> Bool {
    defaults.set(payload, forKey: payloadKey)
    return defaults.synchronize() && defaults.string(forKey: payloadKey) == payload
  }
}

private struct WidgetKitTimelineReloader: WidgetTimelineReloading {
  func reloadAllTimelines() {
    WidgetCenter.shared.reloadAllTimelines()
  }
}

private struct NoopWatchPayloadSynchronizer: WatchPayloadSynchronizing {
  func synchronize(_ payload: String) {}
}

private final class WidgetWatchTransferSession: WatchTransferSession {
  private let session: WCSession

  init(session: WCSession) {
    self.session = session
  }

  var activationState: WatchTransferActivationState {
    session.activationState == .activated ? .activated : .inactive
  }

  var isComplicationEnabled: Bool {
    session.isComplicationEnabled
  }

  var remainingComplicationTransfers: Int {
    session.remainingComplicationUserInfoTransfers
  }

  func activate() {
    session.activate()
  }

  func updateApplicationContext(_ context: [String: String]) throws {
    try session.updateApplicationContext(context)
  }

  func transferCurrentComplicationUserInfo(_ context: [String: String]) {
    session.transferCurrentComplicationUserInfo(context)
  }
}
