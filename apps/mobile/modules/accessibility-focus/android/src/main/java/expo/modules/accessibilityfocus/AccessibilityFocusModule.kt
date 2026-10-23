package expo.modules.accessibilityfocus

import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Moves TalkBack focus to a view, and reports TalkBack focus changes as the
 * native view tags from the focused view outwards. React Native's own Android
 * `setAccessibilityFocus` only sends `TYPE_VIEW_FOCUSED`, which TalkBack ignores
 * for a view that cannot take input focus; `ACTION_ACCESSIBILITY_FOCUS` asks the
 * accessibility service to move its cursor there.
 * Every accessibility event a view sends passes its ancestors'
 * `onRequestSendAccessibilityEvent`, so one delegate on the window's decor view
 * sees each focus and focus-clear in the app. React Native views carry their
 * React tag as the view id.
 */
class AccessibilityFocusModule : Module() {
  private var decorView: View? = null
  private var wrappedDelegate: View.AccessibilityDelegate? = null

  override fun definition() = ModuleDefinition {
    Name("AccessibilityFocus")

    Events("onAccessibilityFocusChange")

    AsyncFunction("focus") { tag: Int, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      activity.runOnUiThread {
        val view = activity.window?.decorView?.findViewById<View>(tag)
        promise.resolve(
          view?.performAccessibilityAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null)
            ?: false
        )
      }
    }

    OnStartObserving {
      runOnUiThread { attach() }
    }

    OnStopObserving {
      runOnUiThread { detach() }
    }

    OnActivityEntersForeground {
      runOnUiThread { if (decorView != null) attach() }
    }

    OnDestroy {
      runOnUiThread { detach() }
    }
  }

  private fun runOnUiThread(work: () -> Unit) {
    appContext.currentActivity?.runOnUiThread(work)
  }

  private fun attach() {
    val decor = appContext.currentActivity?.window?.decorView ?: return
    if (decorView === decor) return
    detach()
    val existing =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) decor.accessibilityDelegate else null
    wrappedDelegate = existing
    decor.accessibilityDelegate = FocusDelegate(existing)
    decorView = decor
  }

  private fun detach() {
    val decor = decorView ?: return
    if (decor.accessibilityDelegate is FocusDelegate) decor.accessibilityDelegate = wrappedDelegate
    decorView = null
    wrappedDelegate = null
  }

  private inner class FocusDelegate(private val wrapped: View.AccessibilityDelegate?) :
    View.AccessibilityDelegate() {
    override fun onRequestSendAccessibilityEvent(
      host: ViewGroup,
      child: View,
      event: AccessibilityEvent,
    ): Boolean {
      when (event.eventType) {
        AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED,
        AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED ->
          sendEvent("onAccessibilityFocusChange", mapOf("tags" to tagsOf(focusedView(host))))
      }
      return wrapped?.onRequestSendAccessibilityEvent(host, child, event)
        ?: super.onRequestSendAccessibilityEvent(host, child, event)
    }
  }

  private fun focusedView(view: View): View? {
    if (view.isAccessibilityFocused) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        focusedView(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }

  private fun tagsOf(view: View?): List<Int> {
    val tags = mutableListOf<Int>()
    var current: View? = view
    while (current != null) {
      if (current.id > 0) tags.add(current.id)
      current = current.parent as? View
    }
    return tags
  }
}
