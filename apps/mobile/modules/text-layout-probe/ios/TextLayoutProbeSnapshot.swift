import UIKit

/// Builds the answer from every window of every connected scene, on the main thread.
@MainActor
enum TextLayoutProbeSnapshot {
  static func capture(token: String) throws -> Data {
    let all = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    let shown = all.enumerated().filter { !$0.element.isHidden }
    let z = TextLayoutProbeWire.zOrder(levels: shown.map { $0.element.windowLevel.rawValue })
    var windows: [TextLayoutProbeWire.Window] = []
    var records: [TextLayoutProbeWire.Record] = []
    for (rank, entry) in shown.enumerated() {
      let window = entry.element
      windows.append(
        .init(id: entry.offset, rect: window.frame, z: z[rank], focused: window.isKeyWindow))
      collect(window, in: window, id: entry.offset, into: &records)
    }
    return try TextLayoutProbeWire.json(token: token, windows: windows, records: records)
  }

  private static func collect(
    _ view: UIView,
    in window: UIWindow,
    id: Int,
    into records: inout [TextLayoutProbeWire.Record]
  ) {
    if view.isHidden || view.alpha <= 0.01 { return }
    if var record = record(view, in: window, id: id) {
      record.opacity = opacity(view)
      records.append(record)
      // A UIKit text control draws its own internals (placeholder labels, field editors).
      if !TLPParagraphReader.isParagraphLikeView(view) { return }
    }
    for subview in view.subviews { collect(subview, in: window, id: id, into: &records) }
  }

  private static func record(_ view: UIView, in window: UIWindow, id: Int)
    -> TextLayoutProbeWire.Record?
  {
    let viewRect = view.convert(view.bounds, to: window)
    let className = NSStringFromClass(type(of: view))
    if className == "RCTTextInputComponentView" {
      return textInput(view, viewRect, window, id)
    }
    if TLPParagraphReader.isParagraphLikeView(view) {
      let attributed = TLPParagraphReader.attributedTextOfParagraph(view) ?? NSAttributedString()
      if attributed.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
      let limit = TLPParagraphReader.maximumNumberOfLinesOfParagraph(view)
      // A paragraph whose numberOfLines cannot be read cannot be measured the way it renders.
      guard TLPParagraphReader.isParagraphView(view), limit >= 0 else {
        return unknown(view, className, attributed.string, viewRect, window, id)
      }
      let measure = TextLayoutProbeMeasure.measure(
        attributed,
        width: view.bounds.width,
        maximumNumberOfLines: limit,
        lineBreakMode: TLPParagraphReader.lineBreakModeOfParagraph(view))
      // The laid-out text's own extents on both axes, at the view's numberOfLines.
      let content = view.convert(measure.usedRect, to: window)
      let cuts = clip(view, viewRect, window)
      return .init(
        kind: "RCTParagraphComponentView",
        text: attributed.string,
        viewRect: viewRect,
        visibleRect: cuts.visible,
        clipRect: cuts.clip,
        contentRect: content,
        lineCount: measure.lineCount,
        maxLines: limit > 0 ? limit : nil,
        ellipsized: measure.ellipsized,
        unlimitedLineCount: measure.unlimitedLineCount,
        window: id,
        scrolledAway: cuts.scrolledAway)
    }
    // Any other text renderer is reported, so a renderer change cannot hide text from the probe.
    let text: String?
    switch view {
    case let label as UILabel: text = label.text
    case let field as UITextField: text = field.text?.isEmpty == false ? field.text : field.placeholder
    case let textView as UITextView: text = textView.text
    default: return nil
    }
    guard let text, !text.isEmpty else { return nil }
    return unknown(view, className, text, viewRect, window, id)
  }

