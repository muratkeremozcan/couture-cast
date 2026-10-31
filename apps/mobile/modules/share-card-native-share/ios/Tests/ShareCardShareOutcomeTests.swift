// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import XCTest
@testable import ShareCardShareCore

/// N-IOS-OUTCOME: the completion reducer and the settle-once gate follow the result model.
final class ShareCardShareOutcomeTests: XCTestCase {
  struct Failure: Error {}
  let instagram = "com.burbn.instagram.shareextension"
  let mail = "com.apple.UIKit.activity.Mail"

  func result(_ activity: String?, _ completed: Bool, _ error: Error? = nil) -> ShareCardShareResult {
    ShareCardShareOutcomeReducer.result(activityType: activity, completed: completed, error: error)
  }

  func testCompletedNamesTheAppOtherOrUnknown() {
    XCTAssertEqual(result(instagram, true), ShareCardShareResult(target: .instagram, outcome: .completed, code: nil))
    XCTAssertEqual(result(mail, true), ShareCardShareResult(target: .other, outcome: .completed, code: nil))
    XCTAssertEqual(result(nil, true), ShareCardShareResult(target: .unknown, outcome: .completed, code: nil))
  }

  func testNotCompletedIsCancelledWithTheNamedTargetOrNone() {
    XCTAssertEqual(result(instagram, false), ShareCardShareResult(target: .instagram, outcome: .cancelled, code: nil))
    XCTAssertEqual(result(mail, false), ShareCardShareResult(target: .other, outcome: .cancelled, code: nil))
    XCTAssertEqual(result(nil, false), ShareCardShareResult(target: .none, outcome: .cancelled, code: nil))
  }

  func testErrorFailsWithAClosedCodeWhateverElseIsReported() {
    for (activity, completed) in [(instagram, true), (nil, false), (mail, false)] as [(String?, Bool)] {
      XCTAssertEqual(result(activity, completed, Failure()), .failed(.nativeError))
    }
    XCTAssertEqual(ShareCardShareResult.failed(.nativeError).bridgeValue,
                   ["target": "none", "outcome": "failed", "code": "native_error"])
  }

  func testMissingPresenterFailsAsPresenterUnavailable() {
    let configured = ShareCardAnchorConfiguration.configure(
      presenterView: nil as NSObject?, bounds: .zero, anchor: nil, fromWindow: { $0 })
    guard case .failure(let code) = configured else { return XCTFail("presenter required") }
    XCTAssertEqual(ShareCardShareResult.failed(code).bridgeValue,
                   ["target": "none", "outcome": "failed", "code": "presenter_unavailable"])
  }

  func testBridgeValueKeysStayWithinTargetOutcomeCode() {
    let results = [result(instagram, true), result(nil, false), .failed(.busy), .failed(.fileInvalid)]
    for value in results.map(\.bridgeValue) {
      XCTAssertTrue(Set(value.keys).isSubset(of: ["target", "outcome", "code"]), "\(value)")
      XCTAssertFalse(value.values.contains { $0.contains(".") }, "no raw activity id: \(value)")
    }
    XCTAssertNil(result(mail, true).bridgeValue["code"])
  }

  func testOutcomeTypeHasOnlyIosMembersAndCodesAreClosed() {
    XCTAssertEqual(ShareCardShareOutcome.allCases.map(\.rawValue), ["completed", "cancelled", "failed"])
    for foreign in ["target_chosen", "handed_off", "dismissed", "not_confirmed", "unavailable"] {
      XCTAssertNil(ShareCardShareOutcome(rawValue: foreign), foreign)
    }
    XCTAssertEqual(Set(ShareCardShareCode.allCases.map(\.rawValue)),
                   ["presenter_unavailable", "file_invalid", "native_error", "busy"])
  }

  func testGateSettlesOnceIgnoresDuplicatesAndRejectsASecondShareWhileActive() throws {
    let gate = ShareCardShareGate()
    let attempt = try XCTUnwrap(gate.begin())
    XCTAssertNil(gate.begin(), "second share while one is active is busy")
    XCTAssertEqual(gate.settle(attempt, result(nil, false)), result(nil, false))
    XCTAssertNil(gate.settle(attempt, result(instagram, true)), "duplicate completion is ignored")
    XCTAssertFalse(gate.isActive)
    let next = try XCTUnwrap(gate.begin(), "settlement releases the gate")
    XCTAssertNil(gate.settle(attempt, result(mail, true)), "a late completion of an old attempt is ignored")
    XCTAssertTrue(gate.isActive)
    XCTAssertEqual(gate.settle(next, result(mail, true)), result(mail, true))
  }
}
