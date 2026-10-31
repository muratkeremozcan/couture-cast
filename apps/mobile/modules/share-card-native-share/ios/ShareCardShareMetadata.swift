import Foundation
import LinkPresentation

/// What the share sheet header shows for the card. The file keeps its cache name
/// (`cc69-share-<uuid>.png`); the header shows the public name Story 6.8's save and the web
/// download use, with the card itself as the thumbnail.
enum ShareCardShareMetadata {
  static let publicName = "couturecast-card.png"

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
