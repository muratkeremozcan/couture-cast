package expo.modules.sharecardnativeshare

import android.os.Handler

/** The Expo host lifecycle events a share attempt reacts to. */
enum class ShareCardHostEvent {
  /** `OnActivityEntersBackground`: the chooser covered the host. */
  ACTIVITY_ENTERS_BACKGROUND,

  /** `OnActivityEntersForeground`: the host is visible again. */
  ACTIVITY_ENTERS_FOREGROUND,

  /** `OnActivityDestroys`: the host activity is recreated or finished. */
  ACTIVITY_DESTROYS,

  /** `OnDestroy`: the module itself goes away with the React instance. */
  MODULE_DESTROYS,
}

/**
 * Maps each Expo host lifecycle event onto [ShareCardShareController] on the main thread. The
 * Expo module only forwards events here, so the mapping builds and runs under Robolectric.
 */
class ShareCardHostLifecycle(
  private val handler: Handler,
  private val controller: ShareCardShareController,
) {
  fun on(event: ShareCardHostEvent) {
    handler.post {
      when (event) {
        ShareCardHostEvent.ACTIVITY_ENTERS_BACKGROUND -> controller.hostPaused()
        ShareCardHostEvent.ACTIVITY_ENTERS_FOREGROUND -> controller.hostResumed()
        ShareCardHostEvent.ACTIVITY_DESTROYS,
        ShareCardHostEvent.MODULE_DESTROYS -> controller.hostDestroyed()
      }
    }
  }
}
