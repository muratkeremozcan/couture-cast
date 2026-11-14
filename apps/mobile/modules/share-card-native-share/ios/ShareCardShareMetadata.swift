import Foundation

/// What the share sheet header shows for the card: the public name Story 6.8's save and the web
/// download use, which is also the handoff file's own name, with the card itself as the thumbnail.
/// The header itself needs LinkPresentation and lives in ShareCardShareLinkMetadata.swift, so this
/// name builds on Linux with ShareCardShareFile (story 6.15 D6).
enum ShareCardShareMetadata {
  static let publicName = "couturecast-card.png"
}
