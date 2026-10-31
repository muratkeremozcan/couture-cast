import ExpoModulesCore
import UIKit

/// Hands one validated share-card PNG to `UIActivityViewController` and resolves once with
/// `{target, outcome, code?}`. Raw activity types are mapped in `ShareCardShareResult.swift` and
/// never logged or returned.
public final class ShareCardNativeShareModule: Module {
  private let gate = ShareCardShareGate()
  private var pending: (attempt: UUID, promise: Promise)?
  private let story68Session = UUID().uuidString
  private var story68Sequence = 0

  public func definition() -> ModuleDefinition {
    Name("ShareCardNativeShare")

    AsyncFunction("shareFile") { (fileUri: String, expectedSha256: String, anchor: [String: Any]?, promise: Promise) in
      guard let attempt = self.gate.begin() else {
        promise.resolve(ShareCardShareResult.failed(.busy).bridgeValue)
        return
      }
      self.pending = (attempt, promise)
      let url: URL
      do {
        url = try ShareCardShareFile.validateFile(fileUri, expectedSha256, self.appContext?.config.cacheDirectory)
      } catch {
        self.settle(attempt, .failed(.fileInvalid))
        return
      }
      self.present(url, anchor: ShareCardAnchorConfiguration.anchor(from: anchor), attempt: attempt)
    }
    .runOnQueue(.main)

    OnDestroy {
      // A reload drops the JS promise; the next attempt must not see this one as busy.
      if let pending = self.pending { _ = self.gate.settle(pending.attempt, .failed(.nativeError)) }
      self.pending = nil
    }
  }

  private func present(_ url: URL, anchor: CGRect?, attempt: UUID) {
    let presenter = topMostController()
    let configured = ShareCardAnchorConfiguration.configure(
      presenterView: presenter?.view,
      bounds: presenter?.view.bounds ?? .zero,
      anchor: anchor,
      fromWindow: { rect in presenter?.view.convert(rect, from: nil) ?? rect }
    )
    guard let presenter, case .success(let popover) = configured else {
      settle(attempt, .failed(.presenterUnavailable))
      return
    }
    let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    let popoverController = controller.popoverPresentationController
    popoverController?.sourceView = popover.sourceView
    popoverController?.sourceRect = popover.sourceRect
    // What the test-build report records. UIKit does not report the anchor back on a compact
    // iPhone (iOS 26.1 simulator: sourceView read nil right after it was set, and after
    // presentation it was a UITransitionView with sourceRect its bottom 10 points).
    let configuredSource = popoverController == nil ? nil : popover.sourceView
    let configuredRect = configuredSource?.convert(popover.sourceRect, to: nil) ?? .zero
    controller.completionWithItemsHandler = { [weak self] activityType, completed, _, error in
      let result = ShareCardShareOutcomeReducer.result(
        activityType: activityType?.rawValue, completed: completed, error: error)
      DispatchQueue.main.async { self?.settle(attempt, result) }
    }
    var presented = false
    var refused = false
    presenter.present(controller, animated: true) { [weak self, weak controller, weak presenter] in
      guard let controller, let presenter else { return }
      presented = true
      // The attempt already settled as refused; a sheet that appears after that is taken down.
      if refused {
        controller.dismiss(animated: false)
        return
      }
      self?.writeStory68AnchorReport(
        controller, presenter: presenter, sourceView: configuredSource, sourceRect: configuredRect)
    }
    // UIKit refuses a presentation with only a console warning, and then no completion would
    // ever arrive. Presentation can start late: iOS 26 presents UIActivityViewController only
    // after loading its activities (iOS 26.1 simulator: still no presenter one main-queue turn
    // after present(), presented 650 ms later), so only a sheet that has not appeared by the
    // deadline is refused.
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.presentationDeadline) {
      [weak self, weak controller] in
      guard let controller, !presented, controller.presentingViewController == nil,
        !controller.isBeingPresented
      else { return }
      refused = true
      self?.settle(attempt, .failed(.presenterUnavailable))
    }
  }

  /// How long a requested sheet may take to appear before the attempt settles as refused.
  private static let presentationDeadline: TimeInterval = 10

  private func settle(_ attempt: UUID, _ result: ShareCardShareResult) {
    guard let settled = gate.settle(attempt, result), let pending, pending.attempt == attempt else { return }
    self.pending = nil
    pending.promise.resolve(settled.bridgeValue)
  }

  private func topMostController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
    var top = window?.rootViewController
    while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
    // A sheet still on screen is not a presenter for a second sheet.
    guard let top, top.view.window != nil, !(top is UIActivityViewController), !top.isBeingDismissed
    else { return nil }
    return top
  }

  /// Test-build-only proof for the iPhone XCUITest, where a compact sheet ignores the popover
  /// anchor. Compiled out of Release and written only by the isolated story68 app, it records,
  /// after presentation, the sourceView and sourceRect (window points) assigned to the popover
  /// controller; `sourceView` is nil when the controller had none to assign to.
  private func writeStory68AnchorReport(
    _ controller: UIActivityViewController, presenter: UIViewController, sourceView: UIView?,
    sourceRect rect: CGRect
  ) {
    #if DEBUG
    guard Bundle.main.bundleIdentifier == "com.couturecast.story68",
      let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    else { return }
    story68Sequence += 1
    let record: [String: Any] = [
      "session": story68Session,
      "sequence": story68Sequence,
      "presented": controller.presentingViewController === presenter,
      "mainThread": Thread.isMainThread,
      "sourceViewSet": sourceView != nil,
      "sourceViewIsPresenterView": sourceView === presenter.view,
      "sourceRect": ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height],
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: record) else { return }
    try? data.write(to: directory.appendingPathComponent("cc69-share-anchor.json"), options: .atomic)
    #endif
  }
}
