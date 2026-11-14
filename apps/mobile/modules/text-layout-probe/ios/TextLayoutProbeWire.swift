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

  /// One ancestor on the way from a text view to its window.
  struct Ancestor {
    let rect: CGRect
    let clips: Bool
    let isScrollView: Bool
  }

  struct Cuts {
    let visible: CGRect?
    let clip: CGRect?
    let scrolledAway: Bool
  }

  /// Scrolled away: outside the window, or cut to nothing only once scroll viewports cut it (its
  /// clipRect, which no scroll view cuts, is left). A text that a non-scroll ancestor or a
  /// zero-size container cuts to nothing is not. So scrolledAway implies no visibleRect, and a
  /// text with no visibleRect that is not scrolled away has no clipRect either.
  static func scrolledAway(_ viewRect: CGRect, _ visible: CGRect?, _ clip: CGRect?, _ window: CGRect)
    -> Bool
  {
    disjoint(viewRect, window) || (visible == nil && clip != nil)
  }

  /// visibleRect: cut by every clipping ancestor and the window. clipRect: the same without
  /// scroll views, whose viewport cuts are not layout clips. Above a scroll view, an ancestor or
  /// the window cuts clipRect only on the edges where it cuts into that scroll view's viewport:
  /// scroll content past the screen is only scrolled off, while a container smaller than the
  /// scroll view it holds is a real clip. A text outside every scroll view is cut by the window
  /// whole. Ancestors run nearest first.
  static func cuts(viewRect: CGRect, ancestors: [Ancestor], window: CGRect) -> Cuts {
    var visible: CGRect? = viewRect
    var clip: CGRect? = viewRect
    // The viewport of the scroll view passed last on the way up, once there is one.
    var viewport: CGRect?
    for ancestor in ancestors {
      if ancestor.isScrollView {
        if ancestor.clips { visible = cut(visible, ancestor.rect) }
        viewport = ancestor.rect
        continue
      }
      guard ancestor.clips else { continue }
      visible = cut(visible, ancestor.rect)
      clip = cut(clip, viewport.map { cutInto(ancestor.rect, $0) } ?? ancestor.rect)
    }
    visible = cut(visible, window)
    clip = cut(clip, viewport.map { cutInto(window, $0) } ?? window)
    return Cuts(visible: visible, clip: clip, scrolledAway: scrolledAway(viewRect, visible, clip, window))
  }

  /// `rect` with every edge that does not cut into `viewport` opened.
  static func cutInto(_ rect: CGRect, _ viewport: CGRect) -> CGRect {
    let open = CGFloat(1 << 29)
    let left = rect.minX > viewport.minX ? rect.minX : -open
    let top = rect.minY > viewport.minY ? rect.minY : -open
    let right = rect.maxX < viewport.maxX ? rect.maxX : open
    let bottom = rect.maxY < viewport.maxY ? rect.maxY : open
    return CGRect(x: left, y: top, width: right - left, height: bottom - top)
  }

  /// Window stacking: by windowLevel, then by scene order; z counts up from 0 at the bottom.
  static func zOrder(levels: [CGFloat]) -> [Int] {
    let order = levels.indices.sorted { levels[$0] != levels[$1] ? levels[$0] < levels[$1] : $0 < $1 }
    var z = [Int](repeating: 0, count: levels.count)
    for (rank, index) in order.enumerated() { z[index] = rank }
    return z
  }

  static func json(token: String, windows: [Window], records: [Record]) throws -> Data {
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
