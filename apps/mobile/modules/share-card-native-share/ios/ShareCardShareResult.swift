import Foundation

/// The closed iOS share result. Raw activity types never leave this file: they map to a target
/// here and the bridge carries only `{target, outcome, code?}`.
enum ShareCardShareTarget: String, CaseIterable {
  case pinterest, instagram, facebook, tiktok, other, none, unknown
}

/// iOS reports completed or not completed; there is no chooser or web outcome on this platform.
enum ShareCardShareOutcome: String, CaseIterable {
  case completed, cancelled, failed
}

enum ShareCardShareCode: String, CaseIterable {
  case presenterUnavailable = "presenter_unavailable"
  case fileInvalid = "file_invalid"
  case nativeError = "native_error"
  case busy
}

extension ShareCardShareCode: Error {}

struct ShareCardShareResult: Equatable {
  let target: ShareCardShareTarget
  let outcome: ShareCardShareOutcome
  let code: ShareCardShareCode?

  static func failed(_ code: ShareCardShareCode) -> ShareCardShareResult {
    ShareCardShareResult(target: .none, outcome: .failed, code: code)
  }

  /// The only shape that crosses the bridge.
  var bridgeValue: [String: String] {
    var value = ["target": target.rawValue, "outcome": outcome.rawValue]
    if let code { value["code"] = code.rawValue }
    return value
  }
}

/// Exact-match allowlist from the spec Design Notes. Everything else, including near misses, is
/// `other`.
enum ShareCardActivityTarget {
  static let allowlist: [String: ShareCardShareTarget] = [
    "pinterest.ShareExtension": .pinterest,
    "com.burbn.instagram.shareextension": .instagram,
    "com.facebook.Facebook.ShareExtension": .facebook,
    "com.zhiliaoapp.musically.ShareExtension": .tiktok,
  ]

  static func target(for activityType: String) -> ShareCardShareTarget {
    allowlist[activityType] ?? .other
  }
}

/// Maps one `UIActivityViewController` completion to the result model.
enum ShareCardShareOutcomeReducer {
  static func result(activityType: String?, completed: Bool, error: Error?) -> ShareCardShareResult {
    if error != nil { return .failed(.nativeError) }
    let named = activityType.map(ShareCardActivityTarget.target(for:))
    if completed { return ShareCardShareResult(target: named ?? .unknown, outcome: .completed, code: nil) }
    return ShareCardShareResult(target: named ?? .none, outcome: .cancelled, code: nil)
  }
}

/// One share at a time. `begin` hands out an attempt; only the first settlement of the active
/// attempt returns a result, so duplicate or late completions are ignored. Main thread only.
final class ShareCardShareGate {
  private var active: UUID?

  var isActive: Bool { active != nil }

  func begin() -> UUID? {
    guard active == nil else { return nil }
    let attempt = UUID()
    active = attempt
    return attempt
  }

  func settle(_ attempt: UUID, _ result: ShareCardShareResult) -> ShareCardShareResult? {
    guard active == attempt else { return nil }
    active = nil
    return result
  }
}

/// The requested sheet's state when the presentation deadline passes.
enum ShareCardSheetState {
  /// UIKit refused the presentation and released the controller.
  case released
  /// The controller exists but is neither presented nor being presented.
  case offScreen
  case onScreen
}

/// Decides one presentation. UIKit refuses a presentation with only a console warning, and then no
/// completion ever arrives, so a sheet that has not appeared by the deadline settles the attempt as
/// refused, and a sheet that appears after that is taken down. Main thread only.
final class ShareCardPresentationWatch {
  private var presented = false
  private var refused = false

  /// The sheet appeared. True when the attempt already settled as refused and the sheet must go.
  func sheetAppeared() -> Bool {
    presented = true
    return refused
  }

  /// The deadline passed. True once, when the attempt must settle failed/presenter_unavailable.
  func deadlinePassed(_ sheet: ShareCardSheetState) -> Bool {
    guard sheet != .onScreen, !presented, !refused else { return false }
    refused = true
    return true
  }
}
