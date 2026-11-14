import CoreGraphics
import Foundation

/// The version 1 answer the harness reads (scripts/lib/live-font-text-probe.mjs), and the rect
/// rules every record follows. Foundation only, so `swift test` runs it off a device.
enum TextLayoutProbeWire {
  static let notification = "com.couturecast.textlayoutprobe.dump"
  static let directoryName = "text-layout-probe"
  static let requestName = "request"

  struct Window {
    let id: Int
    let rect: CGRect
    let z: Int
    let focused: Bool
  }

  struct Record {
    let kind: String
    let text: String
    let viewRect: CGRect
    let visibleRect: CGRect?
    let clipRect: CGRect?
    let contentRect: CGRect
    let lineCount: Int
    let maxLines: Int?
    let ellipsized: Int
    let unlimitedLineCount: Int?
    let window: Int
    let scrolledAway: Bool
    let offWindow: Bool
    var opacity: Double = 1
    /// The nearest accessibility element with an identifier at or above the view; nil for none.
    var accessibilityAncestor: AccessibilityAncestor? = nil
  }

  /// An accessibility element with a non-empty accessibilityIdentifier (React Native's testID)
  /// and its frame in window coordinates, written like viewRect.
  struct AccessibilityAncestor: Equatable {
    let identifier: String
    let rect: CGRect
  }

  /// The view itself, or else its nearest ancestor, that is an accessibility element with a
  /// non-empty accessibilityIdentifier; nil when none is, up to the walk's end (`parent` nil).
  static func accessibilityAncestor<Node>(
    _ node: Node,
    parent: (Node) -> Node?,
    isElement: (Node) -> Bool,
    identifier: (Node) -> String?,
    rect: (Node) -> CGRect
  ) -> AccessibilityAncestor? {
    var current: Node? = node
    while let candidate = current {
      if isElement(candidate), let id = identifier(candidate), !id.isEmpty {
        return AccessibilityAncestor(identifier: id, rect: rect(candidate))
      }
      current = parent(candidate)
    }
    return nil
  }

  /// One view on the way from a text view up to its window, for its effective opacity.
  struct Layer {
    let alpha: CGFloat
    let opacity: Float
    let hidden: Bool
  }

  /// The opacity a view draws with: the product of alpha and layer opacity of the view and every
  /// ancestor, and exactly 0 when any of them is hidden.
  static func effectiveOpacity(_ chain: [Layer]) -> Double {
    var opacity = 1.0
    for layer in chain {
      if layer.hidden { return 0 }
      opacity *= min(max(Double(layer.alpha), 0), 1) * min(max(Double(layer.opacity), 0), 1)
    }
    return opacity
  }

  /// Walks a view tree from its window and records every text view, hidden or faded ones
  /// included, each with the opacity it draws with (`effectiveOpacity` of it and its ancestors):
  /// the harness counts only an exact 0 as invisible, so nothing is skipped here. `read` gives a
  /// node's record, if it renders text; `descends` says whether the walk goes on below a node
  /// that gave one (a UIKit text control draws its own internals).
  static func collect<Node>(
    _ node: Node,
    layer: (Node) -> Layer,
    children: (Node) -> [Node],
    read: (Node) -> Record?,
    descends: (Node) -> Bool,
    above: [Layer] = [],
    into records: inout [Record]
  ) {
    let chain = above + [layer(node)]
    if var record = read(node) {
      record.opacity = effectiveOpacity(chain)
      records.append(record)
      if !descends(node) { return }
    }
    for child in children(node) {
      collect(
        child, layer: layer, children: children, read: read, descends: descends, above: chain,
        into: &records)
    }
  }

  /// Tokens name the answer file, so they carry no path separator or whitespace.
  static func acceptsToken(_ token: String) -> Bool {
    token.range(of: "^[A-Za-z0-9._:-]{1,128}$", options: .regularExpression) != nil
      && token != "." && token != ".." && token != requestName
  }

  /// The overlap of two rects, or nil when they share no area.
  static func cut(_ rect: CGRect?, _ by: CGRect) -> CGRect? {
    guard let rect else { return nil }
    let overlap = rect.intersection(by)
    if overlap.isNull || overlap.width <= 0 || overlap.height <= 0 { return nil }
    return overlap
  }

