package expo.modules.accessibilityfocus

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeProvider
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AccessibilityFocusObserverTest {
  private lateinit var context: Context
  private val reports = mutableListOf<List<Int>>()

  /** A view whose accessibility focus a test sets, as TalkBack would. */
  private class FocusableView(context: Context) : View(context) {
    var focused = false

    override fun isAccessibilityFocused(): Boolean = focused
  }

  /** Records every call, so forwarding can be checked method by method. */
  private class RecordingDelegate : View.AccessibilityDelegate() {
    val calls = mutableListOf<String>()

    override fun sendAccessibilityEvent(host: View, eventType: Int) {
      calls += "sendAccessibilityEvent"
    }

    override fun sendAccessibilityEventUnchecked(host: View, event: AccessibilityEvent) {
      calls += "sendAccessibilityEventUnchecked"
    }

    override fun dispatchPopulateAccessibilityEvent(host: View, event: AccessibilityEvent): Boolean {
      calls += "dispatchPopulateAccessibilityEvent"
      return true
    }

    override fun onPopulateAccessibilityEvent(host: View, event: AccessibilityEvent) {
      calls += "onPopulateAccessibilityEvent"
    }

    override fun onInitializeAccessibilityEvent(host: View, event: AccessibilityEvent) {
      calls += "onInitializeAccessibilityEvent"
    }

    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
      calls += "onInitializeAccessibilityNodeInfo"
    }

    override fun addExtraDataToAccessibilityNodeInfo(
      host: View,
      info: AccessibilityNodeInfo,
      extraDataKey: String,
      arguments: Bundle?,
    ) {
      calls += "addExtraDataToAccessibilityNodeInfo"
    }

    override fun onRequestSendAccessibilityEvent(
      host: ViewGroup,
      child: View,
      event: AccessibilityEvent,
    ): Boolean {
      calls += "onRequestSendAccessibilityEvent"
      return false
    }

    override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
      calls += "performAccessibilityAction"
      return true
    }

    override fun getAccessibilityNodeProvider(host: View): AccessibilityNodeProvider? {
      calls += "getAccessibilityNodeProvider"
      return null
    }
  }

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    reports.clear()
  }

  private fun idle() = shadowOf(Looper.getMainLooper()).idle()

  private fun observer(sdkInt: Int = 34) =
    AccessibilityFocusObserver(
      emit = { reports += it },
      sdkInt = sdkInt,
      mainHandler = Handler(Looper.getMainLooper()),
    )

  private fun decor(): FrameLayout = FrameLayout(context).apply { id = 1 }

  private fun focusEvent(type: Int = AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED) =
    AccessibilityEvent.obtain(type)

  @Test
  fun forwardsEveryDelegateMethodToTheDelegateItFound() {
    val window = decor()
    val existing = RecordingDelegate()
    window.accessibilityDelegate = existing
    val focus = observer()
    focus.start { window }
    idle()

    val installed = window.accessibilityDelegate!!
    val child = View(context)
    val info = AccessibilityNodeInfo.obtain()
    installed.sendAccessibilityEvent(window, AccessibilityEvent.TYPE_VIEW_CLICKED)
    installed.sendAccessibilityEventUnchecked(window, focusEvent())
    assertTrue(installed.dispatchPopulateAccessibilityEvent(window, focusEvent()))
    installed.onPopulateAccessibilityEvent(window, focusEvent())
    installed.onInitializeAccessibilityEvent(window, focusEvent())
    installed.onInitializeAccessibilityNodeInfo(window, info)
    installed.addExtraDataToAccessibilityNodeInfo(window, info, "key", null)
    assertFalse(installed.onRequestSendAccessibilityEvent(window, child, focusEvent()))
    assertTrue(installed.performAccessibilityAction(window, 1, null))
    assertNull(installed.getAccessibilityNodeProvider(window))

    assertEquals(
      listOf(
        "sendAccessibilityEvent",
        "sendAccessibilityEventUnchecked",
        "dispatchPopulateAccessibilityEvent",
        "onPopulateAccessibilityEvent",
        "onInitializeAccessibilityEvent",
        "onInitializeAccessibilityNodeInfo",
        "addExtraDataToAccessibilityNodeInfo",
        "onRequestSendAccessibilityEvent",
        "performAccessibilityAction",
        "getAccessibilityNodeProvider",
      ),
      existing.calls,
    )
  }

  @Test
  fun reportsTheFocusedViewAndItsAncestorsOnFocusAndClear() {
    val window = decor()
    val row = FrameLayout(context).apply { id = 20 }
    val link = FocusableView(context).apply { id = 30 }
    row.addView(link)
    window.addView(row)
    val focus = observer()
    focus.start { window }
    idle()

    link.focused = true
    window.accessibilityDelegate!!.onRequestSendAccessibilityEvent(window, row, focusEvent())
    link.focused = false
    window.accessibilityDelegate!!.onRequestSendAccessibilityEvent(
      window,
      row,
      focusEvent(AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED),
    )
    window.accessibilityDelegate!!.onRequestSendAccessibilityEvent(
      window,
      row,
      focusEvent(AccessibilityEvent.TYPE_VIEW_CLICKED),
    )

    assertEquals(listOf(listOf(30, 20, 1), emptyList()), reports)
  }

  @Test
  fun restoresTheDelegateItFoundOnStop() {
    val window = decor()
    val existing = RecordingDelegate()
    window.accessibilityDelegate = existing
    val focus = observer()
    focus.start { window }
    idle()
    assertTrue(window.accessibilityDelegate !== existing)

    focus.stop()
    idle()
    assertSame(existing, window.accessibilityDelegate)
    assertNull(focus.attachedDecor)
  }

  @Test
  fun leavesADelegateSomeoneElseInstalledLaterInPlace() {
    val window = decor()
    val focus = observer()
    focus.start { window }
    idle()
    val later = RecordingDelegate()
    window.accessibilityDelegate = later

    focus.stop()
    idle()
    assertSame(later, window.accessibilityDelegate)
  }

  @Test
  fun neverTouchesTheDelegateBeforeApi29() {
    val window = decor()
    val existing = RecordingDelegate()
    window.accessibilityDelegate = existing
    val focus = observer(sdkInt = 28)
    assertFalse(focus.canObserve)
    focus.start { window }
    idle()

    assertSame(existing, window.accessibilityDelegate)
    assertNull(focus.attachedDecor)
  }

  @Test
  fun startsWithoutAnActivityAndAttachesWhenOneAppears() {
    val window = decor()
    var current: View? = null
    val focus = observer()
    focus.start { current }
    idle()
    assertNull(focus.attachedDecor)

    current = window
    focus.windowAvailable()
    idle()
    assertSame(window, focus.attachedDecor)
    assertTrue(window.accessibilityDelegate is AccessibilityFocusObserver.ForwardingDelegate)
  }

  @Test
  fun letsGoOfADestroyedWindowAndAttachesToTheNextOne() {
    val first = decor()
    val second = decor()
    var current: View? = first
    val focus = observer()
    focus.start { current }
    idle()

    focus.windowDestroyed()
    idle()
    assertNull(focus.attachedDecor)
    assertNull(first.accessibilityDelegate)

    current = second
    focus.windowAvailable()
    idle()
    assertSame(second, focus.attachedDecor)
  }

  @Test
  fun aWindowThatAppearsAfterStopIsNotObserved() {
    val window = decor()
    var current: View? = null
    val focus = observer()
    focus.start { current }
    focus.stop()
    idle()

    current = window
    focus.windowAvailable()
    idle()
    assertNull(focus.attachedDecor)
    assertNull(window.accessibilityDelegate)
  }

  @Test
  fun attachesOnlyOnTheMainLooper() {
    val window = decor()
    val focus = observer()
    focus.start { window }
    // Nothing runs until the main looper does.
    assertNull(focus.attachedDecor)
    idle()
    assertSame(window, focus.attachedDecor)
  }
}
