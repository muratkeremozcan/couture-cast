package expo.modules.sharecardnativeshare.receiver

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.provider.OpenableColumns
import java.security.MessageDigest

/**
 * Stands in for another app a member picks in the chooser. It runs under its own UID, reads the
 * shared stream with whatever grant arrived, and broadcasts what it saw to the receive test.
 */
class ShareCardTestReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val stream =
      if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
    val result =
      Intent(RESULT_ACTION)
        .setPackage(TEST_PACKAGE)
        .putExtra("uid", Process.myUid())
        .putExtra("action", intent.action)
        .putExtra("type", intent.type)
        .putExtra("stream", stream?.toString())
        .putExtra("clipItems", intent.clipData?.itemCount ?: 0)
        .putExtra("extras", ArrayList(intent.extras?.keySet().orEmpty().sorted()))
    try {
      val bytes = contentResolver.openInputStream(stream!!)!!.use { it.readBytes() }
      result.putExtra(
        "sha256",
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) },
      )
      contentResolver.query(stream, null, null, null, null)!!.use { cursor ->
        if (cursor.moveToFirst()) {
          result.putExtra("displayName", cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)))
          result.putExtra("size", cursor.getLong(cursor.getColumnIndexOrThrow(OpenableColumns.SIZE)))
        }
      }
    } catch (error: Exception) {
      result.putExtra("readError", error.javaClass.simpleName)
    }
    sendBroadcast(result)
    finish()
  }

  companion object {
    const val RESULT_ACTION = "expo.modules.sharecardnativeshare.receiver.RECEIVED"
    const val TEST_PACKAGE = "expo.modules.sharecardnativeshare.test"
  }
}