  /// Whether `rect` lies entirely outside `area`; a zero-size rect by its origin.
  static func disjoint(_ rect: CGRect, _ area: CGRect) -> Bool {
    if rect.width <= 0 || rect.height <= 0 {
      return !(rect.minX >= area.minX && rect.minX <= area.maxX && rect.minY >= area.minY
        && rect.minY <= area.maxY)
    }
    return cut(rect, area) == nil
  }

  /// How far a scroll view's content can move on one axis: `offset` is the current scroll
  /// position from the start of the range (clamped into it) and `maximum` the largest one.
  struct Scroll {
    let offset: CGFloat
    let maximum: CGFloat
  }

  /// The travel of a scroll view on one axis, or nil when it cannot move there: scrolling is
  /// disabled, or the content with its adjusted insets is no larger than the bounds. `offset` is
  /// the raw contentOffset, which starts at minus the leading inset.
  static func travel(
    content: CGFloat, insetStart: CGFloat, insetEnd: CGFloat, bounds: CGFloat, offset: CGFloat,
    enabled: Bool
  ) -> Scroll? {
    guard enabled else { return nil }
    let maximum = content + insetStart + insetEnd - bounds
    guard maximum > 0.5 else { return nil }
    return Scroll(offset: min(max(offset + insetStart, 0), maximum), maximum: maximum)
  }

  /// One ancestor on the way from a text view to its window.
  struct Ancestor {
    let rect: CGRect
    let clips: Bool
    /// A scroll view's travel on each axis it can scroll; nil on an axis it cannot.
    var scrollX: Scroll? = nil
    var scrollY: Scroll? = nil
    /// The view's own transform (the affine part of its layer transform): its translation moves
    /// it and everything in it, its linear part scales or flips what it holds.
    var transform: CGAffineTransform = .identity
  }

  struct Cuts {
    let visible: CGRect?
    let clip: CGRect?
    let scrolledAway: Bool
    let offWindow: Bool
  }

  /// Off the window: a translation put it there. The view has no reach (clip nil), lies wholly
  /// outside the window (a zero-size one by its origin), and the same reach computed with every
  /// translation removed (`untranslated`) is not nil, so without the translations of the view
  /// and its ancestors (a parked sheet or drawer) part of it could be brought into view. A text
  /// wholly off the window by layout alone has no reach either way and is not offWindow: the
  /// harness fails it as cut to nothing. One a scroll view's band reaches is scrolledAway.
  static func offWindow(
    _ viewRect: CGRect, _ window: CGRect, clip: CGRect?, untranslatedClip: CGRect?
  ) -> Bool {
    clip == nil && disjoint(viewRect, window) && untranslatedClip != nil
  }

  /// One axis of a rect, or nil when it is empty.
  private typealias Span = (lo: CGFloat, hi: CGFloat)

  private static func narrow(_ span: Span?, _ lo: CGFloat, _ hi: CGFloat) -> Span? {
    guard let span else { return nil }
    let cut: Span = (max(span.lo, lo), min(span.hi, hi))
    return cut.hi > cut.lo ? cut : nil
  }

  /// The band of positions a scroll view can bring into `span`. A larger offset moves the content
  /// up (or left), so text now at p shows after a further scroll by d when p - d lies in span, for
  /// d from -offset (back to the start) to maximum - offset (to the end): the band runs from
  /// span start minus offset to span end plus (maximum minus offset). In an inverted scroll view
  /// (its content flipped on that axis on screen) a larger offset moves the content down (or
  /// right), so the band mirrors: span start minus (maximum minus offset) to span end plus offset.
  private static func widen(_ span: Span?, _ scroll: Scroll?, inverted: Bool) -> Span? {
    guard let span, let scroll else { return span }
    let back = scroll.offset
    let ahead = scroll.maximum - scroll.offset
    return inverted ? (span.lo - ahead, span.hi + back) : (span.lo - back, span.hi + ahead)
  }

