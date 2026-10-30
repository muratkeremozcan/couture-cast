package expo.modules.sharecardnativeshare

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo bridge for [ShareCardShareController]. It lives outside `src/main/java` so the pure
 * sources build and run under Robolectric in `unit-tests/` without the Expo runtime.
 */
class ShareCardNativeShareModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val controller = ShareCardShareController(mainHandler)

  override fun definition() = ModuleDefinition {
    Name("ShareCardNativeShare")

    // The anchor positions the iPad popover; Android's chooser has no anchor.
    AsyncFunction("shareFile") {
      fileUri: String,
      expectedSha256: String,
      _: Map<String, Any?>?,
      promise: Promise ->
      mainHandler.post {
        controller.share(
          appContext.reactContext,
          appContext.currentActivity,
          fileUri,
          expectedSha256,
        ) { result -> promise.resolve(result) }
      }
    }

    OnActivityEntersBackground { mainHandler.post { controller.hostPaused() } }

    OnActivityEntersForeground { mainHandler.post { controller.hostResumed() } }

    OnActivityDestroys { mainHandler.post { controller.hostDestroyed() } }

    OnDestroy { mainHandler.post { controller.hostDestroyed() } }
  }
}
