import ExpoModulesCore
import UIKit

/// Story 6.15 F-00i: observes the Darwin notification the harness posts with
/// `xcrun simctl spawn <udid> notifyutil -p com.couturecast.textlayoutprobe.dump`, after writing a
/// token to `Library/Caches/text-layout-probe/request`, and answers with `<token>.json` beside it.
/// The module is linked only into builds prebuilt with COUTURE_TEXT_LAYOUT_PROBE=1
/// (plugins/with-text-layout-probe.js).
public class TextLayoutProbeAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  private static var observing = false

  public func subscriberDidRegister() {
    guard !Self.observing else { return }
    Self.observing = true
    if let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
      _ = try? TextLayoutProbeWire.directory(caches: caches)
    }
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      { _, _, _, _, _ in
        DispatchQueue.main.async {
          MainActor.assumeIsolated { TextLayoutProbeAppDelegateSubscriber.answer() }
        }
      },
      TextLayoutProbeWire.notification as CFString,
      nil,
      .deliverImmediately)
  }

  @MainActor
  static func answer() {
    guard
      let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
      let directory = try? TextLayoutProbeWire.directory(caches: caches),
      let token = TextLayoutProbeWire.requestedToken(in: directory)
    else {
      NSLog("TextLayoutProbe: no valid request token")
      return
    }
    do {
      let data = try TextLayoutProbeSnapshot.capture(token: token)
      _ = try TextLayoutProbeWire.writeAnswer(data, token: token, in: directory)
    } catch {
      // No answer: the harness fails the leg on a missing answer.
      NSLog("TextLayoutProbe: error \(token) \(error)")
    }
  }
}
