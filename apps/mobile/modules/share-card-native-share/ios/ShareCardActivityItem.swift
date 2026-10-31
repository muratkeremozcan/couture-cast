import LinkPresentation
import UIKit

/// The validated file URL as the activity item, so every receiver gets the PNG file named
/// `couturecast-card.png`, plus header metadata with that name and no file path.
final class ShareCardActivityItem: NSObject, UIActivityItemSource {
  private let file: URL
  private let metadata: LPLinkMetadata
  private var reported = false

  init(file: URL) {
    self.file = file
    metadata = ShareCardShareMetadata.linkMetadata(for: file)
  }

  func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
    writeStory68ItemReport(activityViewController)
    return file
  }

  func activityViewController(
    _ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?
  ) -> Any? {
    file
  }

  func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
    metadata
  }

  /// Test-build-only proof for the presenter XCUITest that the item a receiver gets is the
  /// previewed PNG. Compiled out of Release and written only by the isolated story68 app, once per
  /// item when UIKit first asks for the placeholder: a fresh `id`, whether
  /// `itemForActivityType: nil` returns a file URL, and the SHA256 of the bytes it names. No path.
  private func writeStory68ItemReport(_ controller: UIActivityViewController) {
    #if DEBUG
    guard !reported, Bundle.main.bundleIdentifier == "com.couturecast.story68",
      let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    else { return }
    reported = true
    let item = ShareCardShareFile.handedItem(activityViewController(controller, itemForActivityType: nil))
    let record: [String: Any] = [
      "id": UUID().uuidString,
      "itemIsFileURL": item.isFileURL,
      "itemSha256": item.sha256 ?? NSNull(),
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: record) else { return }
    try? data.write(to: directory.appendingPathComponent("cc69-share-item.json"), options: .atomic)
    #endif
  }
}
