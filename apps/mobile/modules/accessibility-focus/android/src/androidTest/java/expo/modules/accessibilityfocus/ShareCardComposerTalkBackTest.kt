// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
package expo.modules.accessibilityfocus

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Instrumentation
import android.app.UiAutomation
import android.graphics.Rect
import android.os.SystemClock
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
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
  private val clock = TreeSettling.Clock({ SystemClock.uptimeMillis() }, { SystemClock.sleep(it) })
  private fun dump() = all().joinToString { "${it.viewIdResourceName}:${it.text}:${it.contentDescription}" }
  private fun waitFor(message: String, condition: () -> Boolean) =
    TreeSettling.waitFor(message, clock, diagnostic = ::dump, condition = condition)
  /** Focus returns and jumps are felt by a TalkBack user: 5 s, and the failure names the bound. */
  private val focusLatencies = mutableListOf<TreeSettling.FocusLatency>()
  private fun waitForFocus(message: String, condition: () -> Boolean) =
    TreeSettling.waitForFocus(message, clock, diagnostic = ::dump, record = { focusLatencies += it }, condition = condition)

  /** Pass or fail, the harness gets every focus wait's latency as closed lines. */
  @After
  fun reportFocusLatencies() {
    if (focusLatencies.isEmpty()) return
    instrumentation.sendStatus(0, Bundle().apply {
      putString(Instrumentation.REPORT_KEY_STREAMRESULT, focusLatencies.joinToString("\n", "\n", "\n") { it.line() })
    })
    focusLatencies.clear()
  }
  /** Id plus bounds of every node: it stops changing once the composer tree is complete. */
  private fun signature(): String = all().joinToString("|") {
    val bounds = Rect()
    it.getBoundsInScreen(bounds)
    "${it.viewIdResourceName}@${bounds.flattenToString()}"
  }
  private fun settledTree(message: String) = TreeSettling.settled(message, clock, signature = ::signature)
  private fun tryClick(id: String): Boolean {
    val node = find(id) ?: return false
    node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
    return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
  }
  private fun click(id: String) {
    waitFor("Click $id") { tryClick(id) }
  }
  /**
   * Leaves the composer if it is open. A deep link or screen blur can close it between the look
   * and the click, so a Cancel that is gone by then is the wanted outcome, never a 20 s wait.
   */
  private fun closeComposerIfOpen() {
    val closed = TreeSettling.clickIfPresent(
      clock,
      present = { find("share-card-cancel") != null },
      click = { tryClick("share-card-cancel") },
    )
    assertTrue("The composer's Cancel stayed present and unclickable: ${dump()}", closed)
  }
  private fun label(node: AccessibilityNodeInfo) = (node.contentDescription ?: node.text ?: "").toString()

  private fun shell(command: String): String = ParcelFileDescriptor.AutoCloseInputStream(
    automation.executeShellCommand(command)
  ).use { String(it.readBytes()) }

  private fun fixture(mode: String) {
    require(mode in listOf("real", "deferred", "release"))
    // Runtime.exec treats shell quotes as literal URI characters.
    val result = shell("am start -W -a android.intent.action.VIEW -d couturecast-story68://__story68__/share-card?mode=$mode com.couturecast.story68")
    assertTrue("Fixture $mode must reach the Story68 activity: $result", result.lineSequence().any { it.trim() == "Status: ok" })
  }

  private fun cacheFiles(): Set<String> = shell(
    "run-as com.couturecast.story68 find cache/share-cards -name cc68-*.png"
  ).lineSequence().filter { Regex("cache/share-cards/cc68-[a-f0-9-]+\\.png").matches(it) }.toSet()

  private fun assertCacheEnumeration() {
    val probe = "cache/share-cards/cc68-${java.util.UUID.randomUUID()}.png"
    shell("run-as com.couturecast.story68 mkdir -p cache/share-cards")
    shell("run-as com.couturecast.story68 touch $probe")
    try {
      assertTrue("Owned sentinel must be returned by the native cache query", probe in cacheFiles())
    } finally {
      shell("run-as com.couturecast.story68 rm $probe")
    }
  }

  private fun assertHeader(title: String, removedContentHeading: String) {
    waitFor("Existing $title header") { all().any { label(it) == title && it.isHeading } }
    assertEquals("Exactly one existing $title header", 1, all().count { label(it) == title && it.isHeading })
    assertFalse("No duplicate content heading", all().any { label(it) == removedContentHeading && it.isHeading })
  }

  /** TalkBack is bound, touch exploration is on and a window is active before any fixture opens. */
  private fun awaitTalkBackReady() {
    val manager = context.getSystemService(AccessibilityManager::class.java)
    waitFor("Actual TalkBack touch exploration required") { manager.isEnabled && manager.isTouchExplorationEnabled }
    waitFor("TalkBack service must be bound") {
      manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
        .any { it.id.contains("com.google.android.marvin.talkback") }
    }
    waitFor("Active window available") { automation.rootInActiveWindow != null }
  }

  @Test
  fun actualTalkBackOpenSaveCancelTraversalAndFocus() {
    awaitTalkBackReady()
    // The real adapter writes "Saved to photos"; earlier harness steps may leave another mode.
    fixture("real")
    waitFor("Story68 app active") { find("tab-home") != null || find("share-card-cancel") != null }
    closeComposerIfOpen()
    click("tab-home")
    waitFor("Outfit action") { find("outfit-share-card-open") != null }
    click("outfit-share-card-open")
    waitFor("Approved preview") { all().any { it.viewIdResourceName?.contains("share-card-preview-loaded-") == true } }
    waitFor("TalkBack focus on modal title") { find("share-card-title")?.isAccessibilityFocused == true }
    // The tree fills in after the title takes focus: wait for it to be complete and still.
    settledTree("Composer tree settles")
    waitFor("Traversal order title, watermark, save, cancel") {
      TreeSettling.orderHolds(
        all().mapNotNull { it.viewIdResourceName?.substringAfterLast('/') },
        listOf("share-card-title", "share-card-watermark", "share-card-save", "share-card-cancel")
      )
    }
    for (id in listOf("share-card-title", "share-card-save", "share-card-cancel"))
      waitFor("Label of $id") { find(id)?.let { label(it).isNotBlank() } == true }
    waitFor("Save is clickable") { find("share-card-save")?.isClickable == true }
    click("share-card-save")
    waitFor("Saved status") { all().any { label(it) == "Saved to photos" } }
    // Saved feedback returns TalkBack focus to Save, the same target iOS asserts.
    waitForFocus("TalkBack focus on Save after saving") { find("share-card-save")?.isAccessibilityFocused == true }
    waitForFocus("Focused Save is in the active modal window") { automation.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY)?.let { hasId(it, "share-card-save") } == true }
    click("share-card-cancel")
    waitFor("Title dismissed") { find("share-card-title") == null }
    waitForFocus("TalkBack restored to opener") { find("outfit-share-card-open")?.isAccessibilityFocused == true }
    waitFor("Restored opener visible") {
      val bounds = Rect()
      find("outfit-share-card-open")?.getBoundsInScreen(bounds)
      !bounds.isEmpty
    }
  }
  @Test
  fun actualTalkBackOwnedSavingAndReopenedFinishingRestoreWatermark() {
    awaitTalkBackReady()
    try {
      fixture("real")
      assertCacheEnumeration()
      closeComposerIfOpen()
      click("tab-home")
      assertHeader("Home", "Outfit")
      click("tab-community")
      assertHeader("Community", "Living community lookbook")
      click("tab-home")
      waitFor("Outfit action") { find("outfit-share-card-open") != null }
      waitFor("Action label Create my outfit card") { find("outfit-share-card-open")?.let { label(it) } == "Create my outfit card" }
      fixture("deferred")
      click("outfit-share-card-open")
      waitFor("Approved preview and enabled Save") {
        all().any { it.viewIdResourceName?.contains("share-card-preview-loaded-") == true } && find("share-card-save")?.isEnabled == true
      }
      waitFor("Accessibility focus moves to Save") { find("share-card-save")?.performAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS) == true }
      waitForFocus("Save initially focused") { find("share-card-save")?.isAccessibilityFocused == true }
      val before = cacheFiles()
      click("share-card-save")
      waitFor("Committed file remains owned") { (cacheFiles() - before).isNotEmpty() }
      waitForFocus("Owned Saving without a Cancel focus jump") {
        find("share-card-feedback")?.let { label(it) == "Saving" } == true && find("share-card-save")?.isAccessibilityFocused == true
      }
      assertFalse("No Finishing save label while owned saving", all().any { label(it) == "Finishing save" })
      click("share-card-cancel")
      click("outfit-share-card-open")
      waitFor("Reopened Finishing save") { find("share-card-feedback")?.let { label(it) == "Finishing save" } == true }
      waitForFocus("Old save focuses its Cancel recovery control") { find("share-card-cancel")?.isAccessibilityFocused == true }
      waitFor("Save is disabled while the old save finishes") { find("share-card-save")?.isEnabled == false }
      fixture("release")
      waitFor("Settled old save re-enables the watermark") { find("share-card-watermark")?.isEnabled == true && find("share-card-feedback") == null }
      var checked = false
      waitFor("Watermark state readable") { find("share-card-watermark")?.also { checked = it.isChecked } != null }
      click("share-card-watermark")
      waitFor("Re-enabled watermark toggles") { find("share-card-watermark")?.isChecked != checked }
      assertFalse("No Saved to photos label for the old save", all().any { label(it) == "Saved to photos" })
      click("share-card-cancel")
    } catch (failure: Throwable) {
      // Cleanup runs for the next test's sake; whatever it hits must not replace this failure.
      try { restoreRealFixture() } catch (cleanup: Throwable) { failure.addSuppressed(cleanup) }
      throw failure
    }
    restoreRealFixture()
  }

  private fun restoreRealFixture() {
    fixture("release")
    fixture("real")
    closeComposerIfOpen()
  }

}
