package expo.modules.accessibilityfocus

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
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
 *
 * `focus` moves at once. `focusAfterInitialPlacement` is for a window that just
 * appeared: TalkBack places its own first focus there some time later and would
 * overwrite an earlier move, so it waits for that placement first
 * ([InitialFocusPlacement]). A newer request of either kind replaces a pending one.
 */
class AccessibilityFocusModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val observer =
    AccessibilityFocusObserver(
      emit = { tags -> sendEvent("onAccessibilityFocusChange", mapOf("tags" to tags)) },
      mainHandler = mainHandler,
    )
  private val scheduler =
    object : InitialFocusPlacement.Scheduler {
      override fun now() = SystemClock.uptimeMillis()

      override fun post(delayMs: Long, task: () -> Unit) {
        mainHandler.postDelayed(task, delayMs)
      }
    }

  /** The pending placement; main looper only. */
  private var placement: InitialFocusPlacement? = null

  private fun decorView(): View? = appContext.currentActivity?.window?.decorView

  override fun definition() = ModuleDefinition {
    Name("AccessibilityFocus")

    Events("onAccessibilityFocusChange")

    Constants("canObserveFocus" to observer.canObserve)

    AsyncFunction("focus") { tag: Int, promise: Promise ->
      mainHandler.post {
        placement?.cancel()
        // React Native Modal lives in a Dialog window, outside the Activity decor.
        // Resolve its real React view before choosing the window to focus within.
        val view = runCatching { appContext.findView<View>(tag) }.getOrNull()
        promise.resolve(observer.moveFocus(view?.rootView ?: decorView(), tag))
      }
    }

    AsyncFunction("focusAfterInitialPlacement") { tag: Int, promise: Promise ->
      mainHandler.post { placeFocus(tag, promise) }
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
      mainHandler.post { placement?.cancel() }
      observer.stop()
    }
  }

  /** Resolves the outcome's wire name (see [InitialFocusPlacement.Outcome]). Main looper. */
  private fun placeFocus(tag: Int, promise: Promise) {
    placement?.cancel()
    val target = ViewTarget(tag)
    lateinit var run: InitialFocusPlacement
    run =
      InitialFocusPlacement(target, scheduler) { outcome ->
        target.detach()
        if (placement === run) placement = null
        promise.resolve(outcome.wire)
      }
    target.onFocusEvent = run::initialFocusObserved
    placement = run
    run.start()
  }

  /**
   * The React view with tag [tag], read fresh on every check: it may not be in its Dialog window
   * yet when the request arrives. Once it is, TalkBack's focus events in that window reach
   * [onFocusEvent] through a delegate on the window's root view.
   */
  private inner class ViewTarget(private val tag: Int) : InitialFocusPlacement.Target {
    var onFocusEvent: () -> Unit = {}
    private var root: View? = null
    private var untap: (() -> Unit)? = null

    private fun view(): View? =
      runCatching { appContext.findView<View>(tag) }.getOrNull()?.takeIf { it.isAttachedToWindow }

    override fun screenReaderOn(): Boolean {
      val manager =
        appContext.reactContext?.getSystemService(Context.ACCESSIBILITY_SERVICE)
          as? AccessibilityManager
      return manager?.isEnabled == true && manager.isTouchExplorationEnabled
    }

    override fun present(): Boolean {
      val view = view() ?: return false
      watch(view.rootView)
      return true
    }

    override fun windowFocused() = view()?.hasWindowFocus() == true

    override fun initialFocusPlaced() =
      root?.let { AccessibilityFocusObserver.focusedView(it) } != null

    override fun focused() = view()?.isAccessibilityFocused == true

    override fun move() =
      view()?.performAccessibilityAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null) ==
        true

    private fun watch(next: View) {
      if (root === next) return
      detach()
      root = next
      untap = observer.tapFocusEvents(next) { onFocusEvent() }
    }

    fun detach() {
      untap?.invoke()
      untap = null
      root = null
    }
  }
}
