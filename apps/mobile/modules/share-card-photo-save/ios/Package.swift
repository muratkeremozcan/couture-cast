// swift-tools-version: 5.9
import PackageDescription
let package = Package(
  name: "ShareCardPngFile",
  platforms: [.macOS(.v13), .iOS(.v15)],
  products: [.library(name: "ShareCardPngFile", targets: ["ShareCardPngFile"])],
  targets: [
    .target(name: "ShareCardPngFile", path: ".", exclude: ["ShareCardPhotoSaveModule.swift", "ShareCardPhotoSave.podspec", "Tests", "Package.swift"], sources: ["ShareCardPngFile.swift"]),
    .testTarget(name: "ShareCardPhotoSaveTests", dependencies: ["ShareCardPngFile"], path: "Tests", resources: [.copy("approved.png")])
  ]
)
