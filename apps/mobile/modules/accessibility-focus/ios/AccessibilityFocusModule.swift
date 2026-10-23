import ExpoModulesCore
import UIKit

/// Reports VoiceOver focus changes as the native view tags from the focused
/// element outwards. React Native views carry their React tag as `UIView.tag`.
public class AccessibilityFocusModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AccessibilityFocus")

    Events("onAccessibilityFocusChange")

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
      self?.sendEvent("onAccessibilityFocusChange", ["tags": Self.tags(of: element)])
    }
  }

  private func stopObserving() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    observer = nil
  }

  private static func tags(of element: Any?) -> [Int] {
    var view = element as? UIView
    if view == nil, let accessibilityElement = element as? UIAccessibilityElement {
      view = accessibilityElement.accessibilityContainer as? UIView
    }
    var tags: [Int] = []
    while let current = view {
      if current.tag > 0 { tags.append(current.tag) }
      view = current.superview
    }
    return tags
  }
}
