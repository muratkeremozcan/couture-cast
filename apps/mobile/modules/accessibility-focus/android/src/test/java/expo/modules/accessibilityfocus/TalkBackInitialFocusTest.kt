package expo.modules.accessibilityfocus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * A fake window on a virtual clock: TalkBack puts its own focus on the first view some time after
 * the window appears, overwriting any focus the test placed earlier. Run 41208356725 lost that
 * race: the module moved focus to the second view, the OS reported it, and TalkBack's initial
 * focus then took the first view before "TalkBack holds the view" was read.
 */
class TalkBackInitialFocusTest {
  private class FakeWindow(
    private val talkBackLandsAt: Long?,
    private val talkBackMovesAgainAt: Long? = null,
  ) {
    var time = 0L
    val clock = TreeSettling.Clock({ time }, { time += it })
    private var placedByTest: Pair<Int, Long>? = null

    /** The view TalkBack focus is on now: the latest placement, TalkBack's own or the test's. */
    fun focused(): Int? {
      val talkBack = listOfNotNull(
        talkBackLandsAt?.takeIf { it <= time }?.let { FIRST to it },
        talkBackMovesAgainAt?.takeIf { it <= time }?.let { THIRD to it },
      ).maxByOrNull { it.second }
      return listOfNotNull(talkBack, placedByTest).maxByOrNull { it.second }?.first
    }

    fun move(view: Int) {
      placedByTest = view to time
    }

    fun advance(ms: Long) {
      time += ms
    }
  }

  @Test
  fun aFocusMoveBeforeTalkBackPlacesItsOwnIsOverwritten() {
    // The test before the gate: launch returned, focus moved at once, TalkBack landed 120 ms on.
    val window = FakeWindow(talkBackLandsAt = 120)
    window.move(SECOND)
    assertEquals(SECOND, window.focused())
    window.advance(200)
    assertEquals("TalkBack's initial focus took the view back", FIRST, window.focused())
  }

  @Test
  fun aFocusMoveAfterTheGateKeepsTheView() {
    val window = FakeWindow(talkBackLandsAt = 120)
    TreeSettling.initialFocusSettled("TalkBack placed its focus in the test window", window.clock) {
      window.focused()
    }
    assertEquals(FIRST, window.focused())
    window.move(SECOND)
    window.advance(5_000)
    assertEquals(SECOND, window.focused())
  }

  @Test
  fun theGateWaitsForASlowHostAndForTalkBackToStopMoving() {
    val window = FakeWindow(talkBackLandsAt = 1_800, talkBackMovesAgainAt = 1_900)
    TreeSettling.initialFocusSettled("TalkBack placed its focus in the test window", window.clock) {
      window.focused()
    }
    assertEquals(THIRD, window.focused())
    assertTrue("it read past TalkBack's second placement", window.time >= 2_100)
    window.move(SECOND)
    window.advance(5_000)
    assertEquals(SECOND, window.focused())
  }

  @Test
  fun aWindowTalkBackNeverFocusesFailsWithinTheFocusBound() {
    val window = FakeWindow(talkBackLandsAt = null)
    try {
      TreeSettling.initialFocusSettled("TalkBack placed its focus in the test window", window.clock) {
        window.focused()
      }
      fail("a window TalkBack never adopts must fail")
    } catch (error: AssertionError) {
      assertEquals(
        "TalkBack placed its focus in the test window within ${TreeSettling.FOCUS_BOUND_MS} ms: ",
        error.message,
      )
    }
    assertEquals(TreeSettling.FOCUS_BOUND_MS, window.time)
  }

  @Test
  fun focusThatNeverSettlesFailsInsideTheSameBound() {
    var time = 0L
    val clock = TreeSettling.Clock({ time }, { time += it })
    try {
      TreeSettling.initialFocusSettled("TalkBack placed its focus in the test window", clock) {
        if (time / 100 % 2 == 0L) FIRST else SECOND
      }
      fail("focus that keeps moving must fail")
    } catch (error: AssertionError) {
      assertEquals(
        "TalkBack placed its focus in the test window: " +
          "TalkBack kept moving its focus: tree kept changing",
        error.message,
      )
    }
    assertNotEquals(0L, time)
    assertTrue("the whole gate stays inside the focus bound", time <= TreeSettling.FOCUS_BOUND_MS)
  }

  private companion object {
    const val FIRST = 101
    const val SECOND = 102
    const val THIRD = 103
  }
}
