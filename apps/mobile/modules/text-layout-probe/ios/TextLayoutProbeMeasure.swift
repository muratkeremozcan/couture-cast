#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// Lays an attributed string out the way React Native's RCTTextLayoutManager draws a paragraph:
/// TextKit at the view's width, lineFragmentPadding 0, the paragraph's maximumNumberOfLines with
/// its line break mode. AppKit and UIKit share these TextKit classes, so `swift test` runs it on
/// a Mac.
enum TextLayoutProbeMeasure {
  struct Measure {
    /// The laid-out text's used rect in the view's own coordinates.
    let usedRect: CGRect
    let lineCount: Int
    let unlimitedLineCount: Int
    /// 1 when the limit dropped lines (the paragraph renders truncated), else 0.
    var ellipsized: Int { unlimitedLineCount > lineCount ? 1 : 0 }
  }

  /// `maximumNumberOfLines` 0 is no limit, as in React Native's ParagraphAttributes.
  static func measure(
    _ text: NSAttributedString,
    width: CGFloat,
    maximumNumberOfLines: Int,
    lineBreakMode: NSLineBreakMode
  ) -> Measure {
    let limited = layout(text, width: width, limit: max(0, maximumNumberOfLines), mode: lineBreakMode)
    let unlimited =
      maximumNumberOfLines > 0
      ? layout(text, width: width, limit: 0, mode: .byWordWrapping) : limited
    return Measure(
      usedRect: limited.used,
      lineCount: limited.lines,
      unlimitedLineCount: unlimited.lines
    )
  }

  private static func layout(
    _ text: NSAttributedString,
    width: CGFloat,
    limit: Int,
    mode: NSLineBreakMode
  ) -> (used: CGRect, lines: Int) {
    let storage = NSTextStorage(attributedString: text)
    let manager = NSLayoutManager()
    let container = NSTextContainer(
      size: CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
    container.lineFragmentPadding = 0
    container.maximumNumberOfLines = limit
    container.lineBreakMode = limit > 0 ? mode : .byWordWrapping
    manager.addTextContainer(container)
    storage.addLayoutManager(manager)
    let glyphs = manager.glyphRange(for: container)
    var lines = 0
    manager.enumerateLineFragments(forGlyphRange: glyphs) { _, _, _, _, _ in lines += 1 }
    return (manager.usedRect(for: container), lines)
  }
}
