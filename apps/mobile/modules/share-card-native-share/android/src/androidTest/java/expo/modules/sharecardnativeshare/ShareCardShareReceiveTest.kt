package expo.modules.sharecardnativeshare

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.Process
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * N-AND-RECEIVE on a real device. The receiving Activity gets the exact `ACTION_SEND` the chooser
 * wraps and reads the PNG through the module's provider; its SHA256 equals the previewed digest.
 * The shell then stands in for another app's UID: the granted URI is readable, while a sibling
 * share file that was never granted and every out-of-scope URI are denied. Receivers see the card
 * as `couturecast-card.png` with its real size, never its per-share directory name.
 *
 * A second app, `test-receiver` (its own package and UID), is picked in the real system chooser:
 * it reads the card with only the grant the chooser forwarded, and the same app started without
 * the grant is refused. The lane installs it before this class runs.
 */
@RunWith(AndroidJUnit4::class)
class ShareCardShareReceiveTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context: Context = instrumentation.targetContext
  private val authority = ShareCardShareFiles.authority(context)
  private val shell = "com.android.shell"
  private lateinit var shared: File
  private lateinit var sibling: File
  private lateinit var outside: File
  private lateinit var expected: String
  private lateinit var uri: Uri

  /** Distinct PNG-signed bytes per file, so a wrong file can never match the digest. */
  private fun write(file: File) =
    file.apply {
      parentFile!!.mkdirs()
      writeBytes(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10) + UUID.randomUUID().toString().toByteArray())
    }

  private fun sha256(bytes: ByteArray) =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  /** Queries a content URI's columns as the shell UID, a different app from the provider's. */
  private fun queryAsShell(target: Uri): String {
    val output = instrumentation.uiAutomation.executeShellCommand("content query --uri $target")
    return ParcelFileDescriptor.AutoCloseInputStream(output).use { it.readBytes().decodeToString() }
  }

  /** Reads a content URI as the shell UID, a different app from the provider's. */
  private fun readAsShell(target: Uri): ByteArray {
    val output = instrumentation.uiAutomation.executeShellCommand("content read --uri $target")
    return ParcelFileDescriptor.AutoCloseInputStream(output).use { it.readBytes() }
  }

  @Before
  fun writeFiles() {
    val directory = File(context.cacheDir, ShareCardShareFiles.DIRECTORY)
    shared = write(File(directory, "cc69-share-${UUID.randomUUID()}/${ShareCardShareFiles.PUBLIC_NAME}"))
    sibling = write(File(directory, "cc69-share-${UUID.randomUUID()}/${ShareCardShareFiles.PUBLIC_NAME}"))
    outside = write(File(context.cacheDir, "cc69-share-${UUID.randomUUID()}.png"))
    expected = ShareCardShareFiles.sha256(shared)
    uri = FileProvider.getUriForFile(context, authority, ShareCardShareFiles.validate(context.cacheDir, shared.toURI().toString(), expected)!!)
    ShareCardReceiveTestActivity.received = java.util.concurrent.CompletableFuture()
  }

  @After
  fun cleanUp() {
    context.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    listOf(shared, sibling).forEach { it.parentFile!!.deleteRecursively() }
    outside.delete()
  }

  @Test
  fun receivingActivityReadsTheGrantedPngWithThePreviewedDigest() {
    val callback = ShareCardChooserCallback.register(context, "receive-test") { _, _ -> }
    try {
      val chooser = ShareCardChooserIntent.build(uri, callback.pendingIntent.intentSender)
      assertEquals(Intent.ACTION_CHOOSER, chooser.action)
      val send = IntentCompat.getParcelableExtra(chooser, Intent.EXTRA_INTENT, Intent::class.java)!!
      // Deliver the wrapped intent to the stand-in receiver the way the chooser hands it on.
      context.startActivity(
        Intent(send)
          .setClass(context, ShareCardReceiveTestActivity::class.java)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      val received = ShareCardReceiveTestActivity.received.get(20, TimeUnit.SECONDS)
      assertEquals(Intent.ACTION_SEND, received.action)
      assertEquals("image/png", received.type)
      assertEquals(uri, received.stream)
      assertEquals(authority, received.stream?.authority)
      assertEquals(listOf(uri), received.clipUris)
      assertTrue(received.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
      assertFalse(received.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0)
      assertFalse(Intent.EXTRA_TEXT in received.extras)
      assertFalse(Intent.EXTRA_SUBJECT in received.extras)
      assertEquals(setOf(Intent.EXTRA_STREAM), received.extras)
      assertEquals(null, received.readError)
      assertEquals(expected, received.sha256)
      assertEquals("couturecast-card.png", received.displayName)
      assertEquals(shared.length(), received.size)
      assertEquals("couturecast-card.png", shared.name)
    } finally {
      callback.teardown()
    }
  }

  @Test
  fun anotherUidReadsOnlyTheGrantedUriAndNeverASiblingOrOutOfScopeFile() {
    val siblingUri = FileProvider.getUriForFile(context, authority, sibling)
    assertTrue("no grant yet", sha256(readAsShell(uri)) != expected)
    context.grantUriPermission(shell, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    assertEquals(expected, sha256(readAsShell(uri)))
    val columns = queryAsShell(uri)
    assertTrue(columns, columns.contains("_display_name=couturecast-card.png"))
    assertTrue(columns, columns.contains("_size=${shared.length()}"))
    assertFalse(columns, columns.contains("cc69-share"))
    assertNotEquals(ShareCardShareFiles.sha256(sibling), sha256(readAsShell(siblingUri)))
    for (target in
      listOf(
        Uri.parse("content://$authority/share_cards/../${outside.name}"),
        Uri.parse("content://$authority/share_cards/%2E%2E/${outside.name}"),
        Uri.parse("content://$authority/cache/${outside.name}"),
      )) {
      assertNotEquals(target.toString(), ShareCardShareFiles.sha256(outside), sha256(readAsShell(target)))
    }
  }

  /** Collects the one report `test-receiver` broadcasts after it handled a share. */
  private fun receiverReport(): Pair<CompletableFuture<Bundle>, () -> Unit> {
    val report = CompletableFuture<Bundle>()
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          report.complete(intent.extras ?: Bundle())
        }
      }
    // Exported: the report comes from the receiver app's UID.
    ContextCompat.registerReceiver(context, receiver, IntentFilter(RECEIVER_RESULT_ACTION), ContextCompat.RECEIVER_EXPORTED)
    return report to { context.unregisterReceiver(receiver) }
  }

  private fun receiverUid() = context.packageManager.getApplicationInfo(RECEIVER_PACKAGE, 0).uid

  private fun assertReceiverInstalled() {
    try {
      receiverUid()
    } catch (error: Exception) {
      fail("install the test-receiver APK before this class runs")
    }
  }

  /** Taps the receiver's label in the system chooser, expanding the sheet when it is below it. */
  private fun pickInChooser(label: String) {
    val device = UiDevice.getInstance(instrumentation)
    repeat(4) {
      val target = device.wait(Until.findObject(By.text(label)), 5_000)
      if (target != null) {
        target.click()
        return
      }
      device.swipe(device.displayWidth / 2, device.displayHeight * 9 / 10, device.displayWidth / 2, device.displayHeight / 4, 20)
    }
    fail("$label never appeared in the system chooser")
  }

  @Test
  fun anotherAppPickedInTheSystemChooserReadsTheCardWithOnlyTheForwardedGrant() {
    assertReceiverInstalled()
    val (report, stopReport) = receiverReport()
    val selection = CompletableFuture<ShareCardChooserSelection>()
    val callback = ShareCardChooserCallback.register(context, "receive-chooser") { _, picked -> selection.complete(picked) }
    try {
      context.startActivity(
        ShareCardChooserIntent.build(uri, callback.pendingIntent.intentSender).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      pickInChooser(RECEIVER_LABEL)
      val seen = report.get(30, TimeUnit.SECONDS)
      assertNotEquals("the reader is another app", Process.myUid(), seen.getInt("uid"))
      assertEquals(receiverUid(), seen.getInt("uid"))
      assertEquals(Intent.ACTION_SEND, seen.getString("action"))
      assertEquals("image/png", seen.getString("type"))
      assertEquals(uri.toString(), seen.getString("stream"))
      assertEquals(1, seen.getInt("clipItems"))
      assertEquals(null, seen.getString("readError"))
      assertEquals(expected, seen.getString("sha256"))
      assertEquals("couturecast-card.png", seen.getString("displayName"))
      assertEquals(shared.length(), seen.getLong("size"))
      assertFalse(seen.getStringArrayList("extras").orEmpty().contains(Intent.EXTRA_TEXT))
      assertFalse(seen.getStringArrayList("extras").orEmpty().contains(Intent.EXTRA_SUBJECT))
      // The real chooser reported the app it launched through the attempt's callback.
      assertEquals(ShareCardChooserSelection.App(RECEIVER_PACKAGE), selection.get(30, TimeUnit.SECONDS))
    } finally {
      callback.teardown()
      stopReport()
    }
  }

  @Test
  fun theSameAppStartedWithoutTheGrantCannotReadTheCard() {
    assertReceiverInstalled()
    val (report, stopReport) = receiverReport()
    val callback = ShareCardChooserCallback.register(context, "receive-no-grant") { _, _ -> }
    try {
      val chooser = ShareCardChooserIntent.build(uri, callback.pendingIntent.intentSender)
      val send = IntentCompat.getParcelableExtra(chooser, Intent.EXTRA_INTENT, Intent::class.java)!!
      // The exact send with its ClipData, so Android adds no grant of its own; only the flags go.
      assertNotNull(send.clipData)
      context.startActivity(
        Intent(send).setComponent(ComponentName(RECEIVER_PACKAGE, RECEIVER_ACTIVITY)).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      val seen = report.get(30, TimeUnit.SECONDS)
      assertNotEquals(Process.myUid(), seen.getInt("uid"))
      assertEquals(receiverUid(), seen.getInt("uid"))
      assertEquals(uri.toString(), seen.getString("stream"))
      assertEquals("SecurityException", seen.getString("readError"))
      assertNull(seen.getString("sha256"))
    } finally {
      callback.teardown()
      stopReport()
    }
  }

  @Test
  fun theProviderRefusesOutOfScopeUrisEvenToItsOwnApp() {
    try {
      FileProvider.getUriForFile(context, authority, outside)
      fail("a file outside share-cards must not get a URI")
    } catch (expected: IllegalArgumentException) {
    }
    for (target in
      listOf(
        Uri.parse("content://$authority/share_cards/../${outside.name}"),
        Uri.parse("content://$authority/share_cards/%2E%2E/${outside.name}"),
        Uri.parse("content://$authority/cache/${outside.name}"),
      )) {
      try {
        context.contentResolver.openInputStream(target)!!.use { it.readBytes() }
        fail("$target must be refused")
      } catch (expected: Exception) {
        assertTrue(target.toString(), expected is SecurityException || expected is IllegalArgumentException || expected is java.io.FileNotFoundException)
      }
    }
  }

  private companion object {
    const val RECEIVER_PACKAGE = "expo.modules.sharecardnativeshare.receiver"
    const val RECEIVER_ACTIVITY = "expo.modules.sharecardnativeshare.receiver.ShareCardTestReceiverActivity"
    const val RECEIVER_RESULT_ACTION = "expo.modules.sharecardnativeshare.receiver.RECEIVED"
    const val RECEIVER_LABEL = "CC69 Receiver"
  }
}
