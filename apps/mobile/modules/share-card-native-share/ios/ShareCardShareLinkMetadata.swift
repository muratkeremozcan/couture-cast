import Foundation
import LinkPresentation

extension ShareCardShareMetadata {
  /// No `url` or `originalURL`: with `originalURL` set to the file, the iOS 26.1 header showed the
  /// cache name as its subtitle.
  static func linkMetadata(for file: URL) -> LPLinkMetadata {
    let metadata = LPLinkMetadata()
    metadata.title = publicName
    let preview = NSItemProvider(contentsOf: file)
    preview?.suggestedName = publicName
    metadata.iconProvider = preview
    return metadata
  }
}
