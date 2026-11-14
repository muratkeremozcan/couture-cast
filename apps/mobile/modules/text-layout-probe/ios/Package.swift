// swift-tools-version: 5.9
// The text layout probe's wire and rect rules and its TextKit measure, without the UIKit window
// walk and the React Native paragraph reader, which need the app build. TextKit is shared by
// AppKit and UIKit, so these run on a Mac:
//   swift test
import PackageDescription

let package = Package(
  name: "TextLayoutProbeRules",
  platforms: [.macOS(.v13), .iOS(.v15)],
  products: [.library(name: "TextLayoutProbeRules", targets: ["TextLayoutProbeRules"])],
  targets: [
    .target(
      name: "TextLayoutProbeRules",
      path: ".",
      exclude: [
        "TextLayoutProbe.podspec", "TextLayoutProbeAppDelegateSubscriber.swift",
        "TextLayoutProbeSnapshot.swift", "TLPParagraphReader.h", "TLPParagraphReader.mm", "Tests",
        "Package.swift",
      ],
      sources: ["TextLayoutProbeWire.swift", "TextLayoutProbeMeasure.swift"]
    ),
    .testTarget(name: "TextLayoutProbeRulesTests", dependencies: ["TextLayoutProbeRules"], path: "Tests"),
  ]
)
