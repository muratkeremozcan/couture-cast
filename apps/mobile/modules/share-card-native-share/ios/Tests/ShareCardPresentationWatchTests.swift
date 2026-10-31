import XCTest
@testable import ShareCardShareCore

/// V2: a refused presentation settles the attempt once, released controller included, and a sheet
/// that appears late is taken down without a second settlement.
final class ShareCardPresentationWatchTests: XCTestCase {
  let refused = ShareCardShareResult.failed(.presenterUnavailable)
  let completed = ShareCardShareResult(target: .other, outcome: .completed, code: nil)

  func testMissedDeadlineSettlesOnceWhetherTheControllerIsReleasedOrOffScreen() throws {
    for sheet in [ShareCardSheetState.released, .offScreen] {
      let gate = ShareCardShareGate()
      let watch = ShareCardPresentationWatch()
      let attempt = try XCTUnwrap(gate.begin())
      XCTAssertTrue(watch.deadlinePassed(sheet), "\(sheet) is refused")
      XCTAssertEqual(gate.settle(attempt, refused), refused)
      XCTAssertFalse(watch.deadlinePassed(sheet), "\(sheet) settles once")
      XCTAssertFalse(gate.isActive, "\(sheet) releases the share lock")
    }
  }

  func testLateSheetIsTakenDownAndDoesNotSettleTwice() throws {
    let gate = ShareCardShareGate()
    let watch = ShareCardPresentationWatch()
    let attempt = try XCTUnwrap(gate.begin())
    XCTAssertTrue(watch.deadlinePassed(.released))
    XCTAssertEqual(gate.settle(attempt, refused), refused)
    XCTAssertTrue(watch.sheetAppeared(), "a sheet that appears after the refusal is dismissed")
    XCTAssertFalse(watch.deadlinePassed(.onScreen))
    XCTAssertNil(gate.settle(attempt, completed), "its completion does not settle again")
  }

  func testSheetOnScreenOrAlreadyPresentedIsNotRefused() {
    let presenting = ShareCardPresentationWatch()
    XCTAssertFalse(presenting.deadlinePassed(.onScreen), "a sheet still being presented waits")
    XCTAssertFalse(presenting.sheetAppeared())
    for sheet in [ShareCardSheetState.released, .offScreen, .onScreen] {
      let watch = ShareCardPresentationWatch()
      XCTAssertFalse(watch.sheetAppeared(), "a sheet in time is kept")
      XCTAssertFalse(watch.deadlinePassed(sheet), "an appeared sheet is never refused: \(sheet)")
    }
  }
}
