package expo.modules.sharecardnativeshare

import android.content.ClipData
import android.content.Intent
import android.content.IntentSender
import android.net.Uri

/** `ACTION_SEND` of one PNG with a read grant, no text or subject, inside the system chooser. */
object ShareCardChooserIntent {
  fun build(uri: Uri, callback: IntentSender): Intent {
    val send =
      Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri(null, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    return Intent.createChooser(send, null, callback).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
  }
}
