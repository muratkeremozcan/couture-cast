import LinkPresentation
import UIKit

/// The validated file URL as the activity item, so every receiver still gets the PNG file, plus
/// header metadata that names the card `couturecast-card.png` in place of its cache name.
final class ShareCardActivityItem: NSObject, UIActivityItemSource {
  private let file: URL
  private let metadata: LPLinkMetadata

  init(file: URL) {
    self.file = file
    metadata = ShareCardShareMetadata.linkMetadata(for: file)
  }

  func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
    file
  }

  func activityViewController(
    _ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?
  ) -> Any? {
    file
  }

  func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
    metadata
  }
}
