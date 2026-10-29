package expo.modules.accessibilityfocus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * A fake composer tree on a virtual clock: the title gains TalkBack focus at once and the
 * remaining nodes attach later, as they do on a fast host. The old one-shot snapshot reads
 * the tree at the instant of title focus; the waits read it until it is complete and still.
 */
class TreeSettlingTest {
  private val expectedOrder = listOf("share-card-title", "share-card-watermark", "share-card-save", "share-card-cancel")

  private class FakeComposerTree {
    var time = 0L
    val clock = TreeSettling.Clock({ time }, { time += it })
    /** Node id to the virtual time it attaches; the title is there when it takes focus. */
    private val attachesAt = linkedMapOf(
      "share-card-title" to 0L,
      "share-card-watermark" to 300L,
      "share-card-save" to 500L,
      "share-card-cancel" to 700L,
    )

    fun ids(): List<String> = attachesAt.filterValues { it <= time }.keys.toList()
    fun signature(): String = ids().joinToString("|") { "$it@${it.length}" }
    val titleFocused: Boolean get() = "share-card-title" in ids()
  }

  /** The assertion shape the test used before: read once, right after the title focus wait. */
  private fun oldOneShotOrder(ids: List<String>) =
    ids.indexOf("share-card-title") < ids.indexOf("share-card-watermark") &&
      ids.indexOf("share-card-watermark") < ids.indexOf("share-card-save") &&
      ids.indexOf("share-card-save") < ids.indexOf("share-card-cancel")

  @Test
  fun oneShotSnapshotAfterTitleFocusFailsBecauseLaterNodesAreNotAttachedYet() {
    val tree = FakeComposerTree()
    TreeSettling.waitFor("TalkBack focus on modal title", tree.clock) { tree.titleFocused }
    assertFalse("the old snapshot saw a partial tree", oldOneShotOrder(tree.ids()))
    assertEquals(listOf("share-card-title"), tree.ids())
  }

  @Test
  fun namedWaitAndSettledBarrierPassOnTheSameTree() {
    val tree = FakeComposerTree()
    TreeSettling.waitFor("TalkBack focus on modal title", tree.clock) { tree.titleFocused }
    TreeSettling.settled("Composer tree settles", tree.clock) { tree.signature() }
    assertTrue(TreeSettling.orderHolds(tree.ids(), expectedOrder))
    TreeSettling.waitFor("Traversal order", tree.clock) { TreeSettling.orderHolds(tree.ids(), expectedOrder) }
    assertTrue("settling waited past the last attach", tree.time >= 700L)
  }

  @Test
  fun orderWaitAloneAlsoConvergesWithoutTheBarrier() {
    val tree = FakeComposerTree()
    TreeSettling.waitFor("Traversal order", tree.clock) { TreeSettling.orderHolds(tree.ids(), expectedOrder) }
    assertTrue(tree.time in 500L..900L)
  }

  @Test
  fun settledResetsWhileTheTreeChangesAndNeedsEqualSamples() {
    val tree = FakeComposerTree()
    var samples = 0
    val signature = TreeSettling.settled("Composer tree settles", tree.clock, samples = 3, intervalMs = 200) {
      samples++
      tree.signature()
    }
    assertEquals(tree.signature(), signature)
    // 700 ms of attaching at 200 ms intervals, then 2 more equal samples.
    assertTrue(samples >= 6)
    assertEquals(4, tree.ids().size)
  }

  @Test
  fun aTreeThatNeverSettlesFailsWithTheNamedMessage() {
    var time = 0L
    val clock = TreeSettling.Clock({ time }, { time += it })
    var n = 0
    try {
      TreeSettling.settled("Composer tree settles", clock, timeoutMs = 1_000) { (n++).toString() }
      fail("expected a timeout")
    } catch (error: AssertionError) {
      assertTrue(error.message!!.startsWith("Composer tree settles"))
    }
  }

  @Test
  fun waitForFailsWithItsMessageAndTheDiagnosticOnly() {
    var time = 0L
    val clock = TreeSettling.Clock({ time }, { time += it })
    try {
      TreeSettling.waitFor("Saved status", clock, timeoutMs = 500, diagnostic = { "id:text" }) { false }
      fail("expected a timeout")
    } catch (error: AssertionError) {
      assertEquals("Saved status: id:text", error.message)
    }
  }

