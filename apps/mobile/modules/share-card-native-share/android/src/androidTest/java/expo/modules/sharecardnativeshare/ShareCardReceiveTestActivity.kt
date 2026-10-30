package expo.modules.sharecardnativeshare

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.core.content.IntentCompat
import java.security.MessageDigest
import java.util.concurrent.CompletableFuture

/** Stands in for the app a member picks: reads the shared stream the way a receiver would. */
class ShareCardReceiveTestActivity : Activity() {
  data class Received(
    val action: String?,
    val type: String?,
    val stream: Uri?,
    val clipUris: List<Uri>,
    val flags: Int,
    val extras: Set<String>,
    val sha256: String?,
    val readError: String?,
  )

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val stream = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
    val clip = intent.clipData
    var sha256: String? = null
    var readError: String? = null
    try {
      val bytes = contentResolver.openInputStream(stream!!)!!.use { it.readBytes() }
      sha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    } catch (error: Exception) {
      readError = error.javaClass.simpleName
    }
    received.complete(
      Received(
        action = intent.action,
        type = intent.type,
        stream = stream,
        clipUris = (0 until (clip?.itemCount ?: 0)).mapNotNull { clip!!.getItemAt(it).uri },
        flags = intent.flags,
        extras = intent.extras?.keySet().orEmpty().toSet(),
        sha256 = sha256,
        readError = readError,
      ),
    )
    finish()
  }

  companion object {
    @Volatile var received = CompletableFuture<Received>()
  }
}
