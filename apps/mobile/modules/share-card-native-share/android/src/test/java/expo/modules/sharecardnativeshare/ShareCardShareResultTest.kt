package expo.modules.sharecardnativeshare

import android.app.Activity
import android.app.Application
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.content.IntentSender
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.core.content.IntentCompat
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.time.Duration
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * N-AND-OUTCOME: the first event wins, settlement tears the attempt down once, and the Android
 * outcome type cannot claim a post or a web outcome.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ShareCardShareResultTest {
  private class FakeClock {
    val pending = mutableListOf<Pair<Long, () -> Unit>>()

    fun schedule(delayMs: Long, action: () -> Unit): () -> Unit {
      val entry = delayMs to action
      pending += entry
      return { pending.remove(entry) }
    }

    fun fire() = pending.toList().also { pending.clear() }.forEach { it.second() }
  }

  private val clock = FakeClock()
  private val session = ShareCardShareSession(clock::schedule)
  private val settled = mutableListOf<ShareCardShareResult>()
  private var teardowns = 0

  private fun begin(id: String = "a1") =
    session.begin(id, teardown = { teardowns++ }, settle = { settled += it })

  private fun app(packageName: String?) = ShareCardChooserSelection.App(packageName)

  @Test
  fun callbackSettlesTargetChosenWithTheMappedAppOrOther() {
    assertTrue(begin())
    session.chooserCallback("a1", app("com.instagram.android"))
    assertEquals(listOf(ShareCardShareResult.chosen(ShareCardShareTarget.INSTAGRAM)), settled)
    assertTrue(begin("a2"))
    session.chooserCallback("a2", app("com.google.android.apps.messaging"))
    assertEquals(ShareCardShareResult.chosen(ShareCardShareTarget.OTHER), settled.last())
    assertEquals(mapOf("target" to "other", "outcome" to "target_chosen"), settled.last().toBridge())
    assertEquals(2, teardowns)
  }

  @Test
  fun aCallbackWithoutAPackageIsOtherAndOneThatSelectsNoAppIsNotConfirmed() {
    begin()
    session.chooserCallback("a1", app(null))
    assertEquals(listOf(ShareCardShareResult.chosen(ShareCardShareTarget.OTHER)), settled)
    begin("a2")
    session.hostPaused()
    session.hostResumed()
    session.chooserCallback("a2", ShareCardChooserSelection.NoTarget)
    assertEquals(ShareCardShareResult.notConfirmed, settled.last())
    assertEquals(mapOf("target" to "none", "outcome" to "not_confirmed"), settled.last().toBridge())
    // It wins like any callback: the grace is cancelled and a late callback is ignored.
    assertTrue(clock.pending.isEmpty())
    session.chooserCallback("a2", app("com.pinterest"))
    clock.fire()
    assertEquals(2, settled.size)
    assertEquals(2, teardowns)
  }

  @Test
  fun resumeAfterTheChooserPlusGraceWithNoCallbackIsNotConfirmed() {
    begin()
    session.hostPaused()
    session.hostResumed()
    assertEquals(listOf(ShareCardShareSession.GRACE_MS), clock.pending.map { it.first })
    assertTrue(settled.isEmpty())
    clock.fire()
    assertEquals(listOf(ShareCardShareResult.notConfirmed), settled)
    assertEquals(mapOf("target" to "none", "outcome" to "not_confirmed"), settled.single().toBridge())
    assertEquals(1, teardowns)
  }

  @Test
  fun resumeBeforeTheChooserCoveredTheHostStartsNoGrace() {
    begin()
    session.hostResumed()
    assertEquals(listOf(ShareCardShareSession.START_MS), clock.pending.map { it.first })
    session.hostPaused()
    session.hostResumed()
    session.hostResumed()
    assertEquals(listOf(ShareCardShareSession.GRACE_MS), clock.pending.map { it.first })
  }

  @Test
  fun aHostThatNeverLeavesAfterBeginSettlesNotConfirmedAtTheStartDeadline() {
    begin()
    assertEquals(listOf(ShareCardShareSession.START_MS), clock.pending.map { it.first })
    clock.fire()
    assertEquals(listOf(ShareCardShareResult.notConfirmed), settled)
    assertEquals(1, teardowns)
    assertFalse(session.isActive)
  }

  @Test
  fun theHostLeavingCancelsTheStartDeadline() {
    begin()
    session.hostPaused()
    assertTrue(clock.pending.isEmpty())
    clock.fire()
    assertTrue(settled.isEmpty())
    assertTrue(session.isActive)
  }

  @Test
  fun callbackInsideTheGraceWindowWinsAndCancelsTheGrace() {
    begin()
    session.hostPaused()
    session.hostResumed()
    session.chooserCallback("a1", app("com.pinterest"))
    assertEquals(listOf(ShareCardShareResult.chosen(ShareCardShareTarget.PINTEREST)), settled)
    assertTrue(clock.pending.isEmpty())
    clock.fire()
    assertEquals(1, settled.size)
  }

  @Test
  fun callbackAfterNotConfirmedDuplicateAndOldAttemptCallbacksAreIgnored() {
    begin()
    session.hostPaused()
    session.hostResumed()
    clock.fire()
    session.chooserCallback("a1", app("com.pinterest"))
    assertEquals(listOf(ShareCardShareResult.notConfirmed), settled)
    begin("a2")
    session.chooserCallback("a1", app("com.pinterest"))
    assertTrue("old attempt id ignored", session.isActive)
    session.chooserCallback("a2", app("com.facebook.katana"))
    session.chooserCallback("a2", app("com.instagram.android"))
    assertEquals(ShareCardShareResult.chosen(ShareCardShareTarget.FACEBOOK), settled.last())
    assertEquals(2, settled.size)
    assertEquals(2, teardowns)
  }

  @Test
  fun recreationOrDestructionMidAttemptIsNotConfirmed() {
    begin()
    session.hostPaused()
    session.hostDestroyed()
    assertEquals(listOf(ShareCardShareResult.notConfirmed), settled)
    session.hostDestroyed()
    assertEquals(1, settled.size)
  }

  @Test
  fun startErrorsSettleFailedOrUnavailableWithNoTarget() {
    begin()
    session.startFailed(ShareCardShareResult.chooserUnavailable)
    begin("a2")
    session.startFailed(ShareCardShareResult.failed(ShareCardShareCode.START_FAILED))
    assertEquals(
      listOf(
        mapOf("target" to "none", "outcome" to "unavailable", "code" to "chooser_unavailable"),
        mapOf("target" to "none", "outcome" to "failed", "code" to "start_failed"),
      ),
      settled.map { it.toBridge() },
    )
  }

  @Test
  fun aSecondBeginWhileActiveIsRefused() {
    assertTrue(begin())
    assertFalse(begin("a2"))
    assertEquals("a1", session.activeAttemptId)
  }

  @Test
  fun outcomeTypeHasNoCompletedHandedOffOrDismissedMember() {
    assertEquals(
      listOf("target_chosen", "not_confirmed", "failed", "unavailable"),
      ShareCardShareOutcome.entries.map { it.wire },
    )
    assertFalse(ShareCardShareTarget.entries.any { it.wire == "unknown" })
    assertEquals(
      listOf("file_invalid", "chooser_unavailable", "start_failed", "busy"),
      ShareCardShareCode.entries.map { it.wire },
    )
  }

  // The controller drives the same session through a real chooser start under Robolectric.

  private lateinit var application: Application
  private lateinit var file: File
  private lateinit var digest: String

  @Before
  fun writeShareFile() {
    resetFileProviderRoots()
    application = ApplicationProvider.getApplicationContext()
    file = File(application.cacheDir, "share-cards/cc69-share-${UUID.randomUUID()}.png")
    file.parentFile!!.mkdirs()
    file.writeBytes(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3))
    digest = ShareCardShareFiles.sha256(file)
  }

  private fun idle(ms: Long = 0) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

  private fun registered(action: String) =
    shadowOf(application).registeredReceivers.any { it.intentFilter.hasAction(action) }

  private fun livePendingIntent(action: String, attemptId: String) =
    PendingIntent.getBroadcast(
      application,
      attemptId.hashCode(),
      Intent(action).setPackage(application.packageName),
      PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_MUTABLE,
    )

  @Test
  fun controllerSettlesOnceAndTearsDownThePendingIntentAndReceiver() {
    val results = mutableListOf<Map<String, String>>()
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val controller = ShareCardShareController(Handler(Looper.getMainLooper())) { "attempt-1" }
    controller.share(application, activity, "file://${file.absolutePath}", digest) { results += it }
    val action = ShareCardChooserCallback.action(application, "attempt-1")
    assertNotNull(shadowOf(activity).nextStartedActivity)
    assertTrue(registered(action))
    assertNotNull(livePendingIntent(action, "attempt-1"))
    controller.share(application, activity, "file://${file.absolutePath}", digest) { results += it }
    assertEquals(listOf(mapOf("target" to "none", "outcome" to "failed", "code" to "busy")), results)
    controller.hostPaused()
    controller.hostResumed()
    idle(ShareCardShareSession.GRACE_MS - 1)
    assertEquals(1, results.size)
    application.sendBroadcast(
      Intent(action)
        .setPackage(application.packageName)
        .putExtra(Intent.EXTRA_CHOSEN_COMPONENT, ComponentName("com.zhiliaoapp.musically", "Share")),
    )
    idle()
    assertEquals(mapOf("target" to "tiktok", "outcome" to "target_chosen"), results.last())
    assertFalse(registered(action))
    assertNull(livePendingIntent(action, "attempt-1"))
    idle(ShareCardShareSession.GRACE_MS)
    assertEquals(2, results.size)
  }

  @Test
  fun chooserWrapsOnePngSendWithAReadGrantTheCallbackAndNoText() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    ShareCardShareController(Handler(Looper.getMainLooper())) { "attempt-6" }
      .share(application, activity, file.toURI().toString(), digest) {}
    val chooser = shadowOf(activity).nextStartedActivity
    assertEquals(Intent.ACTION_CHOOSER, chooser.action)
    // SDK 36 files the callback under the chooser-result extra.
    assertNotNull(
      IntentCompat.getParcelableExtra(chooser, Intent.EXTRA_CHOOSER_RESULT_INTENT_SENDER, IntentSender::class.java),
    )
    val send = IntentCompat.getParcelableExtra(chooser, Intent.EXTRA_INTENT, Intent::class.java)!!
    assertEquals(Intent.ACTION_SEND, send.action)
    assertEquals("image/png", send.type)
    val stream = IntentCompat.getParcelableExtra(send, Intent.EXTRA_STREAM, Uri::class.java)!!
    assertEquals("content", stream.scheme)
    assertEquals(ShareCardShareFiles.authority(application), stream.authority)
    assertEquals("/share_cards/${file.name}", stream.path)
    assertEquals(1, send.clipData!!.itemCount)
    assertEquals(stream, send.clipData!!.getItemAt(0).uri)
    assertTrue(send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
    assertFalse(send.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0)
    assertTrue(chooser.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
    assertFalse(send.hasExtra(Intent.EXTRA_TEXT))
    assertFalse(send.hasExtra(Intent.EXTRA_SUBJECT))
    assertFalse(send.hasExtra(Intent.EXTRA_HTML_TEXT))
  }

  @Test
  fun controllerSettlesNotConfirmedWhenTheChooserNeverCoversTheHost() {
    val results = mutableListOf<Map<String, String>>()
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val controller = ShareCardShareController(Handler(Looper.getMainLooper())) { "attempt-7" }
    controller.share(application, activity, file.toURI().toString(), digest) { results += it }
    idle(ShareCardShareSession.START_MS - 1)
    assertTrue(results.isEmpty())
    idle(1)
    assertEquals(listOf(mapOf("target" to "none", "outcome" to "not_confirmed")), results)
    assertFalse(registered(ShareCardChooserCallback.action(application, "attempt-7")))
    assertFalse(controller.session.isActive)
  }

  @Test
  fun controllerSettlesNotConfirmedAfterResumeAndGrace() {
    val results = mutableListOf<Map<String, String>>()
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val controller = ShareCardShareController(Handler(Looper.getMainLooper())) { "attempt-2" }
    controller.share(application, activity, file.toURI().toString(), digest) { results += it }
    controller.hostPaused()
    controller.hostResumed()
    idle(ShareCardShareSession.GRACE_MS - 1)
    assertTrue(results.isEmpty())
    idle(1)
    assertEquals(listOf(mapOf("target" to "none", "outcome" to "not_confirmed")), results)
    assertFalse(registered(ShareCardChooserCallback.action(application, "attempt-2")))
  }

  @Test
  fun noResolvableChooserIsUnavailableAndOtherStartErrorsFail() {
    val results = mutableListOf<Map<String, String>>()
    shadowOf(application).checkActivities(true)
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    ShareCardShareController(Handler(Looper.getMainLooper())) { "attempt-3" }
      .share(application, activity, file.toURI().toString(), digest) { results += it }
    shadowOf(application).checkActivities(false)
    val throwing = Robolectric.buildActivity(ThrowingActivity::class.java).setup().get()
    ShareCardShareController(Handler(Looper.getMainLooper())) { "attempt-4" }
      .share(application, throwing, file.toURI().toString(), digest) { results += it }
    assertEquals(
      listOf(
        mapOf("target" to "none", "outcome" to "unavailable", "code" to "chooser_unavailable"),
        mapOf("target" to "none", "outcome" to "failed", "code" to "start_failed"),
      ),
      results,
    )
    assertFalse(registered(ShareCardChooserCallback.action(application, "attempt-3")))
    assertFalse(registered(ShareCardChooserCallback.action(application, "attempt-4")))
  }

  @Test
  fun invalidFileOrMissingHostFailsBeforeAnyChooser() {
    val results = mutableListOf<Map<String, String>>()
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val controller = ShareCardShareController(Handler(Looper.getMainLooper()))
    controller.share(application, activity, file.toURI().toString(), "0".repeat(64)) { results += it }
    controller.share(application, null, file.toURI().toString(), digest) { results += it }
    assertNull(shadowOf(activity).nextStartedActivity)
    assertEquals(
      listOf(
        mapOf("target" to "none", "outcome" to "failed", "code" to "file_invalid"),
        mapOf("target" to "none", "outcome" to "failed", "code" to "start_failed"),
      ),
      results,
    )
    assertFalse(controller.session.isActive)
  }

  @Test
  fun hostDestructionMidAttemptSettlesNotConfirmed() {
    val results = mutableListOf<Map<String, String>>()
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val controller = ShareCardShareController(Handler(Looper.getMainLooper())) { "attempt-5" }
    controller.share(application, activity, file.toURI().toString(), digest) { results += it }
    controller.hostPaused()
    controller.hostDestroyed()
    assertEquals(listOf(mapOf("target" to "none", "outcome" to "not_confirmed")), results)
    assertFalse(registered(ShareCardChooserCallback.action(application, "attempt-5")))
  }

  class ThrowingActivity : Activity() {
    override fun startActivity(intent: Intent?) {
      throw SecurityException("denied")
    }
  }
}
