import LinkPresentation
import UIKit

/// The validated file URL as the activity item, so every receiver gets the PNG file named
/// `couturecast-card.png`, plus header metadata with that name and no file path.
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
