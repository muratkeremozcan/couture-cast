// swift-tools-version: 5.9
// The PNG file rules without the Photos bridge, which needs ExpoModulesCore and is left to the app
// build. Story 6.15 D6: they are Foundation-only and run on Linux on every pull request
// (pr-apple-native.yml swift-linux), with swift-crypto for SHA256.
//   swift test
import PackageDescription

#if os(Linux)
let dependencies: [Package.Dependency] = [
  .package(url: "https://github.com/apple/swift-crypto.git", exact: "4.5.2"),
]
let crypto: [Target.Dependency] = [.product(name: "Crypto", package: "swift-crypto")]
// Linux resolves swift-crypto, which writes Package.resolved beside the sources.
let resolved = ["Package.resolved"]
#else
let dependencies: [Package.Dependency] = []
let crypto: [Target.Dependency] = []
let resolved: [String] = []
#endif

let package = Package(
  name: "ShareCardPngFile",
  platforms: [.macOS(.v13), .iOS(.v15)],
  products: [.library(name: "ShareCardPngFile", targets: ["ShareCardPngFile"])],
  dependencies: dependencies,
  targets: [
    .target(
      name: "ShareCardPngFile",
      dependencies: crypto,
      path: ".",
      exclude: ["ShareCardPhotoSaveModule.swift", "ShareCardPhotoSave.podspec", "Tests", "Package.swift"] + resolved,
      sources: ["ShareCardPngFile.swift"]
    ),
    .testTarget(
      name: "ShareCardPhotoSaveTests",
      dependencies: ["ShareCardPngFile"] + crypto,
      path: "Tests",
      resources: [.copy("approved.png")]
    ),
  ]
)
