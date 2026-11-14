import XCTest

#if canImport(UIKit)
import UIKit
typealias ProbeFont = UIFont
#else
import AppKit
typealias ProbeFont = NSFont
#endif

@testable import TextLayoutProbeRules

/// Story 6.15 F-00i: the iOS probe's rect rules, wire JSON, request token and TextKit measure.
final class TextLayoutProbeRulesTests: XCTestCase {
  typealias Wire = TextLayoutProbeWire
  private let window = CGRect(x: 0, y: 0, width: 390, height: 844)

  /// A scroll view's travel on one axis: at `offset` of `maximum`.
  private func scroll(_ offset: CGFloat, of maximum: CGFloat) -> Wire.Scroll {
    Wire.Scroll(offset: offset, maximum: maximum)
  }

  func testAFixedHeightClipperCutsBothRectsAndAScrollViewOnlyTheVisibleOne() {
    let text = CGRect(x: 10, y: 100, width: 200, height: 40)
    let cuts = Wire.cuts(
      viewRect: text,
      ancestors: [
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 20), clips: true),
        .init(rect: CGRect(x: 0, y: 90, width: 390, height: 40), clips: true, scrollY: scroll(0, of: 100)),
      ],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 100, width: 200, height: 20))
    XCTAssertEqual(cuts.visible, CGRect(x: 10, y: 100, width: 200, height: 20))
    XCTAssertFalse(cuts.scrolledAway)
  }

  func testATextCutOnlyAtTheScrollViewportKeepsItsWholeClipRect() {
    let text = CGRect(x: 10, y: 380, width: 200, height: 40)
    let cuts = Wire.cuts(
      viewRect: text,
      ancestors: [
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 300), clips: true, scrollY: scroll(0, of: 300))
      ],
      window: window)
    XCTAssertEqual(cuts.clip, text)
    XCTAssertEqual(cuts.visible, CGRect(x: 10, y: 380, width: 200, height: 20))
    XCTAssertFalse(cuts.scrolledAway)
  }

  func testATextScrolledFullyOutIsScrolledAwayWithNoVisibleRect() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 500, width: 200, height: 40),
      ancestors: [
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 300), clips: true, scrollY: scroll(0, of: 300))
      ],
      window: window)
    XCTAssertTrue(cuts.scrolledAway)
    XCTAssertNil(cuts.visible)
    XCTAssertNotNil(cuts.clip)
  }

  func testAZeroHeightClipperCutsToNothingWithoutScrollingAway() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 100, width: 200, height: 40),
      ancestors: [
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 0), clips: true)
      ],
      window: window)
    XCTAssertNil(cuts.visible)
    XCTAssertNil(cuts.clip)
    XCTAssertFalse(cuts.scrolledAway)
  }

  func testANonClippingAncestorDoesNotCutAndTheWindowDoes() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 830, width: 200, height: 40),
      ancestors: [
        .init(rect: CGRect(x: 0, y: 0, width: 390, height: 10), clips: false)
      ],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 830, width: 200, height: 14))
    XCTAssertEqual(cuts.visible, cuts.clip)
  }

  // TEA ruling 2026-11-14 (r44 P1-1): a text wholly outside the window by layout alone, with no
  // scroll reach, is cut to nothing (the harness fails it); only a translation that put it there
  // makes it offWindow. Neither is scrolledAway.
  func testATextOutsideTheWindowByLayoutIsCutToNothingNotOffWindow() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 900, width: 200, height: 40), ancestors: [], window: window)
    XCTAssertFalse(cuts.offWindow)
    XCTAssertFalse(cuts.scrolledAway)
    XCTAssertNil(cuts.visible)
    XCTAssertNil(cuts.clip)
  }

  func testATextItsOwnTranslationMovesOffTheWindowIsOffWindow() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 900, width: 200, height: 40), ancestors: [], window: window,
      transform: CGAffineTransform(translationX: 0, y: 500))
    XCTAssertTrue(cuts.offWindow)
    XCTAssertFalse(cuts.scrolledAway)
    XCTAssertNil(cuts.visible)
    XCTAssertNil(cuts.clip)
  }

  /// Antigravity r44 PROBE_4B: a non-scrolling footer pushed past the window bottom, and a row
  /// item pushed past the window right, by layout. Both are cut to nothing, not offWindow.
  func testR44AFooterPastTheWindowBottomAndARowItemPastItsRightAreNotOffWindow() {
    let column = Wire.Ancestor(rect: CGRect(x: 0, y: 0, width: 390, height: 900), clips: false)
    let footer = Wire.cuts(
      viewRect: CGRect(x: 10, y: 860, width: 200, height: 30), ancestors: [column], window: window)
    let rowHolder = Wire.Ancestor(rect: CGRect(x: 0, y: 100, width: 600, height: 40), clips: false)
    let item = Wire.cuts(
      viewRect: CGRect(x: 400, y: 100, width: 80, height: 40), ancestors: [rowHolder, column],
      window: window)
    for cuts in [footer, item] {
      XCTAssertFalse(cuts.offWindow)
      XCTAssertNil(cuts.clip)
      XCTAssertNil(cuts.visible)
      XCTAssertFalse(cuts.scrolledAway)
    }
  }

  /// A sheet whose own text lies past the window even with the sheet's translation undone is cut
  /// to nothing: the translation is not what hides it.
  func testATranslatedSheetsTextOffTheWindowEvenUntranslatedIsNotOffWindow() {
    let sheet = Wire.Ancestor(
      rect: CGRect(x: 0, y: 1100, width: 390, height: 300), clips: false,
      transform: CGAffineTransform(translationX: 0, y: 200))
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 1260, width: 200, height: 40), ancestors: [sheet], window: window)
    XCTAssertFalse(cuts.offWindow)
    XCTAssertNil(cuts.clip)
  }

  /// A translation under a parent scaled by 2 moves the text twice as far on screen, so undoing it
  /// moves the text back by twice the translation: 1200 - 600 is on the window, 1200 - 300 not.
  func testATranslationIsUndoneAsTheScaleOfTheViewsOutsideItMapsIt() {
    let scaled = Wire.Ancestor(
      rect: CGRect(x: 0, y: 0, width: 390, height: 2000), clips: false,
      transform: CGAffineTransform(scaleX: 2, y: 2))
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 1200, width: 100, height: 40), ancestors: [scaled],
      window: window, transform: CGAffineTransform(translationX: 0, y: 300))
    XCTAssertTrue(cuts.offWindow)
    let half = Wire.untranslated(
      viewRect: CGRect(x: 10, y: 1200, width: 100, height: 40), ancestors: [scaled],
      transform: CGAffineTransform(translationX: 0, y: 300))
    XCTAssertEqual(half.viewRect, CGRect(x: 10, y: 600, width: 100, height: 40))
  }

  /// The harness validator's invariants hold whatever the cuts: scrolled away means no visible
  /// rect, a visible rect means a clip rect, and nothing visible without scrolling means no clip.
  func testEveryCutCombinationKeepsTheValidatorInvariants() {
    let rects = [
      CGRect(x: 0, y: 100, width: 390, height: 20), CGRect(x: 0, y: 130, width: 390, height: 50),
      CGRect(x: 0, y: 100, width: 390, height: 0), CGRect(x: 0, y: 0, width: 390, height: 844),
    ]
    for first in rects {
      for second in rects {
        for scrollFirst in [true, false] {
          let cuts = Wire.cuts(
            viewRect: CGRect(x: 10, y: 100, width: 200, height: 60),
            ancestors: [
              .init(rect: first, clips: true, scrollY: scrollFirst ? scroll(0, of: 200) : nil),
              .init(rect: second, clips: true, scrollY: scrollFirst ? nil : scroll(0, of: 200)),
            ],
            window: window)
          if cuts.scrolledAway { XCTAssertNil(cuts.visible) }
          if cuts.visible != nil { XCTAssertNotNil(cuts.clip) }
          if cuts.visible == nil && !cuts.scrolledAway { XCTAssertNil(cuts.clip) }
          if cuts.offWindow { XCTAssertNil(cuts.clip) }
          XCTAssertFalse(cuts.offWindow)
        }
      }
    }
  }

  func testAScrollChildHalfPastTheWindowBottomKeepsItsWholeClipRect() {
    let text = CGRect(x: 10, y: 824, width: 200, height: 40)
    let cuts = Wire.cuts(
      viewRect: text,
      ancestors: [
        .init(rect: CGRect(x: 0, y: 0, width: 390, height: 844), clips: true, scrollY: scroll(0, of: 100)),
        // A screen container that clips at the window edge, above the scroll view.
        .init(rect: window, clips: true),
      ],
      window: window)
    XCTAssertEqual(cuts.clip, text)
    XCTAssertEqual(cuts.visible, CGRect(x: 10, y: 824, width: 200, height: 20))
    XCTAssertFalse(cuts.scrolledAway)
  }

  func testAFixedTextHalfPastTheWindowBottomIsCut() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 824, width: 200, height: 40), ancestors: [], window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 824, width: 200, height: 20))
    XCTAssertFalse(cuts.offWindow)
    XCTAssertFalse(cuts.scrolledAway)
  }

  func testAClipperSmallerThanTheScrollViewItHoldsCutsOnlyAcrossTheScrollAxis() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 140, width: 200, height: 40),
      ancestors: [
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 100), clips: true, scrollY: scroll(0, of: 100)),
        .init(rect: CGRect(x: 0, y: 100, width: 150, height: 60), clips: true),
      ],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 140, width: 140, height: 40))
    XCTAssertEqual(cuts.visible, CGRect(x: 10, y: 140, width: 140, height: 20))
  }

  // Antigravity r42 P2: the three probes that showed clipRect blind to the scroll axis.

  func testSwiftP1HorizClipY() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 100, width: 200, height: 80),
      ancestors: [.init(rect: CGRect(x: 0, y: 100, width: 390, height: 40), clips: true, scrollX: scroll(0, of: 100))],
      window: window)
    XCTAssertEqual(cuts.visible, CGRect(x: 10, y: 100, width: 200, height: 40))
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 100, width: 200, height: 40))
  }

  func testSwiftVertScrollCutsHoriz() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 0, y: 100, width: 300, height: 30),
      ancestors: [.init(rect: CGRect(x: 0, y: 0, width: 200, height: 400), clips: true, scrollY: scroll(0, of: 200))],
      window: window)
    XCTAssertEqual(cuts.visible, CGRect(x: 0, y: 100, width: 200, height: 30))
    XCTAssertEqual(cuts.clip, CGRect(x: 0, y: 100, width: 200, height: 30))
  }

  func testSwiftP5ScrollWiderThanWindow() {
    let text = CGRect(x: 360, y: 100, width: 60, height: 30)
    let cuts = Wire.cuts(
      viewRect: text,
      ancestors: [.init(rect: CGRect(x: 0, y: 0, width: 450, height: 400), clips: true, scrollX: scroll(0, of: 100))],
      window: window)
    XCTAssertEqual(cuts.clip, text)
    XCTAssertEqual(cuts.visible, CGRect(x: 360, y: 100, width: 30, height: 30))
  }

  // TEA ruling 2026-11-14 (r44 P2-1): a scroll view that does not clip still moves its content,
  // so it widens the band on its axis; it cuts nothing.
  func testANonClippingScrollViewWidensItsAxisWithoutCutting() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 824, width: 200, height: 40),
      ancestors: [.init(rect: CGRect(x: 0, y: 0, width: 390, height: 900), clips: false, scrollY: scroll(0, of: 100))],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 824, width: 200, height: 40))
    XCTAssertEqual(cuts.visible, CGRect(x: 10, y: 824, width: 200, height: 20))
  }

  /// Antigravity r44 cutsA: a non-clipping scroll view with 200 of travel inside a clipper at
  /// 100...200 reaches the text at 210...240.
  func testR44ANonClippingScrollViewInsideAClipperReachesItsTravel() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 0, y: 210, width: 100, height: 30),
      ancestors: [
        .init(rect: CGRect(x: 0, y: 100, width: 100, height: 100), clips: false, scrollY: scroll(0, of: 200)),
        .init(rect: CGRect(x: 0, y: 100, width: 100, height: 100), clips: true),
      ],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 0, y: 210, width: 100, height: 30))
    XCTAssertNil(cuts.visible)
    XCTAssertTrue(cuts.scrolledAway)
    XCTAssertFalse(cuts.offWindow)
  }

  func testOpacityMultipliesUpTheChainAndHiddenMakesItZero() {
    typealias Layer = Wire.Layer
    XCTAssertEqual(Wire.effectiveOpacity([Layer(alpha: 1, opacity: 1, hidden: false)]), 1)
    XCTAssertEqual(Wire.effectiveOpacity([Layer(alpha: 0, opacity: 1, hidden: false)]), 0)
    XCTAssertEqual(
      Wire.effectiveOpacity([
        Layer(alpha: 0.5, opacity: 1, hidden: false), Layer(alpha: 1, opacity: 0.5, hidden: false),
      ]), 0.25, accuracy: 1e-9)
    XCTAssertEqual(
      Wire.effectiveOpacity([
        Layer(alpha: 1, opacity: 1, hidden: false), Layer(alpha: 1, opacity: 1, hidden: true),
      ]), 0)
  }

  func testWindowsStackByLevelThenOrder() {
    XCTAssertEqual(Wire.zOrder(levels: [0, 0, 2000, 1]), [0, 1, 3, 2])
  }

  func testTheJsonCarriesEveryContractField() throws {
    let data = try Wire.json(
      token: "t-1",
      windows: [.init(id: 0, rect: window, z: 0, focused: true)],
      records: [
        .init(
          kind: "RCTParagraphComponentView", text: "Show \"watermark\"\n",
          viewRect: CGRect(x: 1.0 / 3, y: 2, width: 3, height: 4), visibleRect: nil,
          clipRect: nil,
          contentRect: CGRect(x: 0, y: 0, width: 1, height: 8), lineCount: 2, maxLines: nil,
          ellipsized: 0, unlimitedLineCount: 2, window: 0, scrolledAway: false, offWindow: true)
      ])
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(json["version"] as? Int, 1)
    XCTAssertEqual(json["token"] as? String, "t-1")
    XCTAssertEqual(json["platform"] as? String, "ios")
    let window = try XCTUnwrap((json["windows"] as? [[String: Any]])?.first)
    XCTAssertEqual(Set(window.keys), ["id", "rect", "z", "focused"])
    XCTAssertEqual(window["focused"] as? Bool, true)
    let record = try XCTUnwrap((json["records"] as? [[String: Any]])?.first)
    XCTAssertEqual(
      Set(record.keys),
      [
        "kind", "text", "viewRect", "visibleRect", "clipRect", "contentRect", "lineCount",
        "maxLines", "ellipsized", "unlimitedLineCount", "window", "scrolledAway", "offWindow",
        "opacity", "accessibilityAncestor", "behindModal",
      ])
    XCTAssertEqual(Set(json.keys), ["version", "token", "platform", "windows", "records", "elements"])
    XCTAssertEqual((json["elements"] as? [[String: Any]])?.count, 0)
    XCTAssertTrue(record["accessibilityAncestor"] is NSNull)
    XCTAssertTrue(record["behindModal"] is NSNull)
    XCTAssertTrue(record["visibleRect"] is NSNull)
    XCTAssertTrue(record["clipRect"] is NSNull)
    XCTAssertTrue(record["maxLines"] is NSNull)
    XCTAssertEqual(record["text"] as? String, "Show \"watermark\"\n")
    XCTAssertEqual(record["viewRect"] as? [Double], [0.333, 2, 3.333, 6])
    XCTAssertEqual(record["scrolledAway"] as? Bool, false)
    XCTAssertEqual(record["offWindow"] as? Bool, true)
    XCTAssertEqual(record["opacity"] as? Double, 1)
    // Integers stay integers on the wire.
    let text = String(decoding: data, as: UTF8.self)
    XCTAssertTrue(text.contains("\"lineCount\":2"), text)
  }

  func testTheRequestTokenIsReadTrimmedAndAMalformedOneRefused() throws {
    let caches = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: caches) }
    let directory = try Wire.directory(caches: caches)
    XCTAssertNil(Wire.requestedToken(in: directory))
    try "1731600000-home\n".write(
      to: directory.appendingPathComponent("request"), atomically: true, encoding: .utf8)
    XCTAssertEqual(Wire.requestedToken(in: directory), "1731600000-home")
    for bad in ["../escape", "a b", "", "request", ".."] {
      try bad.write(
        to: directory.appendingPathComponent("request"), atomically: true, encoding: .utf8)
      XCTAssertNil(Wire.requestedToken(in: directory), bad)
    }
    let url = try Wire.writeAnswer(Data("{}".utf8), token: "7", in: directory)
    XCTAssertEqual(url.lastPathComponent, "7.json")
    XCTAssertEqual(try Data(contentsOf: url), Data("{}".utf8))
  }

  private func text(_ value: String) -> NSAttributedString {
    NSAttributedString(string: value, attributes: [.font: ProbeFont.systemFont(ofSize: 17)])
  }

  func testTwoLinesMeasureTwoLinesTallerThanOne() {
    let one = TextLayoutProbeMeasure.measure(
      text("Show watermark"), width: 300, maximumNumberOfLines: 0, lineBreakMode: .byTruncatingTail)
    let two = TextLayoutProbeMeasure.measure(
      text("Show watermark\nCard preview"), width: 300, maximumNumberOfLines: 0,
      lineBreakMode: .byTruncatingTail)
    XCTAssertEqual(one.lineCount, 1)
    XCTAssertEqual(two.lineCount, 2)
    XCTAssertEqual(two.unlimitedLineCount, 2)
    XCTAssertEqual(two.ellipsized, 0)
    XCTAssertGreaterThan(two.usedRect.height, one.usedRect.height * 1.8)
  }

  func testNumberOfLinesOneMeasuresOneLineAndReportsTheTruncation() {
    let long = text("A long label that cannot fit on one line of this narrow box at all")
    let measure = TextLayoutProbeMeasure.measure(
      long, width: 120, maximumNumberOfLines: 1, lineBreakMode: .byTruncatingTail)
    let one = TextLayoutProbeMeasure.measure(
      text("Short"), width: 120, maximumNumberOfLines: 0, lineBreakMode: .byTruncatingTail)
    XCTAssertEqual(measure.lineCount, 1)
    XCTAssertGreaterThanOrEqual(measure.unlimitedLineCount, 3)
    XCTAssertEqual(measure.ellipsized, 1)
    // Measured at the limit, the way it renders: one line tall.
    XCTAssertEqual(measure.usedRect.height, one.usedRect.height, accuracy: 0.5)
  }

  func testACentredShortLineHasItsOwnLeftAndRightInsideTheWidth() {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    let centred = NSAttributedString(
      string: "Hi", attributes: [.font: ProbeFont.systemFont(ofSize: 17), .paragraphStyle: style])
    let measure = TextLayoutProbeMeasure.measure(
      centred, width: 300, maximumNumberOfLines: 0, lineBreakMode: .byTruncatingTail)
    XCTAssertGreaterThan(measure.usedRect.minX, 100)
    XCTAssertLessThan(measure.usedRect.maxX, 200)
  }

  private let fieldArea = CGRect(x: 8, y: 0, width: 100, height: 36)

  func testAFieldWiderThanItsTextRectRunsPastItAtItsNaturalWidth() {
    let long = text("A very long single-line input string that overflows 100pt horizontally")
    let input = TextLayoutProbeMeasure.field(
      long, area: fieldArea, alignment: .natural, rightToLeft: false)
    XCTAssertEqual(input.content.minX, fieldArea.minX)
    XCTAssertGreaterThan(input.content.maxX, fieldArea.maxX + 100)
    XCTAssertEqual(input.lineCount, 1)
    XCTAssertEqual(input.maxLines, 1)
    XCTAssertEqual(input.unlimitedLineCount, 1)
    XCTAssertEqual(input.ellipsized, 0)
    // Centred vertically in the text rect, one line tall.
    XCTAssertEqual(input.content.midY, fieldArea.midY, accuracy: 0.5)
    XCTAssertLessThan(input.content.height, 30)
  }

  func testAShortFieldSitsWhereItsAlignmentPutsIt() {
    let short = text("Hi")
    let natural = TextLayoutProbeMeasure.field(
      short, area: fieldArea, alignment: .natural, rightToLeft: false)
    let centred = TextLayoutProbeMeasure.field(
      short, area: fieldArea, alignment: .center, rightToLeft: false)
    let right = TextLayoutProbeMeasure.field(
      short, area: fieldArea, alignment: .right, rightToLeft: false)
    let rtl = TextLayoutProbeMeasure.field(
      short, area: fieldArea, alignment: .natural, rightToLeft: true)
    XCTAssertEqual(natural.content.minX, fieldArea.minX)
    XCTAssertEqual(centred.content.midX, fieldArea.midX, accuracy: 0.01)
    XCTAssertEqual(right.content.maxX, fieldArea.maxX, accuracy: 0.01)
    XCTAssertEqual(rtl.content.maxX, fieldArea.maxX, accuracy: 0.01)
    XCTAssertLessThan(natural.content.width, 30)
  }

  func testATextViewLaysOutInItsContainerOffsetByInsetAndPadding() {
    let input = TextLayoutProbeMeasure.textView(
      text("Show watermark\nCard preview"), containerWidth: 210, lineFragmentPadding: 5,
      insetLeft: 4, insetTop: 8, maximumNumberOfLines: 0, lineBreakMode: .byWordWrapping)
    XCTAssertEqual(input.lineCount, 2)
    XCTAssertNil(input.maxLines)
    XCTAssertEqual(input.content.minY, 8)
    XCTAssertGreaterThanOrEqual(input.content.minX, 9)
    XCTAssertLessThanOrEqual(input.content.maxX, 4 + 5 + 200 + 0.5)
    let limited = TextLayoutProbeMeasure.textView(
      text("Show watermark\nCard preview"), containerWidth: 210, lineFragmentPadding: 5,
      insetLeft: 4, insetTop: 8, maximumNumberOfLines: 1, lineBreakMode: .byTruncatingTail)
    XCTAssertEqual(limited.lineCount, 1)
    XCTAssertEqual(limited.maxLines, 1)
    XCTAssertEqual(limited.unlimitedLineCount, 2)
    XCTAssertEqual(limited.ellipsized, 1)
    XCTAssertLessThan(limited.content.height, input.content.height * 0.7)
  }

  func testALimitTheTextFitsInIsNotATruncation() {
    let measure = TextLayoutProbeMeasure.measure(
      text("Short"), width: 300, maximumNumberOfLines: 2, lineBreakMode: .byTruncatingTail)
    XCTAssertEqual(measure.lineCount, 1)
    XCTAssertEqual(measure.ellipsized, 0)
  }

  // TEA ruling 2026-11-14 (r43 P1): a scroll view's reach on its axis is its viewport cut by
  // everything above it, widened by its travel to [V start - offset, V end + (maximum - offset)].

  private let viewport = CGRect(x: 0, y: 100, width: 390, height: 300)

  private func inScroll(_ text: CGRect, _ travel: Wire.Scroll) -> Wire.Cuts {
    Wire.cuts(
      viewRect: text, ancestors: [.init(rect: viewport, clips: true, scrollY: travel)],
      window: window)
  }

  private func row(_ top: CGFloat) -> CGRect { CGRect(x: 10, y: top, width: 200, height: 40) }

  func testAtOffsetZeroOnlyTheContentBelowCanScrollIn() {
    let below = inScroll(row(450), scroll(0, of: 100))
    XCTAssertEqual(below.clip, row(450))
    XCTAssertTrue(below.scrolledAway)
    // Past the travel: cut at the band's end, viewport bottom plus 100.
    XCTAssertEqual(inScroll(row(480), scroll(0, of: 100)).clip, CGRect(x: 10, y: 480, width: 200, height: 20))
    let above = inScroll(row(40), scroll(0, of: 100))
    XCTAssertNil(above.clip)
    XCTAssertNil(above.visible)
    XCTAssertFalse(above.scrolledAway)
  }

  func testAtTheLargestOffsetOnlyTheContentAboveCanScrollIn() {
    let above = inScroll(row(30), scroll(100, of: 100))
    XCTAssertEqual(above.clip, CGRect(x: 10, y: 30, width: 200, height: 40))
    XCTAssertTrue(above.scrolledAway)
    let below = inScroll(row(450), scroll(100, of: 100))
    XCTAssertNil(below.clip)
    XCTAssertFalse(below.scrolledAway)
  }

  func testAMiddleOffsetOpensEachSideByItsOwnRemainingTravel() {
    // Offset 40 of 100: 40 back toward the start, 60 on toward the end; band 60...460.
    XCTAssertEqual(
      inScroll(row(430), scroll(40, of: 100)).clip, CGRect(x: 10, y: 430, width: 200, height: 30))
    XCTAssertEqual(
      inScroll(row(50), scroll(40, of: 100)).clip, CGRect(x: 10, y: 60, width: 200, height: 30))
  }

  /// Antigravity r43 probe 1: a 60 pt clipper over a 100 pt scroll view with 5 pt of travel.
  func testAnOuterClipperCutsAtTheScrollViewsSmallTravel() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 0, y: 140, width: 100, height: 50),
      ancestors: [
        .init(rect: CGRect(x: 0, y: 100, width: 100, height: 100), clips: true, scrollY: scroll(0, of: 5)),
        .init(rect: CGRect(x: 0, y: 100, width: 100, height: 60), clips: true),
      ],
      window: window)
    XCTAssertEqual(cuts.visible, CGRect(x: 0, y: 140, width: 100, height: 20))
    XCTAssertEqual(cuts.clip, CGRect(x: 0, y: 140, width: 100, height: 25))
    XCTAssertFalse(cuts.scrolledAway)
  }

  /// Antigravity r43 probe 2: a scroll view taller than the window with 10 pt of travel.
  func testAScrollViewTallerThanTheWindowReachesOnlyItsTravelPastTheWindow() {
    let small = CGRect(x: 0, y: 0, width: 100, height: 500)
    let scroller = Wire.Ancestor(
      rect: CGRect(x: 0, y: 0, width: 100, height: 1000), clips: true, scrollY: scroll(0, of: 10))
    let far = Wire.cuts(
      viewRect: CGRect(x: 0, y: 600, width: 100, height: 40), ancestors: [scroller], window: small)
    XCTAssertNil(far.visible)
    XCTAssertNil(far.clip)
    XCTAssertFalse(far.scrolledAway)
    // Past the travel by layout: cut to nothing, not offWindow (r44 P1-1).
    XCTAssertFalse(far.offWindow)
    let edge = Wire.cuts(
      viewRect: CGRect(x: 0, y: 490, width: 100, height: 40), ancestors: [scroller], window: small)
    XCTAssertEqual(edge.clip, CGRect(x: 0, y: 490, width: 100, height: 20))
    XCTAssertFalse(edge.offWindow)
    // Wholly below the window but within the 10 pt of travel: scrolled away, not off the window.
    let reachable = Wire.cuts(
      viewRect: CGRect(x: 0, y: 502, width: 100, height: 6), ancestors: [scroller], window: small)
    XCTAssertFalse(reachable.offWindow)
    XCTAssertEqual(reachable.clip, CGRect(x: 0, y: 502, width: 100, height: 6))
    XCTAssertNil(reachable.visible)
    XCTAssertTrue(reachable.scrolledAway)
  }

  /// Antigravity r43 probe 3: content that does not overflow, or scrolling switched off, gives no
  /// travel, so the scroll view and the 60 pt clipper above it cut as plain clippers.
  func testNoOverflowAndScrollingDisabledGiveNoTravel() {
    XCTAssertNil(
      Wire.travel(content: 180, insetStart: 0, insetEnd: 0, bounds: 200, offset: 0, enabled: true))
    XCTAssertNil(
      Wire.travel(content: 400, insetStart: 0, insetEnd: 0, bounds: 200, offset: 0, enabled: false))
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 0, y: 35, width: 200, height: 50),
      ancestors: [
        .init(
          rect: CGRect(x: 0, y: 0, width: 300, height: 200), clips: true,
          scrollY: Wire.travel(content: 180, insetStart: 0, insetEnd: 0, bounds: 200, offset: 0, enabled: true)),
        .init(rect: CGRect(x: 0, y: 0, width: 300, height: 60), clips: true),
      ],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 0, y: 35, width: 200, height: 25))
  }

  func testTravelCountsTheAdjustedInsetsAndClampsABounce() {
    let travel = Wire.travel(
      content: 400, insetStart: 10, insetEnd: 20, bounds: 200, offset: -10, enabled: true)
    XCTAssertEqual(travel?.maximum, 230)
    XCTAssertEqual(travel?.offset, 0)
    XCTAssertEqual(
      Wire.travel(content: 400, insetStart: 10, insetEnd: 20, bounds: 200, offset: 90, enabled: true)?
        .offset, 100)
    // Pulled past either end, the offset stays in its range.
    XCTAssertEqual(
      Wire.travel(content: 400, insetStart: 10, insetEnd: 20, bounds: 200, offset: -60, enabled: true)?
        .offset, 0)
    XCTAssertEqual(
      Wire.travel(content: 400, insetStart: 10, insetEnd: 20, bounds: 200, offset: 900, enabled: true)?
        .offset, 230)
  }

  func testAParagraphTallerThanItsScrollViewportKeepsItsWholeClipRect() {
    let paragraph = CGRect(x: 10, y: 120, width: 200, height: 500)
    let cuts = inScroll(paragraph, scroll(0, of: 400))
    XCTAssertEqual(cuts.clip, paragraph)
    XCTAssertEqual(cuts.visible, CGRect(x: 10, y: 120, width: 200, height: 280))
    XCTAssertFalse(cuts.scrolledAway)
  }

  func testNestedScrollViewsComposeEachWithItsOwnTravel() {
    // An inner viewport 350...450 runs past the outer one (100...400); the outer travel of 100
    // brings its lower part in, and its own travel of 20 reaches 20 below it.
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 440, width: 200, height: 40),
      ancestors: [
        .init(rect: CGRect(x: 0, y: 350, width: 390, height: 100), clips: true, scrollY: scroll(0, of: 20)),
        .init(rect: viewport, clips: true, scrollY: scroll(0, of: 100)),
      ],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 440, width: 200, height: 30))
    XCTAssertTrue(cuts.scrolledAway)
  }

  /// Coordinator alignment (TEA wording): a text wholly below the window that the scroll view
  /// can bring in is scrolledAway with its clipRect, not offWindow.
  func testBelowFoldTextAScrollCanReachIsScrolledAwayNotOffWindow() {
    let text = CGRect(x: 10, y: 900, width: 200, height: 40)
    let cuts = Wire.cuts(
      viewRect: text,
      ancestors: [.init(rect: window, clips: true, scrollY: scroll(0, of: 400))],
      window: window)
    XCTAssertTrue(cuts.scrolledAway)
    XCTAssertFalse(cuts.offWindow)
    XCTAssertEqual(cuts.clip, text)
    XCTAssertNil(cuts.visible)
  }

  /// Parked by a translation of 500 below its laid-out place at 380 (r44 P1-1).
  func testAParkedSheetBelowTheScreenIsOffWindowAndNotScrolledAway() {
    let sheet = CGRect(x: 0, y: 880, width: 390, height: 300)
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 900, width: 200, height: 40),
      ancestors: [
        .init(rect: sheet, clips: true, transform: CGAffineTransform(translationX: 0, y: 500))
      ],
      window: window)
    XCTAssertTrue(cuts.offWindow)
    XCTAssertFalse(cuts.scrolledAway)
    XCTAssertNil(cuts.visible)
    XCTAssertNil(cuts.clip)
  }

  // TEA ruling 2026-11-14 (r44 P2-2): an inverted scroll view (its content flipped on screen on
  // that axis) moves its content down as its offset grows, so its band mirrors.

  private let lowViewport = CGRect(x: 0, y: 300, width: 390, height: 300)

  private func inverted(
    _ text: CGRect, _ travel: Wire.Scroll, scroller: CGAffineTransform = CGAffineTransform(scaleX: 1, y: -1),
    holders: [CGAffineTransform] = []
  ) -> Wire.Cuts {
    Wire.cuts(
      viewRect: text,
      ancestors: [.init(rect: lowViewport, clips: true, scrollY: travel, transform: scroller)]
        + holders.map { .init(rect: window, clips: false, transform: $0) },
      window: window)
  }

  func testAnInvertedScrollViewAtRestReachesAboveItsViewportAndNotBelow() {
    // Offset 0 of 100: the band is 200...600.
    let above = inverted(row(220), scroll(0, of: 100))
    XCTAssertEqual(above.clip, row(220))
    XCTAssertTrue(above.scrolledAway)
    XCTAssertEqual(inverted(row(180), scroll(0, of: 100)).clip, CGRect(x: 10, y: 200, width: 200, height: 20))
    let below = inverted(row(620), scroll(0, of: 100))
    XCTAssertNil(below.clip)
    XCTAssertFalse(below.scrolledAway)
    XCTAssertFalse(below.offWindow)
  }

  func testAnInvertedScrollViewOpensEachSideByTheMirroredTravel() {
    // Offset 30 of 100: 70 above, 30 below; the band is 230...630.
    XCTAssertEqual(
      inverted(row(200), scroll(30, of: 100)).clip, CGRect(x: 10, y: 230, width: 200, height: 10))
    XCTAssertEqual(
      inverted(row(600), scroll(30, of: 100)).clip, CGRect(x: 10, y: 600, width: 200, height: 30))
  }

  /// React Native iOS flips the component view that holds the UIScrollView; a flip inside a flip
  /// scrolls the usual way.
  func testAFlipOnAHolderInvertsAndAFlipInsideAFlipDoesNot() {
    let flip = CGAffineTransform(scaleX: 1, y: -1)
    let held = inverted(row(220), scroll(0, of: 100), scroller: .identity, holders: [flip])
    XCTAssertEqual(held.clip, row(220))
    let twice = inverted(row(220), scroll(0, of: 100), scroller: flip, holders: [flip])
    XCTAssertNil(twice.clip)
    XCTAssertEqual(inverted(row(620), scroll(0, of: 100), scroller: flip, holders: [flip]).clip, row(620))
  }

  func testAHorizontallyInvertedScrollViewReachesLeftOfItsViewport() {
    let viewport = CGRect(x: 200, y: 100, width: 100, height: 40)
    func cuts(_ x: CGFloat) -> Wire.Cuts {
      Wire.cuts(
        viewRect: CGRect(x: x, y: 100, width: 40, height: 40),
        ancestors: [
          .init(
            rect: viewport, clips: true, scrollX: scroll(0, of: 100),
            transform: CGAffineTransform(scaleX: -1, y: 1))
        ],
        window: window)
    }
    XCTAssertEqual(cuts(120).clip, CGRect(x: 120, y: 100, width: 40, height: 40))
    XCTAssertTrue(cuts(120).scrolledAway)
    XCTAssertNil(cuts(310).clip)
  }

  // TEA ruling 2026-11-14 (r43 P2): every text view is recorded with the opacity it draws with.

  private struct Node {
    var text: String? = nil
    var alpha: CGFloat = 1
    var hidden = false
    var children: [Node] = []
  }

  private func records(_ root: Node) -> [Wire.Record] {
    var out: [Wire.Record] = []
    Wire.collect(
      root,
      layer: { Wire.Layer(alpha: $0.alpha, opacity: 1, hidden: $0.hidden) },
      children: { $0.children },
      read: { node in
        node.text.map {
          Wire.Record(
            kind: "RCTParagraphComponentView", text: $0, viewRect: .zero, visibleRect: nil,
            clipRect: nil, contentRect: .zero, lineCount: 1, maxLines: nil, ellipsized: 0,
            unlimitedLineCount: 1, window: 0, scrolledAway: false, offWindow: false)
        }
      },
      descends: { _ in true },
      into: &out)
    return out
  }

  func testAFaintTextIsRecordedWithItsOpacity() throws {
    let out = records(Node(children: [Node(text: "Faint", alpha: 0.01)]))
    XCTAssertEqual(out.map(\.text), ["Faint"])
    XCTAssertEqual(try XCTUnwrap(out.first).opacity, 0.01, accuracy: 1e-9)
  }

  func testATransparentTextAndAHiddenSubtreeAreRecordedAtOpacityZero() {
    let out = records(
      Node(children: [
        Node(text: "Clear", alpha: 0),
        Node(text: "Hidden", hidden: true),
        Node(hidden: true, children: [Node(text: "Under hidden")]),
        Node(alpha: 0.5, children: [Node(text: "Half")]),
      ]))
    XCTAssertEqual(out.map(\.text), ["Clear", "Hidden", "Under hidden", "Half"])
    XCTAssertEqual(out.map(\.opacity), [0, 0, 0, 0.5])
  }

  func testTheWalkStopsBelowATextControlThatDrawsItsOwnInternals() {
    var out: [Wire.Record] = []
    Wire.collect(
      Node(text: "Field", children: [Node(text: "Placeholder")]),
      layer: { Wire.Layer(alpha: $0.alpha, opacity: 1, hidden: $0.hidden) },
      children: { $0.children },
      read: { node in
        node.text.map {
          Wire.Record(
            kind: "RCTTextInputComponentView", text: $0, viewRect: .zero, visibleRect: nil,
            clipRect: nil, contentRect: .zero, lineCount: 1, maxLines: 1, ellipsized: 0,
            unlimitedLineCount: 1, window: 0, scrolledAway: false, offWindow: false)
        }
      },
      descends: { _ in false },
      into: &out)
    XCTAssertEqual(out.map(\.text), ["Field"])
  }

  func testTheJsonCarriesTheRawOpacity() throws {
    var record = Wire.Record(
      kind: "RCTParagraphComponentView", text: "Faint", viewRect: .zero, visibleRect: nil,
      clipRect: nil, contentRect: .zero, lineCount: 1, maxLines: nil, ellipsized: 0,
      unlimitedLineCount: 1, window: 0, scrolledAway: false, offWindow: false)
    record.opacity = 0.00004
    let data = try Wire.json(
      token: "t", windows: [.init(id: 0, rect: window, z: 0, focused: true)], records: [record])
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let first = try XCTUnwrap((json["records"] as? [[String: Any]])?.first)
    XCTAssertEqual(first["opacity"] as? Double, 0.00004)
  }

  // TEA ruling 2026-11-14 (r44 P3-1): a NaN opacity refuses the answer with its own code; it is
  // never coerced or dropped.
  func testANaNOpacityRefusesTheAnswerWithItsOwnCode() throws {
    let opacity = Wire.effectiveOpacity([
      Wire.Layer(alpha: 1, opacity: 1, hidden: false), Wire.Layer(alpha: .nan, opacity: 1, hidden: false),
    ])
    XCTAssertTrue(opacity.isNaN)
    func record(_ text: String, _ opacity: Double) -> Wire.Record {
      var record = Wire.Record(
        kind: "RCTParagraphComponentView", text: text, viewRect: .zero, visibleRect: nil,
        clipRect: nil, contentRect: .zero, lineCount: 1, maxLines: nil, ellipsized: 0,
        unlimitedLineCount: 1, window: 0, scrolledAway: false, offWindow: false)
      record.opacity = opacity
      return record
    }
    let data = try Wire.json(
      token: "t-nan", windows: [.init(id: 0, rect: window, z: 0, focused: true)],
      records: [record("Fine", 1), record("Broken", opacity)])
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(Set(json.keys), ["version", "token", "platform", "error"])
    XCTAssertEqual(json["token"] as? String, "t-nan")
    XCTAssertEqual(json["platform"] as? String, "ios")
    let error = try XCTUnwrap(json["error"] as? [String: Any])
    XCTAssertEqual(Set(error.keys), ["code", "record", "kind"])
    XCTAssertEqual(error["code"] as? String, "text_probe_opacity_invalid")
    XCTAssertEqual(error["record"] as? Int, 1)
    XCTAssertEqual(error["kind"] as? String, "RCTParagraphComponentView")
    XCTAssertEqual(
      String(decoding: data, as: UTF8.self),
      #"{"error":{"code":"text_probe_opacity_invalid","kind":"RCTParagraphComponentView","record":1},"platform":"ios","token":"t-nan","version":1}"#)
    // Any value outside 0...1 is refused the same way.
    for bad in [-0.5, 1.5, Double.infinity] {
      let refused = try Wire.json(
        token: "t", windows: [.init(id: 0, rect: window, z: 0, focused: true)],
        records: [record("Odd", bad)])
      let parsed = try XCTUnwrap(JSONSerialization.jsonObject(with: refused) as? [String: Any])
      XCTAssertNotNil(parsed["error"], "\(bad)")
      XCTAssertNil(parsed["records"], "\(bad)")
    }
  }

  // TEA ruling 2026-11-14 (r44 4): each iOS record names the nearest accessibility element with
  // an identifier at or above it, `{identifier, rect}` with rect written like viewRect, or null.

  private final class Element {
    let isElement: Bool
    let identifier: String?
    let rect: CGRect
    let parent: Element?
    init(_ isElement: Bool, _ identifier: String?, _ rect: CGRect, _ parent: Element? = nil) {
      self.isElement = isElement
      self.identifier = identifier
      self.rect = rect
      self.parent = parent
    }
  }

  private func ancestor(_ node: Element) -> Wire.AccessibilityAncestor? {
    Wire.accessibilityAncestor(
      node, parent: { $0.parent }, isElement: { $0.isElement }, identifier: { $0.identifier },
      rect: { $0.rect })
  }

  func testTheAccessibilityAncestorIsTheNearestElementWithAnIdentifier() {
    let card = CGRect(x: 0, y: 100, width: 390, height: 200)
    let root = Element(true, "screen", window)
    let outer = Element(true, "outfit-card", card, root)
    // Not an element, or an element without an identifier: passed over.
    let plain = Element(false, "not-an-element", CGRect(x: 0, y: 120, width: 390, height: 80), outer)
    let blank = Element(true, "", CGRect(x: 0, y: 130, width: 390, height: 60), plain)
    let text = Element(false, nil, CGRect(x: 10, y: 140, width: 200, height: 20), blank)
    XCTAssertEqual(ancestor(text), Wire.AccessibilityAncestor(identifier: "outfit-card", rect: card))
    // The view itself when it is one.
    let own = CGRect(x: 10, y: 140, width: 200, height: 20)
    XCTAssertEqual(
      ancestor(Element(true, "title", own, outer)),
      Wire.AccessibilityAncestor(identifier: "title", rect: own))
    XCTAssertNil(ancestor(Element(false, nil, own, Element(false, "x", window))))
    XCTAssertNil(ancestor(Element(true, nil, own)))
  }

  func testTheJsonWritesTheAccessibilityAncestorLikeViewRect() throws {
    var record = Wire.Record(
      kind: "RCTParagraphComponentView", text: "Title", viewRect: .zero, visibleRect: nil,
      clipRect: nil, contentRect: .zero, lineCount: 1, maxLines: nil, ellipsized: 0,
      unlimitedLineCount: 1, window: 0, scrolledAway: false, offWindow: false)
    record.accessibilityAncestor = .init(
      identifier: "outfit-card", rect: CGRect(x: 1.0 / 3, y: 100, width: 390, height: 200))
    let data = try Wire.json(
      token: "t", windows: [.init(id: 0, rect: window, z: 0, focused: true)], records: [record])
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let first = try XCTUnwrap((json["records"] as? [[String: Any]])?.first)
    let found = try XCTUnwrap(first["accessibilityAncestor"] as? [String: Any])
    XCTAssertEqual(Set(found.keys), ["identifier", "rect"])
    XCTAssertEqual(found["identifier"] as? String, "outfit-card")
    XCTAssertEqual(found["rect"] as? [Double], [0.333, 100, 390.333, 300])
  }

  // TEA ruling 2026-11-14: accessibility elements are listed apart from the text records,
  // `{identifier, label, rect, hasText, window}`, never judged and never counted as text.

  private final class AXNode {
    var isElement = false
    var label: String? = nil
    var identifier: String? = nil
    var rect = CGRect.zero
    var hidden = false
    var elementsHidden = false
    /// The probe reported a record for it; `drawsSubtree` for a text control's record.
    var text = false
    var drawsSubtree = false
    var modal = false
    var children: [AXNode] = []
    weak var parent: AXNode?

    init(
      element label: String? = nil, identifier: String? = nil, rect: CGRect = .zero,
      text: Bool = false, _ children: [AXNode] = []
    ) {
      self.isElement = label != nil
      self.label = label
      self.identifier = identifier
      self.rect = rect
      self.text = text
      self.children = children
      for child in children { child.parent = self }
    }

    func contains(_ other: AXNode) -> Bool {
      var current: AXNode? = other
      while let node = current {
        if node === self { return true }
        current = node.parent
      }
      return false
    }
  }

  private func elements(_ root: AXNode, window: Int = 0, descends: Bool = false) -> [Wire.Element] {
    var out: [Wire.Element] = []
    Wire.elements(
      root, window: window, children: { $0.children },
      hidden: { $0.hidden || $0.elementsHidden },
      element: { $0.isElement ? .init(label: $0.label, identifier: $0.identifier, rect: $0.rect) : nil },
      isText: { $0.text }, drawsSubtree: { $0.drawsSubtree }, descendsIntoElements: descends,
      into: &out)
    return out
  }

  func testAnImageWithALabelAndNoTextHasNoText() {
    let image = AXNode(element: "Outfit photo", identifier: "outfit-photo", rect: CGRect(x: 0, y: 0, width: 80, height: 80))
    XCTAssertEqual(
      elements(AXNode([image])),
      [.init(identifier: "outfit-photo", label: "Outfit photo", rect: image.rect, hasText: false, window: 0)])
  }

  func testAButtonWhoseLabelEchoesItsChildTextHasText() {
    let button = AXNode(element: "Save", identifier: "save-button", [AXNode(text: true)])
    let found = elements(AXNode([button]))
    XCTAssertEqual(found.map(\.label), ["Save"])
    XCTAssertEqual(found.map(\.hasText), [true])
  }

  func testATextRecordThatIsItsOwnElementHasText() {
    XCTAssertEqual(elements(AXNode([AXNode(element: "Title", text: true)])).map(\.hasText), [true])
  }

  func testAContainerLabelHasTextFromBelowAndHidesItsElementsAsALeaf() {
    let card = AXNode(
      element: "Outfit card", identifier: "outfit-card",
      [AXNode(element: "Jacket", text: true), AXNode([AXNode(element: "Heart")])])
    let found = elements(AXNode([card]))
    XCTAssertEqual(found.map(\.label), ["Outfit card"])
    XCTAssertEqual(found.map(\.hasText), [true])
    // With descending (Android's tree), the inner elements are listed after the container.
    XCTAssertEqual(elements(AXNode([card]), descends: true).map(\.label), ["Outfit card", "Jacket", "Heart"])
    XCTAssertEqual(elements(AXNode([card]), descends: true).map(\.hasText), [true, true, false])
  }

  /// RCTUITextView's accessibilityLabel joins the input's label and placeholder; the backing view
  /// sits inside the TextInput's record, which the record walk does not enter.
  func testAnInputsBackingElementInsideItsRecordHasTextWithTheJoinedLabel() {
    let backing = AXNode(element: "Email name@example.com", identifier: "email-input")
    let input = AXNode(text: true, [AXNode([backing])])
    input.drawsSubtree = true
    let found = elements(AXNode([input]))
    XCTAssertEqual(found.map(\.label), ["Email name@example.com"])
    XCTAssertEqual(found.map(\.hasText), [true])
    // A paragraph's record covers nothing below it.
    let paragraph = AXNode(text: true, [AXNode(element: "Link")])
    XCTAssertEqual(elements(AXNode([paragraph])).map(\.hasText), [false])
  }

  func testAnEmptyIdentifierIsNullAndAnEmptyLabelOrANonElementIsNotListed() {
    let blankId = AXNode(element: "Close", identifier: "")
    let noId = AXNode(element: "Back")
    let emptyLabel = AXNode(element: "", identifier: "empty")
    let nilLabel = AXNode(element: nil, identifier: "unlabelled")
    nilLabel.isElement = true
    let notElement = AXNode(identifier: "plain")
    notElement.label = "Not an element"
    let found = elements(AXNode([blankId, noId, emptyLabel, nilLabel, notElement]))
    XCTAssertEqual(found.map(\.label), ["Close", "Back"])
    XCTAssertEqual(found.map(\.identifier), [nil, nil])
  }

  func testHiddenAndAccessibilityHiddenSubtreesAreSkippedYetCountForText() {
    let hidden = AXNode(element: "Hidden")
    hidden.hidden = true
    let underHidden = AXNode([AXNode(element: "Under hidden")])
    underHidden.hidden = true
    let axHidden = AXNode([AXNode(element: "Under elements hidden")])
    axHidden.elementsHidden = true
    // A shown element whose only text is hidden (itself, or a group around it) still holds that
    // text's record.
    let faded = AXNode(text: true)
    faded.hidden = true
    let holder = AXNode(element: "Holder", [faded])
    let fadedGroup = AXNode([AXNode(text: true)])
    fadedGroup.hidden = true
    let outer = AXNode(element: "Outer holder", [fadedGroup])
    let found = elements(AXNode([hidden, underHidden, axHidden, holder, outer]))
    XCTAssertEqual(found.map(\.label), ["Holder", "Outer holder"])
    XCTAssertEqual(found.map(\.hasText), [true, true])
  }

  func testElementsRunInTreeOrderWithTheirWindow() {
    let tree = AXNode([
      AXNode(element: "A", [AXNode(text: true)]),
      AXNode([AXNode(element: "B"), AXNode(element: "C", text: true)]),
      AXNode(element: "D"),
    ])
    let found = elements(tree, window: 2)
    XCTAssertEqual(found.map(\.label), ["A", "B", "C", "D"])
    XCTAssertEqual(found.map(\.hasText), [true, false, true, false])
    XCTAssertEqual(Set(found.map(\.window)), [2])
  }

  func testTheJsonWritesEachElementLikeARecordsRect() throws {
    let data = try Wire.json(
      token: "t", windows: [.init(id: 0, rect: window, z: 0, focused: true)], records: [],
      elements: [
        .init(
          identifier: "save-button", label: "Save", rect: CGRect(x: 1.0 / 3, y: 10, width: 100, height: 44),
          hasText: true, window: 0),
        .init(identifier: nil, label: "Outfit photo", rect: .zero, hasText: false, window: 0),
      ])
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let list = try XCTUnwrap(json["elements"] as? [[String: Any]])
    XCTAssertEqual(list.count, 2)
    XCTAssertEqual(Set(list[0].keys), ["identifier", "label", "rect", "hasText", "window"])
    XCTAssertEqual(list[0]["identifier"] as? String, "save-button")
    XCTAssertEqual(list[0]["label"] as? String, "Save")
    XCTAssertEqual(list[0]["rect"] as? [Double], [0.333, 10, 100.333, 54])
    XCTAssertEqual(list[0]["hasText"] as? Bool, true)
    XCTAssertEqual(list[0]["window"] as? Int, 0)
    XCTAssertTrue(list[1]["identifier"] is NSNull)
    XCTAssertEqual(list[1]["hasText"] as? Bool, false)
    let text = String(decoding: data, as: UTF8.self)
    XCTAssertTrue(text.contains("\"hasText\":true"), text)
    XCTAssertTrue(text.contains("\"window\":0"), text)
  }

  // TEA ruling 2026-11-14: a record behind the window's topmost accessibilityViewIsModal view
  // carries `behindModal: {rect}`, that view's frame; inside it, or with no modal view, null.

  private func modal(_ root: AXNode) -> AXNode? {
    Wire.topmostModal(root, children: { $0.children }, hidden: { $0.hidden }, isModal: { $0.modal })
  }

  private func behind(_ node: AXNode, _ root: AXNode) -> Wire.BehindModal? {
    Wire.behindModal(node, modal: modal(root), contains: { $0.contains($1) }, rect: { $0.rect })
  }

  func testARecordBehindAModalSheetGetsTheSheetsRectAndOneInsideItNull() {
    let behindText = AXNode(text: true)
    let sheetText = AXNode(text: true)
    let sheetRect = CGRect(x: 0, y: 400, width: 390, height: 444)
    let sheet = AXNode(rect: sheetRect, [AXNode([sheetText])])
    sheet.modal = true
    let root = AXNode([AXNode([behindText]), sheet])
    XCTAssertEqual(behind(behindText, root), Wire.BehindModal(rect: sheetRect))
    XCTAssertNil(behind(sheetText, root))
    // The modal view itself is inside it.
    XCTAssertNil(behind(sheet, root))
  }

  func testNoModalViewGivesNull() {
    let text = AXNode(text: true)
    XCTAssertNil(behind(text, AXNode([AXNode([text]), AXNode()])))
  }

  func testTheTopmostModalIsTheLastShownOneInTreeOrder() {
    let first = AXNode(rect: CGRect(x: 0, y: 0, width: 10, height: 10))
    first.modal = true
    let nested = AXNode(rect: CGRect(x: 0, y: 0, width: 5, height: 5))
    nested.modal = true
    let outer = AXNode(rect: CGRect(x: 0, y: 0, width: 20, height: 20), [nested])
    outer.modal = true
    let hiddenLast = AXNode(rect: CGRect(x: 0, y: 0, width: 30, height: 30))
    hiddenLast.modal = true
    hiddenLast.hidden = true
    let underHidden = AXNode()
    underHidden.modal = true
    let hiddenHolder = AXNode([underHidden])
    hiddenHolder.hidden = true
    let root = AXNode([first, outer, hiddenLast, hiddenHolder])
    XCTAssertTrue(modal(root) === nested)
    // A text inside the outer modal but outside the nested one is behind the nested one.
    let between = AXNode(text: true)
    outer.children.append(between)
    between.parent = outer
    XCTAssertEqual(behind(between, root), Wire.BehindModal(rect: nested.rect))
    XCTAssertNil(modal(AXNode([hiddenLast, hiddenHolder])))
  }

  func testTheJsonWritesBehindModalLikeViewRect() throws {
    var record = Wire.Record(
      kind: "RCTParagraphComponentView", text: "Behind", viewRect: .zero, visibleRect: nil,
      clipRect: nil, contentRect: .zero, lineCount: 1, maxLines: nil, ellipsized: 0,
      unlimitedLineCount: 1, window: 0, scrolledAway: false, offWindow: false)
    record.behindModal = .init(rect: CGRect(x: 0, y: 400.0004, width: 390, height: 444))
    let data = try Wire.json(
      token: "t", windows: [.init(id: 0, rect: window, z: 0, focused: true)], records: [record])
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let first = try XCTUnwrap((json["records"] as? [[String: Any]])?.first)
    let found = try XCTUnwrap(first["behindModal"] as? [String: Any])
    XCTAssertEqual(Set(found.keys), ["rect"])
    XCTAssertEqual(found["rect"] as? [Double], [0, 400, 390, 844])
  }

  // Antigravity r43 P3: a field wider than its text rect starts at its leading edge whatever
  // its alignment.

  private let overflowing = "A very long single-line input string that overflows 100pt horizontally"

  func testAnOverflowingRightOrCentredFieldStartsAtTheLeadingEdge() {
    for alignment in [NSTextAlignment.right, .center] {
      let input = TextLayoutProbeMeasure.field(
        text(overflowing), area: fieldArea, alignment: alignment, rightToLeft: false)
      XCTAssertEqual(input.content.minX, fieldArea.minX, "\(alignment.rawValue)")
      XCTAssertGreaterThan(input.content.maxX, fieldArea.maxX + 100)
    }
  }

  func testAnOverflowingRightToLeftFieldEndsAtTheRightEdge() {
    for alignment in [NSTextAlignment.natural, .left, .center] {
      let input = TextLayoutProbeMeasure.field(
        text(overflowing), area: fieldArea, alignment: alignment, rightToLeft: true)
      XCTAssertEqual(input.content.maxX, fieldArea.maxX, accuracy: 0.01, "\(alignment.rawValue)")
      XCTAssertLessThan(input.content.minX, fieldArea.minX - 100)
    }
  }
}
