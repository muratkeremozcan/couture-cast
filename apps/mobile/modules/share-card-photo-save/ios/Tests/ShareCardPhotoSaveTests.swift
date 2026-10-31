// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import XCTest
import CryptoKit
@testable import ShareCardPngFile

final class ShareCardPhotoSaveTests: XCTestCase {
  func approved() throws -> Data {
    try Data(contentsOf: Bundle.module.url(forResource: "approved", withExtension: "png")!)
  }

  func crc(_ bytes: [UInt8]) -> UInt32 {
    var value: UInt32 = 0xffffffff
    for byte in bytes {
      value ^= UInt32(byte)
      for _ in 0..<8 { value = (value >> 1) ^ ((value & 1) == 1 ? 0xedb88320 : 0) }
    }
    return value ^ 0xffffffff
  }

  func bigEndian(_ value: UInt32) -> [UInt8] {
    [UInt8(value >> 24 & 0xff), UInt8(value >> 16 & 0xff), UInt8(value >> 8 & 0xff), UInt8(value & 0xff)]
  }

  /// A chunk with a correct CRC, so only the targeted structural guard can reject it.
  func chunk(_ name: String, _ payload: [UInt8]) -> [UInt8] {
    let typed = Array(name.utf8) + payload
    return bigEndian(UInt32(payload.count)) + typed + bigEndian(crc(typed))
  }

  /// Signature, IHDR, optional extra chunks, one IDAT and IEND: 57 bytes plus the IDAT payload.
  func png(width: UInt32 = 1080, height: UInt32 = 1350, idat: [UInt8] = [0x78, 0x9c, 0x03, 0x00], extra: [UInt8] = []) -> Data {
    let header = bigEndian(width) + bigEndian(height) + [8, 2, 0, 0, 0]
    return Data([137, 80, 78, 71, 13, 10, 26, 10] + chunk("IHDR", header) + extra + chunk("IDAT", idat) + chunk("IEND", []))
  }

  func cacheFile(_ data: Data) throws -> (file: URL, root: URL, digest: String) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let directory = root.appendingPathComponent("share-cards", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: root) }
    let file = directory.appendingPathComponent("cc68-\(UUID().uuidString).png")
    try data.write(to: file)
    return (file, root, SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
  }

  func testApprovedCriticalOnlyPng() throws {
    let data = try approved()
    XCTAssertNoThrow(try ShareCardPngFile.validatePng(data))
    var corrupt = data
    corrupt[40] ^= 1
    XCTAssertThrowsError(try ShareCardPngFile.validatePng(corrupt))
    XCTAssertThrowsError(try ShareCardPngFile.validatePng(Data(data.dropLast())))
    XCTAssertThrowsError(try ShareCardPngFile.validatePng(Data()))
  }

  func testCrcValidStructureRejectsEveryNonApprovedChunkAndHeader() throws {
    // Positive control: the builder itself yields an accepted critical-only PNG.
    XCTAssertNoThrow(try ShareCardPngFile.validatePng(png()))
    for name in ["tEXt", "iTXt", "zTXt", "eXIf", "iCCP", "pHYs", "tIME", "PLTE"] {
      XCTAssertThrowsError(try ShareCardPngFile.validatePng(png(extra: chunk(name, Array("CoutureCast".utf8)))), name)
    }
    let approvedBytes = [UInt8](try approved())
    let trailer = Array(approvedBytes.suffix(12))
    XCTAssertEqual(trailer, chunk("IEND", []))
    let metadataBeforeEnd = Data(approvedBytes.dropLast(12) + chunk("tEXt", Array("Author\u{0}private".utf8)) + trailer)
    XCTAssertThrowsError(try ShareCardPngFile.validatePng(metadataBeforeEnd))
    for (width, height) in [(1081, 1350), (1080, 1349), (1350, 1080), (540, 675)] {
      XCTAssertThrowsError(try ShareCardPngFile.validatePng(png(width: UInt32(width), height: UInt32(height))), "\(width)x\(height)")
    }
  }

  func testCacheFileRejectsOversizeOriginalWithMatchingDigest() throws {
    let limit = 3 * 1024 * 1024
    let accepted = png(idat: [UInt8](repeating: 0, count: limit - 57))
    XCTAssertEqual(accepted.count, limit)
    let atLimit = try cacheFile(accepted)
    XCTAssertEqual(try ShareCardPngFile.validateFile(atLimit.file.absoluteString, atLimit.digest, atLimit.root), atLimit.file)
    let oversize = png(idat: [UInt8](repeating: 0, count: limit - 56))
    XCTAssertEqual(oversize.count, limit + 1)
    // Structure and digest both pass, so only the size cap can reject this file.
    XCTAssertNoThrow(try ShareCardPngFile.validatePng(oversize))
    let large = try cacheFile(oversize)
    XCTAssertThrowsError(try ShareCardPngFile.validateFile(large.file.absoluteString, large.digest, large.root))
  }

  func testCacheFileDigestAndPathValidation() throws {
    let (file, root, digest) = try cacheFile(try approved())
    XCTAssertEqual(try ShareCardPngFile.validateFile(file.absoluteString, digest, root), file)
    XCTAssertThrowsError(try ShareCardPngFile.validateFile(file.absoluteString, String(repeating: "0", count: 64), root))
    XCTAssertThrowsError(try ShareCardPngFile.validateFile("https://example.invalid/private.png", digest, root))
    XCTAssertThrowsError(try ShareCardPngFile.validateFile(file.absoluteString, digest, nil))
    let link = file.deletingLastPathComponent().appendingPathComponent("cc68-link.png")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
    XCTAssertThrowsError(try ShareCardPngFile.validateFile(link.absoluteString, digest, root))
  }

  /// N-IOS-PNGFILE-PREFIX: Save stays `cc68-`-only; the share module's `cc69-share-*` handoff
  /// files are refused here even when bytes, digest and folder are all valid.
  func testCacheFileAcceptsPhotoSavePrefixAndRejectsShareHandoffFiles() throws {
    let data = try approved()
    let (file, root, digest) = try cacheFile(data)
    XCTAssertEqual(try ShareCardPngFile.validateFile(file.absoluteString, digest, root), file)
    let directory = file.deletingLastPathComponent()
    for name in ["cc69-share-\(UUID().uuidString.lowercased()).png", "cc69-share-\(UUID().uuidString).png"] {
      let share = directory.appendingPathComponent(name)
      try data.write(to: share)
      XCTAssertThrowsError(try ShareCardPngFile.validateFile(share.absoluteString, digest, root), name)
    }
  }
}
