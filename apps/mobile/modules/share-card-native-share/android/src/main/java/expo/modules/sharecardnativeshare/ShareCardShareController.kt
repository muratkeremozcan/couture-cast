package expo.modules.sharecardnativeshare

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import java.util.UUID

/**
 * Starts the system chooser for one validated file and settles through [ShareCardShareSession].
 * The Expo module only forwards calls and host lifecycle events here. Main thread only.
 */
class ShareCardShareController(
  private val handler: Handler = Handler(Looper.getMainLooper()),
  private val newAttemptId: () -> String = { UUID.randomUUID().toString() },
) {
  val session =
    ShareCardShareSession(
      schedule = { delayMs, action ->
        val runnable = Runnable(action)
        handler.postDelayed(runnable, delayMs)
        ({ handler.removeCallbacks(runnable) })
      },
    )

  fun share(
    context: Context?,
    activity: Activity?,
    fileUri: String,
    expectedSha256: String,
    resolve: (Map<String, String>) -> Unit,
  ) {
    if (session.isActive) {
      resolve(ShareCardShareResult.failed(ShareCardShareCode.BUSY).toBridge())
      return
    }
    if (context == null || activity == null || activity.isFinishing) {
      resolve(ShareCardShareResult.failed(ShareCardShareCode.START_FAILED).toBridge())
      return
    }
    val uri =
      ShareCardShareFiles.validate(context.cacheDir, fileUri, expectedSha256)?.let { file ->
        runCatching {
            FileProvider.getUriForFile(context, ShareCardShareFiles.authority(context), file)
          }
          .getOrNull()
      }
    if (uri == null) {
      resolve(ShareCardShareResult.failed(ShareCardShareCode.FILE_INVALID).toBridge())
      return
    }
    val attemptId = newAttemptId()
    var callback: ShareCardChooserCallback? = null
    session.begin(attemptId, teardown = { callback?.teardown() }, settle = { resolve(it.toBridge()) })
    try {
      callback =
        ShareCardChooserCallback.register(context, attemptId) { id, selection ->
          session.chooserCallback(id, selection)
        }
      activity.startActivity(ShareCardChooserIntent.build(uri, callback.pendingIntent.intentSender))
    } catch (error: ActivityNotFoundException) {
      session.startFailed(ShareCardShareResult.chooserUnavailable)
    } catch (error: RuntimeException) {
      session.startFailed(ShareCardShareResult.failed(ShareCardShareCode.START_FAILED))
    }
  }

  fun hostPaused() = session.hostPaused()

  fun hostResumed() = session.hostResumed()

  fun hostDestroyed() = session.hostDestroyed()
}
