package expo.modules.sharecardnativeshare

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.service.chooser.ChooserResult
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat

/** What one chooser callback observed. Package names stop at the target mapper. */
sealed interface ShareCardChooserSelection {
  /**
   * An app was selected. A pre-Android 15 callback without a component still means chosen, so a
   * missing package maps to `other`.
   */
  data class App(val packageName: String?) : ShareCardChooserSelection

  /**
   * An Android 15+ result that selects no app: Copy, Edit, an unknown type or no component. It
   * settles as `not_confirmed`, because no selected target is confirmed.
   */
  data object NoTarget : ShareCardChooserSelection
}

/**
 * The chooser's per-attempt callback. The PendingIntent is mutable so the system can fill in
 * `EXTRA_CHOSEN_COMPONENT`, and its Intent is bound to this package with the attempt id in the
 * action, which Android 14 requires of a mutable PendingIntent. The receiver is not exported.
 * `Intent.createChooser` files the sender under the chosen-component extra before Android 15 and
 * the chooser-result extra from then on.
 */
class ShareCardChooserCallback
private constructor(
  private val context: Context,
  val action: String,
  val pendingIntent: PendingIntent,
  private val receiver: BroadcastReceiver,
) {
  private var tornDown = false

  /** Cancels the PendingIntent and unregisters the receiver; later calls do nothing. */
  fun teardown() {
    if (tornDown) return
    tornDown = true
    pendingIntent.cancel()
    runCatching { context.unregisterReceiver(receiver) }
  }

  companion object {
    fun action(context: Context, attemptId: String) =
      "${context.packageName}.sharecardnativeshare.CHOSEN.$attemptId"

    val pendingIntentFlags: Int =
      PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)

    const val receiverFlags = ContextCompat.RECEIVER_NOT_EXPORTED

    /**
     * Android 15+ fills in `EXTRA_CHOOSER_RESULT`. Only a component selection that names a
     * component is an app; Copy, Edit, an unknown type or a missing component is
     * [ShareCardChooserSelection.NoTarget]. Without a chooser result, the earlier
     * `EXTRA_CHOSEN_COMPONENT` callback means an app was chosen.
     */
    fun selection(intent: Intent): ShareCardChooserSelection {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
        val result =
          IntentCompat.getParcelableExtra(intent, Intent.EXTRA_CHOOSER_RESULT, ChooserResult::class.java)
        if (result != null) {
          val component = result.selectedComponent
          return if (result.type == ChooserResult.CHOOSER_RESULT_SELECTED_COMPONENT && component != null)
            ShareCardChooserSelection.App(component.packageName)
          else ShareCardChooserSelection.NoTarget
        }
      }
      return ShareCardChooserSelection.App(
        IntentCompat.getParcelableExtra(intent, Intent.EXTRA_CHOSEN_COMPONENT, ComponentName::class.java)
          ?.packageName
      )
    }

    fun register(
      context: Context,
      attemptId: String,
      onChosen: (attemptId: String, selection: ShareCardChooserSelection) -> Unit,
    ): ShareCardChooserCallback {
      val action = action(context, attemptId)
      val receiver =
        object : BroadcastReceiver() {
          override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != action) return
            onChosen(attemptId, selection(intent))
          }
        }
      ContextCompat.registerReceiver(context, receiver, IntentFilter(action), receiverFlags)
      val pendingIntent =
        try {
          PendingIntent.getBroadcast(
            context,
            attemptId.hashCode(),
            Intent(action).setPackage(context.packageName),
            pendingIntentFlags,
          )
        } catch (error: RuntimeException) {
          context.unregisterReceiver(receiver)
          throw error
        }
      return ShareCardChooserCallback(context, action, pendingIntent, receiver)
    }
  }
}
