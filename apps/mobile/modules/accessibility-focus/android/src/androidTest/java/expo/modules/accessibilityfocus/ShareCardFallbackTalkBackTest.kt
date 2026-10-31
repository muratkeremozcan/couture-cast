// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
package expo.modules.accessibilityfocus

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.UiAutomation
import android.app.Instrumentation
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** The runner removes only its declared owned post and revalidates through the real app. */
@RunWith(AndroidJUnit4::class)
class ShareCardFallbackTalkBackTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
  private fun nodes(node: AccessibilityNodeInfo?): List<AccessibilityNodeInfo> =
    if (node == null) emptyList() else listOf(node) + (0 until node.childCount).flatMap { nodes(node.getChild(it)) }
  private fun all() = nodes(automation.rootInActiveWindow)
  private fun id(node: AccessibilityNodeInfo) = node.viewIdResourceName?.substringAfterLast('/')
  private fun find(value: String) = all().firstOrNull { id(it) == value }
  private fun label(node: AccessibilityNodeInfo) = (node.contentDescription ?: node.text ?: "").toString()
  private fun waitFor(message: String, condition: () -> Boolean) {
    val deadline = SystemClock.uptimeMillis() + 20000
    while (SystemClock.uptimeMillis() < deadline) {
      if (condition()) return
      SystemClock.sleep(100)
    }
    fail(message)
  }

  @Test
  fun removedCommunityOpenerRestoresActualTalkBackCursorToExistingHeader() {
    val postId = InstrumentationRegistry.getArguments().getString("CC68_FALLBACK_POST_ID")!!
    require(Regex("cc68-native-[a-f0-9-]{36}").matches(postId))
    val manager = instrumentation.context.getSystemService(AccessibilityManager::class.java)
    assertTrue("Actual touch exploration required", manager.isEnabled && manager.isTouchExplorationEnabled)
    assertTrue("Actual TalkBack service required", manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any { it.id.contains("com.google.android.marvin.talkback") })
    waitFor("Composer remains open through real foreground revalidation") {
      find("share-card-title") != null && all().any { id(it)?.startsWith("share-card-preview-loaded-") == true }
    }
    assertEquals("Exact Cancel label", "Cancel", label(find("share-card-cancel")!!))
    find("share-card-cancel")!!.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
    waitFor("Cancel is visible") { find("share-card-cancel")?.isVisibleToUser == true }
    assertTrue("Dismiss the actual composer", find("share-card-cancel")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
    waitFor("Composer dismissed") { find("share-card-title") == null }
    waitFor("Removed post and its invoking action stay absent") {
      find("community-share-card-open-$postId") == null && find("community-card-author-$postId") == null
    }
    waitFor("Actual TalkBack cursor on the existing Community header") {
      all().any { label(it) == "Community" && it.isHeading && it.isAccessibilityFocused }
    }
    val headers = all().filter { label(it) == "Community" && it.isHeading }
    assertEquals("One existing Community header", 1, headers.size)
    assertTrue(headers.single().isAccessibilityFocused)
    assertTrue(headers.single().isVisibleToUser)
    val bounds = Rect()
    headers.single().getBoundsInScreen(bounds)
    assertFalse("Focused header is visible", bounds.isEmpty)
    assertFalse("Duplicate content heading absent", all().any { label(it) == "Living community lookbook" && it.isHeading })
    instrumentation.sendStatus(0, Bundle().apply {
      putString(Instrumentation.REPORT_KEY_STREAMRESULT, "\nCC68_FALLBACK_PASS android actual-talkback-community-header\n")
    })
  }
}
