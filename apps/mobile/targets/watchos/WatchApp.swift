import SwiftUI

@main
struct WatchApp: App {
  @WKApplicationDelegateAdaptor(WatchAppDelegate.self) var appDelegate

  var body: some Scene {
    WindowGroup {
      WatchContentView()
        .onOpenURL { url in
          let components = URLComponents(
            url: url,
            resolvingAgainstBaseURL: false
          )
          let slot =
            components?.queryItems?.first(where: { $0.name == "slot" })?.value
            ?? "now"
          WatchConnectivityManager.shared.handoffToPhone(slot: slot)
        }
    }
  }
}

class WatchAppDelegate: NSObject, WKApplicationDelegate {
  func applicationDidFinishLaunching() {
    WatchConnectivityManager.shared.activate()
  }
}
