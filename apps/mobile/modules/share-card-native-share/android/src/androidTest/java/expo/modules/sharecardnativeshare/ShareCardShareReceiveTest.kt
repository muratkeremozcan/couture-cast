package expo.modules.sharecardnativeshare

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * N-AND-RECEIVE on a real device. The receiving Activity gets the exact `ACTION_SEND` the chooser
 * wraps and reads the PNG through the module's provider; its SHA256 equals the previewed digest.
 * The shell then stands in for another app's UID: the granted URI is readable, while a sibling
 * `cc69-share-*` file that was never granted and every out-of-scope URI are denied. Receivers see
 * the card as `couturecast-card.png` with its real size, never its cache name.
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
    shared = write(File(directory, "cc69-share-${UUID.randomUUID()}.png"))
    sibling = write(File(directory, "cc69-share-${UUID.randomUUID()}.png"))
    outside = write(File(context.cacheDir, "cc69-share-${UUID.randomUUID()}.png"))
    expected = ShareCardShareFiles.sha256(shared)
    uri = FileProvider.getUriForFile(context, authority, ShareCardShareFiles.validate(context.cacheDir, shared.toURI().toString(), expected)!!)
    ShareCardReceiveTestActivity.received = java.util.concurrent.CompletableFuture()
  }

  @After
  fun cleanUp() {
    context.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    listOf(shared, sibling, outside).forEach { it.delete() }
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
      assertTrue(shared.name.startsWith("cc69-share-"))
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
}
