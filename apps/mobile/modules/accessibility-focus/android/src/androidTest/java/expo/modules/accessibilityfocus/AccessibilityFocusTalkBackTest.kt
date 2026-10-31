// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
package expo.modules.accessibilityfocus

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Collections
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The module against real TalkBack on a device: real views, the module's
 * ACTION_ACCESSIBILITY_FOCUS, the TYPE_VIEW_ACCESSIBILITY_FOCUSED report through
 * the decor view, delegate chaining, the API 29 gate and attach/detach without an
 * Activity. TalkBack must be on: scripts/ci/android-talkback.sh enable.
 *
 * With the instrumentation argument suppressFocus=true the focus action is skipped
 * and nothing else changes; the focus cases must then fail, which shows they
 * observe the OS rather than the module's own bookkeeping.
 */
@RunWith(AndroidJUnit4::class)
class AccessibilityFocusTalkBackTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context: Context = instrumentation.targetContext
  private val suppressFocus =
    InstrumentationRegistry.getArguments().getString("suppressFocus") == "true"
  private val reports = Collections.synchronizedList(mutableListOf<List<Int>>())
  private var scenario: ActivityScenario<FocusTestActivity>? = null

  @Before
  fun talkBackIsOn() {
    val manager = context.getSystemService(AccessibilityManager::class.java)
    assertTrue(
      "TalkBack must be running with touch exploration (scripts/ci/android-talkback.sh enable)",
      manager.isEnabled && manager.isTouchExplorationEnabled,
    )
  }

  @After
  fun close() {
    scenario?.close()
  }

  private fun observer(sdkInt: Int = Build.VERSION.SDK_INT) =
    AccessibilityFocusObserver(
      emit = { reports += it },
      sdkInt = sdkInt,
      mainHandler = Handler(Looper.getMainLooper()),
    )

  private fun launch(): View {
    val launched = ActivityScenario.launch(FocusTestActivity::class.java)
    scenario = launched
    lateinit var decor: View
    launched.onActivity { decor = it.window.decorView }
    instrumentation.waitForIdleSync()
    return decor
  }

  /** The module's focus action, skipped under the suppressed-focus control. */
  private fun AccessibilityFocusObserver.move(decor: View, tag: Int): Boolean {
    var moved = false
    instrumentation.runOnMainSync { moved = suppressFocus || moveFocus(decor, tag) }
    return moved
  }

  private fun awaitReport(tag: Int, timeoutMs: Long = 5_000): Boolean {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      instrumentation.waitForIdleSync()
      if (synchronized(reports) { reports.any { it.firstOrNull() == tag } }) return true
      Thread.sleep(50)
    }
    return false
  }

  private fun idle() = instrumentation.waitForIdleSync()

  @Test
  fun movesTalkBackFocusToTheViewAndReportsItWithItsAncestors() {
    val decor = launch()
    val focus = observer()
    focus.start { decor }
    idle()

    assertTrue("the focus action was taken", focus.move(decor, FocusTestActivity.SECOND))
    assertTrue("the OS reported focus on the view", awaitReport(FocusTestActivity.SECOND))
    val report = synchronized(reports) { reports.last { it.firstOrNull() == FocusTestActivity.SECOND } }
    assertTrue(report.contains(FocusTestActivity.ROOT))
    var focused = false
    instrumentation.runOnMainSync {
      focused = decor.findViewById<View>(FocusTestActivity.SECOND).isAccessibilityFocused
    }
    assertTrue("TalkBack holds the view", focused)
    focus.stop()
    idle()
  }

  @Test
  fun aViewTalkBackAlreadyHoldsCountsAsMovedAndIsReportedAgain() {
    val decor = launch()
    val focus = observer()
    focus.start { decor }
    idle()
    assertTrue("the focus action was taken", focus.move(decor, FocusTestActivity.SECOND))
    assertTrue("the OS reported focus on the view", awaitReport(FocusTestActivity.SECOND))
    reports.clear()

    // TalkBack takes no action on a view it already holds and sends no event.
    assertTrue(
      "a view TalkBack already holds counts as moved",
      focus.move(decor, FocusTestActivity.SECOND),
    )
    assertTrue("the held focus is reported again", awaitReport(FocusTestActivity.SECOND))
    focus.stop()
    idle()
  }

  @Test
  fun chainsToTheDelegateTheWindowAlreadyHadAndRestoresIt() {
    val decor = launch()
    val events = Collections.synchronizedList(mutableListOf<Int>())
    val existing =
      object : View.AccessibilityDelegate() {
        override fun onRequestSendAccessibilityEvent(
          host: ViewGroup,
          child: View,
          event: AccessibilityEvent,
        ): Boolean {
          events += event.eventType
          return super.onRequestSendAccessibilityEvent(host, child, event)
        }
      }
    instrumentation.runOnMainSync { decor.accessibilityDelegate = existing }
    val focus = observer()
    focus.start { decor }
    idle()
    // Wherever TalkBack put its cursor when the window appeared, it is on the
    // first view now, and nothing recorded so far counts.
    assertTrue("the focus action was taken", focus.move(decor, FocusTestActivity.FIRST))
    assertTrue("the OS reported focus on the first view", awaitReport(FocusTestActivity.FIRST))
    var onFirst = false
    instrumentation.runOnMainSync {
      onFirst = decor.findViewById<View>(FocusTestActivity.FIRST).isAccessibilityFocused
    }
    assertTrue("TalkBack holds the first view", onFirst)
    reports.clear()
    events.clear()

    assertTrue("the focus action was taken", focus.move(decor, FocusTestActivity.SECOND))
    assertTrue("the OS reported focus on the view", awaitReport(FocusTestActivity.SECOND))
    assertTrue(
      "the window's own delegate still saw the event",
      events.contains(AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED),
    )
    focus.stop()
    idle()
    var restored: View.AccessibilityDelegate? = null
    instrumentation.runOnMainSync { restored = decor.accessibilityDelegate }
    assertSame(existing, restored)
  }

  @Test
  fun belowApi29ItInstallsNothingAndReportsNothing() {
    val decor = launch()
    var before: View.AccessibilityDelegate? = null
    instrumentation.runOnMainSync { before = decor.accessibilityDelegate }
    val focus = observer(sdkInt = 28)
    focus.start { decor }
    idle()

    focus.move(decor, FocusTestActivity.SECOND)
    assertTrue("no report without a delegate", !awaitReport(FocusTestActivity.SECOND, 1_500))
    var after: View.AccessibilityDelegate? = null
    instrumentation.runOnMainSync { after = decor.accessibilityDelegate }
    assertSame(before, after)
    focus.stop()
  }

  @Test
  fun startsBeforeAnyActivityAndAttachesWhenOneAppears() {
    var current: View? = null
    val focus = observer()
    focus.start { current }
    idle()
    assertEquals(null, focus.attachedDecor)

    val decor = launch()
    current = decor
    focus.windowAvailable()
    idle()
    assertSame(decor, focus.attachedDecor)

    assertTrue("the focus action was taken", focus.move(decor, FocusTestActivity.SECOND))
    assertTrue("the OS reported focus on the view", awaitReport(FocusTestActivity.SECOND))
    focus.windowDestroyed()
    idle()
    assertEquals(null, focus.attachedDecor)
    focus.stop()
  }
}