  /// The scale, flip and rotation of a transform, without its translation.
  private static func linear(_ transform: CGAffineTransform) -> CGAffineTransform {
    CGAffineTransform(a: transform.a, b: transform.b, c: transform.c, d: transform.d, tx: 0, ty: 0)
  }

  /// The reach (clipRect). On each axis, from the window inward, every clipping ancestor cuts the
  /// band so far, and each scroll view that can move on that axis then widens it by its own
  /// travel (`widen`), whether or not it clips: a scroll view that does not clip cuts nothing but
  /// still moves its content. So a scroll view's band is its viewport cut by everything above it
  /// (outer scroll views' bands included) widened by its travel, nested scroll views compose, and
  /// an axis with no travel cuts as any clipper does. A scroll view is inverted on an axis when
  /// the linear parts of its own transform and every ancestor's above it, composed, flip that
  /// axis (a negative a for x, d for y): React Native's inverted lists flip the scroll view or the
  /// component view that holds it.
  private static func reach(_ viewRect: CGRect, _ ancestors: [Ancestor], _ window: CGRect)
    -> CGRect?
  {
    var x: Span? = (window.minX, window.maxX)
    var y: Span? = (window.minY, window.maxY)
    var onScreen = CGAffineTransform.identity
    // Ancestors run nearest first, so the reach is built from the outermost one in.
    for ancestor in ancestors.reversed() {
      onScreen = linear(ancestor.transform).concatenating(onScreen)
      if ancestor.clips {
        x = narrow(x, ancestor.rect.minX, ancestor.rect.maxX)
        y = narrow(y, ancestor.rect.minY, ancestor.rect.maxY)
      }
      x = widen(x, ancestor.scrollX, inverted: onScreen.a < 0)
      y = widen(y, ancestor.scrollY, inverted: onScreen.d < 0)
    }
    guard let x, let y else { return nil }
    return cut(viewRect, CGRect(x: x.lo, y: y.lo, width: x.hi - x.lo, height: y.hi - y.lo))
  }

  /// The view and its ancestors as they would lie with every translation removed. Removing a
  /// view's translation moves it and everything inside it rigidly by that translation as the
  /// linear parts of the views outside it map it, so each rect moves back by the sum of those
  /// mapped translations from itself outward. Scroll offsets, travel and the window stay.
  static func untranslated(
    viewRect: CGRect, ancestors: [Ancestor], transform: CGAffineTransform = .identity
  ) -> (viewRect: CGRect, ancestors: [Ancestor]) {
    var shift = CGSize.zero
    var outer = CGAffineTransform.identity
    var moved: [Ancestor] = []
    func add(_ transform: CGAffineTransform) {
      let step = CGSize(width: transform.tx, height: transform.ty).applying(outer)
      shift = CGSize(width: shift.width + step.width, height: shift.height + step.height)
    }
    for ancestor in ancestors.reversed() {
      add(ancestor.transform)
      moved.append(
        Ancestor(
          rect: ancestor.rect.offsetBy(dx: -shift.width, dy: -shift.height), clips: ancestor.clips,
          scrollX: ancestor.scrollX, scrollY: ancestor.scrollY, transform: ancestor.transform))
      outer = linear(ancestor.transform).concatenating(outer)
    }
    add(transform)
    return (viewRect.offsetBy(dx: -shift.width, dy: -shift.height), moved.reversed())
  }

  /// visibleRect: cut by every clipping ancestor and the window. clipRect: the text's reach
  /// (`reach`). scrolledAway: not visible, yet within reach, on the window or off it; offWindow:
  /// wholly off the window and out of reach because of a translation (`offWindow`). `transform`
  /// is the text view's own.
  static func cuts(
    viewRect: CGRect, ancestors: [Ancestor], window: CGRect,
    transform: CGAffineTransform = .identity
  ) -> Cuts {
    var visible: CGRect? = viewRect
    for ancestor in ancestors where ancestor.clips { visible = cut(visible, ancestor.rect) }
    visible = cut(visible, window)
    let clip = reach(viewRect, ancestors, window)
    var off = false
    if clip == nil && disjoint(viewRect, window) {
      let back = untranslated(viewRect: viewRect, ancestors: ancestors, transform: transform)
      off = offWindow(
        viewRect, window, clip: clip,
        untranslatedClip: reach(back.viewRect, back.ancestors, window))
    }
    return Cuts(
      visible: visible, clip: clip, scrolledAway: visible == nil && clip != nil, offWindow: off)
  }

