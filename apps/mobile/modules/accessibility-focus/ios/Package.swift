// swift-tools-version:5.9
// Story 6.7: runs AccessibilityFocusTarget under XCTest on an iOS simulator,
// without the Expo runtime the module itself needs:
//   xcodebuild test -scheme AccessibilityFocusTarget \
//     -destination 'platform=iOS Simulator,name=<device>'
// Story 6.15 D6: the Foundation-only focus rules build on Linux too, where the
// target holds them alone and `swift test` runs AccessibilityFocusRulesTests on
// every pull request (pr-apple-native.yml swift-linux). macOS keeps the UIKit
// decisions and AccessibilityFocusTargetTests.
import PackageDescription

#if os(Linux)
let targetSources = ["AccessibilityFocusRules.swift"]
let targetExcludes = [
  "AccessibilityFocusModule.swift", "AccessibilityFocusTarget.swift", "AccessibilityFocus.podspec", "Tests",
]
let uikitTests: [Target] = []
#else
let targetSources = ["AccessibilityFocusTarget.swift", "AccessibilityFocusRules.swift"]
let targetExcludes = ["AccessibilityFocusModule.swift", "AccessibilityFocus.podspec", "Tests"]
let uikitTests: [Target] = [
  .testTarget(
    name: "AccessibilityFocusTargetTests",
    dependencies: ["AccessibilityFocusTarget"],
    path: "Tests/AccessibilityFocusTargetTests"
  ),
]
#endif

let package = Package(
  name: "AccessibilityFocusTarget",
  platforms: [.iOS(.v15)],
  products: [.library(name: "AccessibilityFocusTarget", targets: ["AccessibilityFocusTarget"])],
  targets: [
    .target(
      name: "AccessibilityFocusTarget",
      path: ".",
      exclude: targetExcludes,
      sources: targetSources
    ),
    .testTarget(
      name: "AccessibilityFocusRulesTests",
      dependencies: ["AccessibilityFocusTarget"],
      path: "Tests/AccessibilityFocusRulesTests"
    ),
  ] + uikitTests
)
