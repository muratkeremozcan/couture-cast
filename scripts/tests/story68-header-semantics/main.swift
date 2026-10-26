import Foundation
import CoreGraphics

let screen = CGRect(x: 0, y: 0, width: 402, height: 874)
let frame = CGRect(x: 177, y: 71, width: 47, height: 20)
func node(_ descendants: [CGRect] = [], frame bounds: CGRect = frame,
          label: String = "Home", hittable: Bool = true) -> ShareCardHeaderCandidate {
  ShareCardHeaderCandidate(label: label, frame: bounds, isHittable: hittable,
                          matchingDescendantFrames: descendants)
}
func reject(_ name: String, _ nodes: [ShareCardHeaderCandidate]) {
  do {
    _ = try selectShareCardHeader(nodes, expected: "Home", screen: screen)
    print("FAIL unexpected success: \(name)")
    exit(1)
  } catch { print("PASS rejects \(name)") }
}
do {
let selected = try selectShareCardHeader([node([frame]), node()], expected: "Home", screen: screen)
precondition(selected == 1)
print("PASS valid Fabric container and accessible leaf")
reject("equal-frame sibling duplicate headings", [node(), node()])
reject("mismatched descendant frame", [node([frame.offsetBy(dx: 1, dy: 0)]), node()])
reject("multiple matching descendants", [node([frame, frame]), node(), node()])
reject("nested paragraph chain", [node([frame, frame]), node([frame]), node()])
reject("container without accessible leaf", [node([frame])])
reject("zero frame", [node(frame: .zero)])
reject("offscreen heading", [node(frame: frame.offsetBy(dx: -300, dy: 0))])
reject("non-hittable heading", [node(hittable: false)])
reject("wrong label", [node(label: "Community")])
let tabLabel = node(frame: CGRect(x: 20, y: 820, width: 47, height: 20))
let selectedWithTab = try selectShareCardHeader([node(), tabLabel], expected: "Home", screen: screen)
precondition(selectedWithTab == 0)
print("PASS lower tab label remains outside navigation heading selection")

} catch {
  print("FAIL unexpected error: \(error)")
  exit(1)
}
