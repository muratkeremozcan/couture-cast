package expo.modules.accessibilityfocus

import android.annotation.SuppressLint
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeProvider

/**
 * Watches TalkBack focus for one window. Every accessibility event a view sends
 * passes its ancestors' `onRequestSendAccessibilityEvent`, so a delegate on the
 * window's decor view sees each focus and focus-clear in the app.
 *
 * The decor view may already carry a delegate. Only API 29 and later can read it
 * back, so earlier versions never install anything: replacing a delegate this
 * class cannot see would discard its behavior. Where it installs, every method
 * forwards to the delegate it found, and a detach puts that one back.
 *
 * All view work runs on the main looper. `observing` is what the module asked
 * for; an attach waits for a decor view, so observing can start before any
 * Activity exists and attaches when one appears.
 */
class AccessibilityFocusObserver(
  private val emit: (List<Int>) -> Unit,
  private val sdkInt: Int = Build.VERSION.SDK_INT,
  private val mainHandler: Handler = Handler(Looper.getMainLooper()),
) {
  /** Whether this Android version can observe without risking another delegate. */
  val canObserve: Boolean
    get() = sdkInt >= Build.VERSION_CODES.Q

  @Volatile
  private var observing = false
  private var decorProvider: () -> View? = { null }

  internal var attachedDecor: View? = null
    private set
  private var originalDelegate: View.AccessibilityDelegate? = null
  private var installedDelegate: ForwardingDelegate? = null

  /** Starts observing the decor view `decor` resolves, now or once it exists. */
  fun start(decor: () -> View?) {
    observing = true
    decorProvider = decor
    mainHandler.post { attach() }
  }

  /** Stops observing and restores the decor view's own delegate. */
  fun stop() {
    observing = false
    mainHandler.post { detach() }
  }

  /** An Activity came to the foreground: attach to its decor view if observing. */
  fun windowAvailable() {
    mainHandler.post { attach() }
  }

  /** The Activity is going away: let go of its decor view, keep observing. */
  fun windowDestroyed() {
    mainHandler.post { detach() }
  }

  // `View.getAccessibilityDelegate` is API 29; `canObserve` gates it.
  @SuppressLint("NewApi")
  private fun attach() {
    if (!observing || !canObserve) return
    val decor = decorProvider() ?: return
    if (attachedDecor === decor) return
    detach()
    val existing = decor.accessibilityDelegate
    val delegate = ForwardingDelegate(existing)
    decor.accessibilityDelegate = delegate
    attachedDecor = decor
    originalDelegate = existing
    installedDelegate = delegate
  }

  private fun detach() {
    val decor = attachedDecor ?: return
    // Someone who replaced this delegate since keeps theirs.
    if (decor.accessibilityDelegate === installedDelegate) {
      decor.accessibilityDelegate = originalDelegate
    }
    attachedDecor = null
    originalDelegate = null
    installedDelegate = null
  }

  private fun report(host: View) {
    emit(tagsOf(focusedView(host)))
  }

  /** Forwards every call to the delegate it wraps, or to the platform default. */
  inner class ForwardingDelegate(private val wrapped: View.AccessibilityDelegate?) :
    View.AccessibilityDelegate() {
    override fun onRequestSendAccessibilityEvent(
      host: ViewGroup,
      child: View,
      event: AccessibilityEvent,
    ): Boolean {
      when (event.eventType) {
        AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED,
        AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED -> report(host)
      }
      return wrapped?.onRequestSendAccessibilityEvent(host, child, event)
        ?: super.onRequestSendAccessibilityEvent(host, child, event)
    }

    override fun sendAccessibilityEvent(host: View, eventType: Int) {
      wrapped?.sendAccessibilityEvent(host, eventType)
        ?: super.sendAccessibilityEvent(host, eventType)
    }

    override fun sendAccessibilityEventUnchecked(host: View, event: AccessibilityEvent) {
      wrapped?.sendAccessibilityEventUnchecked(host, event)
        ?: super.sendAccessibilityEventUnchecked(host, event)
    }

    override fun dispatchPopulateAccessibilityEvent(
      host: View,
      event: AccessibilityEvent,
    ): Boolean =
      wrapped?.dispatchPopulateAccessibilityEvent(host, event)
        ?: super.dispatchPopulateAccessibilityEvent(host, event)

    override fun onPopulateAccessibilityEvent(host: View, event: AccessibilityEvent) {
      wrapped?.onPopulateAccessibilityEvent(host, event)
        ?: super.onPopulateAccessibilityEvent(host, event)
    }

    override fun onInitializeAccessibilityEvent(host: View, event: AccessibilityEvent) {
      wrapped?.onInitializeAccessibilityEvent(host, event)
        ?: super.onInitializeAccessibilityEvent(host, event)
    }

    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
      wrapped?.onInitializeAccessibilityNodeInfo(host, info)
        ?: super.onInitializeAccessibilityNodeInfo(host, info)
    }

    override fun addExtraDataToAccessibilityNodeInfo(
      host: View,
      info: AccessibilityNodeInfo,
      extraDataKey: String,
      arguments: Bundle?,
    ) {
      wrapped?.addExtraDataToAccessibilityNodeInfo(host, info, extraDataKey, arguments)
        ?: super.addExtraDataToAccessibilityNodeInfo(host, info, extraDataKey, arguments)
    }

    override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean =
      wrapped?.performAccessibilityAction(host, action, args)
        ?: super.performAccessibilityAction(host, action, args)

    override fun getAccessibilityNodeProvider(host: View): AccessibilityNodeProvider? =
      if (wrapped != null) wrapped.getAccessibilityNodeProvider(host)
      else super.getAccessibilityNodeProvider(host)
  }

  /**
   * Asks the accessibility service to move its cursor to the view with React tag
   * `tag` under `decor`. False when the view is not there yet or the service
   * cannot take it (no screen reader, or touch exploration off).
   *
   * A view that already holds the cursor refuses the action and sends no event,
   * so it counts as moved and the observed window reports the focus it holds.
   * Runs on the main looper.
   */
  fun moveFocus(decor: View?, tag: Int): Boolean {
    val view = decor?.findViewById<View>(tag) ?: return false
    if (view.isAccessibilityFocused) {
      attachedDecor?.takeIf { it === decor }?.let { report(it) }
      return true
    }
    return view.performAccessibilityAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null)
  }

  companion object {
    internal fun focusedView(view: View): View? {
      if (view.isAccessibilityFocused) return view
      if (view is ViewGroup) {
        for (index in 0 until view.childCount) {
          focusedView(view.getChildAt(index))?.let { return it }
        }
      }
      return null
    }

    internal fun tagsOf(view: View?): List<Int> {
      val tags = mutableListOf<Int>()
      var current: View? = view
      while (current != null) {
        if (current.id > 0) tags.add(current.id)
        current = current.parent as? View
      }
      return tags
    }
  }
}
