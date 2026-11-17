// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
package expo.modules.accessibilityfocus

import expo.modules.accessibilityfocus.InitialFocusPlacement.Outcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.PriorityQueue

/**
 * A dialog window on a virtual clock. TalkBack puts its own focus on the window's first view
 * some time after the window gains focus, overwriting any focus placed before it. Main run
 * 44076358778 lost that race on Android 36: the reopened composer moved TalkBack to Cancel once,
 * TalkBack's initial placement then took the title, and "Old save focuses its Cancel recovery
 * control" timed out. [InitialFocusPlacement] moves focus only after that placement.
 */
class InitialFocusPlacementTest {
  private class FakeWindow(
    /** When the React view exists in the dialog. */
    private val presentAt: Long = 0,
    /** When the dialog window gains window focus. */
    private val windowFocusAt: Long = 0,
    /** When TalkBack places its initial focus on FIRST, or never. */
    talkBackLandsAt: Long? = 120,
    /** A second TalkBack move to THIRD, after the first placement. */
    talkBackMovesAgainAt: Long? = null,
    /** Whether the root reports TalkBack's focus events (API 29+ delegate); else polling only. */
    private val reportsEvents: Boolean = true,
    private val screenReaderOn: Boolean = true,
  ) : InitialFocusPlacement.Target {
    var time = 0L
    private var sequence = 0L
    private val queue = PriorityQueue<Triple<Long, Long, () -> Unit>>(
      compareBy<Triple<Long, Long, () -> Unit>> { it.first }.thenBy { it.second },
    )
    private var holder: Int? = null
    val moves = mutableListOf<Long>()
    val outcomes = mutableListOf<Pair<Outcome, Long>>()
    var placement: InitialFocusPlacement? = null

    val scheduler = object : InitialFocusPlacement.Scheduler {
      override fun now() = time
      override fun post(delayMs: Long, task: () -> Unit) {
        queue += Triple(time + delayMs, sequence++, task)
      }
    }

    init {
      talkBackLandsAt?.let { at -> queue += Triple(at, sequence++, { talkBackFocuses(FIRST) }) }
      talkBackMovesAgainAt?.let { at -> queue += Triple(at, sequence++, { talkBackFocuses(THIRD) }) }
    }

    private fun talkBackFocuses(view: Int) {
      holder = view
      if (reportsEvents) placement?.initialFocusObserved()
    }

    /** The view TalkBack focus is on now. */
    fun focusedView(): Int? = holder

    /** Today's `focus`: one ACTION_ACCESSIBILITY_FOCUS, as soon as the view exists. */
    fun moveOnce() {
      holder = SECOND
    }

    fun start(): InitialFocusPlacement =
      InitialFocusPlacement(this, scheduler) { outcomes += it to time }.also {
        placement = it
        it.start()
      }

    /** Runs every task and TalkBack event due up to [until] in time order. */
    fun runUntil(until: Long) {
      while (queue.isNotEmpty() && queue.peek()!!.first <= until) {
        val (at, _, task) = queue.poll()!!
        time = at
        task()
      }
      time = until
    }

    override fun screenReaderOn() = screenReaderOn
    override fun present() = time >= presentAt
    override fun windowFocused() = present() && time >= windowFocusAt
    override fun initialFocusPlaced() = holder != null
    override fun focused() = holder == SECOND
    override fun move(): Boolean {
      if (!present()) return false
      moves += time
      holder = SECOND
      // The move's own focus event reaches the root delegate synchronously, as on a device.
      if (reportsEvents) placement?.initialFocusObserved()
      return true
    }
  }

  @Test
  fun todaysSingleShotMoveEndsOnTalkBacksInitialPlacement() {
    val window = FakeWindow(talkBackLandsAt = 120)
    window.moveOnce()
    assertEquals(SECOND, window.focusedView())
    window.runUntil(5_000)
    assertEquals("TalkBack's initial placement took the view back", FIRST, window.focusedView())
  }

  @Test
  fun theMoveWaitsForTalkBacksInitialPlacementAndHoldsTheTarget() {
    val window = FakeWindow(talkBackLandsAt = 120)
    window.start()
    window.runUntil(5_120)
    assertEquals(SECOND, window.focusedView())
    assertEquals(listOf(120L), window.moves)
    assertEquals(listOf(Outcome.FOCUSED to 120L + InitialFocusPlacement.POLL_MS), window.outcomes)
  }

  @Test
  fun aViewNotYetInTheDialogAndAWindowWithoutFocusAreWaitedFor() {
    val window = FakeWindow(presentAt = 300, windowFocusAt = 400, talkBackLandsAt = 650)
    window.start()
    window.runUntil(650 + 5_000)
    assertEquals(SECOND, window.focusedView())
    assertEquals("no move before TalkBack placed its own", listOf(650L), window.moves)
    assertEquals(listOf(Outcome.FOCUSED to 650L + InitialFocusPlacement.POLL_MS), window.outcomes)
  }

