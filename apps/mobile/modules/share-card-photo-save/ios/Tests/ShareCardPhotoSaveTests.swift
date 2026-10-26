import XCTest
import CryptoKit
@testable import ShareCardPngFile

final class ShareCardPhotoSaveTests: XCTestCase {
  func testApprovedCriticalOnlyPng() throws {
    let data = try Data(contentsOf: Bundle.module.url(forResource: "approved", withExtension: "png")!)
    XCTAssertNoThrow(try ShareCardPngFile.validatePng(data))
    var corrupt = data
    corrupt[40] ^= 1
    XCTAssertThrowsError(try ShareCardPngFile.validatePng(corrupt))
    XCTAssertThrowsError(try ShareCardPngFile.validatePng(Data(data.dropLast())))
    XCTAssertThrowsError(try ShareCardPngFile.validatePng(Data()))
  }
  func testCacheFileDigestAndPathValidation() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let directory = root.appendingPathComponent("share-cards", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let data = try Data(contentsOf: Bundle.module.url(forResource: "approved", withExtension: "png")!)
    let file = directory.appendingPathComponent("cc68-\(UUID().uuidString).png")
    try data.write(to: file)
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    XCTAssertEqual(try ShareCardPngFile.validateFile(file.absoluteString, digest, root), file)
    XCTAssertThrowsError(try ShareCardPngFile.validateFile(file.absoluteString, String(repeating: "0", count: 64), root))
    XCTAssertThrowsError(try ShareCardPngFile.validateFile("https://example.invalid/private.png", digest, root))
    XCTAssertThrowsError(try ShareCardPngFile.validateFile(file.absoluteString, digest, nil))
    let link = directory.appendingPathComponent("cc68-link.png")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
    XCTAssertThrowsError(try ShareCardPngFile.validateFile(link.absoluteString, digest, root))
  }
}
