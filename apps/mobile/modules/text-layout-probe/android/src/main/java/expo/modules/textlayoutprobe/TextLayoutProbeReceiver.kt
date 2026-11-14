package expo.modules.textlayoutprobe

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.inspector.WindowInspector

/**
 * Answers `adb shell am broadcast -a com.couturecast.textlayoutprobe.DUMP --es token <t> -p <app>`
 * with the text layout of every window in logcat. Only a sender holding android.permission.DUMP
 * reaches it, which the adb shell does and no installed app can (signature|privileged).
 */
class TextLayoutProbeReceiver(
  private val roots: () -> List<View>,
  private val write: (String) -> Unit = { Log.i(TextLayoutProbeWire.TAG, it) }
) : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val token = intent.getStringExtra(TextLayoutProbeWire.TOKEN_EXTRA)
    if (!TextLayoutProbeWire.acceptsToken(token)) {
      Log.w(TextLayoutProbeWire.TAG, "rejected a request without a valid token")
      return
    }
    // No answer when a recognised class or the testID tag key is missing: the harness then fails
    // the leg on a missing answer, where a partial one would hide text or identifiers from it.
    val classes =
      ReactNativeTextClasses.load(context.classLoader, context.resources, context.packageName)
    if (classes == null) {
      Log.e(TextLayoutProbeWire.TAG, "error $token react_native_text_classes_missing")
      return
    }
    val json =
      try {
        TextLayoutProbeWire.json(token!!, TextLayoutSnapshot(classes).capture(roots()))
      } catch (error: RuntimeException) {
        Log.e(TextLayoutProbeWire.TAG, "error $token ${error.javaClass.name}", error)
        return
      }
    TextLayoutProbeWire.lines(token, json).forEach(write)
  }

  companion object {
    /**
     * Registers the receiver on the main looper, so every read runs on the UI thread. API 29 and
     * later only: WindowInspector, which lists every window root (the composer's modal dialog
     * beside the Activity), and View.transformMatrixToGlobal, which maps every box, line and clip
     * through scaled and flipped ancestors, arrived in Android 10. Below API 29 nothing is
     * registered and null is returned, so a request gets no answer at all (never one with unmapped
     * boxes) and the harness fails the leg on the missing answer (live_font_text_probe_missing).
     */
    fun register(context: Context): TextLayoutProbeReceiver? {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
      val receiver = TextLayoutProbeReceiver({ WindowInspector.getGlobalWindowViews() })
      val filter = IntentFilter(TextLayoutProbeWire.ACTION)
      val handler = Handler(Looper.getMainLooper())
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(
          receiver,
          filter,
          Manifest.permission.DUMP,
          handler,
          Context.RECEIVER_EXPORTED
        )
      } else {
        context.registerReceiver(receiver, filter, Manifest.permission.DUMP, handler)
      }
      return receiver
    }
  }
}
