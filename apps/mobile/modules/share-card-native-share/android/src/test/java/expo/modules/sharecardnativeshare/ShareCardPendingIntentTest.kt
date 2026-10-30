package expo.modules.sharecardnativeshare

import android.app.Application
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Looper
import android.service.chooser.ChooserResult
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * N-AND-PENDINGINTENT: the chooser callback is mutable, package-bound and attempt-scoped, its
 * receiver is not exported, and a system fill-in reaches it as the selection it observed.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34, 36])
class ShareCardPendingIntentTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private val chosen = mutableListOf<Pair<String, ShareCardChooserSelection>>()

  private fun register(attemptId: String) =
    ShareCardChooserCallback.register(application, attemptId) { id, selection -> chosen += id to selection }

  private fun receivers(action: String) =
    shadowOf(application).registeredReceivers.filter { it.intentFilter.hasAction(action) }

  @Test
  fun pendingIntentIsMutablePackageBoundAndCarriesTheAttemptId() {
    val callback = register("attempt-123")
    val shadow = shadowOf(callback.pendingIntent)
    assertTrue(shadow.isBroadcast)
    assertTrue(shadow.flags and PendingIntent.FLAG_MUTABLE != 0)
    assertFalse(shadow.flags and PendingIntent.FLAG_IMMUTABLE != 0)
    assertEquals(application.packageName, shadow.savedIntent.`package`)
    assertEquals("${application.packageName}.sharecardnativeshare.CHOSEN.attempt-123", shadow.savedIntent.action)
    assertEquals(callback.action, shadow.savedIntent.action)
    assertTrue(callback.action.endsWith(".attempt-123"))
    assertEquals(null, shadow.savedIntent.component)
    assertNotEquals(register("attempt-456").action, callback.action)
  }

  @Test
  fun receiverIsRegisteredNotExportedForOnlyItsAttemptAction() {
    assertEquals(Context.RECEIVER_NOT_EXPORTED, ShareCardChooserCallback.receiverFlags)
    val callback = register("attempt-1")
    val wrapper = receivers(callback.action).single()
    assertEquals(1, wrapper.intentFilter.countActions())
    assertTrue(wrapper.flags and Context.RECEIVER_NOT_EXPORTED != 0)
    assertFalse(wrapper.flags and Context.RECEIVER_EXPORTED != 0)
  }

  @Test
  fun aFillInWithTheChosenComponentReachesTheReceiver() {
    val callback = register("attempt-1")
    callback.pendingIntent.send(
      application,
      0,
      Intent().putExtra(Intent.EXTRA_CHOSEN_COMPONENT, ComponentName("com.pinterest", "com.pinterest.Share")),
    )
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf("attempt-1" to ShareCardChooserSelection.App("com.pinterest")), chosen)
  }

  /** The platform builds ChooserResult; its constructor is hidden from the SDK stubs. */
  private fun chooserResult(type: Int, component: ComponentName?) =
    ChooserResult::class.java
      .getConstructor(Int::class.javaPrimitiveType, ComponentName::class.java, Boolean::class.javaPrimitiveType)
      .newInstance(type, component, false)

  private fun sendChooserResult(callback: ShareCardChooserCallback, type: Int, component: ComponentName?) =
    callback.pendingIntent.send(
      application,
      0,
      Intent().putExtra(Intent.EXTRA_CHOOSER_RESULT, chooserResult(type, component)),
    )

  @Test
  @Config(sdk = [36])
  fun anAndroid15ChooserResultFillInReachesTheReceiver() {
    val callback = register("attempt-1")
    sendChooserResult(
      callback,
      ChooserResult.CHOOSER_RESULT_SELECTED_COMPONENT,
      ComponentName("com.instagram.android", "Share"),
    )
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf("attempt-1" to ShareCardChooserSelection.App("com.instagram.android")), chosen)
  }

  @Test
  @Config(sdk = [36])
  fun anAndroid15ChooserResultThatSelectsNoAppIsNoTarget() {
    val callback = register("attempt-1")
    // Copy and Edit name no app; a component selection without a component confirms none either,
    // even when a chosen-component extra rides along.
    sendChooserResult(callback, ChooserResult.CHOOSER_RESULT_COPY, null)
    sendChooserResult(callback, ChooserResult.CHOOSER_RESULT_EDIT, null)
    sendChooserResult(callback, ChooserResult.CHOOSER_RESULT_UNKNOWN, null)
    sendChooserResult(callback, ChooserResult.CHOOSER_RESULT_COPY, ComponentName("com.pinterest", "Share"))
    callback.pendingIntent.send(
      application,
      0,
      Intent()
        .putExtra(Intent.EXTRA_CHOOSER_RESULT, chooserResult(ChooserResult.CHOOSER_RESULT_SELECTED_COMPONENT, null))
        .putExtra(Intent.EXTRA_CHOSEN_COMPONENT, ComponentName("com.pinterest", "Share")),
    )
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(List(5) { "attempt-1" to ShareCardChooserSelection.NoTarget }, chosen)
  }

  @Test
  fun teardownCancelsThePendingIntentAndUnregistersTheReceiverOnce() {
    val callback = register("attempt-1")
    callback.teardown()
    callback.teardown()
    assertTrue(shadowOf(callback.pendingIntent).isCanceled)
    assertTrue(receivers(callback.action).isEmpty())
    application.sendBroadcast(Intent(callback.action).setPackage(application.packageName))
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(chosen.isEmpty())
  }

  @Test
  fun aBroadcastForAnotherAttemptNeverReachesThisReceiver() {
    register("attempt-1")
    application.sendBroadcast(
      Intent(ShareCardChooserCallback.action(application, "attempt-2"))
        .setPackage(application.packageName)
        .putExtra(Intent.EXTRA_CHOSEN_COMPONENT, ComponentName("com.pinterest", "Share")),
    )
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(chosen.isEmpty())
  }
}
