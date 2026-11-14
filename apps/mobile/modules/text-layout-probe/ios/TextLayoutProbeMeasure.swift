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

  /// A text input's laid-out text in the backing view's own coordinates.
  struct Input {
    let content: CGRect
    let lineCount: Int
    let maxLines: Int?
    let unlimitedLineCount: Int
    var ellipsized: Int { unlimitedLineCount > lineCount ? 1 : 0 }
  }

  /// Wide enough for any one line; finite, so a centred or trailing paragraph keeps its width.
  private static let oneLineWidth: CGFloat = 1_000_000

  /// A single-line UITextField: one line that never wraps, at its natural width, placed in the
  /// field's text rect the way the field aligns it and centred vertically. A line wider than the
  /// text rect starts at its leading edge and runs past the other one, as Android's
  /// horizontally scrolling single-line layout does, so the overflow shows against clipRect.
  static func field(
    _ text: NSAttributedString,
    area: CGRect,
    alignment: NSTextAlignment,
    rightToLeft: Bool
  ) -> Input {
    let measure = measure(
      text, width: oneLineWidth, maximumNumberOfLines: 0, lineBreakMode: .byClipping)
    let width = measure.usedRect.width
    let height = measure.usedRect.height
    let leading = rightToLeft ? area.maxX - width : area.minX
    let x: CGFloat
    if width > area.width {
      x = leading
    } else {
      switch alignment {
      case .center: x = area.midX - width / 2
      case .right: x = area.maxX - width
      case .left: x = area.minX
      default: x = leading
      }
    }
    return Input(
      content: CGRect(x: x, y: area.midY - height / 2, width: width, height: height),
      lineCount: measure.lineCount,
      maxLines: 1,
      unlimitedLineCount: measure.unlimitedLineCount)
  }

  /// A multiline UITextView: its text laid out in its text container (width less the line
  /// fragment padding on both sides, its line limit and break mode), offset by the container
  /// inset and padding. The result is in content coordinates, the text view's bounds space.
  static func textView(
    _ text: NSAttributedString,
    containerWidth: CGFloat,
    lineFragmentPadding: CGFloat,
    insetLeft: CGFloat,
    insetTop: CGFloat,
    maximumNumberOfLines: Int,
    lineBreakMode: NSLineBreakMode
  ) -> Input {
    let measure = measure(
      text, width: containerWidth - 2 * lineFragmentPadding,
      maximumNumberOfLines: maximumNumberOfLines, lineBreakMode: lineBreakMode)
    return Input(
      content: measure.usedRect.offsetBy(dx: insetLeft + lineFragmentPadding, dy: insetTop),
      lineCount: measure.lineCount,
      maxLines: maximumNumberOfLines > 0 ? maximumNumberOfLines : nil,
      unlimitedLineCount: measure.unlimitedLineCount)
  }
}
