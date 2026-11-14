// swift-tools-version: 5.9
// Pure sources only: the UIKit bridge needs ExpoModulesCore and is left to the app build.
//   swift test
// Story 6.15 D6: the mapping, outcome, anchor and file rules are Foundation-only and run on Linux
// on every pull request (pr-apple-native.yml swift-linux), with swift-crypto for SHA256. The
// LinkPresentation header (ShareCardShareLinkMetadata.swift) and its tests stay on macOS.
import PackageDescription

let coreSources = [
  "ShareCardShareResult.swift", "ShareCardAnchorConfiguration.swift", "ShareCardShareFile.swift",
  "ShareCardShareMetadata.swift",
]
let alwaysExcluded = [
  "ShareCardNativeShareModule.swift", "ShareCardActivityItem.swift", "ShareCardNativeShare.podspec", "Tests",
  "Package.swift", "LinuxShims",
]

#if os(Linux)
let dependencies: [Package.Dependency] = [
  .package(url: "https://github.com/apple/swift-crypto.git", exact: "4.5.2"),
]
// Foundation's CGRect stands in for CoreGraphics; LinuxShims/CoreGraphics re-exports it, so the
// anchor source keeps its `import CoreGraphics`.
let crypto: [Target.Dependency] = [.product(name: "Crypto", package: "swift-crypto"), "CoreGraphics"]
let shims: [Target] = [.target(name: "CoreGraphics", path: "LinuxShims/CoreGraphics")]
let sources = coreSources
// Linux resolves swift-crypto, which writes Package.resolved beside the sources.
let excluded = alwaysExcluded + ["ShareCardShareLinkMetadata.swift", "Package.resolved"]
let appleOnlyTests = ["ShareCardShareMetadataTests.swift"]
#else
let dependencies: [Package.Dependency] = []
let crypto: [Target.Dependency] = []
let shims: [Target] = []
let sources = coreSources + ["ShareCardShareLinkMetadata.swift"]
let excluded = alwaysExcluded
let appleOnlyTests: [String] = []
#endif

let package = Package(
  name: "ShareCardShareCore",
  platforms: [.macOS(.v13), .iOS(.v15)],
  products: [.library(name: "ShareCardShareCore", targets: ["ShareCardShareCore"])],
  dependencies: dependencies,
  targets: [
    .target(
      name: "ShareCardShareCore",
      dependencies: crypto,
      path: ".",
      exclude: excluded,
      sources: sources
    ),
    .testTarget(
      name: "ShareCardShareCoreTests",
      dependencies: ["ShareCardShareCore"] + crypto,
      path: "Tests",
      exclude: appleOnlyTests
    ),
  ] + shims
)
