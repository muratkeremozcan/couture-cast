import ExpoModulesCore
import UIKit

/// Moves VoiceOver focus to a view, and reports VoiceOver focus changes as the
/// native view tags from the focused element outwards. React Native views carry
/// their React tag as `UIView.tag`.
public class AccessibilityFocusModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AccessibilityFocus")

    Events("onAccessibilityFocusChange")

    Constants(["canObserveFocus": true])

    AsyncFunction("focus") { (tag: Int) -> Bool in
      let view = self.appContext?.findView(withTag: tag, ofType: UIView.self)
      // A view that is not in a window yet cannot take VoiceOver focus; refusing
      // lets the caller ask again once React Native has reattached it.
      guard AccessibilityFocusTarget.canTakeFocus(view), let view else { return false }
      UIAccessibility.post(notification: .layoutChanged, argument: view)
      return true
    }
    .runOnQueue(.main)

    OnStartObserving {
      self.startObserving()
    }

    OnStopObserving {
      self.stopObserving()
    }

    OnDestroy {
      self.stopObserving()
    }
  }

  private func startObserving() {
    guard observer == nil else { return }
    observer = NotificationCenter.default.addObserver(
      forName: UIAccessibility.elementFocusedNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      let element = notification.userInfo?[UIAccessibility.focusedElementUserInfoKey]
      self?.sendEvent(
        "onAccessibilityFocusChange", ["tags": AccessibilityFocusTarget.tags(of: element)])
    }
  }

  private func stopObserving() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    observer = nil
  }
}
