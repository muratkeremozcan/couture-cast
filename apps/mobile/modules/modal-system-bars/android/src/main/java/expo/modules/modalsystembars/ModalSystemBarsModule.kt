package expo.modules.modalsystembars

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsetsController
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Styles only the window containing the supplied attached React view. A React
 * Native Modal owns a Dialog window independently of the Activity status bar. */
internal fun setDarkModalStatusBar(view: View?): Boolean {
  if (view == null || !view.isAttachedToWindow) return false
  val root = view.rootView
  if (Build.VERSION.SDK_INT >= 30) {
    val controller = root.windowInsetsController ?: return false
    controller.setSystemBarsAppearance(
      WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
      WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
    )
  } else {
    @Suppress("DEPRECATION")
    root.systemUiVisibility = root.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
  }
  return true
}
class ModalSystemBarsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ModalSystemBars")
    AsyncFunction("setDarkStatusBar") { tag: Int, promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        val view = runCatching { appContext.findView<View>(tag) }.getOrNull()
        promise.resolve(setDarkModalStatusBar(view))
      }
    }
  }
}
