import Foundation
import CryptoKit

enum ShareCardPngFile {
  static func validateFile(_ uri: String, _ digest: String, _ cacheRoot: URL?) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL,
      let cache = cacheRoot,
      url.standardizedFileURL.deletingLastPathComponent() == cache.appendingPathComponent("share-cards", isDirectory: true).standardizedFileURL,
      url.resolvingSymlinksInPath() == url.standardizedFileURL,
      url.pathExtension == "png", url.lastPathComponent.hasPrefix("cc68-"),
      (try url.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink == false else { throw InvalidFile() }
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    guard data.count <= 3 * 1024 * 1024,
      SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == digest else { throw InvalidFile() }
    try validatePng(data)
    return url
  }

  static func validatePng(_ data: Data) throws {
    let bytes = [UInt8](data)
    guard Array(bytes.prefix(8)) == [137,80,78,71,13,10,26,10] else { throw InvalidFile() }
    func number(_ at: Int) -> Int { Int(bytes[at]) << 24 | Int(bytes[at+1]) << 16 | Int(bytes[at+2]) << 8 | Int(bytes[at+3]) }
    var at = 8; var header = false; var payload = false; var ended = false
    while at < bytes.count {
      guard at + 12 <= bytes.count else { throw InvalidFile() }
      let length = number(at); let end = at + 12 + length
      guard end <= bytes.count else { throw InvalidFile() }
      let name = String(bytes: bytes[(at+4)..<(at+8)], encoding: .ascii)
      var crc: UInt32 = 0xffffffff
      for byte in bytes[(at+4)..<(end-4)] {
        crc ^= UInt32(byte)
        for _ in 0..<8 { crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb88320 : 0) }
      }
      guard (crc ^ 0xffffffff) == UInt32(number(end-4)) else { throw InvalidFile() }
      if name == "IHDR" && !header && at == 8 && length == 13 {
        guard number(at+8) == 1080 && number(at+12) == 1350 && bytes[at+16] == 8 && bytes[at+17] == 2 && bytes[(at+18)...(at+20)].allSatisfy({ $0 == 0 }) else { throw InvalidFile() }
        header = true
      } else if name == "IDAT" && header && !ended && length > 0 { payload = true }
      else if name == "IEND" && payload && length == 0 && end == bytes.count { ended = true }
      else { throw InvalidFile() }
      at = end
    }
    guard ended else { throw InvalidFile() }
  }
  struct InvalidFile: Error {}
}
