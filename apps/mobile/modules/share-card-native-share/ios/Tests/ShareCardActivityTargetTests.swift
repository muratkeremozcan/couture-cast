// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import XCTest
@testable import ShareCardShareCore

/// N-IOS-MAPPER: only the four exact extension ids name an app; everything else is `other`.
final class ShareCardActivityTargetTests: XCTestCase {
  func testAllowlistedExtensionsMapToTheirTargets() {
    XCTAssertEqual(ShareCardActivityTarget.target(for: "pinterest.ShareExtension"), .pinterest)
    XCTAssertEqual(ShareCardActivityTarget.target(for: "com.burbn.instagram.shareextension"), .instagram)
    XCTAssertEqual(ShareCardActivityTarget.target(for: "com.facebook.Facebook.ShareExtension"), .facebook)
    XCTAssertEqual(ShareCardActivityTarget.target(for: "com.zhiliaoapp.musically.ShareExtension"), .tiktok)
    XCTAssertEqual(ShareCardActivityTarget.allowlist.count, 4)
  }

  func testAppleBuiltInsMapToOther() {
    for activity in [
      "com.apple.UIKit.activity.Message", "com.apple.UIKit.activity.Mail",
      "com.apple.UIKit.activity.AirDrop", "com.apple.UIKit.activity.SaveToCameraRoll",
      "com.apple.UIKit.activity.CopyToPasteboard",
    ] {
      XCTAssertEqual(ShareCardActivityTarget.target(for: activity), .other, activity)
    }
  }

  func testNearMissesMapToOther() {
    for activity in [
      "com.burbn.instagram.shareextension.fake", "pinterest.ShareExtension2",
      "Pinterest.ShareExtension", "com.burbn.Instagram.shareextension",
      "xpinterest.ShareExtension", "com.facebook.Facebook", "com.zhiliaoapp.musically",
      " com.burbn.instagram.shareextension", "com.burbn.instagram.shareextension ",
      "com.facebook.Facebook.ShareExtension\n", "", "instagram",
    ] {
      XCTAssertEqual(ShareCardActivityTarget.target(for: activity), .other, activity.debugDescription)
    }
  }

  func testMappedTargetsStayInTheClosedSet() {
    let closed: Set<String> = ["pinterest", "instagram", "facebook", "tiktok", "other", "none", "unknown"]
    XCTAssertEqual(Set(ShareCardShareTarget.allCases.map(\.rawValue)), closed)
    for activity in ["pinterest.ShareExtension", "com.apple.UIKit.activity.Mail", "anything at all"] {
      XCTAssertTrue(closed.contains(ShareCardActivityTarget.target(for: activity).rawValue))
    }
  }
}
