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
