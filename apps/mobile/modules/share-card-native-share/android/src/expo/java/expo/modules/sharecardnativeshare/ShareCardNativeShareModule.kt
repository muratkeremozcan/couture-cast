package expo.modules.sharecardnativeshare

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo bridge for [ShareCardShareController] and [ShareCardHostLifecycle]. It lives outside
 * `src/main/java` so the pure sources build and run under Robolectric in `unit-tests/` without
 * the Expo runtime.
 */
class ShareCardNativeShareModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val controller = ShareCardShareController(mainHandler)
  private val lifecycle = ShareCardHostLifecycle(mainHandler, controller)

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

    OnActivityEntersBackground { lifecycle.on(ShareCardHostEvent.ACTIVITY_ENTERS_BACKGROUND) }

    OnActivityEntersForeground { lifecycle.on(ShareCardHostEvent.ACTIVITY_ENTERS_FOREGROUND) }

    OnActivityDestroys { lifecycle.on(ShareCardHostEvent.ACTIVITY_DESTROYS) }

    OnDestroy { lifecycle.on(ShareCardHostEvent.MODULE_DESTROYS) }
  }
}