  /// Window stacking: by windowLevel, then by scene order; z counts up from 0 at the bottom.
  static func zOrder(levels: [CGFloat]) -> [Int] {
    let order = levels.indices.sorted { levels[$0] != levels[$1] ? levels[$0] < levels[$1] : $0 < $1 }
    var z = [Int](repeating: 0, count: levels.count)
    for (rank, index) in order.enumerated() { z[index] = rank }
    return z
  }

  /// The error code of an answer refused because a record's opacity is not a number from 0 to 1
  /// (NaN from a NaN alpha anywhere up the chain). Such a record is never coerced or dropped.
  static let opacityInvalid = "text_probe_opacity_invalid"

  /// The refusal the harness reads in place of the records: `{version, token, platform, error:
  /// {code, record, kind}}`, `record` the index the first refused record has in the records.
  static func refusal(token: String, code: String, record: Int, kind: String) throws -> Data {
    let payload: [String: Any] = [
      "version": 1,
      "token": token,
      "platform": "ios",
      "error": ["code": code, "record": record, "kind": kind],
    ]
    return try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
  }

  /// The answer; a record whose opacity is not in 0...1 (NaN included) refuses the whole capture
  /// with `opacityInvalid` (JSONSerialization cannot write a NaN, and a coerced one would lie).
  static func json(token: String, windows: [Window], records: [Record]) throws -> Data {
    if let index = records.firstIndex(where: { !($0.opacity >= 0 && $0.opacity <= 1) }) {
      return try refusal(
        token: token, code: opacityInvalid, record: index, kind: records[index].kind)
    }
    let payload: [String: Any] = [
      "version": 1,
      "token": token,
      "platform": "ios",
      "windows": windows.map { window -> [String: Any] in
        ["id": window.id, "rect": wire(window.rect), "z": window.z, "focused": window.focused]
      },
      "records": records.map { record -> [String: Any] in
        [
          "kind": record.kind,
          "text": record.text,
          "viewRect": wire(record.viewRect),
          "visibleRect": record.visibleRect.map(wire) ?? NSNull(),
          "clipRect": record.clipRect.map(wire) ?? NSNull(),
          "contentRect": wire(record.contentRect),
          "lineCount": record.lineCount,
          "maxLines": record.maxLines.map { $0 as Any } ?? NSNull(),
          "ellipsized": record.ellipsized,
          "unlimitedLineCount": record.unlimitedLineCount.map { $0 as Any } ?? NSNull(),
          "window": record.window,
          "scrolledAway": record.scrolledAway,
          "offWindow": record.offWindow,
          // Raw, so only an exact 0 reads as invisible.
          "opacity": record.opacity,
          "accessibilityAncestor": record.accessibilityAncestor.map { ancestor -> Any in
            ["identifier": ancestor.identifier, "rect": wire(ancestor.rect)]
          } ?? NSNull(),
        ]
      },
    ]
    return try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
  }

  /// [left, top, right, bottom] in points, to a thousandth.
  static func wire(_ rect: CGRect) -> [Double] {
    [rect.minX, rect.minY, rect.maxX, rect.maxY].map { (Double($0) * 1000).rounded() / 1000 }
  }

  /// `<caches>/text-layout-probe`, created when missing so the harness can drop its request in.
  static func directory(caches: URL) throws -> URL {
    let directory = caches.appendingPathComponent(directoryName, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  /// The token the harness wrote to `request`, or nil when it is missing or malformed.
  static func requestedToken(in directory: URL) -> String? {
    let url = directory.appendingPathComponent(requestName)
    guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return acceptsToken(token) ? token : nil
  }

  /// Writes `<token>.json` atomically: the harness polls for the name and never sees a partial file.
  static func writeAnswer(_ data: Data, token: String, in directory: URL) throws -> URL {
    let url = directory.appendingPathComponent("\(token).json")
    try data.write(to: url, options: .atomic)
    return url
  }
}
