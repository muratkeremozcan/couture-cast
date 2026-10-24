// swift-tools-version:5.9
// Story 6.7: runs AccessibilityFocusTarget under XCTest on an iOS simulator,
// without the Expo runtime the module itself needs:
//   xcodebuild test -scheme AccessibilityFocusTarget \
//     -destination 'platform=iOS Simulator,name=<device>'
import PackageDescription

let package = Package(
  name: "AccessibilityFocusTarget",
  platforms: [.iOS(.v15)],
  products: [.library(name: "AccessibilityFocusTarget", targets: ["AccessibilityFocusTarget"])],
  targets: [
    .target(
      name: "AccessibilityFocusTarget",
      path: ".",
      exclude: ["AccessibilityFocusModule.swift", "AccessibilityFocus.podspec", "Tests"],
      sources: ["AccessibilityFocusTarget.swift"]
    ),
    .testTarget(
      name: "AccessibilityFocusTargetTests",
      dependencies: ["AccessibilityFocusTarget"],
      path: "Tests/AccessibilityFocusTargetTests"
    ),
  ]
)
