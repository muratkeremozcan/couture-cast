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

  func testAFixedHeightClipperCutsBothRectsAndAScrollViewOnlyTheVisibleOne() {
    let text = CGRect(x: 10, y: 100, width: 200, height: 40)
    let cuts = Wire.cuts(
      viewRect: text,
      ancestors: [
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 20), clips: true, isScrollView: false),
        .init(rect: CGRect(x: 0, y: 90, width: 390, height: 40), clips: true, isScrollView: true),
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
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 300), clips: true, isScrollView: true)
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
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 300), clips: true, isScrollView: true)
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
        .init(rect: CGRect(x: 0, y: 100, width: 390, height: 0), clips: true, isScrollView: false)
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
        .init(rect: CGRect(x: 0, y: 0, width: 390, height: 10), clips: false, isScrollView: false)
      ],
      window: window)
    XCTAssertEqual(cuts.clip, CGRect(x: 10, y: 830, width: 200, height: 14))
    XCTAssertEqual(cuts.visible, cuts.clip)
  }

  func testATextOutsideTheWindowIsScrolledAwayWithNothingLeft() {
    let cuts = Wire.cuts(
      viewRect: CGRect(x: 10, y: 900, width: 200, height: 40), ancestors: [], window: window)
    XCTAssertTrue(cuts.scrolledAway)
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
              .init(rect: first, clips: true, isScrollView: scrollFirst),
              .init(rect: second, clips: true, isScrollView: !scrollFirst),
            ],
            window: window)
          if cuts.scrolledAway { XCTAssertNil(cuts.visible) }
          if cuts.visible != nil { XCTAssertNotNil(cuts.clip) }
          if cuts.visible == nil && !cuts.scrolledAway { XCTAssertNil(cuts.clip) }
        }
      }
    }
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
          ellipsized: 0, unlimitedLineCount: 2, window: 0, scrolledAway: false)
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
        "maxLines", "ellipsized", "unlimitedLineCount", "window", "scrolledAway",
      ])
    XCTAssertTrue(record["visibleRect"] is NSNull)
    XCTAssertTrue(record["maxLines"] is NSNull)
    XCTAssertEqual(record["text"] as? String, "Show \"watermark\"\n")
    XCTAssertEqual(record["viewRect"] as? [Double], [0.333, 2, 3.333, 6])
    XCTAssertEqual(record["scrolledAway"] as? Bool, false)
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

  func testALimitTheTextFitsInIsNotATruncation() {
    let measure = TextLayoutProbeMeasure.measure(
      text("Short"), width: 300, maximumNumberOfLines: 2, lineBreakMode: .byTruncatingTail)
    XCTAssertEqual(measure.lineCount, 1)
    XCTAssertEqual(measure.ellipsized, 0)
  }
}
