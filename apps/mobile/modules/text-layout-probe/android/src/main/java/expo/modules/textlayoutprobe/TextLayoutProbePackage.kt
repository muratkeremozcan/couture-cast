package expo.modules.textlayoutprobe

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Story 6.15 F-00i: registers the text layout probe's receiver from `Application.onCreate`. The
 * module is linked only into builds prebuilt with COUTURE_TEXT_LAYOUT_PROBE=1
 * (plugins/with-text-layout-probe.js); every other build has no trace of it.
 */
class TextLayoutProbePackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context
  ): List<ApplicationLifecycleListener> = listOf(TextLayoutProbeLifecycleListener())
}

class TextLayoutProbeLifecycleListener : ApplicationLifecycleListener {
  override fun onCreate(application: Application) {
    TextLayoutProbeReceiver.register(application)
  }
}
