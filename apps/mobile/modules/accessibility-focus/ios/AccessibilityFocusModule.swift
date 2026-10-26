import ExpoModulesCore
import UIKit

/// Moves VoiceOver focus to a view, and reports VoiceOver focus changes as the
/// native view tags from the focused element outwards. React Native views carry
/// their React tag as `UIView.tag`.
public class AccessibilityFocusModule: Module {
  private var observer: NSObjectProtocol?
  private var story68ObservationSession: String?
  private var story68ObservationSequence = 0
  private weak var story68RequestedView: UIView?
  private var story68ObservationTimer: Timer?

  public func definition() -> ModuleDefinition {
    Name("AccessibilityFocus")

    Events("onAccessibilityFocusChange")

    Constants(["canObserveFocus": true])

    // Enabled exclusively by the existing guarded Debug fixture ingress.
    AsyncFunction("enableStory68Observation") { (fixtureEnabled: Bool) -> Bool in
      self.configureStory68Observation(fixtureEnabled)
    }.runOnQueue(.main)

    AsyncFunction("focus") { (tag: Int) -> Bool in
      let view = self.appContext?.findView(withTag: tag, ofType: UIView.self)
      return AccessibilityFocusTarget.requestLayoutChange(view, didPost: { actual in
        self.recordStory68Target(actual, posted: true)
      })
    }
    .runOnQueue(.main)

    OnStartObserving {
      self.startObserving()
    }

    OnStopObserving {
      self.stopObserving()
    }

    OnDestroy {
      self.stopStory68Observation()
      self.stopObserving()
    }
  }

  private func configureStory68Observation(_ fixtureEnabled: Bool) -> Bool {
    #if DEBUG
    if !fixtureEnabled {
      stopStory68Observation()
      return false
    }
    guard Bundle.main.bundleIdentifier == "com.couturecast.story68" else { return false }
    story68ObservationSession = UUID().uuidString
    story68ObservationSequence = 0
    story68RequestedView = nil
    story68ObservationTimer?.invalidate()
    recordStory68Target(nil, posted: false)
    story68ObservationTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      self?.recordStory68Target(nil, posted: false)
    }
    return true
    #else
    return false
    #endif
  }

  private func stopStory68Observation() {
    story68ObservationTimer?.invalidate()
    story68ObservationTimer = nil
    story68ObservationSession = nil
    story68RequestedView = nil
    #if DEBUG
    if Bundle.main.bundleIdentifier == "com.couturecast.story68",
      let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      try? FileManager.default.removeItem(at: directory.appendingPathComponent("cc68-focus-observation.json"))
    }
    #endif
  }

  private func recordStory68Target(_ view: UIView?, posted: Bool) {
    #if DEBUG
    guard UIApplication.shared.applicationState == .active,
      let session = story68ObservationSession,
      Bundle.main.bundleIdentifier == "com.couturecast.story68"
    else { return }
    if posted {
      story68ObservationSequence += 1
      story68RequestedView = view
    }
    let target = AccessibilityFocusTarget.semanticTarget(story68RequestedView)
    let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
    let headers = windows.flatMap { AccessibilityFocusTarget.visibleSemanticElements(in: $0) }
      .filter { $0.accessibilityTraits.contains(.header) }
      .map { $0.accessibilityLabel ?? "" }
    let record: [String: Any] = [
      "session": session, "sequence": story68ObservationSequence,
      "identifier": AccessibilityFocusTarget.observationIdentifier(of: target, requestedView: story68RequestedView),
      "label": target?.accessibilityLabel ?? "",
      "attached": AccessibilityFocusTarget.canTakeFocus(AccessibilityFocusTarget.containerView(of: target)),
      "header": target?.accessibilityTraits.contains(.header) ?? false,
      "posted": story68ObservationSequence > 0,
      "headings": headers,
    ]
    guard let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
      let data = try? JSONSerialization.data(withJSONObject: record)
    else { return }
    try? data.write(to: directory.appendingPathComponent("cc68-focus-observation.json"), options: .atomic)
    #endif
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
