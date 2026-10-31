import CryptoKit
import XCTest
@testable import ShareCardShareCore

/// N-IOS-SHARE-FILE: only a digest-matching critical-chunk PNG at
/// `cache/share-cards/cc69-share-<uuid>/couturecast-card.png` passes.
final class ShareCardShareFileTests: XCTestCase {
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

  func png(width: UInt32 = 1080, height: UInt32 = 1350, idat: [UInt8] = [0x78, 0x9c, 0x03, 0x00], extra: [UInt8] = []) -> Data {
    let header = bigEndian(width) + bigEndian(height) + [8, 2, 0, 0, 0]
    return Data([137, 80, 78, 71, 13, 10, 26, 10] + chunk("IHDR", header) + extra + chunk("IDAT", idat) + chunk("IEND", []))
  }

  func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

  /// A fresh Caches stand-in holding `share-cards/`.
  func cacheRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root.appendingPathComponent("share-cards"), withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: root) }
    return root
  }

  func write(_ data: Data, _ relative: String, in root: URL) throws -> URL {
    let file = root.appendingPathComponent(relative)
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: file)
    return file
  }

  /// The share-cards-relative handoff path: a per-share directory holding the public name.
  func shareName() -> String { "cc69-share-\(UUID().uuidString.lowercased())/couturecast-card.png" }

  func testAcceptsOnlyAShareFileInsideShareCards() throws {
    let root = try cacheRoot()
    let data = png()
    let file = try write(data, "share-cards/\(shareName())", in: root)
    XCTAssertEqual(try ShareCardShareFile.validateFile(file.absoluteString, digest(data), root), file)
    XCTAssertEqual(file.lastPathComponent, "couturecast-card.png")
    let upper = try write(data, "share-cards/cc69-share-\(UUID().uuidString)/couturecast-card.png", in: root)
    XCTAssertEqual(try ShareCardShareFile.validateFile(upper.absoluteString, digest(data), root), upper)
  }

  func testRejectsPhotoSaveAndOtherNames() throws {
    let root = try cacheRoot()
    let data = png()
    let id = UUID().uuidString.lowercased()
    let card = "couturecast-card.png"
    for name in [
      "cc69-share-\(id).png", "cc68-\(id).png", "cc68-\(id)/\(card)", "cc69-\(id)/\(card)",
      "cc69-share-/\(card)", "cc69-share-not-a-uuid/\(card)", "cc69-share-\(id)x/\(card)",
      "xcc69-share-\(id)/\(card)", "cc69-share-\(id)/couturecast-card.PNG",
      "cc69-share-\(id)/couturecast-card.png.png", "cc69-share-\(id)/cc69-share-\(id).png", card,
    ] {
      let file = try write(data, "share-cards/\(name)", in: root)
      XCTAssertThrowsError(try ShareCardShareFile.validateFile(file.absoluteString, digest(data), root), name)
    }
  }

  func testRejectsFilesOutsideShareCardsAndTraversal() throws {
    let root = try cacheRoot()
    let data = png()
    let name = shareName()
    for relative in [name, "share-cards/nested/\(name)", "other/\(name)", "share-cards-x/\(name)"] {
      let file = try write(data, relative, in: root)
      XCTAssertThrowsError(try ShareCardShareFile.validateFile(file.absoluteString, digest(data), root), relative)
    }
    // The file exists one level up; the URI reaches it through `..`.
    let traversal = root.absoluteString + "share-cards/../" + name
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(traversal, digest(data), root))
    // Even a `..` that lands back inside share-cards is refused.
    let insideName = shareName()
    let inside = try write(data, "share-cards/\(insideName)", in: root)
    let roundTrip = root.absoluteString + "share-cards/../share-cards/" + insideName
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(roundTrip, digest(data), root))
    let directory = inside.deletingLastPathComponent().lastPathComponent
    let viaDirectory = root.absoluteString + "share-cards/\(directory)/../\(insideName)"
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(viaDirectory, digest(data), root))
    XCTAssertThrowsError(try ShareCardShareFile.validateFile("https://example.invalid/\(name)", digest(data), root))
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(inside.absoluteString, digest(data), nil))
  }

  func testRejectsSymlinkEscapes() throws {
    let root = try cacheRoot()
    let outside = try cacheRoot()
    let data = png()
    let target = try write(data, "share-cards/\(shareName())", in: outside)
    let link = root.appendingPathComponent("share-cards/\(shareName())")
    try FileManager.default.createDirectory(at: link.deletingLastPathComponent(), withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(link.absoluteString, digest(data), root))
    // A per-share directory that is a link out of Caches.
    let linkedDirectory = root.appendingPathComponent("share-cards/cc69-share-\(UUID().uuidString.lowercased())")
    try FileManager.default.createSymbolicLink(at: linkedDirectory, withDestinationURL: target.deletingLastPathComponent())
    let throughDirectory = linkedDirectory.appendingPathComponent("couturecast-card.png")
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(throughDirectory.absoluteString, digest(data), root))
    // A share-cards directory that is itself a link out of Caches.
    let linkedRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: linkedRoot, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: linkedRoot) }
    try FileManager.default.createSymbolicLink(
      at: linkedRoot.appendingPathComponent("share-cards"),
      withDestinationURL: target.deletingLastPathComponent().deletingLastPathComponent())
    let escaped = linkedRoot.appendingPathComponent(
      "share-cards/\(target.deletingLastPathComponent().lastPathComponent)/couturecast-card.png")
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(escaped.absoluteString, digest(data), linkedRoot))
  }

  func testRejectsDigestMismatchExtraChunksAndOversize() throws {
    let root = try cacheRoot()
    let data = png()
    let file = try write(data, "share-cards/\(shareName())", in: root)
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(file.absoluteString, String(repeating: "0", count: 64), root))
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(file.absoluteString, digest(data).uppercased(), root))
    for name in ["tEXt", "iTXt", "zTXt", "eXIf", "iCCP", "pHYs", "tIME", "PLTE"] {
      let extra = png(extra: chunk(name, Array("CoutureCast".utf8)))
      let tagged = try write(extra, "share-cards/\(shareName())", in: root)
      XCTAssertThrowsError(try ShareCardShareFile.validateFile(tagged.absoluteString, digest(extra), root), name)
    }
    for (width, height) in [(1081, 1350), (1080, 1349), (1350, 1080)] {
      let wrong = png(width: UInt32(width), height: UInt32(height))
      XCTAssertThrowsError(try ShareCardShareFile.validatePng(wrong), "\(width)x\(height)")
    }
    var corrupt = [UInt8](data)
    corrupt[20] ^= 1
    XCTAssertThrowsError(try ShareCardShareFile.validatePng(Data(corrupt)))
    let limit = ShareCardShareFile.maximumBytes
    let atLimit = png(idat: [UInt8](repeating: 0, count: limit - 57))
    XCTAssertEqual(atLimit.count, limit)
    let accepted = try write(atLimit, "share-cards/\(shareName())", in: root)
    XCTAssertNoThrow(try ShareCardShareFile.validateFile(accepted.absoluteString, digest(atLimit), root))
    let oversize = png(idat: [UInt8](repeating: 0, count: limit - 56))
    XCTAssertNoThrow(try ShareCardShareFile.validatePng(oversize))
    let large = try write(oversize, "share-cards/\(shareName())", in: root)
    XCTAssertThrowsError(try ShareCardShareFile.validateFile(large.absoluteString, digest(oversize), root))
  }

  /// G04: the test build records what `itemForActivityType: nil` hands a receiver. A file URL
  /// reports the SHA256 of the bytes it names, so the XCUITest can compare it to the preview digest.
  func testHandedItemDigestsTheBytesAtAFileURL() throws {
    let root = try cacheRoot()
    let data = png()
    let file = try write(data, "share-cards/\(shareName())", in: root)
    let handed = ShareCardShareFile.handedItem(file)
    XCTAssertTrue(handed.isFileURL)
    XCTAssertEqual(handed.sha256, digest(data))
    XCTAssertEqual(handed.sha256, ShareCardShareFile.sha256(data))
    XCTAssertNotEqual(handed.sha256, digest(Data(file.path.utf8)), "the bytes, never the path")
    let other = png(idat: [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])
    let second = try write(other, "share-cards/\(shareName())", in: root)
    XCTAssertEqual(ShareCardShareFile.handedItem(second).sha256, digest(other))
  }

  func testHandedItemReportsNoDigestForAnythingButAReadableFileURL() throws {
    let root = try cacheRoot()
    let file = try write(png(), "share-cards/\(shareName())", in: root)
    for item: Any? in [nil, file.absoluteString, file.path, URL(string: "https://example.invalid/couturecast-card.png")!] {
      let handed = ShareCardShareFile.handedItem(item)
      XCTAssertFalse(handed.isFileURL, String(describing: item))
      XCTAssertNil(handed.sha256, String(describing: item))
    }
    let missing = root.appendingPathComponent("share-cards/\(shareName())")
    XCTAssertTrue(ShareCardShareFile.handedItem(missing).isFileURL)
    XCTAssertNil(ShareCardShareFile.handedItem(missing).sha256)
  }
}
