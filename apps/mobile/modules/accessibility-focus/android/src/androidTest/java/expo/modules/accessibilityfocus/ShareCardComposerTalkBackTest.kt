package expo.modules.accessibilityfocus

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.UiAutomation
import android.graphics.Rect
import android.os.SystemClock
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real TalkBack and the real signed-in Story68 app, separate from module fixture activities. */
@RunWith(AndroidJUnit4::class)
class ShareCardComposerTalkBackTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
  private val context = instrumentation.context

  private fun nodes(node: AccessibilityNodeInfo?): List<AccessibilityNodeInfo> {
    if (node == null) return emptyList()
    return listOf(node) + (0 until node.childCount).flatMap { nodes(node.getChild(it)) }
  }
  private fun all() = nodes(automation.rootInActiveWindow)
  private fun hasId(node: AccessibilityNodeInfo, id: String) = node.viewIdResourceName?.substringAfterLast('/') == id
  private fun find(id: String) = all().firstOrNull { hasId(it, id) }
  private fun waitFor(message: String, condition: () -> Boolean) {
    val until = SystemClock.uptimeMillis() + 20000
    while (SystemClock.uptimeMillis() < until) {
      if (condition()) return
      SystemClock.sleep(100)
    }
    fail(message + ": " + all().joinToString { "${it.viewIdResourceName}:${it.text}:${it.contentDescription}" })
  }
  private fun click(id: String) {
    waitFor("Missing $id") { find(id) != null }
    val node = find(id)!!
    node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
    assertTrue("Click $id", node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
  }
  private fun label(node: AccessibilityNodeInfo) = (node.contentDescription ?: node.text ?: "").toString()

  @Test
  fun actualTalkBackOpenSaveCancelTraversalAndFocus() {
    val manager = context.getSystemService(AccessibilityManager::class.java)
    assertTrue("Actual TalkBack touch exploration required", manager.isEnabled && manager.isTouchExplorationEnabled)
    val services = manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
    assertTrue("TalkBack service must be bound", services.any { it.id.contains("com.google.android.marvin.talkback") })
    waitFor("Story68 app active") { find("tab-home") != null || find("share-card-cancel") != null }
    if (find("share-card-cancel") != null) click("share-card-cancel")
    click("tab-home")
    waitFor("Outfit action") { find("outfit-share-card-open") != null }
    click("outfit-share-card-open")
    waitFor("Approved preview") { all().any { it.viewIdResourceName?.contains("share-card-preview-loaded-") == true } }
    waitFor("TalkBack focus on modal title") { find("share-card-title")?.isAccessibilityFocused == true }
    val order = all().mapNotNull { it.viewIdResourceName?.substringAfterLast('/') }
    assertTrue(order.indexOf("share-card-title") < order.indexOf("share-card-watermark"))
    assertTrue(order.indexOf("share-card-watermark") < order.indexOf("share-card-save"))
    assertTrue(order.indexOf("share-card-save") < order.indexOf("share-card-cancel"))
    for (id in listOf("share-card-title", "share-card-save", "share-card-cancel")) assertTrue("$id label", label(find(id)!!).isNotBlank())
    assertTrue(find("share-card-save")!!.isClickable)
    click("share-card-save")
    waitFor("Saved status") { all().any { label(it) == "Saved to photos" } }
    assertNotNull("Focus stays in active modal", automation.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY))
    click("share-card-cancel")
    waitFor("Title dismissed") { find("share-card-title") == null }
    waitFor("TalkBack restored to opener") { find("outfit-share-card-open")?.isAccessibilityFocused == true }
    val rect = Rect()
    find("outfit-share-card-open")!!.getBoundsInScreen(rect)
    assertFalse("Restored opener visible", rect.isEmpty)
  }
}
