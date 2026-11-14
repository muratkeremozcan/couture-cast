package expo.modules.headlessjstimers

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The AppRegistry headless task key; index.native.ts registers the same key. */
const val HEADLESS_TIMERS_TASK_KEY = "CoutureCastHeadlessJsTimers"

/**
 * React Native fires JS timers only while a host Activity is resumed or a headless JS task is
 * active (JavaTimerManager). expo-task-manager runs a background task in a process that may have
 * no resumed Activity and starts no headless JS task, so every `setTimeout` there waits for the
 * user to open the app, and `fetch`, which resolves its response through `setTimeout(0)`, never
 * settles. [begin] starts a headless JS task for one unit of background work: timers run until JS
 * resolves the task (index.native.ts does that when the work ends) or the timeout passes.
 */
class HeadlessJsTimersModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HeadlessJsTimers")

    AsyncFunction("begin") { scope: Int, timeoutMs: Double, promise: Promise ->
      val reactContext = appContext.reactContext as? ReactContext
      if (reactContext == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      // HeadlessJsTaskContext starts tasks on the UI thread only.
      Handler(Looper.getMainLooper()).post {
        try {
          val config =
            HeadlessJsTaskConfig(
              HEADLESS_TIMERS_TASK_KEY,
              Arguments.createMap().apply { putInt("scope", scope) },
              timeoutMs.toLong(),
              // The member may open or leave the app while the work runs.
              true,
            )
          promise.resolve(HeadlessJsTaskContext.getInstance(reactContext).startTask(config))
        } catch (error: Exception) {
          promise.reject("ERR_HEADLESS_JS_TIMERS", error.message, error)
        }
      }
    }
  }
}
