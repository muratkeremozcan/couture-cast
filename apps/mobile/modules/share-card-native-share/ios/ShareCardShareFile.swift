import CryptoKit
import Foundation

/// Native gate before any handoff. Accepts only
/// `cache/share-cards/cc69-share-<uuid>/couturecast-card.png` inside the app Caches directory,
/// holding a critical-chunk-only 1080x1350 PNG whose SHA256 matches. The per-share directory lets
/// every receiver see the public name. Photo save keeps its own `cc68-`-only `ShareCardPngFile`;
/// neither validator accepts the other's files.
enum ShareCardShareFile {
  static let prefix = "cc69-share-"
  static let maximumBytes = 3 * 1024 * 1024

  static func validateFile(_ uri: String, _ digest: String, _ cacheRoot: URL?) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL, let cache = cacheRoot,
      !url.pathComponents.contains(".."),
      url.standardizedFileURL.deletingLastPathComponent().deletingLastPathComponent()
        == cache.appendingPathComponent("share-cards", isDirectory: true).standardizedFileURL,
      url.resolvingSymlinksInPath() == url.standardizedFileURL,
      url.lastPathComponent == ShareCardShareMetadata.publicName,
      isShareDirectoryName(url.deletingLastPathComponent().lastPathComponent),
      (try url.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink == false
    else { throw InvalidFile() }
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    guard data.count <= maximumBytes, sha256(data) == digest else { throw InvalidFile() }
    try validatePng(data)
    return url
  }

  static func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  /// What a receiver gets from an activity item: whether it is a file URL, and the SHA256 of the
  /// bytes at that URL. `sha256` is nil for any other item or an unreadable file. The test build
  /// records this for the item `itemForActivityType: nil` returns (G04).
  static func handedItem(_ item: Any?) -> (isFileURL: Bool, sha256: String?) {
    guard let url = item as? URL, url.isFileURL else { return (false, nil) }
    guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return (true, nil) }
    return (true, sha256(data))
  }

  static func isShareDirectoryName(_ name: String) -> Bool {
    guard name.hasPrefix(prefix) else { return false }
    let id = name.dropFirst(prefix.count)
    return id.count == 36 && UUID(uuidString: String(id)) != nil
  }

  /// Signature, one 1080x1350 8-bit RGB IHDR, IDAT and a final empty IEND, every CRC checked.
  static func validatePng(_ data: Data) throws {
    let bytes = [UInt8](data)
    guard Array(bytes.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10] else { throw InvalidFile() }
    func number(_ at: Int) -> Int {
      Int(bytes[at]) << 24 | Int(bytes[at + 1]) << 16 | Int(bytes[at + 2]) << 8 | Int(bytes[at + 3])
    }
    var at = 8
    var header = false
    var payload = false
    var ended = false
    while at < bytes.count {
      guard at + 12 <= bytes.count else { throw InvalidFile() }
      let length = number(at)
      let end = at + 12 + length
      guard end <= bytes.count else { throw InvalidFile() }
      let name = String(bytes: bytes[(at + 4)..<(at + 8)], encoding: .ascii)
      var crc: UInt32 = 0xffffffff
      for byte in bytes[(at + 4)..<(end - 4)] {
        crc ^= UInt32(byte)
        for _ in 0..<8 { crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb88320 : 0) }
      }
      guard (crc ^ 0xffffffff) == UInt32(number(end - 4)) else { throw InvalidFile() }
      if name == "IHDR" && !header && at == 8 && length == 13 {
        guard number(at + 8) == 1080 && number(at + 12) == 1350 && bytes[at + 16] == 8
          && bytes[at + 17] == 2 && bytes[(at + 18)...(at + 20)].allSatisfy({ $0 == 0 })
        else { throw InvalidFile() }
        header = true
      } else if name == "IDAT" && header && !ended && length > 0 {
        payload = true
      } else if name == "IEND" && payload && length == 0 && end == bytes.count {
        ended = true
      } else {
        throw InvalidFile()
      }
      at = end
    }
    guard ended else { throw InvalidFile() }
  }

  struct InvalidFile: Error {}
}
