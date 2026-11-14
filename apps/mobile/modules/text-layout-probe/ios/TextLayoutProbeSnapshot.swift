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
    var elements: [TextLayoutProbeWire.Element] = []
    for (rank, entry) in shown.enumerated() {
      let window = entry.element
      windows.append(
        .init(id: entry.offset, rect: window.frame, z: z[rank], focused: window.isKeyWindow))
      var recorded = Set<ObjectIdentifier>()
      collect(window, in: window, id: entry.offset, into: &records, recorded: &recorded)
      accessibilityElements(window, id: entry.offset, recorded: recorded, into: &elements)
    }
    return try TextLayoutProbeWire.json(
      token: token, windows: windows, records: records, elements: elements)
  }

  /// A view the accessibility tree does not show, with everything under it.
  private static func invisible(_ view: UIView) -> Bool {
    view.isHidden || view.alpha <= 0 || view.layer.opacity <= 0
  }

  /// A UIKit text control draws its own internals (placeholder labels, field editors), so the
  /// record walk does not go below it.
  private static func descends(_ view: UIView) -> Bool {
    TLPParagraphReader.isParagraphLikeView(view)
  }

  /// What the modal opacity check reads of a view. The background is the layer's: React Native's
  /// view returns its backgroundColor prop even when a shaped sublayer paints it (non-uniform
  /// corners or borders), and then leaves the layer's own background nil, so such a view does not
  /// count as filling its rect.
  private static func paint(_ view: UIView, in window: UIWindow) -> TextLayoutProbeWire.Paint {
    let layer = view.layer
    return .init(
      shown: !view.isHidden && view.alpha >= 1 && layer.opacity >= 1 && layer.mask == nil,
      rect: view.convert(view.bounds, to: window),
      clips: view.clipsToBounds || layer.masksToBounds,
      fills: (layer.backgroundColor?.alpha ?? 0) >= 1 && layer.cornerRadius <= 0)
  }

  /// The views from the window down to `view`'s parent.
  private static func ancestors(_ view: UIView, in window: UIWindow) -> [UIView] {
    var found: [UIView] = []
    var parent = view.superview
    while let ancestor = parent {
      found.append(ancestor)
      if ancestor === window { break }
      parent = ancestor.superview
    }
    return found.reversed()
  }

  /// Every text view, hidden and faded ones included, with the opacity it draws with and, when
  /// the window has an accessibility-modal view it lies outside, that view's frame and whether it
  /// is opaque over it.
  private static func collect(
    _ view: UIView,
    in window: UIWindow,
    id: Int,
    into records: inout [TextLayoutProbeWire.Record],
    recorded: inout Set<ObjectIdentifier>
  ) {
    let modal = TextLayoutProbeWire.topmostModal(
      view, children: { $0.subviews }, hidden: invisible, isModal: { $0.accessibilityViewIsModal })
    let opaque =
      modal.map { modal in
        TextLayoutProbeWire.modalOpaque(
          modal, ancestors: ancestors(modal, in: window), children: { $0.subviews },
          paint: { paint($0, in: window) })
      } ?? false
    TextLayoutProbeWire.collect(
      view,
      layer: { .init(alpha: $0.alpha, opacity: $0.layer.opacity, hidden: $0.isHidden) },
      children: { $0.subviews },
      read: { view in
        guard var found = record(view, in: window, id: id) else { return nil }
        found.accessibilityAncestor = accessibilityAncestor(view, in: window)
        found.accessibilityHidden = accessibilityHidden(view, in: window)
        found.behindModal = TextLayoutProbeWire.behindModal(
          view, modal: modal, opaque: opaque,
          contains: { holder, inner in inner.isDescendant(of: holder) },
          rect: { $0.convert($0.bounds, to: window) })
        recorded.insert(ObjectIdentifier(view))
        return found
      },
      descends: descends,
      into: &records)
  }

  /// Every accessibility element with a non-empty label, as the accessibility tree shows them:
  /// hidden, alpha 0 and accessibilityElementsHidden subtrees left out, an element a leaf.
  private static func accessibilityElements(
    _ window: UIWindow,
    id: Int,
    recorded: Set<ObjectIdentifier>,
    into elements: inout [TextLayoutProbeWire.Element]
  ) {
    TextLayoutProbeWire.elements(
      window as UIView,
      window: id,
      children: { $0.subviews },
      hidden: { invisible($0) || $0.accessibilityElementsHidden },
      element: { view in
        view.isAccessibilityElement
          ? .init(
            label: view.accessibilityLabel, identifier: view.accessibilityIdentifier,
            rect: view.convert(view.bounds, to: window))
          : nil
      },
      isText: { recorded.contains(ObjectIdentifier($0)) },
      drawsSubtree: { !descends($0) },
      descendsIntoElements: false,
      into: &elements)
  }

  /// The nearest accessibility element with an identifier at or above `view`, below the window.
  private static func accessibilityAncestor(_ view: UIView, in window: UIWindow)
    -> TextLayoutProbeWire.AccessibilityAncestor?
  {
    TextLayoutProbeWire.accessibilityAncestor(
      view,
      parent: { $0.superview === window ? nil : $0.superview },
      isElement: { $0.isAccessibilityElement },
      identifier: { $0.accessibilityIdentifier },
      rect: { $0.convert($0.bounds, to: window) })
  }

  /// Whether VoiceOver cannot reach the record's view (`TextLayoutProbeWire.accessibilityHidden`),
  /// read from the view up to the window as React Native leaves them. The record's own view counts
  /// as an element the way it presents its text: a paragraph (isAccessibilityElement always NO)
  /// through an element of its accessibilityElements, empty when its `accessible` prop is false;
  /// a TextInput through its backing text field or text view, which carries the input's
  /// `accessible` and `accessibilityElementsHidden` props (its accessibilityElement).
  private static func accessibilityHidden(_ view: UIView, in window: UIWindow) -> Bool {
    let backing =
      NSStringFromClass(type(of: view)) == "RCTTextInputComponentView"
      ? backingTextView(view) : nil
    return TextLayoutProbeWire.accessibilityHidden(
      view,
      parent: { $0 === window ? nil : $0.superview },
      isElement: { node in
        if node.isAccessibilityElement { return true }
        guard node === view else { return false }
        if let backing { return backing.isAccessibilityElement }
        return presentsElement(node)
      },
      elementsHidden: { node in
        node.accessibilityElementsHidden
          || (node === view && backing?.accessibilityElementsHidden == true)
      })
  }

  /// A paragraph's text reaches VoiceOver through its accessibilityElements: React Native returns
  /// none when the Text's `accessible` prop is false, and otherwise marks the first one an element
  /// unless an accessible ancestor coopts its label (then that ancestor is the element).
  private static func presentsElement(_ view: UIView) -> Bool {
    guard TLPParagraphReader.isParagraphLikeView(view) else { return false }
    return (view.accessibilityElements ?? []).contains { element in
      (element as? NSObject)?.isAccessibilityElement == true
    }
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
        scrolledAway: cuts.scrolledAway,
        offWindow: cuts.offWindow)
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
      unlimitedLineCount: input.unlimitedLineCount, window: id, scrolledAway: cuts.scrolledAway,
      offWindow: cuts.offWindow)
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
      unlimitedLineCount: nil, window: id, scrolledAway: cuts.scrolledAway,
      offWindow: cuts.offWindow)
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
          scrollX: travel(ancestor, horizontally: true),
          scrollY: travel(ancestor, horizontally: false),
          transform: transform(ancestor)))
      parent = ancestor.superview
    }
    return TextLayoutProbeWire.cuts(
      viewRect: viewRect, ancestors: ancestors, window: window.bounds, transform: transform(view))
  }

  /// A view's own transform: React Native sets it on the layer (translate, scale, an inverted
  /// list's scaleY -1), which UIView.transform mirrors; its affine part is what moves and flips.
  private static func transform(_ view: UIView) -> CGAffineTransform {
    CATransform3DGetAffineTransform(view.layer.transform)
  }

  /// A scroll view's travel on one axis: nil unless it is a scroll view with scrolling enabled
  /// whose content, with the adjusted insets, is larger than its bounds there (a horizontal React
  /// Native ScrollView has wider content).
  private static func travel(_ view: UIView, horizontally: Bool) -> TextLayoutProbeWire.Scroll? {
    guard let scroll = view as? UIScrollView, !(view is UITextView) else { return nil }
    let inset = scroll.adjustedContentInset
    return horizontally
      ? TextLayoutProbeWire.travel(
        content: scroll.contentSize.width, insetStart: inset.left, insetEnd: inset.right,
        bounds: scroll.bounds.width, offset: scroll.contentOffset.x,
        enabled: scroll.isScrollEnabled)
      : TextLayoutProbeWire.travel(
        content: scroll.contentSize.height, insetStart: inset.top, insetEnd: inset.bottom,
        bounds: scroll.bounds.height, offset: scroll.contentOffset.y,
        enabled: scroll.isScrollEnabled)
  }
}
