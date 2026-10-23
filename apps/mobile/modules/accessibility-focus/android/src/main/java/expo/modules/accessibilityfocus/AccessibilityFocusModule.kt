package expo.modules.accessibilityfocus

import android.os.Handler
import android.os.Looper
import android.view.View
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Moves TalkBack focus to a view, and reports TalkBack focus changes as the
 * native view tags from the focused view outwards. React Native's own Android
 * `setAccessibilityFocus` only sends `TYPE_VIEW_FOCUSED`, which TalkBack ignores
 * for a view that cannot take input focus; `ACTION_ACCESSIBILITY_FOCUS` asks the
 * accessibility service to move its cursor there. React Native views carry their
 * React tag as the view id.
 */
class AccessibilityFocusModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val observer =
    AccessibilityFocusObserver(
      emit = { tags -> sendEvent("onAccessibilityFocusChange", mapOf("tags" to tags)) },
      mainHandler = mainHandler,
    )

  private fun decorView(): View? = appContext.currentActivity?.window?.decorView

  override fun definition() = ModuleDefinition {
    Name("AccessibilityFocus")

    Events("onAccessibilityFocusChange")

    Constants("canObserveFocus" to observer.canObserve)

    AsyncFunction("focus") { tag: Int, promise: Promise ->
      mainHandler.post {
        promise.resolve(observer.moveFocus(decorView(), tag))
      }
    }

    OnStartObserving {
      observer.start(::decorView)
    }

    OnStopObserving {
      observer.stop()
    }

    OnActivityEntersForeground {
      observer.windowAvailable()
    }

    OnActivityDestroys {
      observer.windowDestroyed()
    }

    OnDestroy {
      observer.stop()
    }
  }
}
