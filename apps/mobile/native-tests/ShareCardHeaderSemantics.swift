import Foundation
import CoreGraphics

struct ShareCardHeaderCandidate {
  let label: String
  let frame: CGRect
  let isHittable: Bool
  let matchingDescendantFrames: [CGRect]
}

enum ShareCardHeaderSelectionError: Error {
  case invalidVisibleHeading
  case malformedParagraphContainer
  case expectedOneSemanticHeading
}

/// Fabric exposes a paragraph container and its sole accessible child to XCTest.
/// Preserve that exact structure while counting sibling headings independently.
func selectShareCardHeader(
  _ candidates: [ShareCardHeaderCandidate],
  expected: String,
  screen: CGRect
) throws -> Int {
  let visible = candidates.indices.filter { candidates[$0].frame.minY < screen.midY }
  for index in visible {
    let candidate = candidates[index]
    guard candidate.label == expected, candidate.isHittable,
      !candidate.frame.isEmpty, !candidate.frame.isNull, !candidate.frame.isInfinite,
      screen.contains(candidate.frame), candidate.frame.maxY <= screen.midY
    else { throw ShareCardHeaderSelectionError.invalidVisibleHeading }
    if !candidate.matchingDescendantFrames.isEmpty {
      guard candidate.matchingDescendantFrames.count == 1,
        candidate.matchingDescendantFrames[0] == candidate.frame
      else { throw ShareCardHeaderSelectionError.malformedParagraphContainer }
    }
  }
  let leaves = visible.filter { candidates[$0].matchingDescendantFrames.isEmpty }
  guard leaves.count == 1 else {
    throw ShareCardHeaderSelectionError.expectedOneSemanticHeading
  }
  let leaf = leaves[0]
  guard visible.allSatisfy({
    $0 == leaf || candidates[$0].matchingDescendantFrames == [candidates[leaf].frame]
  }) else { throw ShareCardHeaderSelectionError.malformedParagraphContainer }
  return leaf
}

/// Actual attached UIKit target of a posted layoutChanged request. This record
/// does not report the VoiceOver cursor on a simulator.
struct ShareCardFocusObservation: Codable {
  let session: String
  let sequence: Int
  let identifier: String
  let label: String
  let attached: Bool
  let header: Bool
  let posted: Bool
  var headings: [String] = []
}

enum ShareCardFocusObservationError: Error { case missingPostedTargetOrHeaderTrait }
func requirePostedShareCardFocus(
  _ observation: ShareCardFocusObservation, after sequence: Int,
  label: String, identifier: String?, header: Bool
) throws {
  guard !observation.session.isEmpty, observation.sequence > sequence,
    observation.posted, observation.attached, observation.label == label,
    identifier == nil || observation.identifier == identifier,
    !header || observation.header
  else { throw ShareCardFocusObservationError.missingPostedTargetOrHeaderTrait }
}

func requireNativeShareCardHeader(_ observation: ShareCardFocusObservation, label: String) throws {
  guard observation.headings.filter({ $0 == label }).count == 1 else {
    throw ShareCardFocusObservationError.missingPostedTargetOrHeaderTrait
  }
}

func requireNoNewShareCardFocus(_ observation: ShareCardFocusObservation, after sequence: Int) throws {
  guard observation.sequence == sequence else {
    throw ShareCardFocusObservationError.missingPostedTargetOrHeaderTrait
  }
}
