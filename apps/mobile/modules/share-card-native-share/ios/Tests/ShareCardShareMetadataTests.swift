import LinkPresentation
import XCTest
@testable import ShareCardShareCore

/// The share sheet header names the card `couturecast-card.png`, never its cache file name, and
/// previews the card's own bytes.
final class ShareCardShareMetadataTests: XCTestCase {
  func shareFile(_ bytes: Data) throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathComponent("share-cards")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
    let file = directory.appendingPathComponent("cc69-share-\(UUID().uuidString.lowercased()).png")
    try bytes.write(to: file)
    return file
  }

  func testPublicNameMatchesTheStory68SaveAndWebDownloadName() {
    XCTAssertEqual(ShareCardShareMetadata.publicName, "couturecast-card.png")
  }

  func testHeaderShowsThePublicNameAndNoCachePath() throws {
    let file = try shareFile(Data([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]))
    let metadata = ShareCardShareMetadata.linkMetadata(for: file)
    XCTAssertEqual(metadata.title, "couturecast-card.png")
    XCTAssertNil(metadata.url)
    XCTAssertNil(metadata.originalURL)
    XCTAssertNil(metadata.imageProvider)
    let icon = try XCTUnwrap(metadata.iconProvider)
    XCTAssertEqual(icon.suggestedName, "couturecast-card.png")
    for value in [metadata.title, icon.suggestedName] {
      XCTAssertFalse(value?.contains("cc69-share") ?? false)
    }
  }

  func testHeaderThumbnailIsTheCardPng() throws {
    let bytes = Data([137, 80, 78, 71, 13, 10, 26, 10] + Array(UUID().uuidString.utf8))
    let file = try shareFile(bytes)
    let icon = try XCTUnwrap(ShareCardShareMetadata.linkMetadata(for: file).iconProvider)
    XCTAssertTrue(icon.hasItemConformingToTypeIdentifier("public.png"))
    let loaded = expectation(description: "icon bytes")
    var received: Data?
    _ = icon.loadDataRepresentation(forTypeIdentifier: "public.png") { data, _ in
      received = data
      loaded.fulfill()
    }
    wait(for: [loaded], timeout: 5)
    XCTAssertEqual(received, bytes)
  }
}