  @Test
  fun orderHoldsRequiresEveryIdInStrictOrder() {
    assertTrue(TreeSettling.orderHolds(listOf("a", "x", "b", "c"), listOf("a", "b", "c")))
    assertFalse(TreeSettling.orderHolds(listOf("a", "c"), listOf("a", "b", "c")))
    assertFalse(TreeSettling.orderHolds(listOf("b", "a"), listOf("a", "b")))
    assertFalse(TreeSettling.orderHolds(listOf("a", "a"), listOf("a", "a")))
    // A node that is not attached yet is -1, which sorts before everything: still a failure.
    assertFalse(TreeSettling.orderHolds(listOf("b"), listOf("a", "b")))
    assertFalse(TreeSettling.orderHolds(emptyList(), listOf("a", "b")))
  }

  /** TalkBack focus that returns after [delayMs] of virtual time. */
  private class FakeFocus(private val delayMs: Long) {
    var time = 0L
    val clock = TreeSettling.Clock({ time }, { time += it })
    val returned: Boolean get() = time >= delayMs
  }

  @Test
  fun focusReturnWithinFiveSecondsPassesAndSlowerOneFailsNamingTheBound() {
    val quick = FakeFocus(3_000)
    TreeSettling.waitForFocus("TalkBack focus on Save after saving", quick.clock) { quick.returned }
    val slow = FakeFocus(6_000)
    try {
      TreeSettling.waitForFocus("TalkBack focus on Save after saving", slow.clock, diagnostic = { "id:text" }) { slow.returned }
      fail("a 6 s focus return must not pass")
    } catch (error: AssertionError) {
      assertEquals("TalkBack focus on Save after saving within 5000 ms: id:text", error.message)
    }
  }

  @Test
  fun theDefaultWaitStillAllowsSlowNetworkBackedStates() {
    val saved = FakeFocus(6_000)
    TreeSettling.waitFor("Saved status", saved.clock) { saved.returned }
    assertEquals(5_000L, TreeSettling.FOCUS_BOUND_MS)
  }

  @Test
  fun focusWaitsRecordTheirElapsedTimeWhetherTheyPassOrTimeOut() {
    val recorded = mutableListOf<TreeSettling.FocusLatency>()
    val quick = FakeFocus(3_000)
    TreeSettling.waitForFocus("TalkBack restored to opener", quick.clock, record = { recorded += it }) { quick.returned }
    val slow = FakeFocus(9_000)
    try {
      TreeSettling.waitForFocus("TalkBack focus on Save after saving", slow.clock, record = { recorded += it }) { slow.returned }
      fail("expected a timeout")
    } catch (error: AssertionError) {
      assertTrue(error.message!!.contains("within 5000 ms"))
    }
    assertEquals(
      listOf(
        "CC68_FOCUS_LATENCY|TalkBack restored to opener|3000|ok",
        "CC68_FOCUS_LATENCY|TalkBack focus on Save after saving|5000|timeout",
      ),
      recorded.map { it.line() }
    )
  }

  /** A control on a virtual timeline: present until [leavesAt], clickable from [clickableAt]. */
  private class FakeControl(private val leavesAt: Long, private val clickableAt: Long) {
    var time = 0L
    var clicks = 0
    val clock = TreeSettling.Clock({ time }, { time += it })
    fun present() = time < leavesAt
    fun click(): Boolean {
      if (!present()) return false
      clicks++
      return time >= clickableAt
    }
  }

  @Test
  fun clickIfPresentIsDoneAtOnceWhenTheControlIsAlreadyGone() {
    val control = FakeControl(leavesAt = 0, clickableAt = 0)
    assertTrue(TreeSettling.clickIfPresent(control.clock, control::present, control::click))
    assertEquals(0, control.clicks)
    assertEquals(0L, control.time)
  }

  @Test
  fun aControlThatLeavesBetweenTheLookAndTheClickIsASuccessNotATwentySecondWait() {
    // Present at the look, gone before it can take a click: a blur or a deep link closed it.
    val control = FakeControl(leavesAt = 200, clickableAt = 10_000)
    assertTrue(TreeSettling.clickIfPresent(control.clock, control::present, control::click))
    assertTrue("done well inside the 5 s bound", control.time <= 300)
  }

  @Test
  fun aClickThatLandsEndsTheWaitAndAControlThatNeverLeavesNorClicksFailsAtTheBound() {
    val lands = FakeControl(leavesAt = Long.MAX_VALUE, clickableAt = 400)
    assertTrue(TreeSettling.clickIfPresent(lands.clock, lands::present, lands::click))
    assertEquals(400L, lands.time)
    val stuck = FakeControl(leavesAt = Long.MAX_VALUE, clickableAt = Long.MAX_VALUE)
    assertFalse(TreeSettling.clickIfPresent(stuck.clock, stuck::present, stuck::click))
    assertEquals(5_000L, stuck.time)
  }
}
