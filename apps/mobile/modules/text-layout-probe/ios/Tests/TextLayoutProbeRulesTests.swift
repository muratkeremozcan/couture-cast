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

  // TEA ruling 2026-11-14 (r43): a text wholly outside the window is offWindow, reported apart
  // from scrolledAway, which it leaves false.
  func testATextOutsideTheWindowIsOffWindowNotScrolledAwayWithNothingLeft() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 900, width: 200, height: 40), ancestors: [], window: window)
    XCTAssertTrue(cuts.offWindow)
    XCTAssertFalse(cuts.scrolledAway)
    XCTAssertNil(cuts.visible)
    XCTAssertNil(cuts.clip)
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

  func testANonClippingScrollViewOpensNoAxis() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 824, width: 200, height: 40),
      ancestors: [.init(rect: CGRect(x: 0, y: 0, width: 390, height: 900), clips: false, scrollY: scroll(0, of: 100))],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 824, width: 200, height: 20))
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
          clipRect: CGRect(x: 0, y: 0, width: 1, height: 1),
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
        "opacity",
      ])
    XCTAssertTrue(record["visibleRect"] is NSNull)
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
    XCTAssertTrue(far.offWindow)
    let edge = Wire.cuts(
      viewRect: CGRect(x: 0, y: 490, width: 100, height: 40), ancestors: [scroller], window: small)
    XCTAssertEqual(edge.clip, CGRect(x: 0, y: 490, width: 100, height: 20))
    XCTAssertFalse(edge.offWindow)
    // Wholly below the window but within the 10 pt of travel: off the window, not scrolled away.
    let reachable = Wire.cuts(
      viewRect: CGRect(x: 0, y: 502, width: 100, height: 6), ancestors: [scroller], window: small)
    XCTAssertTrue(reachable.offWindow)
    XCTAssertEqual(reachable.clip, CGRect(x: 0, y: 502, width: 100, height: 6))
    XCTAssertNil(reachable.visible)
    XCTAssertFalse(reachable.scrolledAway)
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

  func testAParkedSheetBelowTheScreenIsOffWindowAndNotScrolledAway() {
    let sheet = CGRect(x: 0, y: 880, width: 390, height: 300)
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 900, width: 200, height: 40),
      ancestors: [.init(rect: sheet, clips: true)], window: window)
    XCTAssertTrue(cuts.offWindow)
    XCTAssertFalse(cuts.scrolledAway)
    XCTAssertNil(cuts.visible)
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