  @Test
  fun withoutFocusEventsPollingStillSeesThePlacement() {
    // Below API 29 no delegate is installed; the placement is read from the views.
    val window = FakeWindow(talkBackLandsAt = 120, reportsEvents = false)
    window.start()
    window.runUntil(5_120)
    assertEquals(SECOND, window.focusedView())
    assertEquals(listOf(150L), window.moves)
    assertEquals(listOf(Outcome.FOCUSED to 200L), window.outcomes)
  }

  @Test
  fun aPlacementMadeBeforeTheRequestCountsAndTheMoveIsImmediate() {
    val window = FakeWindow(talkBackLandsAt = 120)
    window.runUntil(500)
    window.start()
    window.runUntil(5_500)
    assertEquals(SECOND, window.focusedView())
    assertEquals(listOf(500L), window.moves)
    assertEquals(listOf(Outcome.FOCUSED to 550L), window.outcomes)
  }

  @Test
  fun aSecondTalkBackMoveIsAnsweredAndTheTargetHeldBeforeItResolves() {
    val window = FakeWindow(talkBackLandsAt = 120, talkBackMovesAgainAt = 140)
    window.start()
    window.runUntil(5_140)
    assertEquals(SECOND, window.focusedView())
    // The hold check at 170 finds THIRD, moves again, and resolves once a later read holds.
    assertEquals(listOf(120L, 170L), window.moves)
    assertEquals(listOf(Outcome.FOCUSED to 220L), window.outcomes)
  }

  @Test
  fun aMoveFirstHeldAtTheBoundHasNoLaterReadAndIsNotReportedHeld() {
    // CodeRabbit on PR 253: TalkBack places its focus at the bound, the move lands in that same
    // check, and TalkBack moves again 1 ms later. No later read can confirm the hold.
    val bound = InitialFocusPlacement.BOUND_MS
    val window = FakeWindow(talkBackLandsAt = bound, talkBackMovesAgainAt = bound + 1)
    window.start()
    window.runUntil(10_000)
    assertEquals(listOf(bound), window.moves)
    assertEquals(listOf(Outcome.NOT_HELD to bound), window.outcomes)
    assertEquals(THIRD, window.focusedView())
  }

  @Test
  fun aMoveJustBeforeTheBoundIsConfirmedByTheCheckAtTheBound() {
    val bound = InitialFocusPlacement.BOUND_MS
    val window = FakeWindow(talkBackLandsAt = bound - 1)
    window.start()
    window.runUntil(10_000)
    assertEquals(listOf(bound - 1), window.moves)
    assertEquals(listOf(Outcome.FOCUSED to bound), window.outcomes)
    assertEquals(SECOND, window.focusedView())
  }

  @Test
  fun aWindowTalkBackNeverFocusesFailsWithinTheBoundWithoutMoving() {
    val window = FakeWindow(talkBackLandsAt = null)
    window.start()
    window.runUntil(10_000)
    assertEquals(
      listOf(Outcome.NO_INITIAL_PLACEMENT to InitialFocusPlacement.BOUND_MS),
      window.outcomes,
    )
    assertEquals(emptyList<Long>(), window.moves)
    assertNull(window.focusedView())
    assertTrue(
      "the product bound sits inside the device test's focus wait",
      InitialFocusPlacement.BOUND_MS < TreeSettling.FOCUS_BOUND_MS,
    )
  }

  @Test
  fun eachStageThatNeverCompletesIsNamedAtTheBound() {
    val absent = FakeWindow(presentAt = Long.MAX_VALUE)
    absent.start()
    absent.runUntil(10_000)
    assertEquals(listOf(Outcome.NO_TARGET to InitialFocusPlacement.BOUND_MS), absent.outcomes)
    val unfocused = FakeWindow(windowFocusAt = Long.MAX_VALUE, talkBackLandsAt = null)
    unfocused.start()
    unfocused.runUntil(10_000)
    assertEquals(listOf(Outcome.NO_WINDOW_FOCUS to InitialFocusPlacement.BOUND_MS), unfocused.outcomes)
  }

  @Test
  fun withoutAScreenReaderItResolvesAtOnceAndNeverMoves() {
    val window = FakeWindow(screenReaderOn = false)
    window.start()
    window.runUntil(10_000)
    assertEquals(listOf(Outcome.NO_SCREEN_READER to 0L), window.outcomes)
    assertEquals(emptyList<Long>(), window.moves)
  }

  @Test
  fun aCancelledPlacementResolvesOnceAndNeverMovesLater() {
    val window = FakeWindow(talkBackLandsAt = 120)
    val placement = window.start()
    window.runUntil(60)
    placement.cancel()
    placement.cancel()
    window.runUntil(10_000)
    assertEquals(listOf(Outcome.SUPERSEDED to 60L), window.outcomes)
    assertEquals(emptyList<Long>(), window.moves)
    assertEquals(FIRST, window.focusedView())
  }

  private companion object {
    const val FIRST = 101
    const val SECOND = 102
    const val THIRD = 103
  }
}
