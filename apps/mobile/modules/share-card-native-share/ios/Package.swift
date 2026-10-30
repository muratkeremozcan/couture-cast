// swift-tools-version: 5.9
// Pure sources only: the UIKit bridge needs ExpoModulesCore and is left to the app build.
//   swift test
import PackageDescription

let package = Package(
  name: "ShareCardShareCore",
  platforms: [.macOS(.v13), .iOS(.v15)],
  products: [.library(name: "ShareCardShareCore", targets: ["ShareCardShareCore"])],
  targets: [
    .target(
      name: "ShareCardShareCore",
      path: ".",
      exclude: ["ShareCardNativeShareModule.swift", "ShareCardNativeShare.podspec", "Tests", "Package.swift"],
      sources: ["ShareCardShareResult.swift", "ShareCardAnchorConfiguration.swift", "ShareCardShareFile.swift"]
    ),
    .testTarget(name: "ShareCardShareCoreTests", dependencies: ["ShareCardShareCore"], path: "Tests"),
  ]
)