  /// React Native's TextInput: the component view holds a UITextField (single line) or a
  /// UITextView (multiline) that draws the text, or the placeholder while the text is empty.
  private static func textInput(
    _ view: UIView, _ viewRect: CGRect, _ window: UIWindow, _ id: Int
  ) -> TextLayoutProbeWire.Record? {
    guard let backing = backingTextView(view) else {
      return unknown(view, "RCTTextInputComponentView", "", viewRect, window, id)
    }
    let shown: NSAttributedString
    let input: TextLayoutProbeMeasure.Input
    let content: CGRect
    if let field = backing as? UITextField {
      let value = field.attributedText ?? NSAttributedString()
      shown =
        value.length > 0
        ? value
        : field.attributedPlaceholder ?? NSAttributedString(string: field.placeholder ?? "")
      input = TextLayoutProbeMeasure.field(
        shown, area: field.textRect(forBounds: field.bounds), alignment: field.textAlignment,
        rightToLeft: field.effectiveUserInterfaceLayoutDirection == .rightToLeft)
      content = field.convert(input.content, to: window)
    } else if let textView = backing as? UITextView {
      let value = textView.attributedText ?? NSAttributedString()
      let placeholder =
        textView.responds(to: NSSelectorFromString("placeholder"))
        ? textView.value(forKey: "placeholder") as? String : nil
      shown =
        value.length > 0
        ? value
        : NSAttributedString(
          string: placeholder ?? "",
          attributes: [.font: textView.font ?? UIFont.preferredFont(forTextStyle: .body)])
      let container = textView.textContainer
      input = TextLayoutProbeMeasure.textView(
        shown, containerWidth: container.size.width,
        lineFragmentPadding: container.lineFragmentPadding,
        insetLeft: textView.textContainerInset.left, insetTop: textView.textContainerInset.top,
        maximumNumberOfLines: container.maximumNumberOfLines,
        lineBreakMode: container.lineBreakMode)
      // Content coordinates are the text view's bounds space, so its scroll offset carries over.
      content = textView.convert(input.content, to: window)
    } else {
      return nil
    }
    if shown.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
    let cuts = clip(view, viewRect, window)
    return .init(
      kind: "RCTTextInputComponentView", text: shown.string, viewRect: viewRect,
      visibleRect: cuts.visible, clipRect: cuts.clip, contentRect: content,
      lineCount: input.lineCount, maxLines: input.maxLines, ellipsized: input.ellipsized,
      unlimitedLineCount: input.unlimitedLineCount, window: id, scrolledAway: cuts.scrolledAway)
  }

  /// The UITextField or UITextView inside a text input component view, nearest first.
  private static func backingTextView(_ view: UIView) -> UIView? {
    var level = view.subviews
    for _ in 0..<3 {
      if let found = level.first(where: { $0 is UITextField || $0 is UITextView }) { return found }
      level = level.flatMap { $0.subviews }
    }
    return nil
  }

  private static func unknown(
    _ view: UIView, _ className: String, _ text: String, _ viewRect: CGRect,
    _ window: UIWindow, _ id: Int
  ) -> TextLayoutProbeWire.Record {
    let cuts = clip(view, viewRect, window)
    return .init(
      kind: "unknown:\(className)", text: text, viewRect: viewRect, visibleRect: cuts.visible,
      clipRect: cuts.clip, contentRect: viewRect, lineCount: 0, maxLines: nil, ellipsized: 0,
      unlimitedLineCount: nil, window: id, scrolledAway: cuts.scrolledAway)
  }

  private static func clip(_ view: UIView, _ viewRect: CGRect, _ window: UIWindow)
    -> TextLayoutProbeWire.Cuts
  {
    var ancestors: [TextLayoutProbeWire.Ancestor] = []
    var parent = view.superview
    while let ancestor = parent, ancestor !== window {
      ancestors.append(
        .init(
          rect: ancestor.convert(ancestor.bounds, to: window),
          clips: ancestor.clipsToBounds || ancestor.layer.masksToBounds
            || ancestor.layer.mask != nil,
          scrollsX: scrolls(ancestor, horizontally: true),
          scrollsY: scrolls(ancestor, horizontally: false)))
      parent = ancestor.superview
    }
    return TextLayoutProbeWire.cuts(viewRect: viewRect, ancestors: ancestors, window: window.bounds)
  }

  /// Whether a view is a scroll view that can scroll on the axis: its content, with the insets,
  /// is larger than its bounds there (a horizontal React Native ScrollView has wider content).
  private static func scrolls(_ view: UIView, horizontally: Bool) -> Bool {
    guard let scroll = view as? UIScrollView, !(view is UITextView) else { return false }
    let inset = scroll.adjustedContentInset
    return horizontally
      ? scroll.contentSize.width + inset.left + inset.right > scroll.bounds.width + 0.5
      : scroll.contentSize.height + inset.top + inset.bottom > scroll.bounds.height + 0.5
  }

  /// The view and every ancestor up to and including its window, for its effective opacity.
  private static func opacity(_ view: UIView) -> Double {
    var chain: [TextLayoutProbeWire.Layer] = []
    var current: UIView? = view
    while let layer = current {
      chain.append(.init(alpha: layer.alpha, opacity: layer.layer.opacity, hidden: layer.isHidden))
      current = layer.superview
    }
    return TextLayoutProbeWire.effectiveOpacity(chain)
  }
}
