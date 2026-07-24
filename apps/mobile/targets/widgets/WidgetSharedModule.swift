import Foundation
import React
import WidgetKit

@objc(WidgetSharedModule)
class WidgetSharedModule: NSObject {
  private let appGroup = "group.com.anonymous.mobile"
  private let payloadKey = "widgetPayload"

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
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

    sharedDefaults.set(payload, forKey: payloadKey)
    guard sharedDefaults.synchronize(),
          sharedDefaults.string(forKey: payloadKey) == payload else {
      reject("widget_storage_write_failed", "The widget payload could not be saved.", nil)
      return
    }

    WidgetCenter.shared.reloadAllTimelines()
    resolve(nil)
  }
}
