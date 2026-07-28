// Story 3.4 Task 1 step 1 owner: activate WatchConnectivity session and transfer payloads in apps/mobile/targets/widgets/WidgetSharedModule.swift
import Foundation
import React
import UIKit
import WatchConnectivity
import WidgetKit

@objc(WidgetSharedModule)
class WidgetSharedModule: NSObject, WCSessionDelegate {
  private let appGroup = "group.com.anonymous.mobile"
  private let payloadKey = "widgetPayload"
  private let pendingWatchPayload = PendingWatchPayload()

  override init() {
    super.init()
    if WCSession.isSupported() {
      let session = WCSession.default
      session.delegate = self
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

    guard WatchPayloadProjection.optimizedPayload(from: payload) != nil else {
      reject("widget_payload_invalid", "The widget payload is malformed or invalid.", nil)
      return
    }

    sharedDefaults.set(payload, forKey: payloadKey)
    guard sharedDefaults.string(forKey: payloadKey) == payload else {
      reject("widget_storage_write_failed", "The widget payload could not be saved.", nil)
      return
    }

    WidgetCenter.shared.reloadAllTimelines()

    synchronizeWatch(with: payload)

    resolve(nil)
  }

  private func synchronizeWatch(with payload: String) {
    guard WCSession.isSupported() else {
      return
    }
    guard
      let optimizedPayload = WatchPayloadProjection.optimizedPayload(
        from: payload
      )
    else {
      print("[WidgetSharedModule] Watch payload projection failed.")
      return
    }

    let session = WCSession.default
    guard session.activationState == .activated else {
      pendingWatchPayload.replace(with: optimizedPayload)
      session.activate()
      return
    }
    if !sendWatchPayload(optimizedPayload, through: session) {
      pendingWatchPayload.replace(with: optimizedPayload)
    }
  }

  @discardableResult
  private func sendWatchPayload(
    _ payload: String,
    through session: WCSession
  ) -> Bool {
    let context = [payloadKey: payload]
    do {
      try session.updateApplicationContext(context)
    } catch {
      print(
        "[WidgetSharedModule] Failed to update watch context: "
          + error.localizedDescription
      )
      return false
    }

    if session.isComplicationEnabled,
      session.remainingComplicationUserInfoTransfers > 0
    {
      session.transferCurrentComplicationUserInfo(context)
    }
    return true
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

  private func drainPendingPayload(through session: WCSession) {
    guard session.activationState == .activated,
      let payload = pendingWatchPayload.take()
    else {
      return
    }
    if !sendWatchPayload(payload, through: session) {
      pendingWatchPayload.replace(with: payload)
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
    drainPendingPayload(through: session)
  }

  func sessionDidBecomeInactive(_ session: WCSession) {
    print("[WidgetSharedModule] WCSession became inactive")
  }

  func sessionDidDeactivate(_ session: WCSession) {
    print("[WidgetSharedModule] WCSession deactivated. Reactivating.")
    let defaultSession = WCSession.default
    defaultSession.activate()
    drainPendingPayload(through: defaultSession)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    print("[WidgetSharedModule] WCSession reachability changed: \(session.isReachable)")
    if session.isReachable {
      drainPendingPayload(through: session)
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
