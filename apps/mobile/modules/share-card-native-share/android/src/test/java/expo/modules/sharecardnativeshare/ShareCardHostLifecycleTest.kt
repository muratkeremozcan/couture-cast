package expo.modules.sharecardnativeshare

import android.app.Activity
import android.app.Application
import android.os.Handler
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.time.Duration
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * N-AND-OUTCOME host lifecycle bridge: the Expo module forwards its lifecycle events through
 * [ShareCardHostLifecycle], and each event reaches the share session on the main thread as the
 * right host transition.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ShareCardHostLifecycleTest {
  private lateinit var application: Application
  private lateinit var file: File
  private val results = mutableListOf<Map<String, String>>()
  private val handler = Handler(Looper.getMainLooper())
  private lateinit var controller: ShareCardShareController
  private lateinit var lifecycle: ShareCardHostLifecycle

  @Before
  fun startAttempt() {
    resetFileProviderRoots()
    application = ApplicationProvider.getApplicationContext()
    file = File(application.cacheDir, "share-cards/cc69-share-${UUID.randomUUID()}/couturecast-card.png")
    file.parentFile!!.mkdirs()
    file.writeBytes(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3))
    controller = ShareCardShareController(handler) { "attempt-host" }
    lifecycle = ShareCardHostLifecycle(handler, controller)
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    controller.share(application, activity, file.toURI().toString(), ShareCardShareFiles.sha256(file)) {
      results += it
    }
    assertTrue(controller.session.isActive)
  }

  private fun idle(ms: Long = 0) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

  private val notConfirmed = mapOf("target" to "none", "outcome" to "not_confirmed")

  @Test
  fun backgroundThenForegroundSettlesNotConfirmedAfterTheGrace() {
    lifecycle.on(ShareCardHostEvent.ACTIVITY_ENTERS_BACKGROUND)
    lifecycle.on(ShareCardHostEvent.ACTIVITY_ENTERS_FOREGROUND)
    idle()
    // Background cancelled the 5 s start deadline, so only the 750 ms grace is left.
    idle(749)
    assertTrue(results.isEmpty())
    idle(1)
    assertEquals(listOf(notConfirmed), results)
    assertFalse(controller.session.isActive)
    idle(ShareCardShareSession.START_MS)
    assertEquals(1, results.size)
  }

  @Test
  fun eventsReachTheSessionOnlyThroughTheMainThreadQueue() {
    lifecycle.on(ShareCardHostEvent.ACTIVITY_DESTROYS)
    assertTrue("posted, not run inline", results.isEmpty())
    idle()
    assertEquals(listOf(notConfirmed), results)
  }

  @Test
  fun foregroundWithoutBackgroundStartsNoGrace() {
    lifecycle.on(ShareCardHostEvent.ACTIVITY_ENTERS_FOREGROUND)
    idle(ShareCardShareSession.GRACE_MS)
    assertTrue(results.isEmpty())
    assertTrue(controller.session.isActive)
  }

  @Test
  fun activityDestructionMidAttemptSettlesNotConfirmed() {
    lifecycle.on(ShareCardHostEvent.ACTIVITY_ENTERS_BACKGROUND)
    idle()
    lifecycle.on(ShareCardHostEvent.ACTIVITY_DESTROYS)
    idle()
    assertEquals(listOf(notConfirmed), results)
    assertFalse(controller.session.isActive)
  }

  @Test
  fun moduleDestructionMidAttemptSettlesNotConfirmed() {
    lifecycle.on(ShareCardHostEvent.ACTIVITY_ENTERS_BACKGROUND)
    idle()
    lifecycle.on(ShareCardHostEvent.MODULE_DESTROYS)
    idle()
    assertEquals(listOf(notConfirmed), results)
    assertFalse(controller.session.isActive)
  }
}
